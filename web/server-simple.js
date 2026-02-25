#!/usr/bin/env node
/**
 * Web Server (Simplified)
 *
 * Serves static files and proxies API requests to backend services.
 */

import express from 'express';
import { createServer } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadClusterConfig } from '../src/cluster/cluster-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8080;
const SENSOR_SERVICE_URL = process.env.SENSOR_SERVICE_URL || 'http://localhost:3000';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3001';
const MODULE_SERVICE_URL = process.env.MODULE_SERVICE_URL || 'http://localhost:3002';
const PROXY_TIMEOUT = parseInt(process.env.PROXY_TIMEOUT || '30000', 10);
const clusterConfig = loadClusterConfig();
const API_KEY = clusterConfig.apiKey || '';
const ROLE = clusterConfig.role || 'standalone';
const NODE_ID = clusterConfig.nodeId || 'local';
const FLEET_SERVICE_URL = process.env.FLEET_SERVICE_URL
  || (ROLE === 'hub' ? 'http://localhost:3010' : (clusterConfig.hubUrl || 'http://localhost:3010'));

const app = express();
const httpServer = createServer(app);

app.use(express.static(join(__dirname, 'dist')));

app.get('/api/config', (req, res) => {
  res.json({
    apiKey: API_KEY || null,
    role: ROLE,
    nodeId: NODE_ID
  });
});

function proxyAuthHeaders() {
  if (!API_KEY) return {};
  return {
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('X-API-Key', API_KEY);
    }
  };
}

app.use('/socket.io', createProxyMiddleware({
  target: SENSOR_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    console.error('Socket.io proxy error:', err.message);
    if (res && typeof res.destroy === 'function' && !res.writeHead) {
      res.destroy();
    } else {
      res.status(503).json({ error: 'Sensor Service unavailable' });
    }
  }
}));

app.use('/api/sensors', createProxyMiddleware({
  target: SENSOR_SERVICE_URL,
  changeOrigin: true,
  ws: false,
  timeout: PROXY_TIMEOUT,
  proxyTimeout: PROXY_TIMEOUT,
  ...proxyAuthHeaders(),
  onError: (err, req, res) => {
    console.error('Sensor Service proxy error:', err.message);
    res.status(503).json({ error: 'Sensor Service unavailable' });
  }
}));

app.use('/api/camera', createProxyMiddleware({
  target: SENSOR_SERVICE_URL,
  changeOrigin: true,
  ...proxyAuthHeaders(),
  onError: (err, req, res) => {
    console.error('Camera proxy error:', err.message);
    res.status(503).json({ error: 'Camera unavailable' });
  }
}));

app.use('/api/modules', createProxyMiddleware({
  target: MODULE_SERVICE_URL,
  changeOrigin: true,
  timeout: PROXY_TIMEOUT,
  proxyTimeout: PROXY_TIMEOUT,
  ...proxyAuthHeaders(),
  onError: (err, req, res) => {
    console.error('Module Service proxy error:', err.message);
    res.status(503).json({ error: 'Module Service unavailable' });
  }
}));

if (ROLE === 'hub') {
  app.use(['/api/spokes', '/api/module-bundles', '/api/firmware'], createProxyMiddleware({
    target: FLEET_SERVICE_URL,
    changeOrigin: true,
    timeout: PROXY_TIMEOUT,
    proxyTimeout: PROXY_TIMEOUT,
    ...proxyAuthHeaders(),
    onError: (err, req, res) => {
      console.error('Fleet Service proxy error:', err.message);
      res.status(503).json({ error: 'Fleet Service unavailable' });
    }
  }));
} else {
  app.use(['/api/spokes', '/api/module-bundles', '/api/firmware'], (req, res) => {
    res.status(404).json({ error: 'Fleet APIs are only available on hub nodes' });
  });
}

const moduleWsProxy = createProxyMiddleware({
  target: MODULE_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    console.error('Module WebSocket proxy error:', err.message);
    if (res && typeof res.destroy === 'function') res.destroy();
  }
});
app.use('/modules-io', moduleWsProxy);

app.use(['/api/history', '/api/data'], createProxyMiddleware({
  target: STORAGE_SERVICE_URL,
  changeOrigin: true,
  timeout: PROXY_TIMEOUT,
  proxyTimeout: PROXY_TIMEOUT,
  ...proxyAuthHeaders(),
  onError: (err, req, res) => {
    console.error('Storage Service proxy error:', err.message);
    res.status(503).json({ error: 'Storage Service unavailable' });
  }
}));

const wsProxy = createProxyMiddleware({
  target: SENSOR_SERVICE_URL,
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    console.error('WebSocket proxy error:', err.message);
    if (res && typeof res.destroy === 'function') res.destroy();
  }
});

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/modules-io')) {
    moduleWsProxy.upgrade(req, socket, head);
  } else {
    wsProxy.upgrade(req, socket, head);
  }
});

app.get('/health', async (req, res) => {
  const checkService = async (url) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return resp.ok ? 'ok' : 'error';
    } catch {
      return 'unreachable';
    }
  };

  const [sensor, storage, module, fleet] = await Promise.all([
    checkService(SENSOR_SERVICE_URL),
    checkService(STORAGE_SERVICE_URL),
    checkService(MODULE_SERVICE_URL),
    checkService(FLEET_SERVICE_URL)
  ]);

  const allOk = sensor === 'ok' && storage === 'ok' && module === 'ok';
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    uptime: process.uptime(),
    dependencies: { sensor, storage, module, fleet }
  });
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

function shutdown(signal) {
  console.log('');
  console.log(`Received ${signal}, shutting down...`);
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('Force closing server');
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[web-server] Port ${PORT} already in use. Kill the old process or choose a different port.`);
  } else {
    console.error('[web-server] Server error:', err.message);
  }
  process.exit(1);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log(`Web Server running on http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('');
  console.log(`OK Proxying /api/sensors/* -> ${SENSOR_SERVICE_URL}`);
  console.log(`OK Proxying /api/history/* -> ${STORAGE_SERVICE_URL}`);
  console.log(`OK Proxying /api/modules/* -> ${MODULE_SERVICE_URL}`);
  if (ROLE === 'hub') {
    console.log(`OK Proxying /api/spokes/* -> ${FLEET_SERVICE_URL}`);
  } else {
    console.log('OK Fleet API routes disabled (hub role required)');
  }
  console.log(`OK Proxying WebSocket -> ${SENSOR_SERVICE_URL}`);
  console.log(`OK Proxying /modules-io -> ${MODULE_SERVICE_URL}`);
  console.log('');
  console.log(`OK Ready at http://localhost:${PORT}`);
});
