#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import { ArtifactStore } from '../fleet/artifact-store.js';
import { LeaseManager, LEASE_DEFAULT_TTL_MS } from '../fleet/lease-manager.js';
import { canonicalComponentId, loadClusterConfig } from '../cluster/cluster-config.js';
import { requireApiKey as createApiKeyMiddleware, requireAdminToken as createAdminMiddleware } from '../utils/auth.js';
import { normalizeNodeId } from '../utils/normalization.js';
import { BaseService } from './base-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('fleet-service');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const clusterConfig = loadClusterConfig();
const ROLE = clusterConfig.role || 'standalone';
const PORT = parseInt(process.env.FLEET_SERVICE_PORT || '3010', 10);
const SENSOR_SERVICE_URL = process.env.SENSOR_SERVICE_URL || 'http://localhost:3000';
const API_KEY = clusterConfig.apiKey || '';
const ADMIN_TOKEN = process.env.LATTICESPARK_ADMIN_TOKEN || API_KEY;
const SOCKET_TIMEOUT_MS = parseInt(process.env.FLEET_SOCKET_TIMEOUT_MS || '10000', 10);

const service = new BaseService('fleet-service', { port: PORT, host: '0.0.0.0', expressOptions: { limit: '100mb' } });
const { app, httpServer } = service;
const io = new Server(httpServer, {
  transports: ['websocket'],
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const moduleBundleStore = new ArtifactStore({
  baseDir: join(PROJECT_ROOT, 'data', 'module-bundles'),
  kind: 'module'
});
const firmwareBundleStore = new ArtifactStore({
  baseDir: join(PROJECT_ROOT, 'data', 'firmware-bundles'),
  kind: 'firmware'
});
const leaseManager = new LeaseManager();
const spokes = new Map(); // nodeId -> spoke state
const firmwareJobs = new Map(); // nodeId -> Map<jobId, job>

const ensureApiKey = createApiKeyMiddleware(API_KEY);
const ensureAdmin = createAdminMiddleware(ADMIN_TOKEN, API_KEY);

function getSpokeState(nodeId) {
  const normalized = normalizeNodeId(nodeId);
  if (!normalized) return null;
  return spokes.get(normalized) || null;
}

function listSpokes() {
  return Array.from(spokes.values()).map((spoke) => ({
    nodeId: spoke.nodeId,
    connected: Boolean(spoke.socket?.connected),
    connectedAt: spoke.connectedAt || null,
    disconnectedAt: spoke.disconnectedAt || null,
    lastHeartbeat: spoke.lastHeartbeat || null,
    componentsCount: spoke.components.length,
    replayAckSeq: spoke.replayAckSeq || 0,
    queueDepth: spoke.queueDepth || 0,
    moduleCount: Array.isArray(spoke.modules) ? spoke.modules.length : 0,
    spokeMode: spoke.spokeMode || 'full',
    capabilities: spoke.capabilities || {}
  }));
}

async function postToSensorService(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  const response = await fetch(`${SENSOR_SERVICE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sensor service error ${response.status}: ${text}`);
  }
  return response.json();
}

function getOrCreateFirmwareJobMap(nodeId) {
  if (!firmwareJobs.has(nodeId)) {
    firmwareJobs.set(nodeId, new Map());
  }
  return firmwareJobs.get(nodeId);
}

function upsertSpokeState(nodeId, patch) {
  const existing = getSpokeState(nodeId);
  if (!existing) {
    const state = {
      nodeId,
      socket: null,
      connectedAt: null,
      disconnectedAt: null,
      lastHeartbeat: null,
      components: [],
      modules: [],
      replayAckSeq: 0,
      queueDepth: 0,
      capabilities: {},
      spokeMode: 'full',
      ...patch
    };
    spokes.set(nodeId, state);
    return state;
  }
  Object.assign(existing, patch);
  return existing;
}

async function emitToSpoke(nodeId, event, payload, timeoutMs = SOCKET_TIMEOUT_MS) {
  const spoke = getSpokeState(nodeId);
  if (!spoke?.socket?.connected) {
    throw new Error(`Spoke "${nodeId}" is not connected`);
  }

  return new Promise((resolve, reject) => {
    spoke.socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
      if (err) {
        reject(new Error(`Timeout waiting for spoke response (${event})`));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response || { success: true });
    });
  });
}

function setFirmwareJob(nodeId, jobPatch) {
  const jobs = getOrCreateFirmwareJobMap(nodeId);
  const existing = jobs.get(jobPatch.jobId) || {};
  const job = { ...existing, ...jobPatch };
  jobs.set(jobPatch.jobId, job);
  return job;
}

function getFirmwareJob(nodeId, jobId) {
  const jobs = firmwareJobs.get(nodeId);
  if (!jobs) return null;
  return jobs.get(jobId) || null;
}

io.use((socket, next) => {
  if (!API_KEY) return next();
  const key = socket.handshake.auth?.apiKey
    || socket.handshake.headers?.['x-api-key']
    || '';
  if (key === API_KEY) return next();
  log.warn('Rejected socket auth from %s', socket.handshake.address || 'unknown');
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  let nodeId = null;

  socket.on('spoke:hello', async (payload, callback) => {
    try {
      const requestedNodeId = normalizeNodeId(payload?.nodeId);
      if (!requestedNodeId) {
        callback?.({ error: 'nodeId is required' });
        return;
      }

      const existing = getSpokeState(requestedNodeId);
      if (existing?.socket?.connected) {
        callback?.({ error: `Spoke "${requestedNodeId}" is already connected` });
        socket.disconnect(true);
        return;
      }

      nodeId = requestedNodeId;
      const spokeState = upsertSpokeState(nodeId, {
        socket,
        connectedAt: Date.now(),
        disconnectedAt: null,
        lastHeartbeat: Date.now(),
        capabilities: payload?.capabilities || {},
        spokeMode: payload?.spokeMode || 'full'
      });
      socket.join(nodeId);
      log.info({ nodeId, socketId: socket.id }, 'Spoke connected');
      callback?.({
        success: true,
        nodeId,
        connectedAt: spokeState.connectedAt
      });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on('spoke:components', async (payload, callback) => {
    if (!nodeId) {
      callback?.({ error: 'spoke:hello required first' });
      return;
    }
    try {
      const components = Array.isArray(payload?.components) ? payload.components : [];
      const spoke = upsertSpokeState(nodeId, { components });

      await postToSensorService(`/api/relay/spokes/${encodeURIComponent(nodeId)}/components`, { components });
      callback?.({ success: true, count: spoke.components.length });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on('spoke:batch', async (payload, callback) => {
    if (!nodeId) {
      callback?.({ error: 'spoke:hello required first' });
      return;
    }
    try {
      if (!Number.isFinite(payload?.seq)) {
        callback?.({ error: 'seq is required' });
        return;
      }
      const batch = payload?.batch;
      if (!batch || typeof batch !== 'object') {
        callback?.({ error: 'batch must be an object' });
        return;
      }

      const relayResult = await postToSensorService(`/api/relay/spokes/${encodeURIComponent(nodeId)}/batch`, {
        seq: payload.seq,
        batch
      });
      upsertSpokeState(nodeId, {
        replayAckSeq: relayResult?.ack || payload.seq,
        queueDepth: Number.isFinite(payload?.queueDepth) ? payload.queueDepth : 0
      });
      callback?.({ ack: relayResult?.ack || payload.seq });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on('spoke:heartbeat', (payload) => {
    if (!nodeId) return;
    upsertSpokeState(nodeId, {
      lastHeartbeat: Date.now(),
      queueDepth: Number.isFinite(payload?.queueDepth) ? payload.queueDepth : 0,
      replayAckSeq: Number.isFinite(payload?.ackSeq) ? payload.ackSeq : getSpokeState(nodeId)?.replayAckSeq || 0
    });
  });

  socket.on('spoke:module-status', (payload) => {
    if (!nodeId) return;
    const modules = Array.isArray(payload?.modules) ? payload.modules : [];
    upsertSpokeState(nodeId, { modules });
  });

  socket.on('spoke:firmware-status', (payload) => {
    if (!nodeId || !payload?.jobId) return;
    setFirmwareJob(nodeId, {
      jobId: payload.jobId,
      nodeId,
      status: payload.status || 'unknown',
      startedAt: payload.startedAt || Date.now(),
      finishedAt: payload.finishedAt || null,
      detail: payload.detail || null,
      sourceId: payload.sourceId || null,
      bundleId: payload.bundleId || null,
      version: payload.version || null
    });
  });

  socket.on('spoke:firmware-log', (payload) => {
    if (!nodeId || !payload?.jobId || typeof payload?.line !== 'string') return;
    const existing = getFirmwareJob(nodeId, payload.jobId);
    if (!existing) return;
    const logs = Array.isArray(existing.logs) ? existing.logs : [];
    logs.push({ ts: Date.now(), line: payload.line });
    setFirmwareJob(nodeId, { ...existing, logs: logs.slice(-500) });
  });

  socket.on('disconnect', async () => {
    if (!nodeId) return;
    const spoke = getSpokeState(nodeId);
    if (spoke) {
      spoke.socket = null;
      spoke.disconnectedAt = Date.now();
    }
    log.info({ nodeId }, 'Spoke disconnected');
    try {
      await postToSensorService(`/api/relay/spokes/${encodeURIComponent(nodeId)}/offline`, {});
    } catch (err) {
      log.warn({ nodeId, err }, 'Failed to mark spoke offline');
    }
  });
});

app.use('/api', ensureApiKey);

app.get('/api/spokes', (req, res) => {
  res.json({ spokes: listSpokes() });
});

app.get('/api/spokes/:nodeId/components', (req, res) => {
  const spoke = getSpokeState(req.params.nodeId);
  if (!spoke) {
    res.status(404).json({ error: 'Spoke not found' });
    return;
  }
  const components = spoke.components.map((component) => ({
    ...component,
    id: canonicalComponentId(spoke.nodeId, component.id)
  }));
  res.json({ nodeId: spoke.nodeId, components });
});

app.get('/api/spokes/:nodeId/modules', async (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const spoke = getSpokeState(nodeId);
  if (!spoke) {
    res.status(404).json({ error: 'Spoke not found' });
    return;
  }

  try {
    if (spoke.socket?.connected) {
      const result = await emitToSpoke(nodeId, 'hub:module-command', { action: 'list' });
      if (Array.isArray(result.modules)) {
        spoke.modules = result.modules;
      }
    }
    res.json({ nodeId, modules: spoke.modules || [] });
  } catch (err) {
    res.status(503).json({ error: err.message, modules: spoke.modules || [] });
  }
});

app.post('/api/spokes/:nodeId/modules/:moduleId/:action', async (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const moduleId = req.params.moduleId;
  const action = req.params.action;
  if (!['enable', 'disable', 'restart'].includes(action)) {
    res.status(400).json({ error: `Invalid action: ${action}` });
    return;
  }
  try {
    const result = await emitToSpoke(nodeId, 'hub:module-command', { action, moduleId });
    res.json({ success: true, result });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/module-bundles', ensureAdmin, async (req, res) => {
  try {
    const saved = await moduleBundleStore.saveBundle(req.body || {});
    res.json({ success: true, bundle: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/module-bundles', async (req, res) => {
  try {
    const bundles = await moduleBundleStore.listBundles();
    res.json({ bundles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/spokes/:nodeId/modules/deploy', ensureAdmin, async (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const { bundleId, version } = req.body || {};
  if (!bundleId || !version) {
    res.status(400).json({ error: 'bundleId and version are required' });
    return;
  }

  try {
    const bundle = await moduleBundleStore.getBundle(bundleId, version);
    if (!bundle) {
      res.status(404).json({ error: 'Module bundle not found' });
      return;
    }

    const result = await emitToSpoke(nodeId, 'hub:module-deploy', {
      bundleId: bundle.bundleId,
      version: bundle.version,
      archiveChecksum: bundle.archiveChecksum,
      signature: bundle.signature,
      zipBase64: bundle.zipBase64,
      metadata: bundle.metadata || {},
      manifest: bundle.manifest || {}
    }, 60000);

    res.json({ success: true, result });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/firmware/bundles', ensureAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    const manifest = payload.manifest || {};
    const required = ['bundleId', 'version', 'boardProfile', 'mcu', 'programmer', 'baud', 'checksum', 'signature'];
    for (const key of required) {
      if (!manifest[key]) {
        res.status(400).json({ error: `manifest.${key} is required` });
        return;
      }
    }

    const saved = await firmwareBundleStore.saveBundle({
      bundleId: manifest.bundleId,
      version: manifest.version,
      zipBase64: payload.zipBase64,
      archiveChecksum: payload.archiveChecksum,
      signature: manifest.signature,
      metadata: payload.metadata || {},
      manifest
    });
    res.json({ success: true, bundle: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/firmware/bundles', async (req, res) => {
  try {
    const bundles = await firmwareBundleStore.listBundles();
    res.json({ bundles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/spokes/:nodeId/firmware/deploy', ensureAdmin, async (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const { bundleId, version, sourceId, port } = req.body || {};
  if (!bundleId || !version) {
    res.status(400).json({ error: 'bundleId and version are required' });
    return;
  }

  try {
    const bundle = await firmwareBundleStore.getBundle(bundleId, version);
    if (!bundle) {
      res.status(404).json({ error: 'Firmware bundle not found' });
      return;
    }
    const jobId = crypto.randomUUID();
    const job = setFirmwareJob(nodeId, {
      jobId,
      nodeId,
      bundleId,
      version,
      sourceId: sourceId || null,
      status: 'queued',
      createdAt: Date.now(),
      logs: []
    });

    await emitToSpoke(nodeId, 'hub:firmware-deploy', {
      jobId,
      sourceId: sourceId || null,
      port: port || null,
      bundle: {
        bundleId: bundle.bundleId,
        version: bundle.version,
        zipBase64: bundle.zipBase64,
        archiveChecksum: bundle.archiveChecksum,
        manifest: bundle.manifest || {},
        signature: bundle.signature
      }
    }, 120000);

    res.json({ success: true, job });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.get('/api/spokes/:nodeId/firmware/jobs/:jobId', (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const job = getFirmwareJob(nodeId, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Firmware job not found' });
    return;
  }
  res.json(job);
});

app.post('/api/spokes/:nodeId/firmware/rollback', ensureAdmin, async (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const { sourceId } = req.body || {};
  try {
    const result = await emitToSpoke(nodeId, 'hub:firmware-rollback', {
      jobId: crypto.randomUUID(),
      sourceId: sourceId || null
    }, 120000);
    res.json({ success: true, result });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.post('/api/spokes/:nodeId/components/:componentId/write', async (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const componentId = req.params.componentId;
  const { data, ownerId, leaseTtlMs } = req.body || {};

  if (!data || typeof data !== 'object') {
    res.status(400).json({ error: 'data object is required' });
    return;
  }

  const resolvedOwner = ownerId || 'hub-api';
  const leaseKey = canonicalComponentId(nodeId, componentId);
  const lease = leaseManager.acquireOrRenew(leaseKey, resolvedOwner, leaseTtlMs || LEASE_DEFAULT_TTL_MS);
  if (!lease.ok) {
    res.status(409).json({
      error: lease.error,
      lease: lease.lease
    });
    return;
  }

  try {
    const result = await emitToSpoke(nodeId, 'hub:write', {
      componentId,
      data,
      ownerId: resolvedOwner,
      leaseTtlMs: leaseTtlMs || LEASE_DEFAULT_TTL_MS
    });
    res.json({ success: true, lease: lease.lease, result });
  } catch (err) {
    leaseManager.clear(leaseKey);
    res.status(503).json({ error: err.message });
  }
});

app.delete('/api/spokes/:nodeId/components/:componentId/lease', ensureAdmin, (req, res) => {
  const nodeId = normalizeNodeId(req.params.nodeId);
  const componentId = req.params.componentId;
  const key = canonicalComponentId(nodeId, componentId);
  leaseManager.clear(key);
  res.json({ success: true });
});

// Health check
service.registerHealthCheck(async () => {
  let sensor = 'unknown';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const r = await fetch(`${SENSOR_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    sensor = r.ok ? 'ok' : 'error';
  } catch {
    sensor = 'unreachable';
  }
  return {
    status: sensor === 'ok' ? 'ok' : 'degraded',
    dependencies: { sensorService: sensor },
    spokes: {
      total: spokes.size,
      connected: listSpokes().filter(s => s.connected).length
    },
    activeLeases: leaseManager.listActive().length
  };
});

// Shutdown: close Socket.IO connections
service.onShutdown = async () => {
  log.info('Closing spoke connections...');
  for (const [, spoke] of spokes) {
    if (spoke.socket) {
      try { spoke.socket.disconnect(true); } catch {}
    }
  }
  spokes.clear();
  io.close();
};

// Startup
if (ROLE === 'spoke') {
  log.info('Disabled in spoke role');
  setInterval(() => {}, 0x7fffffff);
} else {
  service.initialize = async () => {
    await moduleBundleStore.initialize();
    await firmwareBundleStore.initialize();
  };
  service.start().catch((err) => {
    log.error({ err }, 'Fatal startup error');
    process.exit(1);
  });
}
