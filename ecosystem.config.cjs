/**
 * PM2 Ecosystem Configuration
 *
 * Production process manager for 24/7 CrowPi3 operation.
 * Auto-restarts crashed services with exponential backoff.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop all
 *   pm2 logs
 *   pm2 monit
 *
 * Log rotation:
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 7
 *   pm2 set pm2-logrotate:compress true
 *
 * Prerequisites:
 *   pnpm install          (pm2 is a project dependency)
 *   pnpm run web:build    (build web assets before starting)
 */

const LOG_DIR = 'logs';

// Shared API key for inter-service auth. Set to enable; leave empty for dev mode (no auth).
const CROWPI_API_KEY = process.env.CROWPI_API_KEY || '';

module.exports = {
  apps: [
    {
      name: 'sensor-service',
      script: 'src/services/sensor-service.js',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      error_file: `${LOG_DIR}/sensor-service-error.log`,
      out_file: `${LOG_DIR}/sensor-service-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        SENSOR_SERVICE_PORT: 3000,
        STORAGE_SERVICE_URL: 'http://localhost:3001',
        CAMERA_SERVICE_URL: 'http://localhost:8081',
        CROWPI_API_KEY,
      },
    },
    {
      name: 'storage-service',
      script: 'src/services/storage-service.js',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      error_file: `${LOG_DIR}/storage-service-error.log`,
      out_file: `${LOG_DIR}/storage-service-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        STORAGE_SERVICE_PORT: 3001,
        DB_PATH: 'data/sensors.db',
        RETENTION_HOURS: 24,
        CROWPI_API_KEY,
      },
    },
    {
      name: 'module-service',
      script: 'src/services/module-service.js',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      error_file: `${LOG_DIR}/module-service-error.log`,
      out_file: `${LOG_DIR}/module-service-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        CROWPI_API_KEY,
      },
    },
    {
      name: 'camera-service',
      script: 'src/camera-service/camera-service.py',
      interpreter: 'python3',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      error_file: `${LOG_DIR}/camera-service-error.log`,
      out_file: `${LOG_DIR}/camera-service-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        CAMERA_CONFIG: 'config/components.json',
        CROWPI_API_KEY,
      },
    },
    {
      name: 'web-server',
      script: 'web/server-simple.js',
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      error_file: `${LOG_DIR}/web-server-error.log`,
      out_file: `${LOG_DIR}/web-server-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        PORT: 8080,
        CROWPI_API_KEY,
      },
    },
  ],
};
