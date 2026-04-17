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

import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import readline from 'readline';
import { createSensorCoordinator } from '../coordinator/sensor-coordinator.js';
import { CameraClient } from '../camera-client/camera-client.js';
import {
  canonicalComponentId,
  loadClusterConfig,
  parseCanonicalComponentId
} from '../cluster/cluster-config.js';
import { withTimeout } from '../utils/timeout.js';
import { requireApiKey as createApiKeyMiddleware } from '../utils/auth.js';
import { normalizeNodeId } from '../utils/normalization.js';
import { io as ioClient } from 'socket.io-client';
import { BaseService } from './base-service.js';
import { createLogger } from '../utils/logger.js';
import { startHealthMonitor } from '../utils/health-monitor.js';

const log = createLogger('sensor-service');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const clusterConfig = loadClusterConfig();
const ROLE = clusterConfig.role || 'standalone';
const PORT = process.env.SENSOR_SERVICE_PORT || 3000;
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3001';
const CAMERA_SERVICE_URL = process.env.CAMERA_SERVICE_URL || 'http://localhost:8081';
const FLEET_SERVICE_URL = process.env.FLEET_SERVICE_URL
  || (ROLE === 'hub' ? 'http://localhost:3010' : (clusterConfig.hubUrl || 'http://localhost:3010'));
const DEBUG = process.env.SENSOR_DEBUG === 'true';
const API_KEY = clusterConfig.apiKey || '';
const ENABLE_ARDUINO_INGEST = !['0', 'false', 'no', 'off', 'disabled']
  .includes(String(process.env.LATTICESPARK_ENABLE_ARDUINO_INGEST || 'true').trim().toLowerCase());

const service = new BaseService('sensor-service', { port: PORT });
const { app, httpServer } = service;
const io = new Server(httpServer, {
  transports: ['websocket'],
  maxHttpBufferSize: parseInt(process.env.SOCKETIO_MAX_BUFFER_BYTES || '1000000', 10),
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Slow-client protection: a dashboard tab in a half-alive state (backgrounded,
// TCP alive but not consuming) will accumulate sensor:batch frames in the
// per-socket ws sendBuffer. Over days this is unbounded. Periodically disconnect
// any client whose outbound buffer exceeds threshold.
const SLOW_CLIENT_BUFFER_BYTES = parseInt(
  process.env.SLOW_CLIENT_BUFFER_BYTES || String(2 * 1024 * 1024), 10
);
const SLOW_CLIENT_CHECK_MS = parseInt(process.env.SLOW_CLIENT_CHECK_MS || '30000', 10);
let slowClientTimer = null;
let slowClientsDisconnected = 0;

function checkSlowClients() {
  for (const socket of io.sockets.sockets.values()) {
    const ws = socket.conn?.transport?.socket;
    const buffered = ws?.bufferedAmount ?? 0;
    if (buffered > SLOW_CLIENT_BUFFER_BYTES) {
      slowClientsDisconnected++;
      log.warn({
        socketId: socket.id,
        bufferedBytes: buffered,
        thresholdBytes: SLOW_CLIENT_BUFFER_BYTES
      }, 'Disconnecting slow client (outbound buffer exceeds threshold)');
      socket.disconnect(true);
    }
  }
}

// Remote-spoke TTL: on the hub, remoteSpokes only gets entries removed via an
// explicit /offline call. If a spoke dies without sending /offline (crash,
// network partition, redeploy under a new nodeId), its entry and all its
// components linger forever. Periodically evict spokes that haven't checked in.
const REMOTE_SPOKE_TTL_MS = parseInt(
  process.env.REMOTE_SPOKE_TTL_MS || String(15 * 60 * 1000), 10
);
const REMOTE_SPOKE_PRUNE_MS = parseInt(process.env.REMOTE_SPOKE_PRUNE_MS || '60000', 10);
let remoteSpokePruneTimer = null;
let remoteSpokesPruned = 0;

function pruneStaleRemoteSpokes() {
  const cutoff = Date.now() - REMOTE_SPOKE_TTL_MS;
  let pruned = 0;
  for (const [nodeId, spoke] of remoteSpokes.entries()) {
    if (spoke?.lastSeen && spoke.lastSeen >= cutoff) continue;
    for (const component of spoke?.components || []) {
      remoteComponentIndex.delete(component.id);
      latestDataCache.delete(component.id);
      lastStoragePush.delete(component.id);
    }
    remoteSpokes.delete(nodeId);
    remoteSpokesPruned++;
    pruned++;
    log.warn({
      nodeId,
      lastSeen: spoke?.lastSeen ? new Date(spoke.lastSeen).toISOString() : null,
      ttlMs: REMOTE_SPOKE_TTL_MS
    }, 'Pruned stale remote spoke');
  }
  if (pruned > 0) {
    io.emit('components', getComponentsWithCamera());
  }
}

// Socket.IO auth: require API key when configured (via auth object or X-API-Key header)
if (API_KEY) {
  io.use((socket, next) => {
    const key = socket.handshake.auth?.apiKey
      || socket.handshake.headers?.['x-api-key']
      || '';
    if (key === API_KEY) return next();
    next(new Error('unauthorized'));
  });
}

const requireApiKey = createApiKeyMiddleware(API_KEY);

const READ_TIMEOUT = parseInt(process.env.READ_TIMEOUT || '5000', 10);

let inFlightReads = 0; // track in-flight polling reads for graceful shutdown
let coordinator = null;
let cameraClient = null;
let cameraConfig = null;
let pollingIntervals = new Map();
let coordinatorListeners = {}; // stored so we can remove on shutdown
const lastStoragePush = new Map(); // throttle storage writes per sensor
const STORAGE_INTERVAL = parseInt(process.env.STORAGE_INTERVAL || '2000', 10);
const latestDataCache = new Map(); // componentId -> latest validated data
const remoteSpokes = new Map(); // nodeId -> { components, lastSeq, lastSeen, online }
const remoteComponentIndex = new Map(); // canonicalId -> { nodeId, componentId, component }
const arduinoComponentIndex = new Map(); // componentId -> component
const arduinoReaders = new Map(); // sourceId -> { stream, rl, source }
const pausedArduinoSources = new Set(); // sourceId
let arduinoConfig = { sources: [] };
let arduinoComponents = [];

// Batch WebSocket emissions to reduce network traffic
const BATCH_INTERVAL = parseInt(process.env.BATCH_INTERVAL || '100', 10);
let pendingBatch = {};
let batchTimer = null;
const skipStorageIds = new Set();

let stopHealthMonitor = null;

function normalizeArduinoTimestamp(rawTs) {
  const nowSec = Date.now() / 1000;
  if (!Number.isFinite(rawTs)) {
    return { timestamp: nowSec, timestamp_source: 'sensor_service_fallback' };
  }
  if (rawTs > 100000000000) {
    return { timestamp: rawTs / 1000, timestamp_source: 'arduino' };
  }
  if (rawTs > 1000000000) {
    return { timestamp: rawTs, timestamp_source: 'arduino' };
  }
  return { timestamp: nowSec, timestamp_source: 'sensor_service_fallback' };
}

async function loadArduinoConfig() {
  const configPath = join(__dirname, '..', '..', 'config', 'arduino-sources.json');
  if (!existsSync(configPath)) return { sources: [] };
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.sources)) return { sources: [] };
    return parsed;
  } catch (err) {
    log.warn({ err }, 'Failed to parse arduino config');
    return { sources: [] };
  }
}

function buildArduinoComponents(config) {
  const components = [];
  for (const source of config.sources || []) {
    if (!source?.enabled) continue;
    const map = source.channelMap || {};
    for (const [fieldName, componentDef] of Object.entries(map)) {
      if (!componentDef?.componentId) continue;
      components.push({
        id: componentDef.componentId,
        type: componentDef.type || 'ArduinoFloat',
        config: {
          label: componentDef.label || componentDef.componentId,
          category: componentDef.category || 'arduino',
          pollInterval: componentDef.pollInterval || 500,
          historyWindow: componentDef.historyWindow || 1,
          sourceId: source.sourceId,
          fieldName,
          skipStorage: Boolean(componentDef.skipStorage),
          metrics: Array.isArray(componentDef.metrics) ? componentDef.metrics : [
            {
              id: 'value',
              label: 'Value',
              type: 'single',
              keys: ['value'],
              unit: componentDef.unit || '',
              precision: Number.isFinite(componentDef.precision) ? componentDef.precision : 2
            }
          ]
        }
      });
    }
  }
  return components;
}

function refreshArduinoComponentIndex() {
  arduinoComponentIndex.clear();
  for (const component of arduinoComponents) {
    arduinoComponentIndex.set(component.id, component);
    if (component.config?.skipStorage) {
      skipStorageIds.add(component.id);
    } else {
      skipStorageIds.delete(component.id);
    }
  }
}

function stopArduinoReader(sourceId) {
  const reader = arduinoReaders.get(sourceId);
  if (!reader) return;
  try { reader.rl.close(); } catch {}
  try { reader.stream.close(); } catch {}
  arduinoReaders.delete(sourceId);
}

async function handleArduinoLine(source, line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    // Ignore non-JSON serial noise (boot/reset chatter, stray text).
    return;
  }

  const jsonLine = trimmed.slice(start, end + 1);

  let parsed;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    log.warn({ sourceId: source.sourceId }, 'Invalid Arduino JSON');
    return;
  }

  const values = (parsed?.values && typeof parsed.values === 'object')
    ? parsed.values
    : parsed;
  if (!values || typeof values !== 'object') return;
  const ts = normalizeArduinoTimestamp(parsed.ts);
  const map = source.channelMap || {};

  for (const [fieldName, mapping] of Object.entries(map)) {
    if (!mapping?.componentId) continue;
    const rawValue = values[fieldName];
    const numValue = typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue);
    if (!Number.isFinite(numValue)) continue;

    const metricKey = mapping?.metrics?.[0]?.keys?.[0] || 'value';
    processComponentData(
      mapping.componentId,
      {
        [metricKey]: numValue,
        timestamp: ts.timestamp,
        timestamp_source: ts.timestamp_source
      },
      Boolean(mapping?.skipStorage)
    );
  }
}

function configureArduinoPort(source) {
  const baud = Number.parseInt(source?.baud || '115200', 10);
  if (!Number.isFinite(baud) || baud <= 0) return;
  if (process.platform === 'win32') return;

  const result = spawnSync(
    'stty',
    ['-F', source.port, String(baud), 'raw', '-echo'],
    { encoding: 'utf-8' }
  );

  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    const detail = stderr || stdout || `exit=${result.status}`;
    log.warn({ port: source.port, baud }, 'Failed to configure serial port: %s', detail);
  } else {
    log.info({ port: source.port, baud }, 'Configured serial port');
  }
}

function startArduinoReader(source) {
  if (!source?.sourceId || !source?.port) return;
  if (!source.enabled) return;
  if (pausedArduinoSources.has(source.sourceId)) return;
  if (arduinoReaders.has(source.sourceId)) return;

  if (!existsSync(source.port)) {
    log.warn({ port: source.port }, 'Arduino source port not found');
    return;
  }

  try {
    configureArduinoPort(source);
    const stream = createReadStream(source.port, { encoding: 'utf-8' });
    stream.on('error', (err) => {
      log.warn({ sourceId: source.sourceId, err }, 'Arduino stream error');
      stopArduinoReader(source.sourceId);
    });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      handleArduinoLine(source, line).catch((err) => {
        log.warn({ sourceId: source.sourceId, err }, 'Arduino parse error');
      });
    });
    rl.on('error', (err) => {
      log.warn({ sourceId: source.sourceId, err }, 'Arduino reader error');
    });
    arduinoReaders.set(source.sourceId, { stream, rl, source });
    log.info({ sourceId: source.sourceId, port: source.port }, 'Arduino source active');
  } catch (err) {
    log.warn({ sourceId: source.sourceId, err }, 'Failed to start Arduino reader');
  }
}

async function initializeArduinoIngest() {
  if (!ENABLE_ARDUINO_INGEST) {
    log.info('Arduino ingest disabled by LATTICESPARK_ENABLE_ARDUINO_INGEST');
    return;
  }

  arduinoConfig = await loadArduinoConfig();
  arduinoComponents = buildArduinoComponents(arduinoConfig);
  refreshArduinoComponentIndex();

  for (const source of arduinoConfig.sources || []) {
    startArduinoReader(source);
  }

  io.emit('components', getComponentsWithCamera());
}

function pauseArduinoSource(sourceId) {
  if (!sourceId) return { success: false, error: 'sourceId is required' };
  const source = (arduinoConfig.sources || []).find(s => s.sourceId === sourceId);
  if (!source) return { success: false, error: `source not found: ${sourceId}` };

  pausedArduinoSources.add(sourceId);
  stopArduinoReader(sourceId);
  return { success: true, sourceId };
}

function resumeArduinoSource(sourceId) {
  if (!sourceId) return { success: false, error: 'sourceId is required' };
  const source = (arduinoConfig.sources || []).find(s => s.sourceId === sourceId);
  if (!source) return { success: false, error: `source not found: ${sourceId}` };

  pausedArduinoSources.delete(sourceId);
  startArduinoReader(source);
  return { success: true, sourceId };
}

function getLocalComponents() {
  return [
    ...(coordinator ? coordinator.getComponents() : []),
    ...arduinoComponents
  ];
}

function getRemoteComponents() {
  const components = [];
  for (const spoke of remoteSpokes.values()) {
    if (!Array.isArray(spoke.components)) continue;
    components.push(...spoke.components);
  }
  return components;
}

function validateAndNormalizeData(componentId, rawData) {
  if (!rawData || typeof rawData !== 'object') {
    log.warn({ componentId }, 'Invalid data: not an object');
    return null;
  }

  const validated = {};
  let hasMetrics = false;

  let timestamp = rawData.timestamp;
  if (!Number.isFinite(timestamp)) {
    timestamp = Date.now() / 1000;
  }
  validated.timestamp = timestamp;

  if (typeof rawData.timestamp_source === 'string') {
    validated.timestamp_source = rawData.timestamp_source;
  }

  for (const [key, value] of Object.entries(rawData)) {
    if (key === 'timestamp' || key === 'timestamp_source') continue;
    if (Number.isFinite(value) || typeof value === 'string') {
      validated[key] = value;
      hasMetrics = true;
    } else {
      log.warn({ componentId, key, value }, 'Dropping invalid metric');
    }
  }

  if (!hasMetrics) return null;
  return validated;
}

function processComponentData(componentId, rawData, skipStorage = false) {
  const validated = validateAndNormalizeData(componentId, rawData);
  if (!validated) return;

  if (DEBUG) log.debug({ componentId, data: validated }, 'Component data');

  latestDataCache.set(componentId, validated);
  pendingBatch[componentId] = validated;

  if (!skipStorage) {
    const now = Date.now();
    const lastPush = lastStoragePush.get(componentId) || 0;
    if (now - lastPush >= STORAGE_INTERVAL) {
      lastStoragePush.set(componentId, now);
      pushToStorage(componentId, validated);
    }
  }
}

async function writeToRemoteComponent(nodeId, componentId, data, ownerId, leaseTtlMs) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const response = await fetch(
    `${FLEET_SERVICE_URL}/api/spokes/${encodeURIComponent(nodeId)}/components/${encodeURIComponent(componentId)}/write`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data,
        ownerId,
        leaseTtlMs
      })
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Remote write failed with status ${response.status}`);
  }
  return payload;
}

// Require API key for all REST endpoints (when configured)
app.use('/api', requireApiKey);

// REST API: Get all sensors
app.get('/api/sensors', (req, res) => {
  const localComponents = getLocalComponents();
  const components = [...localComponents, ...getRemoteComponents()];
  res.json({ sensors: components });
});

// REST API: Read specific sensor
app.get('/api/sensors/:id/read', async (req, res) => {
  const componentId = req.params.id;
  const parsedRemote = parseCanonicalComponentId(componentId);
  if (parsedRemote && remoteComponentIndex.has(componentId)) {
    const data = latestDataCache.get(componentId);
    if (!data) {
      return res.status(404).json({ error: `No cached data for remote component ${componentId}` });
    }
    return res.json({
      sensorId: componentId,
      data,
      timestamp: Date.now()
    });
  }

  if (arduinoComponentIndex.has(componentId)) {
    const data = latestDataCache.get(componentId);
    if (!data) {
      return res.status(404).json({ error: `No cached data for Arduino component ${componentId}` });
    }
    return res.json({
      sensorId: componentId,
      data,
      timestamp: Date.now()
    });
  }

  if (!coordinator) {
    return res.status(503).json({ error: 'Coordinator not initialized' });
  }

  try {
    const data = await withTimeout(coordinator.read(componentId), READ_TIMEOUT, `read ${componentId}`);
    res.json({
      sensorId: componentId,
      data,
      timestamp: Date.now()
    });
  } catch (error) {
    log.error({ componentId, err: error }, 'Sensor read failed');
    res.status(500).json({ error: 'Sensor read failed' });
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
        log.error({ componentId: id, err: error }, 'Error polling component');
      }
    }, interval);
    pollingIntervals.set(id, intervalId);

    res.json({ status: 'registered', id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Arduino ingest control (used by firmware deployment flow)
app.post('/api/arduino/sources/:sourceId/pause', requireApiKey, (req, res) => {
  if (!ENABLE_ARDUINO_INGEST) {
    res.status(400).json({ error: 'Arduino ingest disabled' });
    return;
  }
  const { sourceId } = req.params;
  const result = pauseArduinoSource(sourceId);
  if (!result.success) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result);
});

app.post('/api/arduino/sources/:sourceId/resume', requireApiKey, (req, res) => {
  if (!ENABLE_ARDUINO_INGEST) {
    res.status(400).json({ error: 'Arduino ingest disabled' });
    return;
  }
  const { sourceId } = req.params;
  const result = resumeArduinoSource(sourceId);
  if (!result.success) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json(result);
});

// Hub relay API: register/refresh components for a spoke node
app.post('/api/relay/spokes/:nodeId/components', requireApiKey, (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  if (!nodeId) {
    res.status(400).json({ error: 'Invalid nodeId' });
    return;
  }

  const incoming = Array.isArray(req.body?.components) ? req.body.components : [];
  const canonicalComponents = incoming
    .filter(component => component && typeof component.id === 'string')
    .map(component => {
      const rawId = component.id.startsWith(`${nodeId}.`)
        ? component.id.slice(nodeId.length + 1)
        : component.id;
      return {
        ...component,
        id: canonicalComponentId(nodeId, rawId),
        config: {
          ...(component.config || {}),
          nodeId
        }
      };
    });

  // Remove any previous component index entries for this node
  for (const [componentId, info] of remoteComponentIndex.entries()) {
    if (info.nodeId === nodeId) {
      remoteComponentIndex.delete(componentId);
      latestDataCache.delete(componentId);
      lastStoragePush.delete(componentId);
    }
  }

  for (const component of canonicalComponents) {
    const originalComponentId = component.id.slice(nodeId.length + 1);
    remoteComponentIndex.set(component.id, {
      nodeId,
      componentId: originalComponentId,
      component
    });
  }

  const prevState = remoteSpokes.get(nodeId) || {};
  remoteSpokes.set(nodeId, {
    nodeId,
    components: canonicalComponents,
    lastSeq: prevState.lastSeq || 0,
    lastSeen: Date.now(),
    online: true
  });

  io.emit('components', getComponentsWithCamera());
  res.json({ success: true, nodeId, count: canonicalComponents.length });
});

// Hub relay API: ingest batched sensor updates for a spoke
app.post('/api/relay/spokes/:nodeId/batch', requireApiKey, (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const seq = Number(req.body?.seq);
  const batch = req.body?.batch;

  if (!nodeId) {
    res.status(400).json({ error: 'Invalid nodeId' });
    return;
  }
  if (!Number.isFinite(seq)) {
    res.status(400).json({ error: 'seq is required' });
    return;
  }
  if (!batch || typeof batch !== 'object') {
    res.status(400).json({ error: 'batch must be an object' });
    return;
  }

  const spoke = remoteSpokes.get(nodeId) || { components: [], lastSeq: 0, online: true };
  if (seq <= spoke.lastSeq) {
    // Idempotent replay: already processed
    res.json({ ack: spoke.lastSeq });
    return;
  }

  for (const [localComponentId, data] of Object.entries(batch)) {
    const canonicalId = canonicalComponentId(nodeId, localComponentId);
    const remoteMeta = remoteComponentIndex.get(canonicalId);
    const skipStorage = Boolean(remoteMeta?.component?.config?.skipStorage);
    processComponentData(canonicalId, data, skipStorage);
  }

  spoke.lastSeq = seq;
  spoke.lastSeen = Date.now();
  spoke.online = true;
  remoteSpokes.set(nodeId, spoke);

  res.json({ ack: seq });
});

// Hub relay API: mark spoke offline and remove its components from live view
app.post('/api/relay/spokes/:nodeId/offline', requireApiKey, (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const spoke = remoteSpokes.get(nodeId);
  if (!spoke) {
    res.json({ success: true, removed: 0 });
    return;
  }

  let removed = 0;
  for (const component of spoke.components || []) {
    remoteComponentIndex.delete(component.id);
    latestDataCache.delete(component.id);
    lastStoragePush.delete(component.id);
    removed++;
  }
  remoteSpokes.delete(nodeId);
  io.emit('components', getComponentsWithCamera());
  res.json({ success: true, removed });
});

// REST API: Health check with upstream dependency verification
service.registerHealthCheck(async () => {
  const coordinatorOk = coordinator !== null;

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

  let fleetStatus = 'n/a';
  if (ROLE === 'hub') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${FLEET_SERVICE_URL}/health`, { signal: controller.signal });
      clearTimeout(timer);
      fleetStatus = resp.ok ? 'ok' : 'error';
    } catch {
      fleetStatus = 'unreachable';
    }
  }

  const healthy = coordinatorOk && storageStatus === 'ok' && (ROLE !== 'hub' || fleetStatus === 'ok');
  return {
    status: healthy ? 'ok' : 'degraded',
    dependencies: {
      coordinator: coordinatorOk ? 'ready' : 'not initialized',
      storageService: storageStatus,
      camera: cameraClient?.isReady ? 'ready' : 'not available',
      arduinoIngest: ENABLE_ARDUINO_INGEST ? 'enabled' : 'disabled',
      fleet: fleetStatus
    },
    pollingComponents: pollingIntervals.size,
    arduinoSources: arduinoReaders.size,
    arduinoComponents: arduinoComponents.length,
    remoteSpokes: remoteSpokes.size,
    remoteComponents: remoteComponentIndex.size,
    uptime: process.uptime()
  };
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
    log.error({ err }, 'Camera stream proxy error');
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
    log.error({ err }, 'Camera snapshot proxy error');
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
  log.info({ socketId: socket.id }, 'Client connected');

  // Send current sensor list (include camera as virtual component)
  socket.emit('components', getComponentsWithCamera());

  // Handle write commands from client
  socket.on('component:write', async ({ componentId, data, ownerId, leaseTtlMs }, callback) => {
    try {
      if (!componentId || !data || typeof data !== 'object') {
        callback?.({ error: 'componentId and data are required' });
        return;
      }

      const parsed = parseCanonicalComponentId(componentId);
      if (parsed && remoteComponentIndex.has(componentId)) {
        const remoteResult = await withTimeout(
          writeToRemoteComponent(
            parsed.nodeId,
            parsed.componentId,
            data,
            ownerId || socket.id,
            leaseTtlMs
          ),
          READ_TIMEOUT + 5000,
          `remote write ${componentId}`
        );
        callback?.({ success: true, remote: true, ...remoteResult });
        return;
      }

      if (!coordinator) {
        callback?.({ error: 'Coordinator not initialized' });
        return;
      }
      await withTimeout(coordinator.write(componentId, data), READ_TIMEOUT, `write ${componentId}`);
      callback?.({ success: true, remote: false });
    } catch (error) {
      log.error({ componentId, err: error }, 'Write error');
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
      log.error({ action, err: error }, 'Camera control error');
      callback?.({ error: error.message });
    }
  });

  socket.on('disconnect', () => {
    log.info({ socketId: socket.id }, 'Client disconnected');
  });
});

// Push data to Storage Service via Socket.IO
let storageSocket = null;

function connectToStorageService() {
  storageSocket = ioClient(STORAGE_SERVICE_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    ...(API_KEY ? { auth: { apiKey: API_KEY } } : {})
  });

  storageSocket.on('connect', () => {
    log.info('Connected to storage-service via Socket.IO');
  });

  storageSocket.on('disconnect', (reason) => {
    log.warn('Disconnected from storage-service: %s', reason);
  });

  storageSocket.on('connect_error', (err) => {
    log.error({ err: { message: err.message } }, 'Storage socket connection error');
  });
}

function pushToStorage(sensorId, data) {
  if (!storageSocket?.connected) return;
  storageSocket.emit('store', {
    sensorId,
    data,
    timestamp: data.timestamp || Date.now() / 1000
  });
}

// Build component list including camera as virtual component
function getComponentsWithCamera() {
  const components = [
    ...getLocalComponents(),
    ...getRemoteComponents()
  ];
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
      log.info('Camera not configured or disabled, skipping');
      return;
    }

    log.info('Monitoring camera service at %s', CAMERA_SERVICE_URL);
    cameraClient = new CameraClient({ url: CAMERA_SERVICE_URL });

    // Forward detection events from camera to WebSocket clients
    cameraClient.on('detection', (data) => {
      io.emit('camera:detection', data);
    });

    // Camera comes and goes — update component list for connected clients
    cameraClient.on('ready', (status) => {
      log.info({ fps: status.fps, resolution: status.resolution }, 'Camera service ready');
      io.emit('components', getComponentsWithCamera());
    });

    cameraClient.on('disconnected', () => {
      log.warn('Camera service disconnected, will retry...');
      io.emit('components', getComponentsWithCamera());
    });

    // Start continuous health polling — never times out, survives restarts
    cameraClient.startMonitoring();

  } catch (error) {
    log.error({ err: error }, 'Failed to initialize camera client');
    cameraClient = null;
  }
}

// Initialize coordinator and start polling
async function initializeCoordinator() {
  try {
    const configFile = join(__dirname, '..', '..', 'config', 'components.json');
    log.info('Initializing coordinator...');
    log.info('Config file: %s', configFile);

    coordinator = await createSensorCoordinator({ configFile });

    // Listen to component data events - store refs for cleanup
    coordinatorListeners.data = (event) => {
      processComponentData(
        event.componentId,
        event.data,
        skipStorageIds.has(event.componentId)
      );
    };

    coordinatorListeners.error = (event) => {
      log.error({ componentId: event.componentId, err: event.error }, 'Component error');
      io.emit('sensor:error', {
        componentId: event.componentId,
        error: event.error.message
      });
    };

    coordinatorListeners.ready = () => {
      const comps = getComponentsWithCamera();
      io.emit('components', comps);

      // Prune per-component Maps for components that no longer exist.
      // Without this, latestDataCache/lastStoragePush/skipStorageIds grow
      // every time a component is renamed or a remote spoke rotates IDs.
      const validIds = new Set(comps.map(c => c.id));
      for (const id of latestDataCache.keys()) {
        if (!validIds.has(id)) latestDataCache.delete(id);
      }
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

    log.info('Coordinator initialized');

    // Start polling sensors based on config
    startPolling();

    // Initialize camera service (non-blocking — failure doesn't affect sensors)
    await initializeCamera(configFile);

    await initializeArduinoIngest();

  } catch (error) {
    log.error({ err: error }, 'Failed to initialize coordinator');
    process.exit(1);
  }
}

// Start polling all configured sensors
function startPolling() {
  const components = coordinator.getComponents();

  for (const component of components) {
    const interval = component.config?.pollInterval || 5000;

    log.info({ componentId: component.id, intervalMs: interval }, 'Starting polling');

    const intervalId = setInterval(async () => {
      inFlightReads++;
      try {
        await withTimeout(coordinator.read(component.id), READ_TIMEOUT, `poll ${component.id}`);
      } catch (error) {
        log.error({ componentId: component.id, err: error }, 'Error polling component');
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
      log.error({ err: error }, 'Failed to emit sensor batch');
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
    log.info({ componentId: sensorId }, 'Stopping polling');
    clearInterval(intervalId);
  }
  pollingIntervals.clear();
}

function stopAllArduinoReaders() {
  for (const sourceId of arduinoReaders.keys()) {
    stopArduinoReader(sourceId);
  }
}

// ── Service lifecycle ────────────────────────────────────────────────────────

service.initialize = async () => {
  log.info('Role: %s', ROLE);
  connectToStorageService();
  await initializeCoordinator();
  stopHealthMonitor = startHealthMonitor({
    log,
    intervalMs: parseInt(process.env.HEALTH_HEARTBEAT_MS || '60000', 10),
    getStats: () => ({
      wsClients: io.sockets.sockets.size,
      pendingBatchKeys: Object.keys(pendingBatch).length,
      pollingComponents: pollingIntervals.size,
      inFlightReads,
      latestDataCache: latestDataCache.size,
      lastStoragePush: lastStoragePush.size,
      skipStorageIds: skipStorageIds.size,
      remoteSpokes: remoteSpokes.size,
      remoteComponents: remoteComponentIndex.size,
      arduinoReaders: arduinoReaders.size,
      arduinoComponents: arduinoComponents.length,
      storageConnected: storageSocket?.connected === true,
      slowClientsDisconnected,
      remoteSpokesPruned
    })
  });
  slowClientTimer = setInterval(checkSlowClients, SLOW_CLIENT_CHECK_MS);
  slowClientTimer.unref();
  remoteSpokePruneTimer = setInterval(pruneStaleRemoteSpokes, REMOTE_SPOKE_PRUNE_MS);
  remoteSpokePruneTimer.unref();
  log.info('Ready - WebSocket: ws://localhost:%d', PORT);
  log.info('Storage Service (Socket.IO): %s', STORAGE_SERVICE_URL);
};

service.onShutdown = async () => {
  if (stopHealthMonitor) {
    stopHealthMonitor();
    stopHealthMonitor = null;
  }
  if (slowClientTimer) {
    clearInterval(slowClientTimer);
    slowClientTimer = null;
  }
  if (remoteSpokePruneTimer) {
    clearInterval(remoteSpokePruneTimer);
    remoteSpokePruneTimer = null;
  }

  // Disconnect from storage-service
  if (storageSocket) {
    storageSocket.disconnect();
    storageSocket = null;
    log.info('Storage socket disconnected');
  }

  // Stop polling (no new reads will start)
  stopPolling();
  stopAllArduinoReaders();

  // Wait for in-flight reads to complete (max 5s, checked every 100ms)
  if (inFlightReads > 0) {
    log.info('Waiting for %d in-flight read(s) to complete...', inFlightReads);
    const drainStart = Date.now();
    while (inFlightReads > 0 && Date.now() - drainStart < 5000) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (inFlightReads > 0) {
      log.warn('%d read(s) still in-flight after 5s, proceeding with shutdown', inFlightReads);
    }
  }

  // Close Socket.io
  io.close(() => {
    log.info('Socket.io closed');
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
    log.info('Camera client disconnected');
  }
};

service.start();
