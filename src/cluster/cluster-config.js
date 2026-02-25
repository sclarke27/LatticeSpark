import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DEFAULT_CONFIG_PATH = join(PROJECT_ROOT, 'config', 'cluster.json');

const DEFAULTS = {
  role: 'standalone',
  nodeId: 'local',
  hubUrl: 'http://localhost:3010',
  apiKey: '',
  disableAuth: false,
  spokeMode: 'full',
  replay: {
    retentionHours: 72,
    maxDiskMb: 1024
  }
};

function readJsonSafe(path) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[cluster-config] Failed to parse ${path}: ${err.message}`);
    return {};
  }
}

function normalizeRole(role) {
  if (role === 'hub' || role === 'spoke' || role === 'standalone') return role;
  return 'standalone';
}

function parseBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

export function loadClusterConfig() {
  const fileConfig = readJsonSafe(DEFAULT_CONFIG_PATH);

  const role = normalizeRole(process.env.LATTICESPARK_ROLE || fileConfig.role || DEFAULTS.role);
  const nodeId = process.env.LATTICESPARK_NODE_ID || fileConfig.nodeId || DEFAULTS.nodeId;
  const hubUrl = process.env.LATTICESPARK_HUB_URL || fileConfig.hubUrl || DEFAULTS.hubUrl;
  const disableAuth = parseBoolean(
    process.env.LATTICESPARK_DISABLE_AUTH,
    parseBoolean(fileConfig.disableAuth, DEFAULTS.disableAuth)
  );
  const apiKey = disableAuth ? '' : (process.env.LATTICESPARK_API_KEY || fileConfig.apiKey || DEFAULTS.apiKey);
  const spokeMode = process.env.LATTICESPARK_SPOKE_MODE || fileConfig.spokeMode || DEFAULTS.spokeMode;

  const replay = {
    retentionHours: parseInt(
      process.env.LATTICESPARK_REPLAY_RETENTION_HOURS || fileConfig?.replay?.retentionHours || DEFAULTS.replay.retentionHours,
      10
    ),
    maxDiskMb: parseInt(
      process.env.LATTICESPARK_REPLAY_MAX_DISK_MB || fileConfig?.replay?.maxDiskMb || DEFAULTS.replay.maxDiskMb,
      10
    )
  };

  return { role, nodeId, hubUrl, apiKey, disableAuth, spokeMode, replay };
}

export function canonicalComponentId(nodeId, componentId) {
  if (!nodeId || !componentId) return componentId;
  if (componentId.startsWith(`${nodeId}.`)) return componentId;
  return `${nodeId}.${componentId}`;
}

export function parseCanonicalComponentId(componentId) {
  if (typeof componentId !== 'string') return null;
  const idx = componentId.indexOf('.');
  if (idx <= 0 || idx === componentId.length - 1) return null;
  return {
    nodeId: componentId.slice(0, idx),
    componentId: componentId.slice(idx + 1)
  };
}
