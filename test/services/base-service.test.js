import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BaseService } from '../../src/services/base-service.js';

describe('BaseService', () => {
  let service;

  afterEach(async () => {
    if (service?.httpServer?.listening) {
      await new Promise((resolve) => service.httpServer.close(resolve));
    }
  });

  it('sets name and port', () => {
    service = new BaseService('test-service', { port: 9999 });
    assert.equal(service.name, 'test-service');
    assert.equal(service.port, 9999);
  });

  it('creates Express app and HTTP server', () => {
    service = new BaseService('test-service', { port: 9999 });
    assert.ok(service.app);
    assert.ok(service.httpServer);
  });

  it('registerHealthCheck creates /health route', async () => {
    service = new BaseService('test-service', { port: 0 }); // port 0 = random
    service.registerHealthCheck(async () => ({ status: 'ok', uptime: 42 }));

    await new Promise((resolve) => {
      service.httpServer.listen(0, resolve);
    });

    const addr = service.httpServer.address();
    const res = await fetch(`http://localhost:${addr.port}/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.uptime, 42);
  });

  it('health check returns 503 on degraded status', async () => {
    service = new BaseService('test-service', { port: 0 });
    service.registerHealthCheck(async () => ({ status: 'degraded', reason: 'db down' }));

    await new Promise((resolve) => {
      service.httpServer.listen(0, resolve);
    });

    const addr = service.httpServer.address();
    const res = await fetch(`http://localhost:${addr.port}/health`);
    assert.equal(res.status, 503);
  });

  it('health check returns 503 when checkFn throws', async () => {
    service = new BaseService('test-service', { port: 0 });
    service.registerHealthCheck(async () => { throw new Error('boom'); });

    await new Promise((resolve) => {
      service.httpServer.listen(0, resolve);
    });

    const addr = service.httpServer.address();
    const res = await fetch(`http://localhost:${addr.port}/health`);
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.error, 'boom');
  });

  it('shutdown is idempotent', () => {
    service = new BaseService('test-service', { port: 9999 });
    service._shutdownCalled = true; // simulate already called
    // Should return immediately without error
    service.shutdown();
    assert.equal(service._shutdownCalled, true);
  });

  it('initialize and onShutdown are no-ops by default', async () => {
    service = new BaseService('test-service', { port: 9999 });
    await service.initialize(); // should not throw
    await service.onShutdown(); // should not throw
  });

  it('accepts expressOptions for JSON body parsing', async () => {
    service = new BaseService('test-service', { port: 0, expressOptions: { limit: '100mb' } });

    service.app.post('/test', (req, res) => {
      res.json({ received: !!req.body });
    });

    await new Promise((resolve) => {
      service.httpServer.listen(0, resolve);
    });

    const addr = service.httpServer.address();
    const res = await fetch(`http://localhost:${addr.port}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true })
    });
    const body = await res.json();
    assert.equal(body.received, true);
  });
});
