#!/usr/bin/env node
/**
 * Unit Tests for Sensor Coordinator - Circuit Breaker
 *
 * Tests circuit breaker behavior using injected mock hardware client.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SensorCoordinator } from '../../src/coordinator/sensor-coordinator.js';

describe('SensorCoordinator - Circuit Breaker', () => {
  let mockHwClient;
  let coordinator;

  beforeEach(() => {
    // Create mock hardware client
    mockHwClient = {
      on: () => {},
      register: mock.fn(async () => ({ status: 'ok' })),
      initialize: mock.fn(async () => ({ status: 'ok' })),
      read: mock.fn(async () => ({ temperature: 25, humidity: 60 })),
      write: mock.fn(async () => ({ status: 'ok' })),
      cleanup: mock.fn(),
      removeAllListeners: mock.fn(),
    };
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

  it('should read successfully when circuit is closed', async () => {
    // Arrange
    const coord = await createCoordinatorWithSensor();

    // Act
    const data = await coord.read('test-sensor');

    // Assert
    assert.deepStrictEqual(data, { temperature: 25, humidity: 60 });
  });

  it('should emit component:data on successful read', async () => {
    // Arrange
    const coord = await createCoordinatorWithSensor();
    let emittedData = null;
    coord.on('component:data', (event) => { emittedData = event; });

    // Act
    await coord.read('test-sensor');

    // Assert
    assert.ok(emittedData);
    assert.equal(emittedData.componentId, 'test-sensor');
    assert.deepStrictEqual(emittedData.data, { temperature: 25, humidity: 60 });
  });

  it('should track failures and open circuit after threshold', async () => {
    // Arrange
    mockHwClient.read = mock.fn(async () => { throw new Error('sensor failed'); });
    const coord = await createCoordinatorWithSensor();
    let circuitOpenEvent = null;
    coord.on('component:circuit-open', (event) => { circuitOpenEvent = event; });

    // Act - fail up to threshold
    for (let i = 0; i < SensorCoordinator.BREAKER_THRESHOLD; i++) {
      await assert.rejects(() => coord.read('test-sensor'), { message: /sensor failed/ });
    }

    // Assert
    assert.ok(circuitOpenEvent);
    assert.equal(circuitOpenEvent.componentId, 'test-sensor');
    assert.equal(circuitOpenEvent.failures, SensorCoordinator.BREAKER_THRESHOLD);
  });

  it('should reject reads immediately when circuit is open', async () => {
    // Arrange
    mockHwClient.read = mock.fn(async () => { throw new Error('sensor failed'); });
    const coord = await createCoordinatorWithSensor();

    // Open the circuit
    for (let i = 0; i < SensorCoordinator.BREAKER_THRESHOLD; i++) {
      await assert.rejects(() => coord.read('test-sensor'));
    }

    // Act - read with open circuit
    await assert.rejects(
      () => coord.read('test-sensor'),
      { message: /Circuit open/ }
    );

    // Assert - hardware was NOT called for the rejected attempt
    assert.equal(mockHwClient.read.mock.callCount(), SensorCoordinator.BREAKER_THRESHOLD);
  });

  it('should recover after cooldown expires (half-open)', async () => {
    // Arrange
    let shouldFail = true;
    mockHwClient.read = mock.fn(async () => {
      if (shouldFail) throw new Error('sensor failed');
      return { temperature: 25 };
    });

    // Shorten cooldown for test speed (must be set before first read creates the breaker)
    const originalCooldown = SensorCoordinator.BREAKER_COOLDOWN;
    SensorCoordinator.BREAKER_COOLDOWN = 10;

    const coord = await createCoordinatorWithSensor();

    // Open the circuit
    for (let i = 0; i < SensorCoordinator.BREAKER_THRESHOLD; i++) {
      await assert.rejects(() => coord.read('test-sensor'));
    }

    // Wait for cooldown
    await new Promise(resolve => setTimeout(resolve, 20));

    // Fix the sensor
    shouldFail = false;
    let circuitCloseEvent = null;
    coord.on('component:circuit-close', (event) => { circuitCloseEvent = event; });

    // Act - should succeed (half-open -> closed)
    const data = await coord.read('test-sensor');

    // Assert
    assert.deepStrictEqual(data, { temperature: 25 });
    assert.ok(circuitCloseEvent);
    assert.equal(circuitCloseEvent.componentId, 'test-sensor');

    // Restore
    SensorCoordinator.BREAKER_COOLDOWN = originalCooldown;
  });

  it('should emit component:error on read failure', async () => {
    // Arrange
    mockHwClient.read = mock.fn(async () => { throw new Error('sensor failed'); });
    const coord = await createCoordinatorWithSensor();
    let errorEvent = null;
    coord.on('component:error', (event) => { errorEvent = event; });

    // Act
    await assert.rejects(() => coord.read('test-sensor'));

    // Assert
    assert.ok(errorEvent);
    assert.equal(errorEvent.componentId, 'test-sensor');
    assert.equal(errorEvent.error.message, 'sensor failed');
  });

  it('should throw for unregistered component', async () => {
    // Arrange
    const coord = await createCoordinatorWithSensor();

    // Act & Assert
    await assert.rejects(
      () => coord.read('nonexistent'),
      { message: /not registered/ }
    );
  });

  it('should clear circuit breakers on shutdown', async () => {
    // Arrange
    mockHwClient.read = mock.fn(async () => { throw new Error('sensor failed'); });
    const coord = await createCoordinatorWithSensor();

    // Cause some failures
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => coord.read('test-sensor'));
    }

    // Act
    await coord.shutdown();
    coordinator = null;

    // Assert
    assert.equal(coord.isInitialized(), false);
  });
});
