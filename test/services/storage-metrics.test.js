/**
 * SQL-contract tests for the /api/sensors/:sensorId/metrics queries.
 * storage-service.js self-starts on import, so the route cannot be unit
 * tested directly; these pin the exact SQL the handler runs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const DISTINCT_SQL =
  'SELECT DISTINCT metric FROM sensor_readings WHERE sensor_id = ? ORDER BY metric';
const UNIT_SQL =
  'SELECT unit FROM sensor_readings WHERE sensor_id = ? AND metric = ? ORDER BY timestamp DESC LIMIT 1';

describe('storage metrics queries', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sensor_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp REAL NOT NULL
      )
    `);
    db.exec(`
      CREATE INDEX idx_metric_timestamp
        ON sensor_readings(sensor_id, metric, timestamp DESC)
    `);

    const insert = db.prepare(
      'INSERT INTO sensor_readings (sensor_id, metric, value, unit, timestamp) VALUES (?, ?, ?, ?, ?)'
    );
    // temperature: oldest row has NULL unit, newest has °C
    insert.run('temp1', 'temperature', 20, null, 100);
    insert.run('temp1', 'temperature', 21, '°C', 200);
    insert.run('temp1', 'humidity', 55, '%', 150);
    insert.run('dist1', 'distance', 42, 'cm', 100);
  });

  afterEach(() => {
    db.close();
  });

  it('returns each metric exactly once, ordered ascending', () => {
    // Act
    const rows = db.prepare(DISTINCT_SQL).all('temp1');

    // Assert - no duplicate for the unit-changed metric
    assert.deepStrictEqual(rows.map((r) => r.metric), ['humidity', 'temperature']);
  });

  it('unit lookup returns the most recent unit', () => {
    // Act
    const row = db.prepare(UNIT_SQL).get('temp1', 'temperature');

    // Assert - newest row's unit, not the older NULL
    assert.equal(row.unit, '°C');
  });

  it('filters by sensor_id; unknown sensor yields empty', () => {
    // Act & Assert
    const rows = db.prepare(DISTINCT_SQL).all('temp1');
    assert.ok(!rows.some((r) => r.metric === 'distance'));
    assert.deepStrictEqual(db.prepare(DISTINCT_SQL).all('nope'), []);
  });

  it('DISTINCT query is covered by idx_metric_timestamp', () => {
    // Act
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${DISTINCT_SQL}`).all('temp1');
    const detail = plan.map((r) => r.detail).join(' | ');

    // Assert
    assert.ok(/COVERING INDEX idx_metric_timestamp/.test(detail), detail);
    assert.ok(!/TEMP B-TREE/.test(detail), detail);
  });

  it('unit query uses idx_metric_timestamp with no sort', () => {
    // Act
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${UNIT_SQL}`).all('temp1', 'temperature');
    const detail = plan.map((r) => r.detail).join(' | ');

    // Assert - ORDER BY timestamp DESC satisfied by index order
    assert.ok(/idx_metric_timestamp/.test(detail), detail);
    assert.ok(!/TEMP B-TREE/.test(detail), detail);
  });
});
