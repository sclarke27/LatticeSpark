/**
 * GOLDEN EXAMPLE: Sensor Component
 *
 * This is the PERFECT structure for ALL sensor components.
 * Copy this file and adapt it for your specific sensor.
 *
 * Rules followed:
 * - rules/javascript/component-structure.md
 * - rules/javascript/async-await.md
 * - rules/common/error-handling.md
 *
 * Anti-patterns avoided:
 * - anti-patterns/async-mistakes.md
 * - anti-patterns/memory-leaks.md
 * - anti-patterns/security-issues.md
 *
 * @fileoverview Perfect sensor component template
 * @module components/sensors/DHT11Sensor
 */

import { EventEmitter } from 'events';
import { BridgeManager } from '../../core/BridgeManager.js';
import { Logger } from '../../utils/logger.js';
import { SensorError, ValidationError, TimeoutError } from '../../errors/index.js';

// ===== CONSTANTS =====
// Define all constants at module level
const DEFAULT_CONFIG = {
  pin: 17,
  pollInterval: 2000,     // 2 seconds
  timeout: 5000,          // 5 seconds
  retryAttempts: 3,
  cache: {
    enabled: true,
    ttl: 1000            // 1 second
  }
};

// Valid pin range for Raspberry Pi
const MIN_PIN = 0;
const MAX_PIN = 27;

/**
 * DHT11 Temperature and Humidity Sensor
 *
 * Features:
 * - Automatic error recovery with circuit breaker
 * - Configurable polling with change detection
 * - Smart caching to reduce I2C bus contention
 * - Comprehensive error handling
 * - Memory leak prevention
 *
 * Events:
 * - 'ready': Emitted when sensor is initialized and ready
 * - 'data': Emitted on every successful read
 * - 'change': Emitted when value changes significantly
 * - 'error': Emitted when an error occurs
 *
 * @extends EventEmitter
 *
 * @example
 * const sensor = new DHT11Sensor({ pin: 17 });
 *
 * sensor.on('ready', () => console.log('Sensor ready'));
 * sensor.on('change', (data) => console.log('Temp changed:', data));
 *
 * await sensor.initialize();
 * const reading = await sensor.read();
 * console.log(`${reading.temperature}°C, ${reading.humidity}%`);
 *
 * await sensor.destroy();
 */
export class DHT11Sensor extends EventEmitter {
  // ===== PRIVATE FIELDS =====
  // CRITICAL: Always use # prefix for true privacy
  #bridge = null;
  #config = {};
  #isInitialized = false;
  #logger;

  // Polling state
  #pollInterval = null;
  #isPolling = false;

  // Cache state
  #cache = null;
  #cacheTime = 0;

  // Last reading for change detection
  #lastReading = null;

  // Circuit breaker state
  #circuitState = 'CLOSED';  // CLOSED | OPEN | HALF_OPEN
  #failureCount = 0;
  #lastFailureTime = 0;

  /**
   * Create a DHT11 sensor instance.
   *
   * IMPORTANT: Constructor is synchronous. Call initialize() before use.
   *
   * @param {Object} config - Sensor configuration
   * @param {number} config.pin - GPIO pin number (0-27)
   * @param {number} [config.pollInterval=2000] - Polling interval in ms
   * @param {number} [config.timeout=5000] - Read timeout in ms
   * @param {number} [config.retryAttempts=3] - Number of retry attempts
   * @param {Object} [config.cache] - Cache configuration
   * @param {boolean} [config.cache.enabled=true] - Enable caching
   * @param {number} [config.cache.ttl=1000] - Cache TTL in ms
   *
   * @throws {ValidationError} If configuration is invalid
   */
  constructor(config = {}) {
    super(); // CRITICAL: Call parent constructor first

    // Validate config before storing
    this.#validateConfig(config);

    // Merge with defaults
    this.#config = {
      ...DEFAULT_CONFIG,
      ...config,
      cache: {
        ...DEFAULT_CONFIG.cache,
        ...(config.cache || {})
      }
    };

    // Create logger with component name
    this.#logger = Logger.create('DHT11Sensor');

    this.#logger.debug('Sensor instance created', {
      pin: this.#config.pin
    });
  }

  // ===== PUBLIC INTERFACE =====

  /**
   * Initialize the sensor.
   *
   * CRITICAL: This method is IDEMPOTENT - safe to call multiple times.
   *
   * @returns {Promise<void>}
   * @throws {SensorError} If initialization fails after retries
   */
  async initialize() {
    // IDEMPOTENT: Safe to call multiple times
    if (this.#isInitialized) {
      this.#logger.debug('Already initialized, skipping');
      return;
    }

    this.#logger.info('Initializing sensor', {
      pin: this.#config.pin
    });

    try {
      // Spawn Python bridge process
      this.#bridge = await BridgeManager.spawn({
        script: 'bridges/sensors/dht11_bridge.py',
        args: [this.#config.pin.toString()]
      });

      // Set up event handlers
      this.#setupEventHandlers();

      // Wait for ready signal with timeout
      await this.#waitForReady();

      this.#isInitialized = true;
      this.#circuitState = 'CLOSED';
      this.#failureCount = 0;

      this.#logger.info('Sensor initialized successfully');

      // Emit ready event
      this.emit('ready');

    } catch (error) {
      this.#logger.error('Initialization failed', {
        error: error.message,
        stack: error.stack
      });

      // Clean up on failure
      await this.#cleanup();

      throw new SensorError('Failed to initialize sensor', {
        sensor: 'dht11',
        pin: this.#config.pin,
        cause: error
      });
    }
  }

  /**
   * Read current temperature and humidity.
   *
   * Uses circuit breaker pattern to prevent cascading failures.
   * Returns cached value if cache is fresh and enabled.
   *
   * @returns {Promise<SensorReading>} Sensor reading
   * @throws {Error} If sensor not initialized
   * @throws {SensorError} If read fails
   * @throws {TimeoutError} If read times out
   *
   * @typedef {Object} SensorReading
   * @property {number} temperature - Temperature in Celsius
   * @property {number} humidity - Relative humidity percentage
   * @property {number} timestamp - Unix timestamp in milliseconds
   */
  async read() {
    // Guard: Ensure initialized
    this.#ensureInitialized();

    // Check circuit breaker
    if (this.#circuitState === 'OPEN') {
      const timeSinceFailure = Date.now() - this.#lastFailureTime;
      const resetTimeout = 30000; // 30 seconds

      if (timeSinceFailure > resetTimeout) {
        this.#circuitState = 'HALF_OPEN';
        this.#logger.info('Circuit breaker entering HALF_OPEN state');
      } else {
        // Return cached value if available
        if (this.#cache) {
          this.#logger.warn('Circuit OPEN, returning cached value');
          return this.#cache;
        }

        throw new SensorError('Circuit breaker is OPEN', {
          sensor: 'dht11',
          state: 'OPEN',
          retryAfter: resetTimeout - timeSinceFailure
        });
      }
    }

    // Check cache
    if (this.#config.cache.enabled && this.#isCacheFresh()) {
      this.#logger.debug('Returning cached value');
      return this.#cache;
    }

    try {
      // Read with timeout
      const reading = await this.#readWithTimeout();

      // Success in HALF_OPEN → CLOSED
      if (this.#circuitState === 'HALF_OPEN') {
        this.#circuitState = 'CLOSED';
        this.#failureCount = 0;
        this.#logger.info('Circuit breaker CLOSED');
      }

      // Update cache
      if (this.#config.cache.enabled) {
        this.#cache = reading;
        this.#cacheTime = Date.now();
      }

      // Emit data event
      this.emit('data', reading);

      // Check for significant change
      if (this.#hasSignificantChange(reading)) {
        this.emit('change', reading);
        this.#lastReading = reading;
      }

      return reading;

    } catch (error) {
      // Update circuit breaker
      this.#failureCount++;
      this.#lastFailureTime = Date.now();

      const failureThreshold = 3;
      if (this.#failureCount >= failureThreshold) {
        this.#circuitState = 'OPEN';
        this.#logger.error('Circuit breaker OPEN', {
          failures: this.#failureCount
        });
      }

      throw error;
    }
  }

  /**
   * Start polling the sensor at configured interval.
   *
   * @returns {Promise<void>}
   * @throws {Error} If sensor not initialized or already polling
   */
  async startPolling() {
    this.#ensureInitialized();

    if (this.#isPolling) {
      this.#logger.warn('Already polling, ignoring start request');
      return;
    }

    this.#logger.info('Starting polling', {
      interval: this.#config.pollInterval
    });

    this.#isPolling = true;

    // Clear any existing interval (safety)
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
    }

    // Start new interval
    this.#pollInterval = setInterval(() => {
      // Wrap in promise handler to catch errors
      this.read().catch(error => {
        this.#logger.error('Poll read failed', {
          error: error.message
        });
        this.emit('error', error);
      });
    }, this.#config.pollInterval);

    // Do initial read
    try {
      await this.read();
    } catch (error) {
      this.#logger.error('Initial poll read failed', error);
      this.emit('error', error);
    }
  }

  /**
   * Stop polling the sensor.
   *
   * IMPORTANT: Always call this in destroy() to prevent leaks.
   */
  stopPolling() {
    if (!this.#isPolling) {
      return;
    }

    this.#logger.info('Stopping polling');

    // CRITICAL: Clear interval to prevent leak
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = null;
    }

    this.#isPolling = false;
  }

  /**
   * Destroy the sensor and clean up all resources.
   *
   * CRITICAL: This method is IDEMPOTENT - safe to call multiple times.
   * CRITICAL: Always call this when done to prevent memory leaks.
   *
   * @returns {Promise<void>}
   */
  async destroy() {
    // IDEMPOTENT: Safe to call multiple times
    if (!this.#isInitialized) {
      this.#logger.debug('Already destroyed, skipping');
      return;
    }

    this.#logger.info('Destroying sensor');

    // Stop polling first
    this.stopPolling();

    // Clean up resources
    await this.#cleanup();

    this.#logger.info('Sensor destroyed');
  }

  // ===== GETTERS (read-only state) =====

  /**
   * Check if sensor is initialized and ready.
   * @returns {boolean}
   */
  get isReady() {
    return this.#isInitialized;
  }

  /**
   * Check if sensor is currently polling.
   * @returns {boolean}
   */
  get isPolling() {
    return this.#isPolling;
  }

  /**
   * Get current circuit breaker state.
   * @returns {string} 'CLOSED' | 'OPEN' | 'HALF_OPEN'
   */
  get circuitState() {
    return this.#circuitState;
  }

  /**
   * Get last successful reading (may be null).
   * @returns {SensorReading|null}
   */
  get lastReading() {
    return this.#lastReading;
  }

  // ===== PRIVATE METHODS =====

  /**
   * Validate configuration object.
   *
   * @param {Object} config - Configuration to validate
   * @throws {ValidationError} If configuration is invalid
   * @private
   */
  #validateConfig(config) {
    // Pin is required
    if (config.pin === undefined || config.pin === null) {
      throw new ValidationError('Pin is required', {
        field: 'pin',
        value: config.pin
      });
    }

    // Pin must be a number
    if (typeof config.pin !== 'number') {
      throw new ValidationError('Pin must be a number', {
        field: 'pin',
        value: config.pin,
        expectedType: 'number',
        actualType: typeof config.pin
      });
    }

    // Pin must be an integer
    if (!Number.isInteger(config.pin)) {
      throw new ValidationError('Pin must be an integer', {
        field: 'pin',
        value: config.pin
      });
    }

    // Pin must be in valid range
    if (config.pin < MIN_PIN || config.pin > MAX_PIN) {
      throw new ValidationError('Pin out of range', {
        field: 'pin',
        value: config.pin,
        constraint: `${MIN_PIN}-${MAX_PIN}`
      });
    }

    // Validate optional fields if present
    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number' || config.timeout < 0) {
        throw new ValidationError('Timeout must be a positive number', {
          field: 'timeout',
          value: config.timeout
        });
      }
    }

    if (config.pollInterval !== undefined) {
      if (typeof config.pollInterval !== 'number' || config.pollInterval < 100) {
        throw new ValidationError('Poll interval must be >= 100ms', {
          field: 'pollInterval',
          value: config.pollInterval,
          constraint: '>= 100'
        });
      }
    }
  }

  /**
   * Ensure sensor is initialized before operations.
   *
   * @throws {Error} If sensor not initialized
   * @private
   */
  #ensureInitialized() {
    if (!this.#isInitialized) {
      throw new Error('Sensor not initialized. Call initialize() first.');
    }
  }

  /**
   * Set up event handlers for bridge process.
   *
   * CRITICAL: Handlers are instance methods to allow removal.
   *
   * @private
   */
  #setupEventHandlers() {
    // CRITICAL: Use bound methods so we can remove them later
    this.#bridge.on('data', this.#handleBridgeData.bind(this));
    this.#bridge.on('error', this.#handleBridgeError.bind(this));
    this.#bridge.on('exit', this.#handleBridgeExit.bind(this));
  }

  /**
   * Handle data from bridge.
   *
   * @param {Object} data - Data from bridge
   * @private
   */
  #handleBridgeData(data) {
    this.#logger.debug('Bridge data received', data);
    // Could emit as event or cache
  }

  /**
   * Handle error from bridge.
   *
   * @param {Error} error - Error from bridge
   * @private
   */
  #handleBridgeError(error) {
    this.#logger.error('Bridge error', {
      error: error.message
    });
    this.emit('error', error);
  }

  /**
   * Handle bridge process exit.
   *
   * @param {number} code - Exit code
   * @private
   */
  #handleBridgeExit(code) {
    this.#logger.warn('Bridge process exited', { code });

    if (code !== 0) {
      const error = new SensorError('Bridge process crashed', {
        sensor: 'dht11',
        exitCode: code
      });
      this.emit('error', error);
    }
  }

  /**
   * Wait for ready signal from bridge with timeout.
   *
   * @returns {Promise<void>}
   * @throws {TimeoutError} If ready signal not received
   * @private
   */
  async #waitForReady() {
    const timeout = this.#config.timeout;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        // Clean up listener
        this.#bridge.off('ready', readyHandler);

        reject(new TimeoutError('Bridge initialization timeout', {
          timeout,
          sensor: 'dht11'
        }));
      }, timeout);

      // Ready handler
      const readyHandler = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      // Wait for ready event
      this.#bridge.once('ready', readyHandler);
    });
  }

  /**
   * Read sensor with timeout and retries.
   *
   * @returns {Promise<SensorReading>}
   * @throws {TimeoutError} If read times out
   * @throws {SensorError} If read fails after retries
   * @private
   */
  async #readWithTimeout() {
    const maxAttempts = this.#config.retryAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Read with timeout using Promise.race
        const reading = await Promise.race([
          this.#doRead(),
          this.#createTimeout(this.#config.timeout)
        ]);

        return reading;

      } catch (error) {
        // Last attempt - throw
        if (attempt === maxAttempts) {
          throw error;
        }

        // Log retry
        const delay = Math.pow(2, attempt) * 100; // Exponential backoff
        this.#logger.warn('Read failed, retrying...', {
          attempt,
          maxAttempts,
          delayMs: delay,
          error: error.message
        });

        // Wait before retry
        await this.#sleep(delay);
      }
    }
  }

  /**
   * Perform actual sensor read via bridge.
   *
   * @returns {Promise<SensorReading>}
   * @throws {SensorError} If read fails
   * @private
   */
  async #doRead() {
    try {
      const response = await this.#bridge.send({
        method: 'read'
      });

      // Validate response
      this.#validateReading(response);

      return {
        temperature: response.temperature,
        humidity: response.humidity,
        timestamp: Date.now()
      };

    } catch (error) {
      throw new SensorError('Read failed', {
        sensor: 'dht11',
        cause: error
      });
    }
  }

  /**
   * Validate sensor reading.
   *
   * @param {Object} reading - Reading to validate
   * @throws {ValidationError} If reading is invalid
   * @private
   */
  #validateReading(reading) {
    if (typeof reading.temperature !== 'number') {
      throw new ValidationError('Invalid temperature', {
        field: 'temperature',
        value: reading.temperature
      });
    }

    if (typeof reading.humidity !== 'number') {
      throw new ValidationError('Invalid humidity', {
        field: 'humidity',
        value: reading.humidity
      });
    }

    // Range checks
    if (reading.temperature < -40 || reading.temperature > 80) {
      throw new ValidationError('Temperature out of range', {
        field: 'temperature',
        value: reading.temperature,
        constraint: '-40 to 80'
      });
    }

    if (reading.humidity < 0 || reading.humidity > 100) {
      throw new ValidationError('Humidity out of range', {
        field: 'humidity',
        value: reading.humidity,
        constraint: '0 to 100'
      });
    }
  }

  /**
   * Check if cache is still fresh.
   *
   * @returns {boolean}
   * @private
   */
  #isCacheFresh() {
    if (!this.#cache) return false;

    const age = Date.now() - this.#cacheTime;
    return age < this.#config.cache.ttl;
  }

  /**
   * Check if reading has changed significantly.
   *
   * @param {SensorReading} reading - New reading
   * @returns {boolean}
   * @private
   */
  #hasSignificantChange(reading) {
    if (!this.#lastReading) return true;

    const tempDelta = Math.abs(reading.temperature - this.#lastReading.temperature);
    const humidityDelta = Math.abs(reading.humidity - this.#lastReading.humidity);

    // Consider significant if > 0.5°C or > 2% humidity change
    return tempDelta > 0.5 || humidityDelta > 2;
  }

  /**
   * Create a timeout promise.
   *
   * @param {number} ms - Timeout in milliseconds
   * @returns {Promise<never>}
   * @private
   */
  #createTimeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError('Operation timeout', {
          timeout: ms
        }));
      }, ms);
    });
  }

  /**
   * Sleep for specified milliseconds.
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   * @private
   */
  #sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up all resources.
   *
   * CRITICAL: Must remove all listeners to prevent memory leaks.
   * CRITICAL: Must kill bridge process to prevent zombie processes.
   *
   * @returns {Promise<void>}
   * @private
   */
  async #cleanup() {
    // CRITICAL: Remove ALL event listeners to prevent memory leak
    this.removeAllListeners();

    // CRITICAL: Kill bridge process to prevent zombie
    if (this.#bridge) {
      try {
        await this.#bridge.kill();
      } catch (error) {
        this.#logger.error('Bridge kill failed', error);
      }
      this.#bridge = null;
    }

    // Clear cache
    this.#cache = null;
    this.#cacheTime = 0;
    this.#lastReading = null;

    // Reset state
    this.#isInitialized = false;
    this.#circuitState = 'CLOSED';
    this.#failureCount = 0;
  }
}

// ===== MODULE EXPORTS =====
export default DHT11Sensor;

/**
 * USAGE EXAMPLES:
 *
 * // Basic usage
 * const sensor = new DHT11Sensor({ pin: 17 });
 * await sensor.initialize();
 * const reading = await sensor.read();
 * console.log(reading);
 * await sensor.destroy();
 *
 * // With event listeners
 * sensor.on('ready', () => console.log('Ready!'));
 * sensor.on('change', (data) => {
 *   console.log(`Temperature: ${data.temperature}°C`);
 * });
 * sensor.on('error', (error) => console.error(error));
 *
 * // With polling
 * await sensor.initialize();
 * await sensor.startPolling(); // Reads every 2 seconds
 * // ... later ...
 * sensor.stopPolling();
 * await sensor.destroy();
 *
 * // Custom configuration
 * const sensor = new DHT11Sensor({
 *   pin: 17,
 *   pollInterval: 5000,  // 5 seconds
 *   timeout: 3000,       // 3 seconds
 *   cache: {
 *     enabled: true,
 *     ttl: 2000          // 2 seconds
 *   }
 * });
 */
