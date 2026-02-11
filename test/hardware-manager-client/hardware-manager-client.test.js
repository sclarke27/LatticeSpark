#!/usr/bin/env node
/**
 * Unit Tests for Hardware Manager Client
 *
 * Tests signal handler lifecycle and basic API without spawning Python.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HardwareManagerClient } from '../../src/hardware-manager-client/hardware-manager-client.js';

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
});
