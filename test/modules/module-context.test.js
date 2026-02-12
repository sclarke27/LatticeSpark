#!/usr/bin/env node
/**
 * Unit Tests for ModuleContext
 *
 * Tests sensor data access, subscriptions, state persistence, and logging.
 * All external dependencies (Socket.IO, filesystem) are mocked.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ModuleContext } from '../../src/modules/module-context.js';

describe('ModuleContext', () => {
  let ctx;
  let mockLatestData;
  let mockComponents;
  let mockModuleIo;
  let mockSensorSocket;

  beforeEach(() => {
    mockLatestData = new Map([
      ['temp-sensor', { temperature: 25, humidity: 60, timestamp: 100 }],
    ]);
    mockComponents = [
      { id: 'temp-sensor', type: 'AHT10' },
      { id: 'buzzer', type: 'Buzzer' },
    ];
    mockModuleIo = { emit: mock.fn() };
    mockSensorSocket = { connected: true, emit: mock.fn() };

    ctx = new ModuleContext({
      moduleId: 'test-module',
      sensorSocket: mockSensorSocket,
      latestData: mockLatestData,
      components: mockComponents,
      moduleIo: mockModuleIo,
      stateDir: '/tmp/latticespark-test/state',
    });
  });

  afterEach(() => {
    ctx._destroy();
  });

  // ─── read() ────────────────────────────────────────────────────────

  describe('read()', () => {
    it('should return shallow copy of cached data', () => {
      // Act
      const data = ctx.read('temp-sensor');

      // Assert
      assert.deepStrictEqual(data, { temperature: 25, humidity: 60, timestamp: 100 });
    });

    it('should return null for unknown component', () => {
      // Act
      const data = ctx.read('nonexistent');

      // Assert
      assert.equal(data, null);
    });

    it('should not mutate the shared cache', () => {
      // Act
      const data = ctx.read('temp-sensor');
      data.temperature = 999;

      // Assert - original cache is untouched
      const fresh = ctx.read('temp-sensor');
      assert.equal(fresh.temperature, 25);
    });
  });

  // ─── onData() / _notifyData() ─────────────────────────────────────

  describe('onData()', () => {
    it('should subscribe and receive notifications', () => {
      // Arrange
      const received = [];
      ctx.onData('temp-sensor', (id, data) => received.push({ id, data }));

      // Act
      ctx._notifyData('temp-sensor', { temperature: 30 });

      // Assert
      assert.equal(received.length, 1);
      assert.equal(received[0].id, 'temp-sensor');
      assert.deepStrictEqual(received[0].data, { temperature: 30 });
    });

    it('should return a working unsubscribe function', () => {
      // Arrange
      const received = [];
      const unsub = ctx.onData('temp-sensor', (id, data) => received.push(data));

      // Act
      unsub();
      ctx._notifyData('temp-sensor', { temperature: 30 });

      // Assert
      assert.equal(received.length, 0);
    });

    it('should notify multiple subscribers', () => {
      // Arrange
      const calls1 = [];
      const calls2 = [];
      ctx.onData('temp-sensor', (id, data) => calls1.push(data));
      ctx.onData('temp-sensor', (id, data) => calls2.push(data));

      // Act
      ctx._notifyData('temp-sensor', { temperature: 30 });

      // Assert
      assert.equal(calls1.length, 1);
      assert.equal(calls2.length, 1);
    });
  });

  describe('_notifyData()', () => {
    it('should call registered callbacks', () => {
      // Arrange
      const cb = mock.fn();
      ctx.onData('temp-sensor', cb);

      // Act
      ctx._notifyData('temp-sensor', { temperature: 30 });

      // Assert
      assert.equal(cb.mock.callCount(), 1);
      assert.deepStrictEqual(cb.mock.calls[0].arguments, ['temp-sensor', { temperature: 30 }]);
    });

    it('should swallow callback errors without propagating', () => {
      // Arrange
      const badCb = mock.fn(() => { throw new Error('callback boom'); });
      const goodCb = mock.fn();
      ctx.onData('temp-sensor', badCb);
      ctx.onData('temp-sensor', goodCb);

      // Act - should not throw
      assert.doesNotThrow(() => ctx._notifyData('temp-sensor', { temperature: 30 }));

      // Assert - both callbacks were called, error was swallowed
      assert.equal(badCb.mock.callCount(), 1);
      assert.equal(goodCb.mock.callCount(), 1);
    });

    it('should no-op for components with no subscribers', () => {
      // Act & Assert - should not throw
      assert.doesNotThrow(() => ctx._notifyData('nonexistent', { value: 1 }));
    });
  });

  // ─── getComponentConfig() ──────────────────────────────────────────

  describe('getComponentConfig()', () => {
    it('should find component by ID', () => {
      // Act
      const config = ctx.getComponentConfig('temp-sensor');

      // Assert
      assert.deepStrictEqual(config, { id: 'temp-sensor', type: 'AHT10' });
    });

    it('should return null for unknown component', () => {
      // Act
      const config = ctx.getComponentConfig('nonexistent');

      // Assert
      assert.equal(config, null);
    });
  });

  // ─── emitState() / getLastEmittedState() ───────────────────────────

  describe('emitState()', () => {
    it('should emit on moduleIo with moduleId and state', () => {
      // Arrange
      const state = { active: true, threshold: 30 };

      // Act
      ctx.emitState(state);

      // Assert
      assert.equal(mockModuleIo.emit.mock.callCount(), 1);
      const [event, payload] = mockModuleIo.emit.mock.calls[0].arguments;
      assert.equal(event, 'module:state');
      assert.equal(payload.moduleId, 'test-module');
      assert.deepStrictEqual(payload.state, state);
    });

    it('should store snapshot for late-connecting clients', () => {
      // Arrange
      const state = { active: true };

      // Act
      ctx.emitState(state);

      // Assert
      assert.deepStrictEqual(ctx.getLastEmittedState(), { active: true });
    });
  });

  describe('getLastEmittedState()', () => {
    it('should return null before any emit', () => {
      // Act & Assert
      assert.equal(ctx.getLastEmittedState(), null);
    });

    it('should return state after emit', () => {
      // Arrange
      ctx.emitState({ count: 42 });

      // Act
      const state = ctx.getLastEmittedState();

      // Assert
      assert.deepStrictEqual(state, { count: 42 });
    });
  });

  // ─── _destroy() ───────────────────────────────────────────────────

  describe('_destroy()', () => {
    it('should clear all subscriptions', () => {
      // Arrange
      const cb = mock.fn();
      ctx.onData('temp-sensor', cb);

      // Act
      ctx._destroy();
      ctx._notifyData('temp-sensor', { temperature: 30 });

      // Assert - callback not called after destroy
      assert.equal(cb.mock.callCount(), 0);
    });
  });

  // ─── log / warn / error ────────────────────────────────────────────

  describe('logging', () => {
    it('should output to console with module prefix', () => {
      // Arrange
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;

      const logCalls = [];
      const warnCalls = [];
      const errorCalls = [];

      console.log = (...args) => logCalls.push(args.join(' '));
      console.warn = (...args) => warnCalls.push(args.join(' '));
      console.error = (...args) => errorCalls.push(args.join(' '));

      try {
        // Act
        ctx.log('hello');
        ctx.warn('be careful');
        ctx.error('something broke');

        // Assert
        assert.equal(logCalls.length, 1);
        assert.ok(logCalls[0].includes('[module:test-module]'));
        assert.ok(logCalls[0].includes('hello'));

        assert.equal(warnCalls.length, 1);
        assert.ok(warnCalls[0].includes('[module:test-module]'));
        assert.ok(warnCalls[0].includes('be careful'));

        assert.equal(errorCalls.length, 1);
        assert.ok(errorCalls[0].includes('[module:test-module]'));
        assert.ok(errorCalls[0].includes('something broke'));
      } finally {
        // Restore
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }
    });
  });
});
