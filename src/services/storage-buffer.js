/**
 * Bounded in-memory buffer for parsed sensor readings awaiting the
 * micro-batch flush in storage-service. Evicts oldest rows beyond maxRows so
 * memory stays bounded when the database falls behind ingestion.
 */
export class StorageBuffer {
  #rows = [];
  #maxRows;
  #dropped = 0;        // since last takeDropped()
  #droppedTotal = 0;   // cumulative, for health stats

  constructor({ maxRows = 20000 } = {}) {
    this.#maxRows = Math.max(1, maxRows);
  }

  /** Append parsed reading rows; evicts oldest beyond maxRows. */
  push(rows) {
    let incoming = rows;
    if (incoming.length > this.#maxRows) {
      const excess = incoming.length - this.#maxRows;
      this.#dropped += excess;
      this.#droppedTotal += excess;
      incoming = incoming.slice(excess); // keep newest
    }
    const overflow = this.#rows.length + incoming.length - this.#maxRows;
    if (overflow > 0) {
      this.#rows.splice(0, overflow);
      this.#dropped += overflow;
      this.#droppedTotal += overflow;
    }
    this.#rows.push(...incoming);
  }

  get size() { return this.#rows.length; }

  get droppedTotal() { return this.#droppedTotal; }

  /**
   * Rows pending flush. Caller must clear() only after a successful insert
   * so a failed (rolled-back) transaction retries next tick.
   */
  peekAll() { return this.#rows; }

  clear() { this.#rows.length = 0; }

  /** Dropped count since last call; resets. */
  takeDropped() {
    const d = this.#dropped;
    this.#dropped = 0;
    return d;
  }
}
