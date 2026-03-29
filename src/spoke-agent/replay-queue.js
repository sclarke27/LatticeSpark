import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export class ReplayQueue {
  #queuePath;
  #statePath;
  #retentionMs;
  #maxBytes;
  #maxItems;
  #items;
  #nextSeq;
  #ackedSeq;
  #ioChain;
  #dirty;

  constructor({ queuePath, retentionHours = 72, maxDiskMb = 1024, maxItems = 10000 }) {
    this.#queuePath = queuePath;
    this.#statePath = `${queuePath}.state.json`;
    this.#retentionMs = Math.max(1, retentionHours) * 3600 * 1000;
    this.#maxBytes = Math.max(0.001, maxDiskMb) * 1024 * 1024;
    this.#maxItems = Math.max(100, maxItems);
    this.#items = [];
    this.#nextSeq = 1;
    this.#ackedSeq = 0;
    this.#ioChain = Promise.resolve();
    this.#dirty = false;
  }

  async initialize() {
    await mkdir(dirname(this.#queuePath), { recursive: true });
    await this.#loadState();
    await this.#loadQueue();
    await this.compact();
  }

  async #loadState() {
    if (!existsSync(this.#statePath)) return;
    try {
      const raw = await readFile(this.#statePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.ackedSeq)) {
        this.#ackedSeq = parsed.ackedSeq;
      }
    } catch {
      this.#ackedSeq = 0;
    }
  }

  async #loadQueue() {
    if (!existsSync(this.#queuePath)) return;
    const raw = await readFile(this.#queuePath, 'utf-8');
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const now = Date.now();
    for (const line of lines) {
      const row = parseJsonLine(line);
      if (!row) continue;
      if (!Number.isFinite(row.seq) || typeof row.batch !== 'object') continue;
      if (!Number.isFinite(row.ts) || now - row.ts > this.#retentionMs) continue;
      if (row.seq <= this.#ackedSeq) continue;
      this.#items.push(row);
      this.#nextSeq = Math.max(this.#nextSeq, row.seq + 1);
    }
    this.#items.sort((a, b) => a.seq - b.seq);

    // Enforce memory cap on load
    if (this.#items.length > this.#maxItems) {
      this.#items = this.#items.slice(-this.#maxItems);
    }
  }

  enqueue(batch) {
    const item = {
      seq: this.#nextSeq++,
      ts: Date.now(),
      batch
    };
    this.#items.push(item);
    this.#dirty = true;

    // Enforce in-memory cap — drop oldest
    if (this.#items.length > this.#maxItems) {
      const overflow = this.#items.length - this.#maxItems;
      this.#items.splice(0, overflow);
    }

    return item;
  }

  pending() {
    return [...this.#items];
  }

  pendingCount() {
    return this.#items.length;
  }

  ack(seq) {
    if (!Number.isFinite(seq) || seq <= this.#ackedSeq) return;
    this.#ackedSeq = seq;

    // Eager prune — #items is sorted by seq, ack is monotonic
    let pruneCount = 0;
    while (pruneCount < this.#items.length && this.#items[pruneCount].seq <= seq) {
      pruneCount++;
    }
    if (pruneCount > 0) {
      this.#items.splice(0, pruneCount);
      this.#dirty = true;
    }
  }

  getAckedSeq() {
    return this.#ackedSeq;
  }

  async flush() {
    return this.#runIoLocked(async () => {
      await this.#flushUnlocked();
    });
  }

  async append(item) {
    return this.#runIoLocked(async () => {
      await mkdir(dirname(this.#queuePath), { recursive: true });
      await appendFile(this.#queuePath, `${JSON.stringify(item)}\n`);
    });
  }

  async compact() {
    return this.#runIoLocked(async () => {
      const now = Date.now();
      const before = this.#items.length;
      this.#items = this.#items.filter(item => now - item.ts <= this.#retentionMs);
      if (this.#items.length !== before) {
        this.#dirty = true;
      }
      if (!this.#dirty) return;
      await this.#flushUnlocked();
      this.#dirty = false;
    });
  }

  async #persistState() {
    await mkdir(dirname(this.#statePath), { recursive: true });
    const tmpPath = `${this.#statePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ ackedSeq: this.#ackedSeq, updatedAt: Date.now() }, null, 2);
    await writeFile(tmpPath, payload);
    await rename(tmpPath, this.#statePath);
  }

  async #flushUnlocked() {
    await mkdir(dirname(this.#queuePath), { recursive: true });
    if (this.#items.length === 0) {
      await writeFile(this.#queuePath, '');
      await this.#persistState();
      return;
    }
    const body = `${this.#items.map(item => JSON.stringify(item)).join('\n')}\n`;
    await writeFile(this.#queuePath, body);
    await this.#persistState();
    await this.#enforceDiskCap();
  }

  #runIoLocked(task) {
    const run = this.#ioChain.then(task, task);
    this.#ioChain = run.catch(() => {});
    return run;
  }

  async #enforceDiskCap() {
    let currentSize = 0;
    try {
      currentSize = (await stat(this.#queuePath)).size;
    } catch {
      return;
    }
    if (currentSize <= this.#maxBytes || this.#items.length === 0) return;

    // Estimate target item count to fit under cap, then drop in bulk
    const avgItemSize = currentSize / this.#items.length;
    const targetItems = Math.max(1, Math.floor(this.#maxBytes / avgItemSize));
    if (targetItems < this.#items.length) {
      this.#items = this.#items.slice(-targetItems);
      const body = `${this.#items.map(item => JSON.stringify(item)).join('\n')}\n`;
      await writeFile(this.#queuePath, body);
    }
  }
}
