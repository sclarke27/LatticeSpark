#!/usr/bin/env node
/**
 * Web Server (Simplified)
 *
 * Serves static files and proxies API requests to services.
 * - Serves Vite-built UI files
 * - Proxies /api/sensors/* to Sensor Service
 * - Proxies /api/history/* to Storage Service
 * - Proxies WebSocket to Sensor Service
 */

import express from 'express';
import { createServer } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8080;
const SENSOR_SERVICE_URL = process.env.SENSOR_SERVICE_URL || 'http://localhost:3000';
const STORAGE_SERVICE_URL = process.env.STORAGE_SERVICE_URL || 'http://localhost:3001';
const MODULE_SERVICE_URL = process.env.MODULE_SERVICE_URL || 'http://localhost:3002';
const PROXY_TIMEOUT = parseInt(process.env.PROXY_TIMEOUT || '30000', 10);
const API_KEY = process.env.CROWPI_API_KEY || '';

const app = express();
const httpServer = createServer(app);

// Serve static files (production build)
app.use(express.static(join(__dirname, 'dist')));

// Expose API key to dashboard (browser fetches this to pass in Socket.IO auth)
app.get('/api/config', (req, res) => {
  res.json({ apiKey: API_KEY || null });
});

/** Proxy option: inject X-API-Key header on proxied requests when configured. */
function proxyAuthHeaders() {
  if (!API_KEY) return {};
  return {
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader('X-API-Key', API_KEY);
    }
  };
}

// Proxy socket.io to Sensor Service (for HTTP polling)
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

// Proxy /api/sensors/* to Sensor Service
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

// Proxy /api/camera/* to Sensor Service (MJPEG stream, snapshot, status)
app.use('/api/camera', createProxyMiddleware({
  target: SENSOR_SERVICE_URL,
  changeOrigin: true,
  ...proxyAuthHeaders(),
  onError: (err, req, res) => {
    console.error('Camera proxy error:', err.message);
    res.status(503).json({ error: 'Camera unavailable' });
  }
}));

// Proxy /api/modules/* to Module Service
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

// Proxy /modules-io to Module Service (Socket.IO)
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

// Proxy /api/history/* and /api/data to Storage Service
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

// Proxy WebSocket connections to Sensor Service
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
    console.log('Module WebSocket upgrade request');
    moduleWsProxy.upgrade(req, socket, head);
  } else {
    console.log('Sensor WebSocket upgrade request');
    wsProxy.upgrade(req, socket, head);
  }
});

// Health check with upstream dependency verification
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

  const [sensor, storage, module] = await Promise.all([
    checkService(SENSOR_SERVICE_URL),
    checkService(STORAGE_SERVICE_URL),
    checkService(MODULE_SERVICE_URL)
  ]);

  const allOk = sensor === 'ok' && storage === 'ok' && module === 'ok';
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    uptime: process.uptime(),
    dependencies: { sensor, storage, module }
  });
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// Shutdown handler
function shutdown(signal) {
  console.log('');
  console.log(`Received ${signal}, shutting down...`);

  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force close after 2 seconds
  setTimeout(() => {
    console.log('Force closing server');
    process.exit(0);
  }, 2000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle port binding errors
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[web-server] Port ${PORT} already in use. Kill the old process or choose a different port.`);
  } else {
    console.error('[web-server] Server error:', err.message);
  }
  process.exit(1);
});

// Start server
httpServer.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log(`Web Server running on http://localhost:${PORT}`);
  console.log('='.repeat(60));
  console.log('');
  console.log(`✓ Proxying /api/sensors/* → ${SENSOR_SERVICE_URL}`);
  console.log(`✓ Proxying /api/history/* → ${STORAGE_SERVICE_URL}`);
  console.log(`✓ Proxying /api/modules/* → ${MODULE_SERVICE_URL}`);
  console.log(`✓ Proxying WebSocket → ${SENSOR_SERVICE_URL}`);
  console.log(`✓ Proxying /modules-io → ${MODULE_SERVICE_URL}`);
  console.log('');
  console.log(`✓ Ready at http://localhost:${PORT}`);
});
