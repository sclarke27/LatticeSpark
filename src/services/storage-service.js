#!/usr/bin/env node
/**
 * Storage Service
 *
 * Historical sensor data storage and query service.
 * - SQLite database for sensor readings (using better-sqlite3 - native C++ addon)
 * - WAL mode for concurrent reads/writes without blocking
 * - Socket.IO server for real-time data ingestion from sensor-service
 * - REST API for historical queries
 * - Configurable retention policy
 * - Automatic cleanup of old data
 */

import Database from 'better-sqlite3';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { BaseService } from './base-service.js';
import { StorageBuffer } from './storage-buffer.js';
import { deleteExpiredReadings } from './storage-retention.js';
import { queryHistory } from './storage-history.js';
import { requireApiKey as createApiKeyMiddleware } from '../utils/auth.js';
import { loadClusterConfig } from '../cluster/cluster-config.js';
import { createLogger } from '../utils/logger.js';
import { startHealthMonitor } from '../utils/health-monitor.js';
import { statSync } from 'fs';

const log = createLogger('storage-service');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.STORAGE_SERVICE_PORT || 3001;
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'sensors.db');
const RETENTION_HOURS = parseInt(process.env.RETENTION_HOURS || '168', 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.STORAGE_FLUSH_MS || '250', 10);
const BUFFER_MAX_ROWS = parseInt(process.env.STORAGE_BUFFER_MAX_ROWS || '20000', 10);
const CLEANUP_CHUNK_ROWS = 10000;

let db = null;
let insertStmt = null;
let insertMany = null;
const storageBuffer = new StorageBuffer({ maxRows: BUFFER_MAX_ROWS });
let lastFlushErrorLogAt = 0;
let lastDropWarnAt = 0;

// ── Database ────────────────────────────────────────────────────────────────

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT,
      timestamp REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sensor_timestamp
      ON sensor_readings(sensor_id, timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metric_timestamp
      ON sensor_readings(sensor_id, metric, timestamp DESC)
  `);

  // Timestamp-only index for cleanup DELETE performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_timestamp
      ON sensor_readings(timestamp)
  `);
}

function initializeDatabase() {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  log.info('Opening database: %s', DB_PATH);
  db = new Database(DB_PATH);

  // WAL mode: readers don't block writers, writers don't block readers
  db.pragma('journal_mode = WAL');

  // Cap WAL file size — truncated back to <=64MB at checkpoint
  db.pragma('journal_size_limit = 67108864');

  // Performance tuning
  db.pragma('synchronous = NORMAL');  // safe with WAL
  db.pragma('cache_size = -8000');    // 8MB cache
  db.pragma('busy_timeout = 5000');

  // Migrate to incremental auto-vacuum if not already set
  const autoVacuum = db.pragma('auto_vacuum', { simple: true });
  if (autoVacuum === 0) {
    log.info('Migrating database to incremental auto-vacuum...');
    db.pragma('auto_vacuum = INCREMENTAL');
    db.exec('VACUUM');
    log.info('Auto-vacuum migration complete');
  }

  initializeSchema();

  // Prepare cached statements
  insertStmt = db.prepare(`
    INSERT INTO sensor_readings (sensor_id, metric, value, unit, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertMany = db.transaction((readings) => {
    for (const r of readings) {
      insertStmt.run(r.sensorId, r.metric, r.value, r.unit, r.timestamp);
    }
  });

  log.info('Database ready (WAL mode)');
}

// Parse sensor data and enqueue rows for the micro-batch flush
function storeSensorReading(sensorId, data, timestamp) {
  const readings = [];

  for (const [key, value] of Object.entries(data)) {
    if (key === 'timestamp') continue;

    // Only store numeric values (skip strings like LCD text)
    const numValue = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(numValue)) continue;

    // Determine unit based on metric name
    let unit = null;
    if (key === 'temperature') unit = '°C';
    else if (key === 'humidity') unit = '%';
    else if (key === 'distance') unit = 'cm';

    readings.push({ sensorId, metric: key, value: numValue, unit, timestamp });
  }

  if (readings.length > 0) {
    storageBuffer.push(readings);
  }
}

// Flush buffered rows in one transaction. On failure the transaction rolls
// back and rows stay queued for the next tick; the buffer cap bounds memory
// if the DB stays unavailable.
function flushStorageBuffer() {
  const dropped = storageBuffer.takeDropped();
  if (dropped > 0 && Date.now() - lastDropWarnAt > 10000) {
    lastDropWarnAt = Date.now();
    log.warn('Storage buffer overflow — dropped %d oldest readings (total %d)',
      dropped, storageBuffer.droppedTotal);
  }
  if (!db || storageBuffer.size === 0) return;
  try {
    insertMany(storageBuffer.peekAll());
    storageBuffer.clear();
  } catch (err) {
    if (Date.now() - lastFlushErrorLogAt > 10000) {
      lastFlushErrorLogAt = Date.now();
      log.error({ err, buffered: storageBuffer.size }, 'Storage flush failed — will retry');
    }
  }
}

let lastCleanup = { at: null, status: 'pending', rowsDeleted: 0, error: null };

let cleanupInProgress = false;

// Delete old data in chunks, yielding between chunks so ingestion is never
// stalled. Runs from a setInterval — the try/catch spans the whole body so
// the returned promise never rejects; failures surface via the health check.
async function cleanupOldData() {
  if (cleanupInProgress) return;
  cleanupInProgress = true;
  const cutoffTimestamp = Date.now() / 1000 - (RETENTION_HOURS * 3600);
  const startedAt = Date.now();
  try {
    const rowsDeleted = await deleteExpiredReadings(db, cutoffTimestamp, CLEANUP_CHUNK_ROWS);
    if (rowsDeleted > 0) {
      log.info('Cleaned up %d old readings (older than %dh)', rowsDeleted, RETENTION_HOURS);
      // Reclaim space incrementally (free up to 1000 pages, non-blocking)
      if (db.open) db.pragma('incremental_vacuum(1000)');
    }
    lastCleanup = {
      at: startedAt,
      status: 'ok',
      rowsDeleted,
      durationMs: Date.now() - startedAt,
      error: null
    };
  } catch (err) {
    lastCleanup = {
      at: startedAt,
      status: 'error',
      rowsDeleted: 0,
      durationMs: Date.now() - startedAt,
      error: err.message
    };
    log.error({ err }, 'Retention cleanup failed — DB will grow until resolved');
  } finally {
    cleanupInProgress = false;
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

const clusterConfig = loadClusterConfig();
const API_KEY = clusterConfig.apiKey || '';

const service = new BaseService('storage-service', { port: PORT });
const { app } = service;

// Require API key for all REST endpoints (when configured)
app.use('/api', createApiKeyMiddleware(API_KEY));

// Periodic task handles for cleanup on shutdown
const periodicTimers = [];

let ingestCount = 0;
let stopHealthMonitor = null;

function startPeriodicTasks() {
  // Micro-batch flush of buffered readings
  periodicTimers.push(setInterval(flushStorageBuffer, FLUSH_INTERVAL_MS));

  // Cleanup old data every 5 minutes (small chunks, yields between chunks)
  periodicTimers.push(setInterval(() => {
    log.info('Running cleanup task...');
    cleanupOldData();
  }, 300000));

  // Run cleanup once shortly after startup
  periodicTimers.push(setTimeout(() => {
    cleanupOldData();
  }, 5000));
}

// ── Socket.IO Server (sensor data ingestion) ────────────────────────────────

let storageIo = null;

function setupSocketServer() {
  storageIo = new Server(service.httpServer, {
    transports: ['websocket'],
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Auth middleware — same pattern as fleet-service
  if (API_KEY) {
    storageIo.use((socket, next) => {
      const key = socket.handshake.auth?.apiKey
        || socket.handshake.headers?.['x-api-key']
        || '';
      if (key === API_KEY) return next();
      log.warn('Rejected storage socket auth from %s', socket.handshake.address || 'unknown');
      next(new Error('unauthorized'));
    });
  }

  storageIo.on('connection', (socket) => {
    log.info({ socketId: socket.id }, 'Sensor service connected for storage writes');

    socket.on('store', ({ sensorId, data, timestamp }) => {
      try {
        if (!sensorId || !data) return;
        const ts = timestamp || Date.now() / 1000;
        storeSensorReading(sensorId, data, ts);
        ingestCount++;
      } catch (error) {
        log.error({ err: error, sensorId }, 'Socket store error');
      }
    });

    socket.on('disconnect', () => {
      log.info({ socketId: socket.id }, 'Sensor service disconnected');
    });
  });
}

// ── REST API ────────────────────────────────────────────────────────────────

// Store sensor data (backward-compatible HTTP endpoint). The write is
// queued for the next micro-batch flush (≤~250ms), not yet durable when
// the response is sent.
app.post('/api/data', (req, res) => {
  try {
    const { sensorId, data, timestamp } = req.body;

    if (!sensorId || !data) {
      return res.status(400).json({ error: 'Missing sensorId or data' });
    }

    const ts = timestamp || Date.now() / 1000;
    storeSensorReading(sensorId, data, ts);

    res.json({ status: 'ok', stored: true });
  } catch (error) {
    log.error({ err: error }, 'Error storing data');
    res.status(500).json({ error: 'Storage write failed' });
  }
});

// Query historical data
app.get('/api/history/:sensorId', (req, res) => {
  try {
    const { sensorId } = req.params;
    const { metric, start, end, limit } = req.query;

    const results = queryHistory(db, sensorId, {
      metric: metric || null,
      start: start ? parseFloat(start) : null,
      end: end ? parseFloat(end) : null,
      limit: limit ? parseInt(limit, 10) : 1000,
      maxWindowSec: RETENTION_HOURS * 3600
    });

    res.json({
      sensorId,
      metric: metric || 'all',
      count: results.length,
      data: results
    });
  } catch (error) {
    log.error({ err: error }, 'Error querying history');
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get available sensors
app.get('/api/sensors', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT DISTINCT sensor_id FROM sensor_readings ORDER BY sensor_id'
    ).all();
    res.json({ sensors: rows.map(r => r.sensor_id) });
  } catch (error) {
    log.error({ err: error }, 'Error getting sensors');
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get metrics for a sensor
app.get('/api/sensors/:sensorId/metrics', (req, res) => {
  try {
    const { sensorId } = req.params;
    // Covering-index distinct scan on idx_metric_timestamp (DISTINCT metric,
    // unit would force a per-row table fetch — unit is not indexed)
    const metricRows = db.prepare(
      'SELECT DISTINCT metric FROM sensor_readings WHERE sensor_id = ? ORDER BY metric'
    ).all(sensorId);
    // Latest unit per metric: single index seek + one row fetch each
    const unitStmt = db.prepare(
      'SELECT unit FROM sensor_readings WHERE sensor_id = ? AND metric = ? ORDER BY timestamp DESC LIMIT 1'
    );
    const metrics = metricRows.map(({ metric }) => ({
      metric,
      unit: unitStmt.get(sensorId, metric)?.unit ?? null
    }));
    res.json({ sensorId, metrics });
  } catch (error) {
    log.error({ err: error }, 'Error getting metrics');
    res.status(500).json({ error: 'Query failed' });
  }
});

// Health check — lightweight index-only query
service.registerHealthCheck(async () => {
  const row = db.prepare(
    'SELECT MAX(timestamp) as newest_reading FROM sensor_readings'
  ).get();

  const cleanupHealthy = lastCleanup.status !== 'error';

  return {
    status: cleanupHealthy ? 'ok' : 'degraded',
    database: 'connected',
    retention_hours: RETENTION_HOURS,
    stats: {
      newest_reading: row?.newest_reading
        ? new Date(row.newest_reading * 1000).toISOString()
        : null
    },
    cleanup: {
      ...lastCleanup,
      at: lastCleanup.at ? new Date(lastCleanup.at).toISOString() : null
    },
    uptime: process.uptime()
  };
});

// Override initialize to set up database and Socket.IO
const originalInitialize = service.initialize.bind(service);
service.initialize = async () => {
  await originalInitialize();
  try {
    initializeDatabase();
    setupSocketServer();
    startPeriodicTasks();
  } catch (err) {
    log.error({ err }, 'Failed to initialize database');
    process.exit(1);
  }
  stopHealthMonitor = startHealthMonitor({
    log,
    intervalMs: parseInt(process.env.HEALTH_HEARTBEAT_MS || '60000', 10),
    getStats: () => {
      let dbSizeMb = null;
      try { dbSizeMb = Math.round(statSync(DB_PATH).size / 1024 / 1024); } catch {}
      const batch = ingestCount;
      ingestCount = 0;
      return {
        ingestsSinceLast: batch,
        dbSizeMb,
        storageClients: storageIo?.sockets?.sockets?.size ?? 0,
        bufferedRows: storageBuffer.size,
        droppedRows: storageBuffer.droppedTotal,
        lastCleanupStatus: lastCleanup.status,
        lastCleanupRows: lastCleanup.rowsDeleted
      };
    }
  });
  log.info('Ready - Retention: %d hours', RETENTION_HOURS);
  log.info('Database: %s (WAL mode)', DB_PATH);
};

// Override onShutdown for database cleanup
service.onShutdown = async () => {
  if (stopHealthMonitor) { stopHealthMonitor(); stopHealthMonitor = null; }

  periodicTimers.forEach(id => clearTimeout(id));
  periodicTimers.length = 0;

  if (storageIo) {
    storageIo.close();
  }

  // Persist any buffered readings before closing the DB (flushStorageBuffer
  // catches its own errors; timers were already cleared above so no flush
  // can fire after db.close())
  flushStorageBuffer();

  if (db) {
    log.info('Closing database...');
    db.close();
  }
};

// Start the service
service.start();
