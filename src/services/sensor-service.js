#!/usr/bin/env node
/**
 * Sensor Service
 *
 * Real-time sensor management service.
 * - Polls sensors at configured rates
 * - WebSocket streaming for real-time updates
 * - REST API for current readings
 * - Pushes data to Storage Service
 */

import express from 'express';
import http from 'http';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { createSensorCoordinator } from '../coordinator/sensor-coordinator.js';
import { CameraClient } from '../camera-client/camera-client.js';

// Prevent unhandled promise rejections from crashing the service
process.on('unhandledRejection', (reason, promise) => {
  console.error('[sensor-service] Unhandled promise rejection:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.SENSOR_SERVICE_PORT || 3000;
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3001';
const CAMERA_SERVICE_URL = process.env.CAMERA_SERVICE_URL || 'http://localhost:8081';
const DEBUG = process.env.SENSOR_DEBUG === 'true';
const API_KEY = process.env.LATTICESPARK_API_KEY || '';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket'],
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.IO auth: require API key when configured
if (API_KEY) {
  io.use((socket, next) => {
    if (socket.handshake.auth?.apiKey === API_KEY) return next();
    next(new Error('unauthorized'));
  });
}

app.use(express.json());

const READ_TIMEOUT = parseInt(process.env.READ_TIMEOUT || '5000', 10);

let inFlightReads = 0; // track in-flight polling reads for graceful shutdown
let coordinator = null;
let cameraClient = null;
let cameraConfig = null;
let pollingIntervals = new Map();
let coordinatorListeners = {}; // stored so we can remove on shutdown
const lastStoragePush = new Map(); // throttle storage writes per sensor
const STORAGE_INTERVAL = parseInt(process.env.STORAGE_INTERVAL || '2000', 10);

// Batch WebSocket emissions to reduce network traffic
const BATCH_INTERVAL = parseInt(process.env.BATCH_INTERVAL || '100', 10);
let pendingBatch = {};
let batchTimer = null;
const skipStorageIds = new Set();

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.then(
      v => { clearTimeout(timer); return v; },
      e => { clearTimeout(timer); throw e; }
    ),
    new Promise((_, reject) =>
      timer = setTimeout(() => reject(new Error(`Timeout: ${label} took longer than ${ms}ms`)), ms)
    )
  ]);
}

// REST API: Get all sensors
app.get('/api/sensors', (req, res) => {
  if (!coordinator) {
    return res.status(503).json({ error: 'Coordinator not initialized' });
  }

  const components = coordinator.getComponents();
  res.json({ sensors: components });
});

// REST API: Read specific sensor
app.get('/api/sensors/:id/read', async (req, res) => {
  if (!coordinator) {
    return res.status(503).json({ error: 'Coordinator not initialized' });
  }

  try {
    const data = await withTimeout(coordinator.read(req.params.id), READ_TIMEOUT, `read ${req.params.id}`);
    res.json({
      sensorId: req.params.id,
      data,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Register a new component at runtime
app.post('/api/components', async (req, res) => {
  if (!coordinator) {
    return res.status(503).json({ error: 'Coordinator not initialized' });
  }

  const { id, config } = req.body;
  if (!id || !config || !config.type) {
    return res.status(400).json({ error: 'Missing required fields: id, config.type' });
  }

  try {
    await coordinator.register(id, config);

    // Update skipStorage set for the new component
    if (config.skipStorage) {
      skipStorageIds.add(id);
    }

    // Start polling for the new component (clear existing if re-registered)
    if (pollingIntervals.has(id)) {
      clearInterval(pollingIntervals.get(id));
    }
    const interval = config.pollInterval || 5000;
    const intervalId = setInterval(async () => {
      try {
        await withTimeout(coordinator.read(id), READ_TIMEOUT, `poll ${id}`);
      } catch (error) {
        console.error(`Error polling ${id}:`, error.message);
      }
    }, interval);
    pollingIntervals.set(id, intervalId);

    res.json({ status: 'registered', id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REST API: Health check with upstream dependency verification
app.get('/health', async (req, res) => {
  const coordinatorOk = coordinator !== null;

  // Check storage service reachability
  let storageStatus = 'unknown';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${STORAGE_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    storageStatus = resp.ok ? 'ok' : 'error';
  } catch {
    storageStatus = 'unreachable';
  }

  const healthy = coordinatorOk && storageStatus === 'ok';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    dependencies: {
      coordinator: coordinatorOk ? 'ready' : 'not initialized',
      storageService: storageStatus,
      camera: cameraClient?.isReady ? 'ready' : 'not available'
    },
    pollingComponents: pollingIntervals.size,
    uptime: process.uptime()
  });
});

// Camera: Proxy MJPEG stream from Python camera service
app.get('/api/camera/stream', (req, res) => {
  if (!cameraClient?.isReady) {
    return res.status(503).json({ error: 'Camera not available' });
  }

  const upstream = http.request({
    hostname: 'localhost',
    port: cameraClient.mjpegPort,
    path: '/stream',
    method: 'GET'
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('Camera stream proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Camera stream unavailable' });
    }
  });

  upstream.end();
  req.on('close', () => upstream.destroy());
});

// Camera: Proxy snapshot from Python camera service
app.get('/api/camera/snapshot', (req, res) => {
  if (!cameraClient?.isReady) {
    return res.status(503).json({ error: 'Camera not available' });
  }

  const upstream = http.request({
    hostname: 'localhost',
    port: cameraClient.mjpegPort,
    path: '/snapshot',
    method: 'GET'
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('Camera snapshot proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Camera snapshot unavailable' });
    }
  });

  upstream.end();
  req.on('close', () => upstream.destroy());
});

// Camera: REST API for camera status
app.get('/api/camera/status', async (req, res) => {
  if (!cameraClient?.isReady) {
    return res.status(503).json({ error: 'Camera not available' });
  }

  try {
    const status = await cameraClient.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current sensor list (include camera as virtual component)
  if (coordinator) {
    socket.emit('components', getComponentsWithCamera());
  }

  // Handle write commands from client
  socket.on('component:write', async ({ componentId, data }, callback) => {
    if (!coordinator) {
      callback?.({ error: 'Coordinator not initialized' });
      return;
    }
    try {
      await withTimeout(coordinator.write(componentId, data), READ_TIMEOUT, `write ${componentId}`);
      callback?.({ success: true });
    } catch (error) {
      console.error(`Write error for ${componentId}:`, error.message);
      callback?.({ error: error.message });
    }
  });

  // Handle camera control commands from client
  socket.on('camera:control', async ({ action, params }, callback) => {
    if (!cameraClient?.isReady) {
      callback?.({ error: 'Camera not available' });
      return;
    }
    try {
      let result;
      switch (action) {
        case 'enable_processor':
          result = await cameraClient.enableProcessor(params.name);
          break;
        case 'disable_processor':
          result = await cameraClient.disableProcessor(params.name);
          break;
        case 'get_processors':
          result = await cameraClient.getProcessors();
          break;
        case 'get_status':
          result = await cameraClient.getStatus();
          break;
        default:
          callback?.({ error: `Unknown action: ${action}` });
          return;
      }
      callback?.({ success: true, ...result });
    } catch (error) {
      console.error(`Camera control error (${action}):`, error.message);
      callback?.({ error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Push data to Storage Service (with timeout to prevent accumulation)
const STORAGE_PUSH_TIMEOUT = parseInt(process.env.STORAGE_PUSH_TIMEOUT || '5000', 10);

async function pushToStorage(sensorId, data) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_PUSH_TIMEOUT);

  try {
    const response = await fetch(`${STORAGE_SERVICE_URL}/api/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sensorId,
        data,
        timestamp: data.timestamp || Date.now() / 1000
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.error(`Storage push failed: ${response.statusText}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`Storage push timeout for ${sensorId} (>${STORAGE_PUSH_TIMEOUT}ms)`);
    } else {
      console.error('Failed to push to storage:', error.message);
    }
  } finally {
    clearTimeout(timer);
  }
}

// Build component list including camera as virtual component
function getComponentsWithCamera() {
  const components = coordinator ? coordinator.getComponents() : [];
  if (cameraClient?.isReady && cameraConfig) {
    components.push({
      id: 'camera',
      type: 'Camera',
      config: cameraConfig
    });
  }
  return components;
}

// Initialize camera client (connects to standalone camera-service managed by PM2)
async function initializeCamera(configFile) {
  try {
    // Read camera config for the virtual component entry
    const fileContent = await readFile(configFile, 'utf-8');
    const fullConfig = JSON.parse(fileContent);
    cameraConfig = fullConfig.camera;

    if (!cameraConfig || cameraConfig.enabled === false) {
      console.log('Camera not configured or disabled, skipping');
      return;
    }

    console.log(`Monitoring camera service at ${CAMERA_SERVICE_URL}...`);
    cameraClient = new CameraClient({ url: CAMERA_SERVICE_URL });

    // Forward detection events from camera to WebSocket clients
    cameraClient.on('detection', (data) => {
      io.emit('camera:detection', data);
    });

    // Camera comes and goes — update component list for connected clients
    cameraClient.on('ready', (status) => {
      console.log(`Camera service ready (fps=${status.fps}, resolution=${status.resolution})`);
      io.emit('components', getComponentsWithCamera());
    });

    cameraClient.on('disconnected', () => {
      console.warn('Camera service disconnected, will retry...');
      io.emit('components', getComponentsWithCamera());
    });

    // Start continuous health polling — never times out, survives restarts
    cameraClient.startMonitoring();

  } catch (error) {
    console.error('Failed to initialize camera client:', error.message);
    cameraClient = null;
  }
}

// Initialize coordinator and start polling
async function initializeCoordinator() {
  try {
    const configFile = join(__dirname, '..', '..', 'config', 'components.json');
    console.log('Initializing coordinator...');
    console.log('Config file:', configFile);

    coordinator = await createSensorCoordinator({ configFile });

    // Listen to component data events - store refs for cleanup
    coordinatorListeners.data = (event) => {
      if (!event.data || typeof event.data !== 'object') {
        console.warn(`Invalid data from ${event.componentId}: not an object`);
        return;
      }

      // Ensure timestamp exists and is valid
      if (!event.data.timestamp || !Number.isFinite(event.data.timestamp)) {
        event.data.timestamp = Date.now() / 1000;
      }

      // Validate metric values - allow numbers and strings, drop booleans/objects
      const validated = { timestamp: event.data.timestamp };
      let hasData = false;
      for (const [key, value] of Object.entries(event.data)) {
        if (key === 'timestamp') continue;
        if (Number.isFinite(value) || typeof value === 'string') {
          validated[key] = value;
          hasData = true;
        } else {
          console.warn(`Dropping invalid metric ${key}=${value} from ${event.componentId}`);
        }
      }

      if (!hasData) return;

      if (DEBUG) console.log(`[${event.componentId}]`, validated);

      // Buffer for batched WebSocket emission
      pendingBatch[event.componentId] = validated;

      // Push to Storage Service (throttled, skip components with skipStorage)
      if (!skipStorageIds.has(event.componentId)) {
        const now = Date.now();
        const lastPush = lastStoragePush.get(event.componentId) || 0;
        if (now - lastPush >= STORAGE_INTERVAL) {
          lastStoragePush.set(event.componentId, now);
          pushToStorage(event.componentId, validated);
        }
      }
    };

    coordinatorListeners.error = (event) => {
      console.error('Component error:', event.componentId, event.error.message);
      io.emit('sensor:error', {
        componentId: event.componentId,
        error: event.error.message
      });
    };

    coordinatorListeners.ready = () => {
      const comps = getComponentsWithCamera();
      io.emit('components', comps);

      // Prune lastStoragePush and skipStorageIds for removed components
      const validIds = new Set(comps.map(c => c.id));
      for (const id of lastStoragePush.keys()) {
        if (!validIds.has(id)) lastStoragePush.delete(id);
      }
      for (const id of skipStorageIds) {
        if (!validIds.has(id)) skipStorageIds.delete(id);
      }
    };

    coordinator.on('component:data', coordinatorListeners.data);
    coordinator.on('component:error', coordinatorListeners.error);
    coordinator.on('component:ready', coordinatorListeners.ready);

    // Build set of components that skip storage
    for (const comp of coordinator.getComponents()) {
      if (comp.config?.skipStorage) {
        skipStorageIds.add(comp.id);
      }
    }

    console.log('✓ Coordinator initialized');

    // Start polling sensors based on config
    startPolling();

    // Initialize camera service (non-blocking — failure doesn't affect sensors)
    await initializeCamera(configFile);

  } catch (error) {
    console.error('Failed to initialize coordinator:', error);
    process.exit(1);
  }
}

// Start polling all configured sensors
function startPolling() {
  const components = coordinator.getComponents();

  for (const component of components) {
    const interval = component.config?.pollInterval || 5000;

    console.log(`Starting polling for ${component.id} (${interval}ms)`);

    const intervalId = setInterval(async () => {
      inFlightReads++;
      try {
        await withTimeout(coordinator.read(component.id), READ_TIMEOUT, `poll ${component.id}`);
      } catch (error) {
        console.error(`Error polling ${component.id}:`, error.message);
      } finally {
        inFlightReads--;
      }
    }, interval);

    pollingIntervals.set(component.id, intervalId);
  }

  // Start batch flush timer
  batchTimer = setInterval(() => {
    if (Object.keys(pendingBatch).length === 0) return;
    const batch = pendingBatch;
    pendingBatch = {};
    try {
      io.emit('sensor:batch', batch);
    } catch (error) {
      console.error('Failed to emit sensor batch:', error.message);
    }
  }, BATCH_INTERVAL);
}

// Stop all polling
function stopPolling() {
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }

  for (const [sensorId, intervalId] of pollingIntervals.entries()) {
    console.log(`Stopping polling for ${sensorId}`);
    clearInterval(intervalId);
  }
  pollingIntervals.clear();
}

// Shutdown handler
async function shutdown(signal) {
  console.log('');
  console.log(`Received ${signal}, shutting down...`);

  const forceExitTimer = setTimeout(() => {
    console.log('Force exit after timeout');
    process.exit(1);
  }, 10000);

  try {
    // Stop polling (no new reads will start)
    stopPolling();

    // Wait for in-flight reads to complete (max 5s, checked every 100ms)
    if (inFlightReads > 0) {
      console.log(`Waiting for ${inFlightReads} in-flight read(s) to complete...`);
      const drainStart = Date.now();
      while (inFlightReads > 0 && Date.now() - drainStart < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (inFlightReads > 0) {
        console.warn(`${inFlightReads} read(s) still in-flight after 5s, proceeding with shutdown`);
      }
    }

    // Close Socket.io
    io.close(() => {
      console.log('Socket.io closed');
    });

    // Remove coordinator listeners and shutdown
    if (coordinator) {
      if (coordinatorListeners.data) {
        coordinator.removeListener('component:data', coordinatorListeners.data);
      }
      if (coordinatorListeners.error) {
        coordinator.removeListener('component:error', coordinatorListeners.error);
      }
      if (coordinatorListeners.ready) {
        coordinator.removeListener('component:ready', coordinatorListeners.ready);
      }
      coordinatorListeners = {};
      await coordinator.shutdown();
      coordinator = null;
    }

    // Disconnect camera client (camera-service runs independently under PM2)
    if (cameraClient) {
      cameraClient.cleanup();
      cameraClient = null;
      console.log('Camera client disconnected');
    }

    // Close HTTP server
    httpServer.close(() => {
      console.log('Server closed');
      clearTimeout(forceExitTimer);
      process.exit(0);
    });

    // Force close after 2 seconds
    setTimeout(() => {
      console.log('Force closing server');
      clearTimeout(forceExitTimer);
      process.exit(0);
    }, 2000);

  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle port binding errors
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[sensor-service] Port ${PORT} already in use. Kill the old process or choose a different port.`);
  } else {
    console.error('[sensor-service] Server error:', err.message);
  }
  process.exit(1);
});

// Start server
httpServer.listen(PORT, async () => {
  console.log('='.repeat(60));
  console.log(`Sensor Service running on http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('');

  await initializeCoordinator();

  console.log('');
  console.log(`✓ Ready - WebSocket: ws://localhost:${PORT}`);
  console.log(`✓ Pushing data to Storage Service: ${STORAGE_SERVICE_URL}`);
});
