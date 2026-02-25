import pino from 'pino';

/**
 * Create a pino logger instance.
 *
 * - JSON output in production (ideal for PM2 log rotation)
 * - Pretty-print in dev (via pino-pretty transport)
 * - Level controlled by LOG_LEVEL env var (default: 'info')
 * - Auto-detects dev vs production via NODE_ENV and PM2_HOME
 *
 * @param {string} name - Logger name (appears in every log line)
 * @param {Object} [options]
 * @param {string} [options.level] - Override log level
 * @returns {import('pino').Logger}
 */
export function createLogger(name, options = {}) {
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.PM2_HOME;
  const level = options.level || process.env.LOG_LEVEL || 'info';

  const baseOptions = { name, level };

  if (isProduction) {
    return pino(baseOptions);
  }

  return pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  });
}
