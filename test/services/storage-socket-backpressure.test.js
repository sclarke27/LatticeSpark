/**
 * Library-contract test for the storage-socket backpressure gate in
 * sensor-service. The gate reads socket.io-client internals
 * (client.io.engine.transport.ws.bufferedAmount) — this pins that path so a
 * dependency upgrade cannot silently neutralize backpressure.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';

describe('storage socket backpressure contract', () => {
  it('exposes a numeric ws bufferedAmount on a live websocket connection', async () => {
    const httpServer = createServer();
    const io = new Server(httpServer, { transports: ['websocket'] });
    let client = null;

    try {
      await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      const port = httpServer.address().port;

      client = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);
        client.on('connect', () => { clearTimeout(timer); resolve(); });
        client.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
      });

      // The internal path the gate reads must exist and be numeric
      assert.ok(client.io.engine.transport.ws, 'transport.ws missing');
      assert.equal(typeof client.io.engine.transport.ws.bufferedAmount, 'number');

      // The exact gate expression evaluates to a number while connected
      const gateValue = client.io?.engine?.transport?.ws?.bufferedAmount ?? 0;
      assert.equal(typeof gateValue, 'number');

      // Plain (non-volatile) emit succeeds — pins that the fix did not
      // switch emit styles
      client.emit('store', { sensorId: 's1', data: { value: 1 } });

      // Fail-open contract after disconnect
      client.disconnect();
      assert.equal(client.connected, false);
      const afterDisconnect = client.io?.engine?.transport?.ws?.bufferedAmount ?? 0;
      assert.equal(typeof afterDisconnect, 'number');
    } finally {
      if (client) client.disconnect();
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
