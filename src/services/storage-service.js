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

import express from 'express';
import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { writeFile } from 'fs/promises';

// Prevent unhandled promise rejections from crashing the service
process.on('unhandledRejection', (reason, promise) => {
  console.error('[storage-service] Unhandled promise rejection:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.STORAGE_SERVICE_PORT || 3001;
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'sensors.db');
const RETENTION_HOURS = parseInt(process.env.RETENTION_HOURS || '24', 10);

const app = express();
app.use(express.json());

let SQL = null;
let db = null;

// Initialize database
async function initializeDatabase() {
  // Ensure data directory exists
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  console.log('Loading SQLite...');
  SQL = await initSqlJs();

  console.log('Initializing database:', DB_PATH);

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('✓ Existing database loaded');
  } else {
    db = new SQL.Database();
    console.log('✓ New database created');
  }

  // Create schema
  db.run(`
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

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_sensor_timestamp
      ON sensor_readings(sensor_id, timestamp DESC)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_metric_timestamp
      ON sensor_readings(sensor_id, metric, timestamp DESC)
  `);

  console.log('✓ Database schema ready');

  // Start periodic save and cleanup
  startPeriodicTasks();
}

// Save database to file (async to avoid blocking event loop)
let saveInProgress = false;

async function saveDatabaseToFile() {
  if (saveInProgress) return; // skip if previous save still running
  saveInProgress = true;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    await writeFile(DB_PATH, buffer);
  } catch (err) {
    console.error('[storage-service] Failed to save database:', err.message);
  } finally {
    saveInProgress = false;
  }
}

// Synchronous save for shutdown (must complete before exit)
function saveDatabaseToFileSync() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
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
    console.log(`Cleaned up ${changes} old readings (older than ${RETENTION_HOURS}h)`);
    // Reclaim disk space after deleting rows (SQLite DELETE doesn't free pages)
    db.run('VACUUM');
  }
}

// Periodic task handles for cleanup on shutdown
const periodicTimers = [];

// Start periodic tasks
function startPeriodicTasks() {
  // Save database to file every 10 seconds
  periodicTimers.push(setInterval(() => {
    saveDatabaseToFile();
  }, 10000));

  // Run cleanup every hour
  periodicTimers.push(setInterval(() => {
    console.log('Running cleanup task...');
    cleanupOldData();
    saveDatabaseToFile();
  }, 3600000)); // 1 hour

  // Run initial cleanup after 5 seconds
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
    console.error('Error storing data:', error);
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
    const MAX_LIMIT = 10000;
    const limitNum = Math.min(limit ? parseInt(limit, 10) || 1000 : 1000, MAX_LIMIT);

    const results = queryHistory(sensorId, metric, startTs, endTs, limitNum);

    res.json({
      sensorId,
      metric: metric || 'all',
      count: results.length,
      data: results
    });
  } catch (error) {
    console.error('Error querying history:', error);
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
    console.error('Error getting sensors:', error);
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
    console.error('Error getting metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

// REST API: Health check
app.get('/health', (req, res) => {
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

  res.json({
    status: 'ok',
    database: 'connected',
    retention_hours: RETENTION_HOURS,
    stats: {
      ...stats,
      oldest_reading: stats.oldest_reading ? new Date(stats.oldest_reading * 1000).toISOString() : null,
      newest_reading: stats.newest_reading ? new Date(stats.newest_reading * 1000).toISOString() : null
    },
    uptime: process.uptime()
  });
});

// Shutdown handler
function shutdown(signal) {
  console.log('');
  console.log(`Received ${signal}, shutting down...`);

  // Clear periodic timers
  periodicTimers.forEach(id => clearTimeout(id));
  periodicTimers.length = 0;

  if (db) {
    console.log('Saving database...');
    saveDatabaseToFileSync();
    console.log('Closing database...');
    db.close();
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle port binding errors
const httpServer = app.listen(PORT);
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[storage-service] Port ${PORT} already in use. Kill the old process or choose a different port.`);
  } else {
    console.error('[storage-service] Server error:', err.message);
  }
  process.exit(1);
});
httpServer.on('listening', async () => {
  console.log('='.repeat(60));
  console.log(`Storage Service running on http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('');

  await initializeDatabase();

  console.log('');
  console.log(`✓ Ready - Retention: ${RETENTION_HOURS} hours`);
  console.log(`✓ Database: ${DB_PATH}`);
  console.log(`✓ Auto-save every 10 seconds`);
});
