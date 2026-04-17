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

let db = null;
let insertStmt = null;
let insertMany = null;

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

// Store sensor reading
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
    insertMany(readings);
  }
}

// Query historical data — downsamples evenly when rows exceed limit
function queryHistory(sensorId, metric, start, end, limit = 1000) {
  let whereClause = 'WHERE sensor_id = ?';
  const params = [sensorId];

  if (metric) {
    whereClause += ' AND metric = ?';
    params.push(metric);
  }

  if (start) {
    whereClause += ' AND timestamp >= ?';
    params.push(start);
  }

  if (end) {
    whereClause += ' AND timestamp <= ?';
    params.push(end);
  }

  // Check if downsampling is needed
  const { cnt } = db.prepare(
    `SELECT COUNT(id) AS cnt FROM sensor_readings ${whereClause}`
  ).get(...params);

  if (cnt <= limit) {
    return db.prepare(
      `SELECT metric, value, unit, timestamp FROM sensor_readings ${whereClause} ORDER BY timestamp DESC`
    ).all(...params);
  }

  // Sample every Nth row to fit within limit while spanning the full time range
  const step = Math.max(1, Math.floor(cnt / limit));
  return db.prepare(`
    SELECT metric, value, unit, timestamp FROM (
      SELECT metric, value, unit, timestamp,
             ROW_NUMBER() OVER (ORDER BY timestamp) AS rn
      FROM sensor_readings ${whereClause}
    ) WHERE rn % ? = 1
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...params, step, limit);
}

let lastCleanup = { at: null, status: 'pending', rowsDeleted: 0, error: null };

// Delete old data. Runs inside a setInterval — an uncaught throw here would
// kill the service, so errors must be caught and surfaced via the health
// check so retention failures are visible before the DB fills the disk.
function cleanupOldData() {
  const cutoffTimestamp = Date.now() / 1000 - (RETENTION_HOURS * 3600);
  const startedAt = Date.now();
  try {
    const result = db.prepare('DELETE FROM sensor_readings WHERE timestamp < ?')
      .run(cutoffTimestamp);

    if (result.changes > 0) {
      log.info('Cleaned up %d old readings (older than %dh)', result.changes, RETENTION_HOURS);
      // Reclaim space incrementally (free up to 1000 pages, non-blocking)
      db.pragma('incremental_vacuum(1000)');
    }
    lastCleanup = {
      at: startedAt,
      status: 'ok',
      rowsDeleted: result.changes,
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
  // Cleanup old data hourly
  periodicTimers.push(setInterval(() => {
    log.info('Running cleanup task...');
    cleanupOldData();
  }, 3600000));

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

// Store sensor data (backward-compatible HTTP endpoint)
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

    const startTs = start ? parseFloat(start) : null;
    const endTs = end ? parseFloat(end) : null;
    const MAX_LIMIT = 50000;
    const limitNum = Math.min(limit ? parseInt(limit, 10) || 1000 : 1000, MAX_LIMIT);

    const results = queryHistory(sensorId, metric, startTs, endTs, limitNum);

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
    const metrics = db.prepare(
      'SELECT DISTINCT metric, unit FROM sensor_readings WHERE sensor_id = ? ORDER BY metric'
    ).all(req.params.sensorId);
    res.json({ sensorId: req.params.sensorId, metrics });
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

  if (db) {
    log.info('Closing database...');
    db.close();
  }
};

// Start the service
service.start();
