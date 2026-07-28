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

// Rewrite the queue file only once at least this many dead rows accumulate
const COMPACT_MIN_DEAD_ROWS = 64;

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
  #fileRows;
  #fileBytes;
  #persistedAckedSeq;

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
    this.#fileRows = 0;
    this.#fileBytes = 0;
    this.#persistedAckedSeq = 0;
  }

  async initialize() {
    await mkdir(dirname(this.#queuePath), { recursive: true });
    await this.#loadState();
    this.#persistedAckedSeq = this.#ackedSeq;
    await this.#loadQueue();
    // Never reuse seqs at/below the persisted ack — reused seqs are
    // un-ackable and dropped on the next reload (data loss).
    this.#nextSeq = Math.max(this.#nextSeq, this.#ackedSeq + 1);
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

    this.#fileRows = lines.length;
    this.#fileBytes = Buffer.byteLength(raw);
    // Dead rows found on disk — let the startup compact() decide on a rewrite
    if (this.#fileRows !== this.#items.length) this.#dirty = true;
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

  pending(limit) {
    if (Number.isFinite(limit) && limit >= 0) {
      return this.#items.slice(0, limit);
    }
    return this.#items.slice();
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
      const line = `${JSON.stringify(item)}\n`;
      await appendFile(this.#queuePath, line);
      this.#fileRows += 1;
      this.#fileBytes += Buffer.byteLength(line);
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
      if (this.#dirty && this.#shouldRewrite()) {
        await this.#flushUnlocked();
        return;
      }
      // Cheap ~60B atomic write, only when acks advanced since last persist
      if (this.#ackedSeq !== this.#persistedAckedSeq) {
        await this.#persistState();
      }
    });
  }

  // Rewrite only when the file is mostly dead rows (acked/expired/overflow-
  // dropped) or has outgrown the disk cap. Row counts proxy for bytes.
  #shouldRewrite() {
    const deadRows = this.#fileRows - this.#items.length;
    return (deadRows >= COMPACT_MIN_DEAD_ROWS && deadRows > this.#items.length)
      || this.#fileBytes > this.#maxBytes;
  }

  async #persistState() {
    const ackedSeq = this.#ackedSeq;
    const tmpPath = `${this.#statePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ ackedSeq, updatedAt: Date.now() }, null, 2);
    await writeFile(tmpPath, payload);
    await rename(tmpPath, this.#statePath);
    this.#persistedAckedSeq = ackedSeq;
  }

  async #flushUnlocked() {
    // Capture before the await — a concurrent enqueue must not skew counters
    const rows = this.#items.length;
    const body = rows === 0 ? '' : `${this.#items.map(item => JSON.stringify(item)).join('\n')}\n`;
    await writeFile(this.#queuePath, body);
    this.#fileRows = rows;
    this.#fileBytes = Buffer.byteLength(body);
    this.#dirty = false;
    await this.#persistState();
    if (rows > 0) await this.#enforceDiskCap();
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
    this.#fileBytes = currentSize; // self-heal tracked-byte drift
    if (currentSize <= this.#maxBytes || this.#items.length === 0) return;

    // Estimate target item count to fit under cap, then drop in bulk
    const avgItemSize = currentSize / this.#items.length;
    const targetItems = Math.max(1, Math.floor(this.#maxBytes / avgItemSize));
    if (targetItems < this.#items.length) {
      this.#items = this.#items.slice(-targetItems);
      const rows = this.#items.length;
      const body = `${this.#items.map(item => JSON.stringify(item)).join('\n')}\n`;
      await writeFile(this.#queuePath, body);
      this.#fileRows = rows;
      this.#fileBytes = Buffer.byteLength(body);
    }
  }
}
