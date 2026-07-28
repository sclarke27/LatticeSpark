import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StorageBuffer } from '../../src/services/storage-buffer.js';

function row(n) {
  return { sensorId: `s${n}`, metric: 'value', value: n, unit: null, timestamp: n };
}

describe('StorageBuffer', () => {
  it('push below cap: grows FIFO with no drops', () => {
    // Arrange
    const buf = new StorageBuffer({ maxRows: 10 });

    // Act
    buf.push([row(1), row(2)]);
    buf.push([row(3)]);

    // Assert
    assert.equal(buf.size, 3);
    assert.deepStrictEqual(buf.peekAll().map((r) => r.value), [1, 2, 3]);
    assert.equal(buf.takeDropped(), 0);
  });

  it('overflow drops oldest, keeps newest', () => {
    // Arrange
    const buf = new StorageBuffer({ maxRows: 5 });
    buf.push([row(1), row(2), row(3), row(4), row(5)]);

    // Act
    buf.push([row(6), row(7)]);

    // Assert
    assert.equal(buf.size, 5);
    assert.equal(buf.peekAll()[0].value, 3); // oldest surviving row
    assert.equal(buf.peekAll()[4].value, 7); // newest kept
    assert.equal(buf.takeDropped(), 2);
  });

  it('single push larger than maxRows keeps only the newest maxRows', () => {
    // Arrange
    const buf = new StorageBuffer({ maxRows: 3 });

    // Act
    buf.push([row(1), row(2), row(3), row(4), row(5)]);

    // Assert
    assert.equal(buf.size, 3);
    assert.deepStrictEqual(buf.peekAll().map((r) => r.value), [3, 4, 5]);
    assert.equal(buf.takeDropped(), 2);
  });

  it('takeDropped resets while droppedTotal stays cumulative', () => {
    // Arrange
    const buf = new StorageBuffer({ maxRows: 2 });
    buf.push([row(1), row(2), row(3)]); // drops 1

    // Act & Assert
    assert.equal(buf.takeDropped(), 1);
    assert.equal(buf.takeDropped(), 0);
    buf.push([row(4), row(5)]); // drops 2 more
    assert.equal(buf.takeDropped(), 2);
    assert.equal(buf.droppedTotal, 3);
  });

  it('retry semantics: peekAll stable until clear()', () => {
    // Arrange
    const buf = new StorageBuffer({ maxRows: 10 });
    buf.push([row(1), row(2)]);

    // Act & Assert - models flush-failure retry then successful flush
    const first = buf.peekAll();
    const second = buf.peekAll();
    assert.deepStrictEqual(first, second);
    assert.equal(buf.size, 2);

    buf.clear();
    assert.equal(buf.size, 0);
    assert.deepStrictEqual(buf.peekAll(), []);
  });

  it('constructor clamps maxRows to >= 1 and defaults to 20000', () => {
    // Arrange
    const clamped = new StorageBuffer({ maxRows: 0 });
    const dflt = new StorageBuffer();

    // Act
    clamped.push([row(1), row(2)]);
    dflt.push(Array.from({ length: 20001 }, (_, i) => row(i)));

    // Assert
    assert.equal(clamped.size, 1);
    assert.equal(dflt.size, 20000);
    assert.equal(dflt.takeDropped(), 1);
  });
});
