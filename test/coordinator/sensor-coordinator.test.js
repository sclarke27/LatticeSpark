#!/usr/bin/env node
/**
 * Unit Tests for Sensor Coordinator
 *
 * Basic tests for coordinator functionality.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SensorCoordinator } from '../../src/coordinator/sensor-coordinator.js';

describe('SensorCoordinator', () => {
  describe('Constructor', () => {
    it('should create coordinator instance', () => {
      const coordinator = new SensorCoordinator();
      assert.ok(coordinator);
      assert.equal(coordinator.isInitialized(), false);
    });

    it('should accept configuration', () => {
      const config = {
        components: {
          test: { type: 'DHT11', pins: { data: 4 } }
        }
      };
      const coordinator = new SensorCoordinator(config);
      assert.ok(coordinator);
    });
  });

  describe('Methods', () => {
    it('should have required methods', () => {
      const coordinator = new SensorCoordinator();
      assert.equal(typeof coordinator.initialize, 'function');
      assert.equal(typeof coordinator.read, 'function');
      assert.equal(typeof coordinator.write, 'function');
      assert.equal(typeof coordinator.shutdown, 'function');
      assert.equal(typeof coordinator.getComponents, 'function');
      assert.equal(typeof coordinator.getComponent, 'function');
    });

    it('should throw error when reading before initialization', async () => {
      const coordinator = new SensorCoordinator();
      await assert.rejects(
        async () => await coordinator.read('test'),
        { message: /not initialized/ }
      );
    });

    it('should throw error when writing before initialization', async () => {
      const coordinator = new SensorCoordinator();
      await assert.rejects(
        async () => await coordinator.write('test', {}),
        { message: /not initialized/ }
      );
    });
  });

  describe('Component Management', () => {
    it('should return empty array when no components', () => {
      const coordinator = new SensorCoordinator();
      const components = coordinator.getComponents();
      assert.ok(Array.isArray(components));
      assert.equal(components.length, 0);
    });

    it('should throw error when getting nonexistent component', () => {
      const coordinator = new SensorCoordinator();
      assert.throws(
        () => coordinator.getComponent('nonexistent'),
        { message: /not registered/ }
      );
    });
  });

  describe('Event Emitter', () => {
    it('should inherit from EventEmitter', () => {
      const coordinator = new SensorCoordinator();
      assert.equal(typeof coordinator.on, 'function');
      assert.equal(typeof coordinator.emit, 'function');
      assert.equal(typeof coordinator.removeAllListeners, 'function');
    });

    it('should emit events', () => {
      const coordinator = new SensorCoordinator();
      let eventReceived = false;

      coordinator.on('test-event', () => {
        eventReceived = true;
      });

      coordinator.emit('test-event');
      assert.equal(eventReceived, true);
    });
  });

  describe('Shutdown', () => {
    it('should be idempotent when not initialized', async () => {
      const coordinator = new SensorCoordinator();
      await coordinator.shutdown();
      await coordinator.shutdown();
      await coordinator.shutdown();
      assert.equal(coordinator.isInitialized(), false);
    });
  });
});
