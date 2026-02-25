#!/usr/bin/env node
/**
 * Storage Service
 *
 * Historical sensor data storage and query service.
 * - SQLite database for sensor readings (using sql.js - pure JavaScript)
 * - REST API for historical queries
 * - Configurable retention policy
 * - Automatic cleanup of old data
 */

import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { writeFile, rename } from 'fs/promises';
import { BaseService } from './base-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('storage-service');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.STORAGE_SERVICE_PORT || 3001;
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'sensors.db');
const RETENTION_HOURS = parseInt(process.env.RETENTION_HOURS || '168', 10);

let SQL = null;
let db = null;
let recoveryInProgress = false;

function isCorruptionError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('database disk image is malformed') ||
    msg.includes('file is not a database') ||
    msg.includes('database schema is malformed')
  );
}

function initializeSchema(database) {
  database.run(`
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

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_sensor_timestamp
      ON sensor_readings(sensor_id, timestamp DESC)
  `);

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_metric_timestamp
      ON sensor_readings(sensor_id, metric, timestamp DESC)
  `);
}

function buildCorruptBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${DB_PATH}.corrupt-${stamp}.bak`;
}

function recoverDatabase(reason, error) {
  if (recoveryInProgress) return;
  recoveryInProgress = true;
  try {
    log.error({ err: error, reason }, 'Recovering database');

    try {
      if (db) db.close();
    } catch {}

    if (existsSync(DB_PATH)) {
      try {
        const backupPath = buildCorruptBackupPath();
        renameSync(DB_PATH, backupPath);
        log.error('Corrupt DB backed up: %s', backupPath);
      } catch (backupErr) {
        log.error({ err: backupErr }, 'Failed to backup corrupt DB');
      }
    }

    db = new SQL.Database();
    initializeSchema(db);
    saveDatabaseToFileSync();
    log.info('Recovery complete with fresh database');
  } finally {
    recoveryInProgress = false;
  }
}

// Initialize database
async function initializeDatabase() {
  // Ensure data directory exists
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  log.info('Loading SQLite...');
  SQL = await initSqlJs();

  log.info('Initializing database: %s', DB_PATH);

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    try {
      const buffer = readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
      initializeSchema(db);
      log.info('Existing database loaded');
    } catch (err) {
      if (!isCorruptionError(err)) throw err;
      recoverDatabase('startup-load', err);
    }
  } else {
    db = new SQL.Database();
    initializeSchema(db);
    log.info('New database created');
  }

  log.info('Database schema ready');
}

// Save database to file (async to avoid blocking event loop)
let saveInProgress = false;

async function saveDatabaseToFile() {
  if (!db || recoveryInProgress) return;
  if (saveInProgress) return; // skip if previous save still running
  saveInProgress = true;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = `${DB_PATH}.tmp`;
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, DB_PATH);
  } catch (err) {
    log.error({ err }, 'Failed to save database');
  } finally {
    saveInProgress = false;
  }
}

// Synchronous save for shutdown (must complete before exit)
function saveDatabaseToFileSync() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const tmpPath = `${DB_PATH}.tmp`;
  writeFileSync(tmpPath, buffer);
  renameSync(tmpPath, DB_PATH);
}

// Store sensor reading
function storeSensorReading(sensorId, data, timestamp) {
  // Convert sensor data to flat readings
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

    readings.push({
      sensorId,
      metric: key,
      value: numValue,
      unit,
      timestamp
    });
  }

  // Insert all readings in a transaction
  db.run('BEGIN TRANSACTION');
  try {
    const stmt = db.prepare(`
      INSERT INTO sensor_readings (sensor_id, metric, value, unit, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const reading of readings) {
      stmt.run([
        reading.sensorId,
        reading.metric,
        reading.value,
        reading.unit,
        reading.timestamp
      ]);
    }

    stmt.free();
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

// Query historical data
function queryHistory(sensorId, metric, start, end, limit = 1000) {
  let query = `
    SELECT metric, value, unit, timestamp
    FROM sensor_readings
    WHERE sensor_id = ?
  `;

  const params = [sensorId];

  if (metric) {
    query += ` AND metric = ?`;
    params.push(metric);
  }

  if (start) {
    query += ` AND timestamp >= ?`;
    params.push(start);
  }

  if (end) {
    query += ` AND timestamp <= ?`;
    params.push(end);
  }

  query += ` ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  const stmt = db.prepare(query);
  try {
    stmt.bind(params);

    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }
    return results;
  } finally {
    stmt.free();
  }
}

// Delete old data
function cleanupOldData() {
  const cutoffTimestamp = Date.now() / 1000 - (RETENTION_HOURS * 3600);

  const stmt = db.prepare(`
    DELETE FROM sensor_readings
    WHERE timestamp < ?
  `);
  stmt.run([cutoffTimestamp]);
  stmt.free();

  const changes = db.getRowsModified();
  if (changes > 0) {
    log.info('Cleaned up %d old readings (older than %dh)', changes, RETENTION_HOURS);
    // Reclaim disk space after deleting rows (SQLite DELETE doesn't free pages)
    db.run('VACUUM');
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

const service = new BaseService('storage-service', { port: PORT });
const { app } = service;

// Periodic task handles for cleanup on shutdown
const periodicTimers = [];

function startPeriodicTasks() {
  periodicTimers.push(setInterval(() => saveDatabaseToFile(), 10000));
  periodicTimers.push(setInterval(() => {
    log.info('Running cleanup task...');
    cleanupOldData();
    saveDatabaseToFile();
  }, 3600000));
  periodicTimers.push(setTimeout(() => {
    cleanupOldData();
    saveDatabaseToFile();
  }, 5000));
}

// REST API: Store sensor data
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
    if (isCorruptionError(error)) {
      try {
        recoverDatabase('write-path', error);
        const { sensorId, data, timestamp } = req.body;
        const ts = timestamp || Date.now() / 1000;
        storeSensorReading(sensorId, data, ts);
        return res.json({ status: 'ok', stored: true, recovered: true });
      } catch (recoveryErr) {
        log.error({ err: recoveryErr }, 'Error recovering storage database');
        return res.status(500).json({ error: recoveryErr.message });
      }
    }
    log.error({ err: error }, 'Error storing data');
    res.status(500).json({ error: error.message });
  }
});

// REST API: Query historical data
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
    res.status(500).json({ error: error.message });
  }
});

// REST API: Get available sensors
app.get('/api/sensors', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT DISTINCT sensor_id
      FROM sensor_readings
      ORDER BY sensor_id
    `);

    try {
      const sensors = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        sensors.push(row.sensor_id);
      }
      res.json({ sensors });
    } finally {
      stmt.free();
    }
  } catch (error) {
    log.error({ err: error }, 'Error getting sensors');
    res.status(500).json({ error: error.message });
  }
});

// REST API: Get metrics for a sensor
app.get('/api/sensors/:sensorId/metrics', (req, res) => {
  try {
    const { sensorId } = req.params;

    const stmt = db.prepare(`
      SELECT DISTINCT metric, unit
      FROM sensor_readings
      WHERE sensor_id = ?
      ORDER BY metric
    `);
    try {
      stmt.bind([sensorId]);

      const metrics = [];
      while (stmt.step()) {
        metrics.push(stmt.getAsObject());
      }
      res.json({
        sensorId,
        metrics
      });
    } finally {
      stmt.free();
    }
  } catch (error) {
    log.error({ err: error }, 'Error getting metrics');
    res.status(500).json({ error: error.message });
  }
});

// Health check
service.registerHealthCheck(async () => {
  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_readings,
      COUNT(DISTINCT sensor_id) as total_sensors,
      MIN(timestamp) as oldest_reading,
      MAX(timestamp) as newest_reading
    FROM sensor_readings
  `);
  let stats;
  try {
    stmt.step();
    stats = stmt.getAsObject();
  } finally {
    stmt.free();
  }

  return {
    status: 'ok',
    database: 'connected',
    retention_hours: RETENTION_HOURS,
    stats: {
      ...stats,
      oldest_reading: stats.oldest_reading ? new Date(stats.oldest_reading * 1000).toISOString() : null,
      newest_reading: stats.newest_reading ? new Date(stats.newest_reading * 1000).toISOString() : null
    },
    uptime: process.uptime()
  };
});

// Override initialize to set up database
const originalInitialize = service.initialize.bind(service);
service.initialize = async () => {
  await originalInitialize();
  try {
    await initializeDatabase();
    startPeriodicTasks();
  } catch (err) {
    log.error({ err }, 'Failed to initialize database');
    process.exit(1);
  }
  log.info('Ready - Retention: %d hours', RETENTION_HOURS);
  log.info('Database: %s', DB_PATH);
  log.info('Auto-save every 10 seconds');
};

// Override onShutdown for database cleanup
service.onShutdown = async () => {
  periodicTimers.forEach(id => clearTimeout(id));
  periodicTimers.length = 0;

  if (db) {
    log.info('Saving database...');
    saveDatabaseToFileSync();
    log.info('Closing database...');
    db.close();
  }
};

// Start the service
service.start();
