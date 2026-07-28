import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { queryHistory, MAX_LIMIT } from '../../src/services/storage-history.js';

describe('queryHistory', () => {
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
  });

  afterEach(() => {
    db.close();
  });

  function insert(sensorId, metric, value, unit, ts) {
    db.prepare(
      'INSERT INTO sensor_readings (sensor_id, metric, value, unit, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(sensorId, metric, value, unit, ts);
  }

  it('returns raw values newest-first when rows fit within limit', () => {
    // Arrange - 10 readings over 60s
    const now = Date.now() / 1000;
    for (let i = 0; i < 10; i++) {
      insert('s1', 'temperature', 20 + i, '°C', now - 60 + i * 6);
    }

    // Act
    const rows = queryHistory(db, 's1', { start: now - 120, end: now, limit: 500 });

    // Assert - buckets finer than data → AVG of 1 → exact values
    assert.equal(rows.length, 10);
    assert.deepStrictEqual(rows.map((r) => r.value), [29, 28, 27, 26, 25, 24, 23, 22, 21, 20]);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].timestamp < rows[i - 1].timestamp);
    }
  });

  it('downsamples to at most limit rows via bucket averages', () => {
    // Arrange - 1000 readings at 0.1s spacing over 100s, value = index
    const base = 1000000;
    for (let i = 0; i < 1000; i++) {
      insert('s1', 'distance', i, 'cm', base + i * 0.1);
    }

    // Act - 100s window / limit 100 → 1s buckets of 10 readings each
    const rows = queryHistory(db, 's1', { start: base, end: base + 100, limit: 100 });

    // Assert
    assert.ok(rows.length <= 100);
    // Bucket [base+10, base+11): readings 100..109 → mean 104.5, newest ts base+10.9
    const bucket = rows.find((r) => Math.abs(r.timestamp - (base + 10.9)) < 0.001);
    assert.ok(bucket, 'expected bucket at base+10.9');
    assert.ok(Math.abs(bucket.value - 104.5) < 0.0001);
  });

  it('defaults start to end-24h when start absent', () => {
    // Arrange
    const now = Date.now() / 1000;
    insert('s1', 'temperature', 1, '°C', now - 25 * 3600);
    insert('s1', 'temperature', 2, '°C', now - 3600);

    // Act
    const rows = queryHistory(db, 's1', {});

    // Assert
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 2);
  });

  it('caps window length at maxWindowSec', () => {
    // Arrange
    const now = Date.now() / 1000;
    insert('s1', 'temperature', 1, '°C', now - 10 * 86400);
    insert('s1', 'temperature', 2, '°C', now - 86400);

    // Act
    const rows = queryHistory(db, 's1', {
      start: now - 10 * 86400,
      maxWindowSec: 7 * 86400
    });

    // Assert
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 2);
  });

  it('filters by metric and ignores other sensors', () => {
    // Arrange
    const now = Date.now() / 1000;
    insert('s1', 'temperature', 21, '°C', now - 10);
    insert('s1', 'humidity', 55, '%', now - 10);
    insert('s2', 'temperature', 99, '°C', now - 10);

    // Act
    const rows = queryHistory(db, 's1', { metric: 'temperature' });

    // Assert
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metric, 'temperature');
    assert.equal(rows[0].value, 21);
  });

  it('groups per metric when metric is null', () => {
    // Arrange - two metrics in the same bucket window with distinct ranges
    const now = Date.now() / 1000;
    insert('s1', 'temperature', 20, '°C', now - 5);
    insert('s1', 'temperature', 22, '°C', now - 4);
    insert('s1', 'humidity', 50, '%', now - 5);
    insert('s1', 'humidity', 60, '%', now - 4);

    // Act - one big bucket
    const rows = queryHistory(db, 's1', { start: now - 10, end: now, limit: 1 });

    // Assert - values never blend across metrics
    const temp = rows.find((r) => r.metric === 'temperature');
    const hum = rows.find((r) => r.metric === 'humidity');
    if (temp) assert.equal(temp.value, 21);
    if (hum) assert.equal(hum.value, 55);
    assert.ok(temp || hum);
  });

  it('clamps limit: negative, zero, and huge values', () => {
    // Arrange
    const base = 1000000;
    for (let i = 0; i < 3000; i++) {
      insert('s1', 'value', i, null, base + i);
    }
    const opts = { start: base, end: base + 3000 };

    // Act & Assert - negative/zero neither error nor go unbounded
    const neg = queryHistory(db, 's1', { ...opts, limit: -5 });
    assert.ok(neg.length >= 1 && neg.length <= MAX_LIMIT);
    const zero = queryHistory(db, 's1', { ...opts, limit: 0 });
    assert.ok(zero.length >= 1 && zero.length <= MAX_LIMIT);
    const huge = queryHistory(db, 's1', { ...opts, limit: 999999 });
    assert.ok(huge.length <= MAX_LIMIT);
  });

  it('returns [] when start >= end', () => {
    // Arrange
    const now = Date.now() / 1000;
    insert('s1', 'temperature', 21, '°C', now - 10);

    // Act & Assert
    assert.deepStrictEqual(queryHistory(db, 's1', { start: now, end: now - 100 }), []);
  });

  it('preserves unit in aggregated rows', () => {
    // Arrange - multi-row buckets
    const base = 1000000;
    for (let i = 0; i < 100; i++) {
      insert('s1', 'temperature', 20 + (i % 3), '°C', base + i);
    }

    // Act - force aggregation (100s of data, limit 10)
    const rows = queryHistory(db, 's1', { start: base, end: base + 100, limit: 10 });

    // Assert
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.unit, '°C');
    }
  });
});
