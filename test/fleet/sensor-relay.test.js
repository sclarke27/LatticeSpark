#!/usr/bin/env node
/**
 * Unit Tests for sensor-relay - timed relay POSTs from fleet-service to
 * sensor-service. Uses a real local HTTP server (no mocking framework).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { postJsonToSensorService } from '../../src/fleet/sensor-relay.js';

describe('postJsonToSensorService', () => {
  let server;
  let baseUrl;
  let sockets;
  let handler;

  beforeEach(async () => {
    sockets = new Set();
    handler = (req, res) => { res.end('{}'); };
    server = http.createServer((req, res) => handler(req, res));
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it('resolves with parsed JSON on 200', async () => {
    // Arrange
    let captured = null;
    handler = (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        captured = { headers: req.headers, body };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ack":5}');
      });
    };

    // Act
    const result = await postJsonToSensorService(
      baseUrl, '/api/relay/spokes/n1/batch', { seq: 5, batch: { a: 1 } },
      { apiKey: 'secret', timeoutMs: 2000 }
    );

    // Assert
    assert.deepStrictEqual(result, { ack: 5 });
    assert.equal(captured.headers['content-type'], 'application/json');
    assert.equal(captured.headers['x-api-key'], 'secret');
    assert.deepStrictEqual(JSON.parse(captured.body), { seq: 5, batch: { a: 1 } });
  });

  it('omits X-API-Key header when apiKey is empty', async () => {
    // Arrange
    let captured = null;
    handler = (req, res) => {
      captured = req.headers;
      res.end('{}');
    };

    // Act
    await postJsonToSensorService(baseUrl, '/api/x', {}, { timeoutMs: 2000 });

    // Assert
    assert.equal(captured['x-api-key'], undefined);
  });

  it('throws Sensor service error with status and body on non-OK', async () => {
    // Arrange
    handler = (req, res) => {
      res.writeHead(500);
      res.end('boom');
    };

    // Act & Assert - message byte-identical to the pre-fix fleet-service one
    await assert.rejects(
      () => postJsonToSensorService(baseUrl, '/api/x', {}, { timeoutMs: 2000 }),
      { message: 'Sensor service error 500: boom' }
    );
  });

  it('aborts and throws descriptive timeout when server never responds', async () => {
    // Arrange - accept the request but never write a response
    handler = () => {};

    // Act
    const started = Date.now();
    await assert.rejects(
      () => postJsonToSensorService(baseUrl, '/api/relay/spokes/n1/batch', {}, { timeoutMs: 100 }),
      { message: /Sensor service timeout after 100ms \(POST \/api\/relay/ }
    );

    // Assert - rejected promptly, not after an undici default timeout
    assert.ok(Date.now() - started < 2000);
  });

  it('aborts a stalled response body', async () => {
    // Arrange - 200 headers plus half a JSON body, then stall
    handler = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"ack"');
      // never end()
    };

    // Act & Assert - pins `return await response.json()` staying inside the
    // try so the abort timer covers body streaming
    await assert.rejects(
      () => postJsonToSensorService(baseUrl, '/api/x', {}, { timeoutMs: 100 }),
      { message: /Sensor service timeout after 100ms/ }
    );
  });
});
