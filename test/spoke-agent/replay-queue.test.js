#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
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
});
