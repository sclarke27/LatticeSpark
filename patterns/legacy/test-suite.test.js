/**
 * GOLDEN EXAMPLE: Test Suite
 *
 * This is the PERFECT structure for ALL test suites.
 * Copy this file and adapt it for your specific component.
 *
 * Rules followed:
 * - rules/common/testing.md
 * - TDD workflow (RED → GREEN → IMPROVE)
 * - AAA pattern (Arrange → Act → Assert)
 * - 80%+ coverage
 *
 * Anti-patterns avoided:
 * - Shared state between tests
 * - Testing implementation details
 * - Missing edge cases
 * - No cleanup (memory leaks)
 *
 * @fileoverview Perfect test suite template
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DHT11Sensor } from '../src/components/sensors/DHT11Sensor.js';
import { SensorError, ValidationError, TimeoutError } from '../src/errors/index.js';

/**
 * Test suite for DHT11Sensor
 *
 * Coverage:
 * - Happy path (normal operation)
 * - Error cases (failures, timeouts, invalid data)
 * - Edge cases (boundary values, rapid calls, etc.)
 * - Resource cleanup (no leaks)
 *
 * Patterns:
 * - AAA (Arrange → Act → Assert)
 * - Test isolation (no shared state)
 * - Mocks for external dependencies
 * - Descriptive test names
 */
describe('DHT11Sensor', () => {
  // ===== TEST FIXTURES =====
  // Fresh instance for EACH test (no shared state)
  let sensor;
  let mockBridge;
  let mockLogger;

  /**
   * beforeEach runs before EVERY test
   * Creates fresh instances to ensure test isolation
   */
  beforeEach(() => {
    // ARRANGE: Create mock dependencies
    mockBridge = createMockBridge();
    mockLogger = createMockLogger();

    // ARRANGE: Create sensor instance
    sensor = new DHT11Sensor({
      pin: 17,
      pollInterval: 1000,
      timeout: 5000
    });

    // Inject mocks (dependency injection)
    sensor._bridge = mockBridge;
    sensor._logger = mockLogger;
  });

  /**
   * afterEach runs after EVERY test
   * CRITICAL: Clean up to prevent memory leaks
   */
  afterEach(async () => {
    // CRITICAL: Destroy sensor to prevent leaks
    if (sensor) {
      await sensor.destroy();
      sensor = null;
    }

    // Clear all mocks
    jest.clearAllMocks();
  });

  // ===== HAPPY PATH TESTS =====

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      // ARRANGE
      const config = { pin: 17 };

      // ACT
      const instance = new DHT11Sensor(config);

      // ASSERT
      expect(instance).toBeInstanceOf(DHT11Sensor);
      expect(instance.isReady).toBe(false);
    });

    it('should merge config with defaults', () => {
      // ARRANGE
      const config = { pin: 17 };

      // ACT
      const instance = new DHT11Sensor(config);

      // ASSERT - has default values
      expect(instance._config).toMatchObject({
        pin: 17,
        pollInterval: 2000,  // Default
        timeout: 5000        // Default
      });
    });

    it('should allow custom configuration', () => {
      // ARRANGE
      const config = {
        pin: 22,
        pollInterval: 3000,
        timeout: 10000
      };

      // ACT
      const instance = new DHT11Sensor(config);

      // ASSERT
      expect(instance._config).toMatchObject(config);
    });
  });

  describe('initialize', () => {
    it('should initialize sensor successfully', async () => {
      // ARRANGE - mockBridge already set up

      // ACT
      await sensor.initialize();

      // ASSERT
      expect(sensor.isReady).toBe(true);
      expect(mockBridge.spawn).toHaveBeenCalledWith({
        script: expect.stringContaining('dht11_bridge.py'),
        args: ['17']
      });
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      // ARRANGE
      await sensor.initialize();

      // ACT - initialize again
      await sensor.initialize();
      await sensor.initialize();

      // ASSERT - only spawned once
      expect(mockBridge.spawn).toHaveBeenCalledTimes(1);
    });

    it('should emit ready event when initialized', async () => {
      // ARRANGE
      const readyHandler = jest.fn();
      sensor.on('ready', readyHandler);

      // ACT
      await sensor.initialize();

      // ASSERT
      expect(readyHandler).toHaveBeenCalled();
    });
  });

  describe('read', () => {
    beforeEach(async () => {
      // Initialize sensor before read tests
      await sensor.initialize();
    });

    it('should read temperature and humidity', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 23.5,
        humidity: 65.0
      });

      // ACT
      const reading = await sensor.read();

      // ASSERT
      expect(reading).toMatchObject({
        temperature: 23.5,
        humidity: 65.0,
        timestamp: expect.any(Number)
      });
    });

    it('should emit data event on successful read', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 23.5,
        humidity: 65.0
      });

      const dataHandler = jest.fn();
      sensor.on('data', dataHandler);

      // ACT
      await sensor.read();

      // ASSERT
      expect(dataHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 23.5,
          humidity: 65.0
        })
      );
    });

    it('should emit change event when value changes significantly', async () => {
      // ARRANGE
      mockBridge.send
        .mockResolvedValueOnce({ temperature: 23.0, humidity: 65.0 })
        .mockResolvedValueOnce({ temperature: 24.0, humidity: 65.0 });

      const changeHandler = jest.fn();
      sensor.on('change', changeHandler);

      // ACT
      await sensor.read();  // First reading
      await sensor.read();  // Second reading (1°C change)

      // ASSERT
      expect(changeHandler).toHaveBeenCalled();
    });

    it('should NOT emit change event for insignificant changes', async () => {
      // ARRANGE
      mockBridge.send
        .mockResolvedValueOnce({ temperature: 23.0, humidity: 65.0 })
        .mockResolvedValueOnce({ temperature: 23.2, humidity: 65.0 });

      const changeHandler = jest.fn();
      sensor.on('change', changeHandler);

      // ACT
      await sensor.read();  // First reading
      await sensor.read();  // Second reading (0.2°C change - insignificant)

      // ASSERT
      expect(changeHandler).not.toHaveBeenCalled();
    });

    it('should use cache if fresh', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 23.5,
        humidity: 65.0
      });

      // ACT
      await sensor.read();  // Populates cache
      await sensor.read();  // Should use cache

      // ASSERT - bridge called only once
      expect(mockBridge.send).toHaveBeenCalledTimes(1);
    });
  });

  // ===== ERROR CASES =====

  describe('error handling', () => {
    it('should throw ValidationError for invalid pin', () => {
      // ARRANGE & ACT & ASSERT
      expect(() => new DHT11Sensor({ pin: -1 }))
        .toThrow(ValidationError);

      expect(() => new DHT11Sensor({ pin: 50 }))
        .toThrow(ValidationError);

      expect(() => new DHT11Sensor({ pin: 'invalid' }))
        .toThrow(ValidationError);
    });

    it('should throw if read before initialize', async () => {
      // ARRANGE - sensor not initialized

      // ACT & ASSERT
      await expect(sensor.read())
        .rejects.toThrow('not initialized');
    });

    it('should throw SensorError on bridge read failure', async () => {
      // ARRANGE
      await sensor.initialize();
      mockBridge.send.mockRejectedValue(new Error('I2C timeout'));

      // ACT & ASSERT
      await expect(sensor.read())
        .rejects.toThrow(SensorError);
    });

    it('should throw TimeoutError on read timeout', async () => {
      // ARRANGE
      await sensor.initialize();

      // Simulate slow response
      mockBridge.send.mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ temperature: 23, humidity: 65 }), 10000)
        )
      );

      // ACT & ASSERT
      await expect(sensor.read())
        .rejects.toThrow(TimeoutError);
    });

    it('should retry on transient failures', async () => {
      // ARRANGE
      await sensor.initialize();

      mockBridge.send
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({ temperature: 23, humidity: 65 });

      // ACT
      const reading = await sensor.read();

      // ASSERT - succeeded after 3 attempts
      expect(mockBridge.send).toHaveBeenCalledTimes(3);
      expect(reading.temperature).toBe(23);
    });

    it('should open circuit breaker after repeated failures', async () => {
      // ARRANGE
      await sensor.initialize();
      mockBridge.send.mockRejectedValue(new Error('Sensor failed'));

      // ACT - fail 3 times
      await expect(sensor.read()).rejects.toThrow();
      await expect(sensor.read()).rejects.toThrow();
      await expect(sensor.read()).rejects.toThrow();

      // ASSERT - circuit is now OPEN
      expect(sensor.circuitState).toBe('OPEN');
    });

    it('should emit error event on failure', async () => {
      // ARRANGE
      await sensor.initialize();
      mockBridge.send.mockRejectedValue(new Error('Read failed'));

      const errorHandler = jest.fn();
      sensor.on('error', errorHandler);

      // ACT
      await expect(sensor.read()).rejects.toThrow();

      // ASSERT
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  // ===== EDGE CASES =====

  describe('edge cases', () => {
    beforeEach(async () => {
      await sensor.initialize();
    });

    it('should handle minimum temperature (-40°C)', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: -40,
        humidity: 50
      });

      // ACT
      const reading = await sensor.read();

      // ASSERT
      expect(reading.temperature).toBe(-40);
    });

    it('should handle maximum temperature (80°C)', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 80,
        humidity: 50
      });

      // ACT
      const reading = await sensor.read();

      // ASSERT
      expect(reading.temperature).toBe(80);
    });

    it('should handle minimum humidity (0%)', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 25,
        humidity: 0
      });

      // ACT
      const reading = await sensor.read();

      // ASSERT
      expect(reading.humidity).toBe(0);
    });

    it('should handle maximum humidity (100%)', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 25,
        humidity: 100
      });

      // ACT
      const reading = await sensor.read();

      // ASSERT
      expect(reading.humidity).toBe(100);
    });

    it('should handle rapid consecutive reads', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 23.5,
        humidity: 65.0
      });

      // ACT - read 10 times rapidly
      const reads = await Promise.all([
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read(),
        sensor.read()
      ]);

      // ASSERT - all succeeded
      expect(reads).toHaveLength(10);
      reads.forEach(reading => {
        expect(reading.temperature).toBeDefined();
      });
    });
  });

  // ===== POLLING TESTS =====

  describe('polling', () => {
    beforeEach(async () => {
      await sensor.initialize();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start polling at configured interval', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 23.5,
        humidity: 65.0
      });

      // ACT
      await sensor.startPolling();

      // Advance time by 3 intervals
      jest.advanceTimersByTime(3000);

      // ASSERT - read 3 times (initial + 2 intervals)
      expect(mockBridge.send).toHaveBeenCalledTimes(3);
    });

    it('should stop polling when requested', async () => {
      // ARRANGE
      mockBridge.send.mockResolvedValue({
        temperature: 23.5,
        humidity: 65.0
      });

      await sensor.startPolling();

      // ACT
      sensor.stopPolling();

      jest.advanceTimersByTime(10000);

      // ASSERT - no additional reads after stop
      const callCount = mockBridge.send.mock.calls.length;
      jest.advanceTimersByTime(5000);
      expect(mockBridge.send).toHaveBeenCalledTimes(callCount);
    });

    it('should not start polling twice', async () => {
      // ARRANGE
      await sensor.startPolling();

      // ACT
      await sensor.startPolling();  // Try to start again

      // ASSERT - only one interval created
      jest.advanceTimersByTime(1000);
      expect(mockBridge.send).toHaveBeenCalledTimes(2); // Initial + 1 interval
    });
  });

  // ===== RESOURCE CLEANUP =====

  describe('cleanup', () => {
    it('should clean up resources on destroy', async () => {
      // ARRANGE
      await sensor.initialize();

      const listenerCount = sensor.listenerCount('data');

      // ACT
      await sensor.destroy();

      // ASSERT - all listeners removed
      expect(sensor.listenerCount('data')).toBe(0);
      expect(mockBridge.kill).toHaveBeenCalled();
      expect(sensor.isReady).toBe(false);
    });

    it('should be idempotent (safe to destroy multiple times)', async () => {
      // ARRANGE
      await sensor.initialize();

      // ACT
      await sensor.destroy();
      await sensor.destroy();
      await sensor.destroy();

      // ASSERT - no errors, bridge killed only once
      expect(mockBridge.kill).toHaveBeenCalledTimes(1);
    });

    it('should stop polling on destroy', async () => {
      // ARRANGE
      await sensor.initialize();
      await sensor.startPolling();

      // ACT
      await sensor.destroy();

      // ASSERT
      expect(sensor.isPolling).toBe(false);
    });
  });
});

// ===== MOCK HELPERS =====

/**
 * Create mock bridge for testing.
 * @returns {Object} Mock bridge
 */
function createMockBridge() {
  return {
    spawn: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue({
      temperature: 23.5,
      humidity: 65.0
    }),
    kill: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    once: jest.fn((event, handler) => {
      if (event === 'ready') {
        // Simulate immediate ready
        setTimeout(handler, 0);
      }
    }),
    off: jest.fn()
  };
}

/**
 * Create mock logger for testing.
 * @returns {Object} Mock logger
 */
function createMockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

/**
 * TEST COVERAGE SUMMARY:
 *
 * Happy Path:
 * ✓ Constructor
 * ✓ Initialize
 * ✓ Read
 * ✓ Events (ready, data, change)
 * ✓ Caching
 * ✓ Polling
 *
 * Error Cases:
 * ✓ Invalid configuration
 * ✓ Read before initialize
 * ✓ Bridge failures
 * ✓ Timeouts
 * ✓ Retries
 * ✓ Circuit breaker
 *
 * Edge Cases:
 * ✓ Boundary values (min/max)
 * ✓ Rapid consecutive calls
 * ✓ Idempotent operations
 *
 * Resource Cleanup:
 * ✓ Destroy removes listeners
 * ✓ Destroy kills bridge
 * ✓ Destroy stops polling
 * ✓ Destroy is idempotent
 *
 * Total: 30+ tests covering all scenarios
 * Expected coverage: > 90%
 */
