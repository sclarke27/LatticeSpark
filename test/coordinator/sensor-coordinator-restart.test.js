#!/usr/bin/env node
/**
 * Unit Tests for Sensor Coordinator - Re-registration after Restart
 *
 * The Python hardware manager auto-respawns with an empty driver registry;
 * the coordinator must replay register/initialize for every known component
 * when the client emits 'restart'.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { SensorCoordinator } from '../../src/coordinator/sensor-coordinator.js';

describe('SensorCoordinator - Restart Re-registration', () => {
  let mockHwClient;
  let coordinator;

  beforeEach(() => {
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

  function waitForEvents(emitter, event, n, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let count = 0;
      const timer = setTimeout(() => {
        emitter.removeListener(event, onEvent);
        reject(new Error(`Timed out waiting for ${n}x ${event} (got ${count})`));
      }, timeoutMs);
      function onEvent() {
        count++;
        if (count >= n) {
          clearTimeout(timer);
          emitter.removeListener(event, onEvent);
          resolve();
        }
      }
      emitter.on(event, onEvent);
    });
  }

  async function createCoordinator(components) {
    coordinator = new SensorCoordinator({ hwClient: mockHwClient, components });
    await coordinator.initialize();
    return coordinator;
  }

  it('replays registration on restart', async () => {
    // Arrange
    const coord = await createCoordinator({
      'sensor-a': { type: 'TypeA', pins: { data: 4 } },
      'sensor-b': { type: 'TypeB', pins: { data: 5 } }
    });
    assert.equal(mockHwClient.register.mock.callCount(), 2);
    assert.equal(mockHwClient.initialize.mock.callCount(), 2);
    const readyPromise = waitForEvents(coord, 'component:ready', 2);

    // Act
    mockHwClient.emit('restart');
    await readyPromise;

    // Assert
    assert.equal(mockHwClient.register.mock.callCount(), 4);
    assert.equal(mockHwClient.initialize.mock.callCount(), 4);
    const replayCall = mockHwClient.register.mock.calls[2];
    assert.equal(replayCall.arguments[0], 'sensor-a');
    assert.equal(replayCall.arguments[1], 'TypeA');
    assert.deepStrictEqual(replayCall.arguments[2].pins, { data: 4 });
  });

  it('resets the circuit breaker after successful re-registration', async () => {
    // Arrange - open the breaker
    mockHwClient.read = mock.fn(async () => { throw new Error('sensor failed'); });
    const coord = await createCoordinator({
      'test-sensor': { type: 'TestSensor', pins: { data: 4 } }
    });
    for (let i = 0; i < SensorCoordinator.BREAKER_THRESHOLD; i++) {
      await assert.rejects(() => coord.read('test-sensor'));
    }
    await assert.rejects(() => coord.read('test-sensor'), { message: /Circuit open/ });

    // Act - hardware recovers, python respawns
    mockHwClient.read = mock.fn(async () => ({ value: 42 }));
    const readyPromise = waitForEvents(coord, 'component:ready', 1);
    mockHwClient.emit('restart');
    await readyPromise;
    // component:ready fires just before the replay loop resets the breaker —
    // yield so the loop's continuation runs before we read
    await new Promise((r) => setTimeout(r, 10));

    // Assert - reads resume immediately (no cooldown wait)
    const data = await coord.read('test-sensor');
    assert.deepStrictEqual(data, { value: 42 });
  });

  it('keeps the circuit breaker open when re-registration fails', async () => {
    // Arrange - open the breaker
    mockHwClient.read = mock.fn(async () => { throw new Error('sensor failed'); });
    const coord = await createCoordinator({
      'test-sensor': { type: 'TestSensor', pins: { data: 4 } }
    });
    for (let i = 0; i < SensorCoordinator.BREAKER_THRESHOLD; i++) {
      await assert.rejects(() => coord.read('test-sensor'));
    }

    // Act - re-registration fails
    mockHwClient.register = mock.fn(async () => { throw new Error('register failed'); });
    const errorPromise = waitForEvents(coord, 'component:error', 1);
    mockHwClient.emit('restart');
    await errorPromise;

    // Assert
    await assert.rejects(() => coord.read('test-sensor'), { message: /Circuit open/ });
  });

  it('aborts a superseded replay when a newer restart arrives', async () => {
    // Arrange
    const coord = await createCoordinator({
      'sensor-a': { type: 'TypeA', pins: { data: 4 } },
      'sensor-b': { type: 'TypeB', pins: { data: 5 } }
    });

    let releaseFirst;
    const firstCallGate = new Promise((resolve) => { releaseFirst = resolve; });
    let postRestartCalls = 0;
    mockHwClient.register = mock.fn(async () => {
      postRestartCalls++;
      if (postRestartCalls === 1) {
        await firstCallGate; // first replay's first register hangs
      }
      return { status: 'ok' };
    });

    // Act - second restart supersedes the first mid-replay
    const readyPromise = waitForEvents(coord, 'component:ready', 3);
    mockHwClient.emit('restart');
    mockHwClient.emit('restart');
    releaseFirst();
    await readyPromise;
    await new Promise((r) => setTimeout(r, 50));

    // Assert - first replay registered only sensor-a (aborted before sensor-b):
    // 1 hanging call + 2 from the second replay = 3, not 4
    assert.equal(mockHwClient.register.mock.callCount(), 3);
  });

  it('is safe to shut down during a replay', async () => {
    // Arrange
    const coord = await createCoordinator({
      'sensor-a': { type: 'TypeA', pins: { data: 4 } }
    });
    let releaseRegister;
    const gate = new Promise((resolve) => { releaseRegister = resolve; });
    mockHwClient.register = mock.fn(async () => {
      await gate;
      return { status: 'ok' };
    });
    let unhandled = null;
    const probe = (reason) => { unhandled = reason; };
    process.on('unhandledRejection', probe);

    try {
      // Act
      mockHwClient.emit('restart');
      await coord.shutdown();
      coordinator = null;
      releaseRegister();
      await new Promise((r) => setTimeout(r, 50));

      // Assert
      assert.equal(unhandled, null);
    } finally {
      process.removeListener('unhandledRejection', probe);
    }
  });
});
