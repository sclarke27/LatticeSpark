#!/usr/bin/env node
/**
 * Unit Tests for Sensor Coordinator - Bridge Event Forwarding
 *
 * Verifies hwClient 'error'/'exit' events are forwarded on the coordinator so
 * sensor-service can attach a handler — an unhandled EventEmitter 'error'
 * throws and kills the process.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { SensorCoordinator } from '../../src/coordinator/sensor-coordinator.js';

describe('SensorCoordinator - Bridge Event Forwarding', () => {
  let mockHwClient;
  let coordinator;

  beforeEach(() => {
    // Real EventEmitter so the coordinator's forwarding listeners register
    mockHwClient = Object.assign(new EventEmitter(), {
      register: mock.fn(async () => ({ status: 'ok' })),
      initialize: mock.fn(async () => ({ status: 'ok' })),
      read: mock.fn(async () => ({ value: 1 })),
      write: mock.fn(async () => ({ status: 'ok' })),
      cleanup: mock.fn(),
    });
  });

  afterEach(async () => {
    if (coordinator) {
      await coordinator.shutdown();
      coordinator = null;
    }
  });

  async function createCoordinatorWithSensor() {
    coordinator = new SensorCoordinator({
      hwClient: mockHwClient,
      components: {
        'test-sensor': { type: 'TestSensor', pins: { data: 4 } }
      }
    });
    await coordinator.initialize();
    return coordinator;
  }

  it('forwards hwClient error events as coordinator error', async () => {
    // Arrange
    const coord = await createCoordinatorWithSensor();
    const bridgeError = new Error('bridge died');
    let received = null;
    coord.on('error', (err) => { received = err; });

    // Act
    mockHwClient.emit('error', bridgeError);

    // Assert
    assert.equal(received, bridgeError);
  });

  it('forwards hwClient exit events as hardware-manager-exit', async () => {
    // Arrange
    const coord = await createCoordinatorWithSensor();
    let received = null;
    coord.on('hardware-manager-exit', (info) => { received = info; });

    // Act
    mockHwClient.emit('exit', { code: 1, signal: null });

    // Assert
    assert.deepStrictEqual(received, { code: 1, signal: null });
  });

  it('unhandled hwClient error crashes without a coordinator error listener', async () => {
    // Arrange - deliberately NO coordinator 'error' listener
    await createCoordinatorWithSensor();

    // Act & Assert - documents the crash this fix guards against:
    // ERR_UNHANDLED_ERROR propagates synchronously through the forwarder
    assert.throws(() => mockHwClient.emit('error', new Error('boom')));
  });

  it('stops forwarding after shutdown', async () => {
    // Arrange
    const coord = await createCoordinatorWithSensor();
    let received = null;
    coord.on('error', (err) => { received = err; });

    // Act
    await coord.shutdown();
    coordinator = null;

    // Assert - shutdown removed the coordinator's forwarding listeners from
    // the hwClient. Absorb the raw emit on the mock (a bare EventEmitter
    // throws on 'error' with no listeners) and verify nothing was forwarded.
    mockHwClient.on('error', () => {});
    mockHwClient.emit('error', new Error('late'));
    assert.equal(received, null);
  });
});
