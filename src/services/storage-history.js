/**
 * History query for storage-service, extracted for unit testing.
 * Downsamples via time-bucket AVG in SQL so response size is bounded
 * by `limit` regardless of raw row count (single index-range scan,
 * no COUNT / ROW_NUMBER passes).
 */

export const DEFAULT_WINDOW_SEC = 24 * 3600; // used when no start given
export const MAX_LIMIT = 2000;               // hard cap on returned rows

// Rows: { metric, value: bucket AVG, unit, timestamp: newest in bucket },
// ordered newest-first. `unit` is a bare column: SQLite's min/max
// bare-column rule resolves it from the MAX(timestamp) row (unit is
// constant per metric anyway).
export function queryHistory(db, sensorId, {
  metric = null,
  start = null,
  end = null,
  limit = 1000,
  maxWindowSec = 7 * 24 * 3600
} = {}) {
  const now = Date.now() / 1000;
  const effEnd = Number.isFinite(end) ? end : now;
  let effStart = Number.isFinite(start) ? start : effEnd - DEFAULT_WINDOW_SEC;
  if (effEnd - effStart > maxWindowSec) effStart = effEnd - maxWindowSec;
  if (effEnd <= effStart) return [];

  // Math.floor(limit) || 1000 handles NaN/0; Math.max(1, ...) handles
  // negatives (SQLite treats a negative LIMIT as unbounded)
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit) || 1000, MAX_LIMIT));
  const bucketSec = Math.max((effEnd - effStart) / cappedLimit, 0.001);

  let whereClause = 'WHERE sensor_id = ? AND timestamp >= ? AND timestamp <= ?';
  const params = [sensorId, effStart, effEnd];
  if (metric) {
    whereClause += ' AND metric = ?';
    params.push(metric);
  }

  return db.prepare(`
    SELECT metric, AVG(value) AS value, unit, MAX(timestamp) AS timestamp
    FROM sensor_readings ${whereClause}
    GROUP BY metric, CAST(timestamp / ? AS INTEGER)
    ORDER BY MAX(timestamp) DESC
    LIMIT ?
  `).all(...params, bucketSec, cappedLimit);
}
