#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, stat } from 'node:fs/promises';
import { ReplayQueue } from '../../src/spoke-agent/replay-queue.js';

function tempQueuePath(name) {
  return join(tmpdir(), `latticespark-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.ndjson`);
}

describe('ReplayQueue', () => {
  it('enqueues and acknowledges items', async () => {
    const queuePath = tempQueuePath('ack');
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1 });
    await queue.initialize();

    const one = queue.enqueue({ temp: { value: 1 } });
    const two = queue.enqueue({ temp: { value: 2 } });
    await queue.flush();

    assert.equal(queue.pending().length, 2);
    queue.ack(one.seq);
    assert.equal(queue.pending().length, 1);
    queue.ack(two.seq);
    assert.equal(queue.pending().length, 0);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });

  it('persists ack state across reload', async () => {
    const queuePath = tempQueuePath('persist');
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1 });
    await queue.initialize();

    const item = queue.enqueue({ humidity: { value: 30 } });
    await queue.flush();
    queue.ack(item.seq);
    await queue.flush();

    const queueReload = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1 });
    await queueReload.initialize();
    assert.equal(queueReload.getAckedSeq(), item.seq);
    assert.equal(queueReload.pending().length, 0);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });

  it('ack() eagerly prunes items from memory', async () => {
    const queuePath = tempQueuePath('eager-prune');
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1 });
    await queue.initialize();

    const items = [];
    for (let i = 0; i < 5; i++) {
      items.push(queue.enqueue({ sensor: { value: i } }));
    }

    // Ack up to seq 3 — items 1,2,3 should be pruned, leaving 4,5
    queue.ack(items[2].seq);
    const remaining = queue.pending();
    assert.equal(remaining.length, 2);
    assert.equal(remaining[0].seq, items[3].seq);
    assert.equal(remaining[1].seq, items[4].seq);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });

  it('enqueue() enforces maxItems cap', async () => {
    const queuePath = tempQueuePath('max-items');
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1, maxItems: 100 });
    await queue.initialize();

    const items = [];
    for (let i = 0; i < 200; i++) {
      items.push(queue.enqueue({ sensor: { value: i } }));
    }

    // Should keep only the newest 100
    const pending = queue.pending();
    assert.equal(pending.length, 100);
    assert.equal(pending[0].seq, items[100].seq);
    assert.equal(pending[99].seq, items[199].seq);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });

  it('pendingCount() matches pending().length', async () => {
    const queuePath = tempQueuePath('pending-count');
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1 });
    await queue.initialize();

    assert.equal(queue.pendingCount(), 0);
    assert.equal(queue.pendingCount(), queue.pending().length);

    const one = queue.enqueue({ temp: { value: 1 } });
    queue.enqueue({ temp: { value: 2 } });
    queue.enqueue({ temp: { value: 3 } });

    assert.equal(queue.pendingCount(), 3);
    assert.equal(queue.pendingCount(), queue.pending().length);

    queue.ack(one.seq);
    assert.equal(queue.pendingCount(), 2);
    assert.equal(queue.pendingCount(), queue.pending().length);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });

  it('compact() skips rewrite when clean', async () => {
    const queuePath = tempQueuePath('compact-clean');
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 1 });
    await queue.initialize();

    queue.enqueue({ temp: { value: 1 } });
    await queue.flush();

    // First compact writes (dirty from enqueue)
    await queue.compact();
    const firstStat = await stat(queuePath);

    // Wait a tick so mtime would differ if rewritten
    await new Promise(resolve => setTimeout(resolve, 50));

    // Second compact should skip (nothing changed)
    await queue.compact();
    const secondStat = await stat(queuePath);

    assert.equal(firstStat.mtimeMs, secondStat.mtimeMs);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });

  it('disk cap drops items in bulk', async () => {
    const queuePath = tempQueuePath('disk-cap');
    // Very small disk cap to trigger enforcement
    const queue = new ReplayQueue({ queuePath, retentionHours: 72, maxDiskMb: 0.001, maxItems: 10000 });
    await queue.initialize();

    // Enqueue enough items to exceed ~1KB disk cap
    for (let i = 0; i < 50; i++) {
      queue.enqueue({ sensor: { value: i, padding: 'x'.repeat(50) } });
    }
    await queue.flush();

    // After flush + disk cap enforcement, items should be trimmed
    const fileSize = (await stat(queuePath)).size;
    assert.ok(queue.pendingCount() < 50, `Expected fewer than 50 items, got ${queue.pendingCount()}`);
    assert.ok(fileSize <= 1024 + 200, `File ${fileSize} bytes should be near 1KB cap`);

    await rm(queuePath, { force: true });
    await rm(`${queuePath}.state.json`, { force: true });
  });
});
