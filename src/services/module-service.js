import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { ModuleContext } from '../modules/module-context.js';
import { discoverModules, validateComponentRefs, loadModuleClass } from '../modules/module-loader.js';
import { loadClusterConfig } from '../cluster/cluster-config.js';
import { withTimeout } from '../utils/timeout.js';
import { atomicWriteJson } from '../utils/persistence.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { BaseService } from './base-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('module-service');
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const MODULE_SERVICE_PORT = parseInt(process.env.MODULE_SERVICE_PORT || '3002', 10);
const SENSOR_SERVICE_URL = process.env.SENSOR_SERVICE_URL || 'http://localhost:3000';
const MODULES_DIR = join(PROJECT_ROOT, 'modules');
const STATE_DIR = join(PROJECT_ROOT, 'data', 'modules');
const clusterConfig = loadClusterConfig();

const CLEANUP_TIMEOUT = parseInt(process.env.MODULE_CLEANUP_TIMEOUT || '5000', 10);
const INIT_TIMEOUT = parseInt(process.env.MODULE_INIT_TIMEOUT || '10000', 10);
const BREAKER_THRESHOLD = parseInt(process.env.MODULE_BREAKER_THRESHOLD || '5', 10);
const BREAKER_BASE_DELAY = parseInt(process.env.MODULE_BREAKER_BASE_DELAY || '5000', 10);
const BREAKER_MAX_DELAY = parseInt(process.env.MODULE_BREAKER_MAX_DELAY || '300000', 10);
const BREAKER_MAX_RETRIES = parseInt(process.env.MODULE_BREAKER_MAX_RETRIES || '10', 10);
const API_KEY = clusterConfig.apiKey || '';

// ── Module Registry ─────────────────────────────────────────────────────────

/** @type {Map<string, ModuleEntry>} */
const modules = new Map();

/**
 * @typedef {Object} ModuleEntry
 * @property {string} id
 * @property {string} dir
 * @property {Object} config - Parsed module.json
 * @property {string} status - 'stopped' | 'running' | 'disabled' | 'error'
 * @property {Object|null} instance - BaseModule instance
 * @property {ModuleContext|null} context
 * @property {NodeJS.Timeout|null} intervalId
 * @property {number} consecutiveErrors
 * @property {string|null} lastError
 * @property {number} breakerTrips - consecutive circuit breaker trips (for backoff)
 * @property {NodeJS.Timeout|null} restartTimer - pending auto-restart timer
 */

// ── Shared State ────────────────────────────────────────────────────────────

/** @type {Map<string, Object>} Latest sensor data cache */
const latestData = new Map();

/** @type {Map<string, Object>} Previous sensor data (for onChange comparison) */
const previousData = new Map();

/** @type {Array} Component list from sensor-service */
let components = [];

/** @type {import('socket.io-client').Socket} */
let sensorSocket = null;

/** @type {Server} */
let moduleIo = null;

// ── Sensor Service Connection ───────────────────────────────────────────────

/** Named handlers so we can remove them before re-registering on reconnect. */
function onSensorComponents(comps) {
  // Mutate in-place so ModuleContext references stay current
  components.length = 0;
  components.push(...comps);

  // Prune latestData/previousData for components no longer present
  const validIds = new Set(comps.map(c => c.id));
  for (const id of latestData.keys()) {
    if (!validIds.has(id)) latestData.delete(id);
  }
  for (const id of previousData.keys()) {
    if (!validIds.has(id)) previousData.delete(id);
  }
}

function onSensorBatch(batch) {
  for (const [componentId, data] of Object.entries(batch)) {
    const current = latestData.get(componentId);
    if (current) {
      previousData.set(componentId, { ...current });
    }
    latestData.set(componentId, data);
  }
  handleSensorBatch(batch);
}

function onSensorError({ componentId, error }) {
  log.warn({ componentId }, 'Sensor error: %s', error);
}

function connectToSensorService() {
  return new Promise((resolve) => {
    // Clean up any existing socket to prevent listener accumulation
    if (sensorSocket) {
      sensorSocket.off('components', onSensorComponents);
      sensorSocket.off('sensor:batch', onSensorBatch);
      sensorSocket.off('sensor:error', onSensorError);
      sensorSocket.disconnect();
    }

    sensorSocket = ioClient(SENSOR_SERVICE_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      ...(API_KEY ? { auth: { apiKey: API_KEY } } : {})
    });

    sensorSocket.on('connect', () => {
      log.info('Connected to sensor-service');
      // Resume paused module intervals on reconnect
      for (const entry of modules.values()) {
        if (entry.status === 'running' && !entry.intervalId && entry.config.triggers.interval) {
          entry.intervalId = setInterval(
            () => safeCall(entry, 'execute'),
            entry.config.triggers.interval
          );
          log.info({ moduleId: entry.id }, 'Resumed interval');
        }
      }
    });

    sensorSocket.on('disconnect', () => {
      log.info('Disconnected from sensor-service, pausing module intervals');
      // Pause module intervals — onSensorChange won't fire anyway (no batches)
      for (const entry of modules.values()) {
        if (entry.intervalId) {
          clearInterval(entry.intervalId);
          entry.intervalId = null;
        }
      }
    });

    // Register data handlers (named functions — safe to remove on reconnect)
    sensorSocket.on('components', onSensorComponents);
    sensorSocket.on('sensor:batch', onSensorBatch);
    sensorSocket.on('sensor:error', onSensorError);

    // Resolve on first components event
    sensorSocket.once('components', () => resolve());
  });
}

// ── Sensor Change Handling ──────────────────────────────────────────────────

/**
 * Shallow equality check for flat sensor data objects.
 * Compares own enumerable keys/values — handles typical sensor payloads
 * (numeric readings, strings, timestamps) without JSON.stringify overhead.
 */
function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function handleSensorBatch(batch) {
  for (const entry of modules.values()) {
    if (entry.status !== 'running' || !entry.instance) continue;

    const watchedIds = entry.config.triggers.onChange;
    if (!Array.isArray(watchedIds) || watchedIds.length === 0) continue;

    for (const componentId of watchedIds) {
      if (!(componentId in batch)) continue;

      const newData = batch[componentId];
      const prevData = previousData.get(componentId) ?? null;

      // Only fire if data actually changed
      if (prevData && shallowEqual(newData, prevData)) continue;

      // Pass copies to modules so they can't corrupt the shared cache
      const newCopy = { ...newData };
      const prevCopy = prevData ? { ...prevData } : null;

      // Notify context subscribers
      entry.context._notifyData(componentId, newCopy);

      // Call module's onSensorChange
      safeCall(entry, 'onSensorChange', componentId, newCopy, prevCopy);
    }
  }
}

// ── Module Lifecycle ────────────────────────────────────────────────────────

async function startModule(entry) {
  if (entry.status === 'running') return;

  try {
    const ModuleClass = await loadModuleClass(entry.id, entry.dir);

    const context = new ModuleContext({
      moduleId: entry.id,
      sensorSocket,
      latestData,
      components,
      moduleIo,
      stateDir: STATE_DIR
    });

    const instance = new ModuleClass(context, entry.config);
    entry.instance = instance;
    entry.context = context;
    entry.consecutiveErrors = 0;
    entry.lastError = null;

    // Validate component refs (warnings only — don't block startup)
    const warnings = validateComponentRefs(entry.config, components);
    warnings.forEach(w => log.warn({ moduleId: entry.id }, w));

    await withTimeout(instance.initialize(), INIT_TIMEOUT, 'initialize() timeout');

    // Start interval trigger
    if (entry.config.triggers.interval) {
      entry.intervalId = setInterval(
        () => safeCall(entry, 'execute'),
        entry.config.triggers.interval
      );
    }

    entry.status = 'running';
    entry.breakerTrips = 0;  // Reset on successful start
    log.info({ moduleId: entry.id }, 'Started module');
    broadcastModuleStatus(entry);
  } catch (err) {
    entry.status = 'error';
    entry.lastError = err.message;
    log.error({ moduleId: entry.id, err }, 'Failed to start module');
    broadcastModuleStatus(entry);
  }
}

async function stopModule(entry) {
  if (entry.status !== 'running' && entry.status !== 'error') return;

  // Clear pending restart timer
  if (entry.restartTimer) {
    clearTimeout(entry.restartTimer);
    entry.restartTimer = null;
  }

  // Clear interval
  if (entry.intervalId) {
    clearInterval(entry.intervalId);
    entry.intervalId = null;
  }

  // Call cleanup with timeout
  if (entry.instance) {
    try {
      await withTimeout(entry.instance.cleanup(), CLEANUP_TIMEOUT, 'cleanup timeout');
    } catch (err) {
      log.warn({ moduleId: entry.id, err }, 'Cleanup error');
    }
  }

  // Destroy context
  if (entry.context) {
    entry.context._destroy();
  }

  entry.instance = null;
  entry.context = null;
  entry.status = 'stopped';
  broadcastModuleStatus(entry);
}

/**
 * Safely call a method on a module instance with error tracking.
 * Circuit breaker covers both execute() and onSensorChange().
 */
async function safeCall(entry, method, ...args) {
  if (!entry.instance || typeof entry.instance[method] !== 'function') return;

  try {
    await entry.instance[method](...args);
    entry.consecutiveErrors = 0;
  } catch (err) {
    entry.lastError = err.message;
    entry.consecutiveErrors++;
    log.error({ moduleId: entry.id, method, err }, 'Module method error');

    if (entry.consecutiveErrors >= BREAKER_THRESHOLD) {
      entry.breakerTrips++;

      if (entry.breakerTrips > BREAKER_MAX_RETRIES) {
        log.error({ moduleId: entry.id, maxRetries: BREAKER_MAX_RETRIES }, 'Circuit breaker: permanently disabling module');
        await disableModule(entry.id);
        return;
      }

      const delay = Math.min(
        BREAKER_BASE_DELAY * Math.pow(2, entry.breakerTrips - 1),
        BREAKER_MAX_DELAY
      );
      log.error({ moduleId: entry.id, delaySec: delay / 1000, attempt: entry.breakerTrips, maxRetries: BREAKER_MAX_RETRIES }, 'Circuit breaker: restarting module');
      await stopModule(entry);
      entry.status = 'error';
      broadcastModuleStatus(entry);

      entry.restartTimer = setTimeout(() => {
        (async () => {
          entry.restartTimer = null;
          entry.consecutiveErrors = 0;
          log.info({ moduleId: entry.id, attempt: entry.breakerTrips, maxRetries: BREAKER_MAX_RETRIES }, 'Auto-restarting module');
          await startModule(entry);
          broadcastFullModuleList();
        })().catch(err => {
          log.error({ moduleId: entry.id, err }, 'Auto-restart failed');
        });
      }, delay);
    }
  }
}

async function enableModule(moduleId) {
  const entry = modules.get(moduleId);
  if (!entry) return { error: `Module "${moduleId}" not found` };

  entry.config.enabled = true;
  await persistConfig(entry);
  await startModule(entry);
  broadcastFullModuleList();
  return { success: true };
}

async function disableModule(moduleId) {
  const entry = modules.get(moduleId);
  if (!entry) return { error: `Module "${moduleId}" not found` };

  await stopModule(entry);
  entry.config.enabled = false;
  entry.status = 'disabled';
  await persistConfig(entry);
  broadcastModuleStatus(entry);
  broadcastFullModuleList();
  log.info({ moduleId }, 'Disabled module');
  return { success: true };
}

async function restartModule(moduleId) {
  const entry = modules.get(moduleId);
  if (!entry) return { error: `Module "${moduleId}" not found` };

  await stopModule(entry);
  await startModule(entry);
  broadcastFullModuleList();
  return { success: true, status: entry.status };
}

async function rescanModules() {
  const discovered = await discoverModules(MODULES_DIR);
  const byId = new Map(discovered.map((m) => [m.id, m]));

  let added = 0;
  let updated = 0;
  let removed = 0;

  // Add or update discovered modules
  for (const found of discovered) {
    const existing = modules.get(found.id);

    if (!existing) {
      const entry = {
        id: found.id,
        dir: found.dir,
        config: found.config,
        status: found.config.enabled ? 'stopped' : 'disabled',
        instance: null,
        context: null,
        intervalId: null,
        consecutiveErrors: 0,
        lastError: null,
        breakerTrips: 0,
        restartTimer: null
      };
      modules.set(found.id, entry);
      added++;
      if (entry.config.enabled) {
        await startModule(entry);
      }
      continue;
    }

    const wasRunning = existing.status === 'running';
    existing.dir = found.dir;
    existing.config = found.config;
    updated++;

    if (!found.config.enabled && wasRunning) {
      await stopModule(existing);
      existing.status = 'disabled';
    } else if (found.config.enabled && wasRunning) {
      // Reload running modules so updated code/config takes effect after deploy.
      await stopModule(existing);
      existing.status = 'stopped';
      await startModule(existing);
    } else if (found.config.enabled && !wasRunning) {
      existing.status = 'stopped';
      await startModule(existing);
    }
  }

  // Remove modules that no longer exist on disk
  for (const [moduleId, entry] of modules.entries()) {
    if (byId.has(moduleId)) continue;
    await stopModule(entry);
    modules.delete(moduleId);
    removed++;
  }

  broadcastFullModuleList();
  return {
    success: true,
    added,
    updated,
    removed,
    total: modules.size
  };
}

function broadcastFullModuleList() {
  if (!moduleIo) return;
  moduleIo.emit('modules', getModuleList());
}

async function persistConfig(entry) {
  const configPath = join(entry.dir, 'module.json');
  try {
    await atomicWriteJson(configPath, entry.config);
  } catch (err) {
    log.error({ moduleId: entry.id, err }, 'Failed to persist config');
  }
}

// ── Socket.IO Broadcasting ──────────────────────────────────────────────────

function broadcastModuleStatus(entry) {
  if (!moduleIo) return;
  moduleIo.emit('module:status', {
    moduleId: entry.id,
    status: entry.status,
    lastError: entry.lastError,
    enabled: entry.config.enabled
  });
}

function getModuleList() {
  return Array.from(modules.values()).map(entry => ({
    id: entry.id,
    name: entry.config.name,
    description: entry.config.description || '',
    version: entry.config.version || '0.0.0',
    enabled: entry.config.enabled,
    status: entry.status,
    lastError: entry.lastError,
    triggers: entry.config.triggers,
    components: entry.config.components,
    ui: entry.config.ui || {}
  }));
}

// ── Express REST API ────────────────────────────────────────────────────────

function registerRoutes(app) {
  // List all modules
  app.get('/api/modules', (req, res) => {
    res.json(getModuleList());
  });

  // Get single module
  app.get('/api/modules/:id', (req, res) => {
    const entry = modules.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Module not found' });

    const info = getModuleList().find(m => m.id === req.params.id);
    res.json(info);
  });

  // Enable module
  app.post('/api/modules/:id/enable', async (req, res) => {
    const result = await enableModule(req.params.id);
    res.json(result);
  });

  // Disable module
  app.post('/api/modules/:id/disable', async (req, res) => {
    const result = await disableModule(req.params.id);
    res.json(result);
  });

  // Restart module
  app.post('/api/modules/:id/restart', async (req, res) => {
    const result = await restartModule(req.params.id);
    res.json(result);
  });

  // Rescan modules directory (used by spoke-agent module deploy flow)
  app.post('/api/modules/rescan', async (req, res) => {
    try {
      const result = await rescanModules();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send command to module
  app.post('/api/modules/:id/command', async (req, res) => {
    const entry = modules.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Module not found' });
    if (entry.status !== 'running') return res.status(400).json({ error: 'Module not running' });

    const { command, params } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing "command" field' });

    try {
      const result = await entry.instance.handleCommand(command, params || {});
      res.json({ success: true, result: result ?? null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

}

// ── Socket.IO Server ────────────────────────────────────────────────────────

function setupSocketIO(httpServer) {
  moduleIo = new Server(httpServer, {
    path: '/modules-io',
    transports: ['websocket'],
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Socket.IO auth: require API key when configured
  if (API_KEY) {
    moduleIo.use((socket, next) => {
      if (socket.handshake.auth?.apiKey === API_KEY) return next();
      next(new Error('unauthorized'));
    });
  }

  moduleIo.on('connection', (socket) => {
    log.info({ socketId: socket.id }, 'UI client connected');

    // Send current module list
    socket.emit('modules', getModuleList());

    // Replay last emitted state for all running modules
    for (const entry of modules.values()) {
      if (entry.context) {
        const state = entry.context.getLastEmittedState();
        if (state !== null) {
          socket.emit('module:state', { moduleId: entry.id, state });
        }
      }
    }

    // Handle commands from UI
    socket.on('module:command', async ({ moduleId, command, params }, callback) => {
      const entry = modules.get(moduleId);
      if (!entry || entry.status !== 'running') {
        callback?.({ error: 'Module not running' });
        return;
      }
      try {
        const result = await entry.instance.handleCommand(command, params || {});
        callback?.({ success: true, result: result ?? null });
      } catch (err) {
        callback?.({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      log.info({ socketId: socket.id }, 'UI client disconnected');
    });
  });
}

// ── Service ─────────────────────────────────────────────────────────────────

const service = new BaseService('module-service', { port: MODULE_SERVICE_PORT });

service.registerHealthCheck(async () => {
  const running = Array.from(modules.values()).filter(m => m.status === 'running').length;
  const sensorConnected = sensorSocket?.connected ?? false;
  return {
    status: sensorConnected ? 'ok' : 'degraded',
    dependencies: {
      sensorService: sensorConnected ? 'connected' : 'disconnected'
    },
    modules: { total: modules.size, running },
    uptime: process.uptime()
  };
});

service.initialize = async () => {
  log.info('Starting...');

  // 1. Discover modules
  const discovered = await discoverModules(MODULES_DIR);
  for (const { id, dir, config } of discovered) {
    modules.set(id, {
      id,
      dir,
      config,
      status: config.enabled ? 'stopped' : 'disabled',
      instance: null,
      context: null,
      intervalId: null,
      consecutiveErrors: 0,
      lastError: null,
      breakerTrips: 0,
      restartTimer: null
    });
  }
  log.info('Discovered %d module(s)', modules.size);

  // 2. Register REST routes + Socket.IO
  registerRoutes(service.app);
  setupSocketIO(service.httpServer);

  // 3. Connect to sensor-service (wait for components)
  log.info('Connecting to sensor-service...');
  await connectToSensorService();
  log.info('Sensor-service ready (%d components)', components.length);

  // 4. Start enabled modules
  const enabledModules = Array.from(modules.values()).filter(m => m.config.enabled);
  for (const entry of enabledModules) {
    await startModule(entry);
  }

  log.info('REST API: http://localhost:%d/api/modules', MODULE_SERVICE_PORT);
  log.info('Socket.IO path: /modules-io');
};

service.onShutdown = async () => {
  for (const entry of modules.values()) {
    if (entry.status === 'running') {
      await stopModule(entry);
    }
  }
  if (sensorSocket) sensorSocket.disconnect();
};

service.start().catch(err => {
  log.error({ err }, 'Fatal error');
  process.exit(1);
});
