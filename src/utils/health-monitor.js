import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Start a periodic heartbeat that logs process health + caller-provided stats.
 *
 * Logs RSS, heap usage, event-loop lag, uptime, and any counters the caller
 * returns from getStats(). Intended for diagnosing slow leaks on long-running
 * services — the rate-of-change of each counter identifies what's growing.
 *
 * @param {Object} opts
 * @param {import('pino').Logger} opts.log - Logger (pino-compatible)
 * @param {number} [opts.intervalMs=60000] - Heartbeat interval
 * @param {() => Object} [opts.getStats] - Called each tick; returned fields are merged into the log record
 * @returns {() => void} Stop function (clears interval and disables loop monitor)
 */
export function startHealthMonitor({ log, intervalMs = 60000, getStats } = {}) {
  if (!log) throw new Error('health-monitor: log is required');

  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();

  const tick = () => {
    const mem = process.memoryUsage();
    const loopMaxMs = loop.max / 1e6;
    const loopMeanMs = loop.mean / 1e6;
    const loopP99Ms = loop.percentile(99) / 1e6;
    loop.reset();

    let extra = {};
    if (typeof getStats === 'function') {
      try {
        extra = getStats() || {};
      } catch (err) {
        extra = { statsError: err.message };
      }
    }

    log.info({
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
      arrayBuffersMb: Math.round((mem.arrayBuffers || 0) / 1024 / 1024),
      loopMeanMs: Math.round(loopMeanMs * 100) / 100,
      loopP99Ms: Math.round(loopP99Ms * 100) / 100,
      loopMaxMs: Math.round(loopMaxMs * 100) / 100,
      uptimeSec: Math.round(process.uptime()),
      ...extra
    }, 'health');
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    loop.disable();
  };
}
