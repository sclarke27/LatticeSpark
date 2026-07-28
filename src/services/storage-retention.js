/**
 * Delete sensor_readings older than cutoff in chunks, yielding to the
 * event loop between chunks so Socket.IO ingestion stays responsive.
 * Exits early (returning rows deleted so far) if the db is closed mid-run.
 * @param {import('better-sqlite3').Database} db
 * @param {number} cutoffTimestamp - epoch seconds; rows strictly older are deleted
 * @param {number} chunkSize - max rows per DELETE
 * @returns {Promise<number>} total rows deleted
 */
export async function deleteExpiredReadings(db, cutoffTimestamp, chunkSize) {
  const stmt = db.prepare(`
    DELETE FROM sensor_readings
    WHERE id IN (SELECT id FROM sensor_readings WHERE timestamp < ? LIMIT ?)
  `);
  let total = 0;
  while (db.open) {
    const { changes } = stmt.run(cutoffTimestamp, chunkSize);
    total += changes;
    if (changes < chunkSize) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return total;
}
