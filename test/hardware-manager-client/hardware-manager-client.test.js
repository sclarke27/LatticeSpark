#!/usr/bin/env node
/**
 * Unit Tests for Hardware Manager Client
 *
 * Tests signal handler lifecycle, stdin error guarding, and basic API without
 * spawning Python (uses a Node fixture child).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HardwareManagerClient,
  createHardwareManagerClient
} from '../../src/hardware-manager-client/hardware-manager-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('HardwareManagerClient', () => {
  describe('Signal Handler Management', () => {
    let client;

    afterEach(() => {
      if (client) {
        client.cleanup();
        client = null;
      }
    });

    it('should register process signal handlers in constructor', () => {
      // Arrange
      const beforeExit = process.listenerCount('exit');
      const beforeSigint = process.listenerCount('SIGINT');
      const beforeSigterm = process.listenerCount('SIGTERM');

      // Act
      client = new HardwareManagerClient();

      // Assert
      assert.equal(process.listenerCount('exit'), beforeExit + 1);
      assert.equal(process.listenerCount('SIGINT'), beforeSigint + 1);
      assert.equal(process.listenerCount('SIGTERM'), beforeSigterm + 1);
    });

    it('should remove process signal handlers on cleanup', () => {
      // Arrange
      const beforeExit = process.listenerCount('exit');
      const beforeSigint = process.listenerCount('SIGINT');
      const beforeSigterm = process.listenerCount('SIGTERM');

      client = new HardwareManagerClient();

      // Act
      client.cleanup();
      client = null;

      // Assert
      assert.equal(process.listenerCount('exit'), beforeExit);
      assert.equal(process.listenerCount('SIGINT'), beforeSigint);
      assert.equal(process.listenerCount('SIGTERM'), beforeSigterm);
    });

    it('should handle cleanup called multiple times without error', () => {
      // Arrange
      const beforeExit = process.listenerCount('exit');
      client = new HardwareManagerClient();

      // Act
      client.cleanup();
      client.cleanup();
      client = null;

      // Assert
      assert.equal(process.listenerCount('exit'), beforeExit);
    });

    it('should not leak listeners across multiple instances', () => {
      // Arrange
      const beforeExit = process.listenerCount('exit');

      // Act
      const client1 = new HardwareManagerClient();
      const client2 = new HardwareManagerClient();

      // Assert - both registered
      assert.equal(process.listenerCount('exit'), beforeExit + 2);

      // Act - clean up one
      client1.cleanup();
      assert.equal(process.listenerCount('exit'), beforeExit + 1);

      // Act - clean up other
      client2.cleanup();
      assert.equal(process.listenerCount('exit'), beforeExit);
    });
  });

  describe('Constructor', () => {
    it('should create client instance', () => {
      // Act
      const client = new HardwareManagerClient();

      // Assert
      assert.ok(client);
      assert.equal(client.isReady(), false);

      // Cleanup
      client.cleanup();
    });

    it('should accept configuration', () => {
      // Arrange
      const config = { timeout: 10000 };

      // Act
      const client = new HardwareManagerClient(config);

      // Assert
      assert.ok(client);

      // Cleanup
      client.cleanup();
    });
  });

  describe('Methods', () => {
    it('should have required methods', () => {
      // Arrange
      const client = new HardwareManagerClient();

      // Assert
      assert.equal(typeof client.start, 'function');
      assert.equal(typeof client.request, 'function');
      assert.equal(typeof client.register, 'function');
      assert.equal(typeof client.read, 'function');
      assert.equal(typeof client.write, 'function');
      assert.equal(typeof client.cleanup, 'function');
      assert.equal(typeof client.isReady, 'function');

      // Cleanup
      client.cleanup();
    });

    it('should throw when requesting before start', async () => {
      // Arrange
      const client = new HardwareManagerClient();

      // Act & Assert
      await assert.rejects(
        () => client.request('ping'),
        { message: /not started/ }
      );

      // Cleanup
      client.cleanup();
    });
  });

  describe('Stdin Error Handling', () => {
    let client;

    afterEach(() => {
      if (client) {
        client.cleanup();
        client = null;
      }
    });

    it('should survive writes to a closed child stdin and reject the request', async () => {
      // Arrange — fixture emits ready, destroys its stdin, stays alive
      client = new HardwareManagerClient({
        pythonPath: process.execPath,
        managerPath: join(__dirname, 'fixtures', 'fake-manager-stdin-closed.js'),
        timeout: 1000
      });
      await client.start();
      await new Promise((r) => setTimeout(r, 50)); // let stdin close propagate

      // Act & Assert — EPIPE is swallowed by the stdin 'error' handler; the
      // request rejects via its timeout. Without the fix this test kills the
      // runner with an uncaught stream 'error'.
      await assert.rejects(() => client.request('ping'));
      assert.equal(client.isReady(), true); // client survived
    });
  });

  describe('Event Emitter', () => {
    it('should inherit from EventEmitter', () => {
      // Arrange
      const client = new HardwareManagerClient();

      // Assert
      assert.equal(typeof client.on, 'function');
      assert.equal(typeof client.emit, 'function');
      assert.equal(typeof client.removeAllListeners, 'function');

      // Cleanup
      client.cleanup();
    });
  });

  describe('Restart behavior (fake child)', () => {
    let client;
    let savedBaseDelay;
    let savedMaxDelay;
    let savedMaxRetries;

    function fakeChild(name) {
      return {
        pythonPath: process.execPath,
        managerPath: join(__dirname, 'fixtures', name),
        timeout: 250
      };
    }

    async function waitFor(cond, timeoutMs = 5000) {
      const start = Date.now();
      while (!cond()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error('waitFor timeout');
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    beforeEach(() => {
      savedBaseDelay = HardwareManagerClient.RESTART_BASE_DELAY;
      savedMaxDelay = HardwareManagerClient.RESTART_MAX_DELAY;
      savedMaxRetries = HardwareManagerClient.RESTART_MAX_RETRIES;
      HardwareManagerClient.RESTART_BASE_DELAY = 20;
      HardwareManagerClient.RESTART_MAX_DELAY = 40;
    });

    afterEach(() => {
      HardwareManagerClient.RESTART_BASE_DELAY = savedBaseDelay;
      HardwareManagerClient.RESTART_MAX_DELAY = savedMaxDelay;
      HardwareManagerClient.RESTART_MAX_RETRIES = savedMaxRetries;
      if (client) {
        client.cleanup();
        client = null;
      }
    });

    it('ready timeout tears down without latching the restart chain', async () => {
      // Arrange
      const baseline = process.listenerCount('exit');
      client = new HardwareManagerClient(fakeChild('never-ready.js'));
      client.on('error', () => {}); // emissions must not throw
      let exits = 0;
      client.on('exit', () => { exits++; });

      // Act
      await assert.rejects(() => client.start(), { message: /did not send ready signal/ });

      // Assert — signal handlers kept (teardown, not cleanup)...
      assert.equal(process.listenerCount('exit'), baseline + 1);
      // ...and the killed child's exit drove the chain into more attempts
      await waitFor(() => exits >= 2);
    });

    it('child exit before ready rejects start() promptly and keeps retrying', async () => {
      // Arrange
      client = new HardwareManagerClient(fakeChild('exits-immediately.js'));
      client.on('error', () => {});
      let exits = 0;
      client.on('exit', () => { exits++; });

      // Act & Assert — fast-fail, not the ready timeout
      await assert.rejects(() => client.start(), { message: /Process exited before ready/ });
      await waitFor(() => exits >= 2);
    });

    it('gives up with error after RESTART_MAX_RETRIES', async () => {
      // Arrange
      HardwareManagerClient.RESTART_MAX_RETRIES = 2;
      client = new HardwareManagerClient(fakeChild('exits-immediately.js'));
      const errors = [];
      client.on('error', (err) => { errors.push(err); });
      let exits = 0;
      client.on('exit', () => { exits++; });

      // Act
      await assert.rejects(() => client.start());
      await waitFor(() => errors.some((e) => /max attempts/.test(e.message)));

      // Assert — chain stopped
      const exitsAtGiveUp = exits;
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(exits, exitsAtGiveUp);
    });

    it('cleanup() stops the restart chain', async () => {
      // Arrange
      const baseline = process.listenerCount('exit');
      client = new HardwareManagerClient(fakeChild('never-ready.js'));
      client.on('error', () => {});
      let exits = 0;
      client.on('exit', () => { exits++; });
      await assert.rejects(() => client.start());

      // Act
      client.cleanup();

      // Assert
      await new Promise((r) => setTimeout(r, 100));
      const exitsAfterCleanup = exits;
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(exits, exitsAfterCleanup);
      assert.equal(process.listenerCount('exit'), baseline);
      client = null;
    });

    it('emits restart after successful respawn', async () => {
      // Arrange — fixture becomes ready, then dies; the respawn re-readies
      client = new HardwareManagerClient(fakeChild('ready-then-exit.js'));
      client.on('error', () => {});
      let restarts = 0;
      client.on('restart', () => { restarts++; });

      // Act
      await client.start();
      await waitFor(() => restarts >= 1);

      // Assert + prompt cleanup (fixture loops ready/exit forever otherwise)
      assert.ok(restarts >= 1);
      client.cleanup();
      client = null;
    });

    it('createHardwareManagerClient cleans up after failed start', async () => {
      // Arrange
      const baseline = process.listenerCount('exit');

      // Act & Assert
      await assert.rejects(
        () => createHardwareManagerClient(fakeChild('never-ready.js')),
        { message: /did not send ready signal/ }
      );
      assert.equal(process.listenerCount('exit'), baseline);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(process.listenerCount('exit'), baseline); // no orphaned respawn
    });

    it('spawn failure retries without an exit event', async () => {
      // Arrange — nonexistent binary: 'error' fires, 'exit' never does
      HardwareManagerClient.RESTART_MAX_RETRIES = 2;
      client = new HardwareManagerClient({
        pythonPath: join(__dirname, 'fixtures', 'no-such-binary'),
        managerPath: join(__dirname, 'fixtures', 'never-ready.js'),
        timeout: 250
      });
      const errors = [];
      client.on('error', (err) => { errors.push(err); });

      // Act
      await assert.rejects(() => client.start());

      // Assert — the error-handler path scheduled restarts to exhaustion
      await waitFor(() => errors.some((e) => /max attempts/.test(e.message)));
    });
  });
});
