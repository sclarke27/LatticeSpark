#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { io as ioClient } from 'socket.io-client';
import { ReplayQueue } from '../spoke-agent/replay-queue.js';
import { loadClusterConfig } from '../cluster/cluster-config.js';
import { atomicWriteJson } from '../utils/persistence.js';
import { authHeaders } from '../utils/auth.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('spoke-agent');

process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Unhandled promise rejection');
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

const clusterConfig = loadClusterConfig();
const ROLE = clusterConfig.role || 'standalone';
const NODE_ID = clusterConfig.nodeId || 'spoke-1';
const HUB_URL = clusterConfig.hubUrl || 'http://localhost:3010';
const API_KEY = clusterConfig.apiKey || '';
const SPOKE_MODE = clusterConfig.spokeMode || 'full';
const SENSOR_SERVICE_URL = process.env.SENSOR_SERVICE_URL || 'http://localhost:3000';
const MODULE_SERVICE_URL = process.env.MODULE_SERVICE_URL || 'http://localhost:3002';
const QUEUE_PATH = process.env.SPOKE_RELAY_QUEUE_PATH || join(PROJECT_ROOT, 'data', 'spoke-agent', `${NODE_ID}-relay.ndjson`);
const HEARTBEAT_MS = parseInt(process.env.SPOKE_HEARTBEAT_MS || '10000', 10);
const MODULE_SYNC_MS = parseInt(process.env.SPOKE_MODULE_SYNC_MS || '15000', 10);
const FIRMWARE_STATE_PATH = process.env.SPOKE_FIRMWARE_STATE_PATH || join(PROJECT_ROOT, 'data', 'spoke-agent', `${NODE_ID}-firmware-state.json`);

const queue = new ReplayQueue({
  queuePath: QUEUE_PATH,
  retentionHours: clusterConfig?.replay?.retentionHours || 72,
  maxDiskMb: clusterConfig?.replay?.maxDiskMb || 1024
});

let sensorSocket = null;
let fleetSocket = null;
let heartbeatTimer = null;
let moduleSyncTimer = null;
let queueCompactTimer = null;
let flushInProgress = false;
let localComponents = [];
let firmwareState = { sources: {} };
let activeFirmwareJob = null;

async function loadArduinoConfig() {
  const path = join(PROJECT_ROOT, 'config', 'arduino-sources.json');
  if (!existsSync(path)) return { sources: [] };
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.sources)) return { sources: [] };
    return parsed;
  } catch (err) {
    log.warn({ err }, 'Failed to parse arduino config');
    return { sources: [] };
  }
}

async function loadFirmwareState() {
  if (!existsSync(FIRMWARE_STATE_PATH)) return;
  try {
    const raw = await readFile(FIRMWARE_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      firmwareState = parsed;
      if (!firmwareState.sources) firmwareState.sources = {};
    }
  } catch {
    firmwareState = { sources: {} };
  }
}

async function persistFirmwareState() {
  await atomicWriteJson(FIRMWARE_STATE_PATH, firmwareState, { ensureDir: true });
}

function emitFirmwareStatus(statusPatch) {
  if (!fleetSocket?.connected) return;
  fleetSocket.emit('spoke:firmware-status', statusPatch);
}

function emitFirmwareLog(jobId, line) {
  if (!fleetSocket?.connected) return;
  fleetSocket.emit('spoke:firmware-log', { jobId, line });
}

async function announceComponents() {
  if (!fleetSocket?.connected) return;
  const components = localComponents.map((c) => ({ id: c.id, type: c.type, config: c.config }));
  fleetSocket.emit('spoke:components', { components }, (ack) => {
    if (ack?.error) {
      log.warn('Failed to announce components: %s', ack.error);
    }
  });
}

async function enqueueBatch(batch) {
  const item = queue.enqueue(batch);
  await queue.append(item);
  if (fleetSocket?.connected) {
    flushQueue().catch((err) => {
      log.error({ err }, 'Queue flush error');
    });
  }
}

async function flushQueue() {
  if (!fleetSocket?.connected || flushInProgress) return;
  flushInProgress = true;
  try {
    const pending = queue.pending();
    for (const item of pending) {
      const ack = await new Promise((resolve, reject) => {
        fleetSocket.timeout(10000).emit('spoke:batch', {
          seq: item.seq,
          batch: item.batch,
          queueDepth: queue.pending().length
        }, (err, response) => {
          if (err) {
            reject(new Error('Hub timeout waiting for batch ACK'));
            return;
          }
          if (response?.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response?.ack || item.seq);
        });
      });
      queue.ack(ack);
    }
    await queue.compact();
  } finally {
    flushInProgress = false;
  }
}

async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders(API_KEY) };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

async function listLocalModules() {
  const data = await fetchJson(`${MODULE_SERVICE_URL}/api/modules`);
  return Array.isArray(data) ? data : [];
}

async function sendLocalModuleStatus() {
  if (!fleetSocket?.connected) return;
  try {
    const modules = await listLocalModules();
    fleetSocket.emit('spoke:module-status', { modules });
  } catch (err) {
    log.warn({ err }, 'Failed to fetch local modules');
  }
}

async function runLocalModuleAction(action, moduleId) {
  if (action === 'list') {
    return { modules: await listLocalModules() };
  }
  if (!['enable', 'disable', 'restart'].includes(action)) {
    throw new Error(`Unsupported module action: ${action}`);
  }
  const data = await fetchJson(`${MODULE_SERVICE_URL}/api/modules/${encodeURIComponent(moduleId)}/${action}`, {
    method: 'POST'
  });
  await sendLocalModuleStatus();
  return data;
}

async function requestSensorWrite(componentId, data) {
  if (!sensorSocket?.connected) {
    throw new Error('sensor-service socket not connected');
  }
  return new Promise((resolve, reject) => {
    sensorSocket.timeout(5000).emit('component:write', { componentId, data }, (err, result) => {
      if (err) {
        reject(new Error('sensor-service write timeout'));
        return;
      }
      if (result?.error) {
        reject(new Error(result.error));
        return;
      }
      resolve(result || { success: true });
    });
  });
}

async function runCommand(command, args, { timeoutMs = 60000, cwd = PROJECT_ROOT, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    const consume = (stream, sink) => {
      const rl = readline.createInterface({ input: stream });
      rl.on('line', (line) => {
        if (sink === 'stdout') stdout += `${line}\n`;
        else stderr += `${line}\n`;
        onLine?.(line);
      });
    };

    consume(proc.stdout, 'stdout');
    consume(proc.stderr, 'stderr');

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function extractZip(zipPath, destDir) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  if (process.platform === 'win32') {
    await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`
    ], { timeoutMs: 120000 });
    return;
  }
  await runCommand('unzip', ['-o', zipPath, '-d', destDir], { timeoutMs: 120000 });
}

async function findModuleRoot(extractDir) {
  const directModuleJson = join(extractDir, 'module.json');
  if (existsSync(directModuleJson)) return extractDir;

  const entries = await readdir(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(extractDir, entry.name);
    if (existsSync(join(candidate, 'module.json'))) {
      return candidate;
    }
  }
  throw new Error('No module.json found in extracted module bundle');
}

async function deployModuleBundle(payload) {
  const { bundleId, version, zipBase64 } = payload;
  if (!bundleId || !version || !zipBase64) {
    throw new Error('bundleId, version, and zipBase64 are required');
  }

  const workDir = join(PROJECT_ROOT, 'data', 'spoke-agent', 'module-work');
  await mkdir(workDir, { recursive: true });

  const zipPath = join(workDir, `${bundleId}-${version}.zip`);
  const extractDir = join(workDir, `${bundleId}-${version}-extract`);
  await writeFile(zipPath, Buffer.from(zipBase64, 'base64'));
  await extractZip(zipPath, extractDir);

  const moduleRoot = await findModuleRoot(extractDir);
  const moduleJson = JSON.parse(await readFile(join(moduleRoot, 'module.json'), 'utf-8'));
  const moduleId = payload?.manifest?.moduleId || payload?.metadata?.moduleId || moduleJson?.id || moduleRoot.split(/[\\/]/).pop();

  if (!moduleId || typeof moduleId !== 'string') {
    throw new Error('Unable to resolve moduleId from bundle');
  }

  const modulesDir = join(PROJECT_ROOT, 'modules');
  const targetDir = join(modulesDir, moduleId);
  const stageDir = join(modulesDir, `${moduleId}.stage`);
  const backupDir = join(modulesDir, `${moduleId}.backup-${Date.now()}`);

  await rm(stageDir, { recursive: true, force: true });
  await rename(moduleRoot, stageDir);

  let hadExisting = false;
  if (existsSync(targetDir)) {
    hadExisting = true;
    await rename(targetDir, backupDir);
  }

  try {
    await rename(stageDir, targetDir);
    await fetchJson(`${MODULE_SERVICE_URL}/api/modules/rescan`, { method: 'POST' });
    await rm(backupDir, { recursive: true, force: true });
    return { success: true, moduleId, bundleId, version };
  } catch (err) {
    await rm(targetDir, { recursive: true, force: true });
    if (hadExisting && existsSync(backupDir)) {
      await rename(backupDir, targetDir);
    }
    throw err;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
}

function validateFirmwareManifest(manifest) {
  const required = ['bundleId', 'version', 'boardProfile', 'mcu', 'programmer', 'baud', 'checksum', 'signature'];
  for (const key of required) {
    if (!manifest?.[key]) {
      throw new Error(`Firmware manifest missing field: ${key}`);
    }
  }
}

async function findFirmwareFiles(extractDir, fallbackManifest = {}) {
  let manifest = fallbackManifest;
  const manifestPath = join(extractDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  }
  validateFirmwareManifest(manifest);

  const entries = await readdir(extractDir, { withFileTypes: true });
  let hexPath = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.hex')) {
      hexPath = join(extractDir, entry.name);
      break;
    }
  }
  if (!hexPath) {
    throw new Error('No .hex firmware file found in bundle');
  }
  return { manifest, hexPath };
}

async function preflightAvrdude() {
  try {
    await runCommand('avrdude', ['-?'], { timeoutMs: 10000 });
  } catch (err) {
    if (String(err.message).includes('ENOENT')) {
      throw new Error('avrdude not found on spoke host');
    }
  }
}

async function runFirmwareDeploy(payload) {
  if (activeFirmwareJob) {
    throw new Error(`Firmware deploy already running (${activeFirmwareJob})`);
  }

  const { jobId, sourceId } = payload;
  const bundle = payload.bundle || {};
  if (!jobId) throw new Error('jobId is required');
  if (!bundle.zipBase64) throw new Error('bundle.zipBase64 is required');

  const startedAt = Date.now();
  activeFirmwareJob = jobId;
  emitFirmwareStatus({
    jobId,
    status: 'running',
    startedAt,
    sourceId: sourceId || null,
    bundleId: bundle.bundleId || null,
    version: bundle.version || null
  });

  const workDir = join(PROJECT_ROOT, 'data', 'spoke-agent', 'firmware-work');
  await mkdir(workDir, { recursive: true });

  const zipPath = join(workDir, `${jobId}.zip`);
  const extractDir = join(workDir, `${jobId}-extract`);
  const historyDir = join(PROJECT_ROOT, 'data', 'spoke-agent', 'firmware-history');
  await mkdir(historyDir, { recursive: true });
  let arduinoIngestPaused = false;

  try {
    const archiveBuffer = Buffer.from(bundle.zipBase64, 'base64');
    const archiveChecksum = createHash('sha256').update(archiveBuffer).digest('hex');
    if (bundle.archiveChecksum && archiveChecksum !== bundle.archiveChecksum) {
      throw new Error('Firmware archive checksum mismatch');
    }
    await writeFile(zipPath, archiveBuffer);

    await extractZip(zipPath, extractDir);
    const { manifest, hexPath } = await findFirmwareFiles(extractDir, bundle.manifest || {});
    const hexBuffer = await readFile(hexPath);
    const firmwareChecksum = createHash('sha256').update(hexBuffer).digest('hex');
    if (firmwareChecksum !== manifest.checksum) {
      throw new Error('Firmware .hex checksum mismatch against manifest');
    }

    await preflightAvrdude();

    const arduinoConfig = await loadArduinoConfig();
    const source = (arduinoConfig.sources || []).find(s => s.sourceId === sourceId) || null;
    const serialPort = payload.port || source?.port;
    if (!serialPort) {
      throw new Error('Serial port is required (payload.port or source config)');
    }
    if (!existsSync(serialPort)) {
      throw new Error(`Serial port not found: ${serialPort}`);
    }

    if (sourceId) {
      await requestArduinoIngestAction(sourceId, 'pause');
      arduinoIngestPaused = true;
      emitFirmwareLog(jobId, `[deploy] paused arduino ingest for source ${sourceId}`);
    }

    const avrdudeArgs = [
      '-p', String(manifest.mcu),
      '-c', String(manifest.programmer),
      '-P', serialPort,
      '-b', String(manifest.baud),
      '-U', `flash:w:${hexPath}:i`
    ];

    emitFirmwareLog(jobId, `[deploy] flashing ${manifest.bundleId}@${manifest.version} to ${serialPort}`);
    await runCommand('avrdude', avrdudeArgs, {
      timeoutMs: 120000,
      onLine: (line) => emitFirmwareLog(jobId, line)
    });

    const sourceKey = sourceId || '_default';
    const historyPath = join(historyDir, `${sourceKey}-${manifest.bundleId}-${manifest.version}.zip`);
    await writeFile(historyPath, archiveBuffer);
    firmwareState.sources[sourceKey] = {
      bundleId: manifest.bundleId,
      version: manifest.version,
      archivePath: historyPath,
      manifest,
      updatedAt: Date.now()
    };
    await persistFirmwareState();

    emitFirmwareStatus({
      jobId,
      status: 'success',
      startedAt,
      finishedAt: Date.now(),
      sourceId: sourceId || null,
      bundleId: manifest.bundleId,
      version: manifest.version,
      detail: 'Firmware deployed and verified'
    });

    return { success: true, bundleId: manifest.bundleId, version: manifest.version };
  } catch (err) {
    emitFirmwareStatus({
      jobId,
      status: 'failed',
      startedAt,
      finishedAt: Date.now(),
      sourceId: sourceId || null,
      bundleId: bundle.bundleId || null,
      version: bundle.version || null,
      detail: err.message
    });
    throw err;
  } finally {
    if (arduinoIngestPaused && sourceId) {
      try {
        await requestArduinoIngestAction(sourceId, 'resume');
        emitFirmwareLog(jobId, `[deploy] resumed arduino ingest for source ${sourceId}`);
      } catch (resumeErr) {
        emitFirmwareLog(jobId, `[deploy] failed to resume arduino ingest for source ${sourceId}: ${resumeErr.message}`);
      }
    }
    activeFirmwareJob = null;
    await rm(extractDir, { recursive: true, force: true });
  }
}

async function runFirmwareRollback({ jobId, sourceId }) {
  const sourceKey = sourceId || '_default';
  const record = firmwareState?.sources?.[sourceKey];
  if (!record || !record.archivePath || !existsSync(record.archivePath)) {
    throw new Error(`No rollback firmware found for source: ${sourceKey}`);
  }
  const zipBase64 = (await readFile(record.archivePath)).toString('base64');
  return runFirmwareDeploy({
    jobId,
    sourceId,
    bundle: {
      bundleId: record.bundleId,
      version: record.version,
      zipBase64,
      manifest: record.manifest
    }
  });
}

function connectToSensorService() {
  sensorSocket = ioClient(SENSOR_SERVICE_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    ...(API_KEY ? { auth: { apiKey: API_KEY } } : {})
  });

  sensorSocket.on('connect', () => {
    log.info('Connected to local sensor-service');
  });

  sensorSocket.on('disconnect', () => {
    log.warn('Disconnected from local sensor-service');
  });

  sensorSocket.on('components', (components) => {
    localComponents = Array.isArray(components) ? components : [];
    announceComponents().catch((err) => {
      log.warn({ err }, 'Failed to announce components');
    });
  });

  sensorSocket.on('sensor:batch', (batch) => {
    enqueueBatch(batch).catch((err) => {
      log.error({ err }, 'Failed to enqueue local sensor batch');
    });
  });

  sensorSocket.on('sensor:error', ({ componentId, error }) => {
    log.warn({ componentId }, 'sensor-service error: %s', error);
  });
}

function connectToHub() {
  fleetSocket = ioClient(HUB_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    ...(API_KEY ? { auth: { apiKey: API_KEY } } : {})
  });

  fleetSocket.on('connect', () => {
    log.info('Connected to hub: %s', HUB_URL);
    fleetSocket.emit('spoke:hello', {
      nodeId: NODE_ID,
      spokeMode: SPOKE_MODE,
      capabilities: {
        remoteWrite: true,
        moduleControl: true,
        moduleDeploy: true,
        firmwareDeploy: true
      }
    }, (response) => {
      if (response?.error) {
        log.error('spoke:hello rejected: %s', response.error);
        return;
      }
      log.info({ nodeId: NODE_ID }, 'Hub accepted node');
      announceComponents().catch(() => {});
      sendLocalModuleStatus().catch(() => {});
      flushQueue().catch(() => {});
    });
  });

  fleetSocket.on('disconnect', () => {
    log.warn('Disconnected from hub');
  });

  fleetSocket.on('connect_error', (err) => {
    log.error({ err }, 'Hub connect error');
  });

  fleetSocket.io.on('reconnect_attempt', (attempt) => {
    log.warn({ attempt }, 'Reconnecting to hub...');
  });

  fleetSocket.io.on('reconnect_error', (err) => {
    log.error({ err }, 'Hub reconnect error');
  });

  fleetSocket.on('hub:write', async (payload, callback) => {
    try {
      const result = await requestSensorWrite(payload.componentId, payload.data);
      callback?.({ success: true, result });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  fleetSocket.on('hub:module-command', async (payload, callback) => {
    try {
      const result = await runLocalModuleAction(payload.action, payload.moduleId);
      callback?.({ success: true, ...result });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  fleetSocket.on('hub:module-deploy', async (payload, callback) => {
    try {
      const result = await deployModuleBundle(payload);
      callback?.({ success: true, ...result });
      await sendLocalModuleStatus();
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  fleetSocket.on('hub:firmware-deploy', async (payload, callback) => {
    try {
      const result = await runFirmwareDeploy(payload);
      callback?.({ success: true, ...result });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  fleetSocket.on('hub:firmware-rollback', async (payload, callback) => {
    try {
      const result = await runFirmwareRollback(payload);
      callback?.({ success: true, ...result });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (!fleetSocket?.connected) return;
    fleetSocket.emit('spoke:heartbeat', {
      ackSeq: queue.getAckedSeq(),
      queueDepth: queue.pending().length
    });
  }, HEARTBEAT_MS);
}

function startModuleSync() {
  moduleSyncTimer = setInterval(() => {
    sendLocalModuleStatus().catch(() => {});
  }, MODULE_SYNC_MS);
}

async function requestArduinoIngestAction(sourceId, action) {
  if (!sourceId) return;
  const normalizedAction = action === 'pause' ? 'pause' : 'resume';
  await fetchJson(
    `${SENSOR_SERVICE_URL}/api/arduino/sources/${encodeURIComponent(sourceId)}/${normalizedAction}`,
    { method: 'POST' }
  );
}

async function shutdown(signal) {
  log.info({ signal }, 'Shutting down');
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (moduleSyncTimer) clearInterval(moduleSyncTimer);
  if (queueCompactTimer) clearInterval(queueCompactTimer);

  try {
    await queue.flush();
  } catch {}

  try { sensorSocket?.disconnect(); } catch {}
  try { fleetSocket?.disconnect(); } catch {}
  process.exit(0);
}

async function main() {
  if (ROLE !== 'spoke') {
    log.info('Disabled in role "%s"', ROLE);
    setInterval(() => {}, 0x7fffffff);
    return;
  }

  await queue.initialize();
  await loadFirmwareState();
  connectToSensorService();
  connectToHub();
  startHeartbeat();
  startModuleSync();

  queueCompactTimer = setInterval(() => {
    queue.compact().catch(() => {});
  }, 30000);

  log.info('Hub target: %s', HUB_URL);
  log.info('Running as node "%s" in mode "%s"', NODE_ID, SPOKE_MODE);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
