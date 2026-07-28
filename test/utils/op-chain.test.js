import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpChain } from '../../src/utils/op-chain.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('createOpChain', () => {
  it('runs ops in FIFO order regardless of internal delays', async () => {
    // Arrange
    const enqueue = createOpChain();
    const order = [];

    // Act - first op is slowest
    const a = enqueue(async () => { await sleep(30); order.push('a'); });
    const b = enqueue(async () => { await sleep(10); order.push('b'); });
    const c = enqueue(async () => { order.push('c'); });
    await Promise.all([a, b, c]);

    // Assert
    assert.deepStrictEqual(order, ['a', 'b', 'c']);
  });

  it('strictly serializes: an op only starts after the previous settled', async () => {
    // Arrange
    const enqueue = createOpChain();
    let aDone = false;
    let bSawADone = false;

    // Act
    const a = enqueue(async () => { await sleep(20); aDone = true; });
    const b = enqueue(async () => { bSawADone = aDone; });
    await Promise.all([a, b]);

    // Assert
    assert.equal(bSawADone, true);
  });

  it('a rejected op reports its own error and does not break the chain', async () => {
    // Arrange
    const enqueue = createOpChain();
    let bRan = false;

    // Act
    const a = enqueue(async () => { throw new Error('op a failed'); });
    const b = enqueue(async () => { bRan = true; });

    // Assert
    await assert.rejects(() => a, { message: 'op a failed' });
    await b;
    assert.equal(bRan, true);
  });

  it('propagates op results', async () => {
    const enqueue = createOpChain();
    assert.equal(await enqueue(() => 42), 42);
  });

  it('enqueue while busy appends after all previously queued ops', async () => {
    // Arrange
    const enqueue = createOpChain();
    const order = [];
    let releaseA;
    const gate = new Promise((r) => { releaseA = r; });

    // Act - C is enqueued from outside while A is pending and B queued
    const a = enqueue(async () => { await gate; order.push('a'); });
    const b = enqueue(async () => { order.push('b'); });
    const c = enqueue(async () => { order.push('c'); });
    releaseA();
    await Promise.all([a, b, c]);

    // Assert
    assert.deepStrictEqual(order, ['a', 'b', 'c']);
  });
});
