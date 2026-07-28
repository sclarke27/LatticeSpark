import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { deleteExpiredReadings } from '../../src/services/storage-retention.js';

const CUTOFF = 1000;

describe('deleteExpiredReadings', () => {
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
    db.exec('CREATE INDEX idx_timestamp ON sensor_readings(timestamp)');
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  function insertRows(count, timestamp) {
    const stmt = db.prepare(
      'INSERT INTO sensor_readings (sensor_id, metric, value, unit, timestamp) VALUES (?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < count; i++) {
      stmt.run('s1', 'value', i, null, timestamp);
    }
  }

  function remaining() {
    return db.prepare('SELECT COUNT(id) AS cnt FROM sensor_readings').get().cnt;
  }

  it('deletes expired rows across multiple chunks', async () => {
    // Arrange
    insertRows(25, CUTOFF - 1);
    insertRows(5, CUTOFF + 1);

    // Act
    const deleted = await deleteExpiredReadings(db, CUTOFF, 10);

    // Assert
    assert.equal(deleted, 25);
    assert.equal(remaining(), 5);
  });

  it('returns 0 when nothing is expired', async () => {
    // Arrange
    insertRows(10, CUTOFF + 1);

    // Act
    const deleted = await deleteExpiredReadings(db, CUTOFF, 10);

    // Assert
    assert.equal(deleted, 0);
    assert.equal(remaining(), 10);
  });

  it('yields to the event loop between chunks', async () => {
    // Arrange
    insertRows(15, CUTOFF - 1);
    const events = [];
    setImmediate(() => events.push('io'));

    // Act
    await deleteExpiredReadings(db, CUTOFF, 5);
    events.push('done');

    // Assert - pending I/O callbacks ran mid-cleanup, not after
    assert.deepStrictEqual(events, ['io', 'done']);
  });

  it('exits cleanly when db is closed mid-run', async () => {
    // Arrange
    insertRows(15, CUTOFF - 1);
    setImmediate(() => db.close());

    // Act
    const deleted = await deleteExpiredReadings(db, CUTOFF, 5);

    // Assert - resolved without throwing, partial progress only
    assert.ok(deleted < 15);
  });

  it('deletes an exactly-full final chunk', async () => {
    // Arrange - covers the changes === chunkSize boundary
    insertRows(10, CUTOFF - 1);

    // Act
    const deleted = await deleteExpiredReadings(db, CUTOFF, 10);

    // Assert
    assert.equal(deleted, 10);
    assert.equal(remaining(), 0);
  });
});
