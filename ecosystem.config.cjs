/**
 * PM2 Ecosystem Configuration
 *
 * Production process manager for 24/7 LatticeSpark operation.
 * Auto-restarts crashed services with exponential backoff.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop all
 *   pm2 logs
 *   pm2 monit
 *
 * Log rotation (run ONCE per machine, before first `pnpm run services`):
 *   pnpm run services:setup-logs
 *   (installs pm2-logrotate with 10MB max size, 7-file retention, gzip, daily rotate)
 *
 * Each app below sets max_memory_restart as a belt-and-suspenders against
 * slow leaks: PM2 restarts the process before it exhausts host memory and
 * freezes SSH (the observed failure mode on ~weekly-uptime nodes).
 *
 * Prerequisites:
 *   pnpm install          (pm2 is a project dependency)
 *   pnpm run web:build    (build web assets before starting)
 */

const LOG_DIR = 'logs';

// Shared API key for inter-service auth. Set to enable; leave empty for dev mode (no auth).
const LATTICESPARK_API_KEY = process.env.LATTICESPARK_API_KEY;
const LATTICESPARK_ROLE = process.env.LATTICESPARK_ROLE;
const LATTICESPARK_NODE_ID = process.env.LATTICESPARK_NODE_ID;
const FLEET_SERVICE_URL = process.env.FLEET_SERVICE_URL || 'http://localhost:3010';
const LATTICESPARK_HUB_URL = process.env.LATTICESPARK_HUB_URL;
const LATTICESPARK_DISABLE_AUTH = process.env.LATTICESPARK_DISABLE_AUTH;

function parseEnabled(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(raw).trim().toLowerCase());
}

const AUTH_DISABLED = parseEnabled(LATTICESPARK_DISABLE_AUTH);

function optionalClusterEnv() {
  return {
    ...(LATTICESPARK_DISABLE_AUTH !== undefined ? { LATTICESPARK_DISABLE_AUTH } : {}),
    ...(!AUTH_DISABLED && LATTICESPARK_API_KEY ? { LATTICESPARK_API_KEY } : {}),
    ...(LATTICESPARK_ROLE ? { LATTICESPARK_ROLE } : {}),
    ...(LATTICESPARK_NODE_ID ? { LATTICESPARK_NODE_ID } : {}),
    ...(LATTICESPARK_HUB_URL ? { LATTICESPARK_HUB_URL } : {})
  };
}

function envEnabled(primaryName, fallbackName, defaultValue = true) {
  const raw = process.env[primaryName] ?? process.env[fallbackName];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultValue;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return defaultValue;
}

const ENABLE_SENSOR_SERVICE = envEnabled('LATTICESPARK_ENABLE_SENSOR_SERVICE', 'ENABLE_SENSOR_SERVICE', true);
const ENABLE_STORAGE_SERVICE = envEnabled('LATTICESPARK_ENABLE_STORAGE_SERVICE', 'ENABLE_STORAGE_SERVICE', true);
const ENABLE_MODULE_SERVICE = envEnabled('LATTICESPARK_ENABLE_MODULE_SERVICE', 'ENABLE_MODULE_SERVICE', true);
const ENABLE_CAMERA_SERVICE = false;//envEnabled('LATTICESPARK_ENABLE_CAMERA_SERVICE', 'ENABLE_CAMERA_SERVICE', true);
const ENABLE_WEB_SERVER = envEnabled('LATTICESPARK_ENABLE_WEB_SERVER', 'ENABLE_WEB_SERVER', true);
const ENABLE_FLEET_SERVICE = envEnabled('LATTICESPARK_ENABLE_FLEET_SERVICE', 'ENABLE_FLEET_SERVICE', true);
const ENABLE_SPOKE_AGENT_SERVICE = envEnabled('LATTICESPARK_ENABLE_SPOKE_AGENT_SERVICE', 'ENABLE_SPOKE_AGENT_SERVICE', true);

const apps = [
  {
    enabled: ENABLE_SENSOR_SERVICE,
    name: 'sensor-service',
    script: 'src/services/sensor-service.js',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.SENSOR_SERVICE_MAX_MEMORY || '512M',
    error_file: `${LOG_DIR}/sensor-service-error.log`,
    out_file: `${LOG_DIR}/sensor-service-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      SENSOR_SERVICE_PORT: 3000,
      STORAGE_SERVICE_URL: 'http://localhost:3001',
      CAMERA_SERVICE_URL: 'http://localhost:8081',
      FLEET_SERVICE_URL,
      ...optionalClusterEnv()
    },
  },
  {
    enabled: ENABLE_STORAGE_SERVICE,
    name: 'storage-service',
    script: 'src/services/storage-service.js',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.STORAGE_SERVICE_MAX_MEMORY || '512M',
    error_file: `${LOG_DIR}/storage-service-error.log`,
    out_file: `${LOG_DIR}/storage-service-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      STORAGE_SERVICE_PORT: 3001,
      DB_PATH: 'data/sensors.db',
      RETENTION_HOURS: 168,
      ...optionalClusterEnv()
    },
  },
  {
    enabled: ENABLE_MODULE_SERVICE,
    name: 'module-service',
    script: 'src/services/module-service.js',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.MODULE_SERVICE_MAX_MEMORY || '256M',
    error_file: `${LOG_DIR}/module-service-error.log`,
    out_file: `${LOG_DIR}/module-service-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      ...optionalClusterEnv()
    },
  },
  {
    enabled: ENABLE_CAMERA_SERVICE,
    name: 'camera-service',
    script: 'src/camera-service/camera-service.py',
    interpreter: 'python3',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.CAMERA_SERVICE_MAX_MEMORY || '768M',
    error_file: `${LOG_DIR}/camera-service-error.log`,
    out_file: `${LOG_DIR}/camera-service-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      CAMERA_CONFIG: 'config/components.json',
      ...optionalClusterEnv()
    },
  },
  {
    enabled: ENABLE_WEB_SERVER,
    name: 'web-server',
    script: 'web/server-simple.js',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.WEB_SERVER_MAX_MEMORY || '256M',
    error_file: `${LOG_DIR}/web-server-error.log`,
    out_file: `${LOG_DIR}/web-server-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      PORT: 8080,
      FLEET_SERVICE_URL,
      ...optionalClusterEnv()
    },
  },
  {
    enabled: ENABLE_FLEET_SERVICE,
    name: 'fleet-service',
    script: 'src/services/fleet-service.js',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.FLEET_SERVICE_MAX_MEMORY || '256M',
    error_file: `${LOG_DIR}/fleet-service-error.log`,
    out_file: `${LOG_DIR}/fleet-service-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      FLEET_SERVICE_PORT: 3010,
      SENSOR_SERVICE_URL: 'http://localhost:3000',
      ...optionalClusterEnv()
    },
  },
  {
    enabled: ENABLE_SPOKE_AGENT_SERVICE,
    name: 'spoke-agent-service',
    script: 'src/services/spoke-agent-service.js',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: process.env.SPOKE_AGENT_MAX_MEMORY || '512M',
    error_file: `${LOG_DIR}/spoke-agent-service-error.log`,
    out_file: `${LOG_DIR}/spoke-agent-service-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    merge_logs: true,
    env: {
      // Keep empty by default so spoke-agent can fall back to config/cluster.json hubUrl.
      ...optionalClusterEnv(),
      SENSOR_SERVICE_URL: 'http://localhost:3000',
      MODULE_SERVICE_URL: 'http://localhost:3002',
    },
  },
];

module.exports = {
  apps: apps
    .filter(app => app.enabled !== false)
    .map(({ enabled, ...app }) => app),
};
