#!/usr/bin/env node
/**
 * Sensor Coordinator
 *
 * Central coordination point for all CrowPi3 components.
 * Loads configuration, manages hardware manager client, and provides simple API.
 *
 * Features:
 * - Configuration-driven component registration
 * - Simple read/write API
 * - Event aggregation
 * - Progressive initialization (core fast, infrastructure gradual)
 *
 * Design:
 * - This is the "smart" layer - circuit breakers, caching, etc. will go here
 * - Hardware manager is "dumb" - just hardware I/O
 * - For now: minimal implementation to get DHT11 working end-to-end
 *
 * Events:
 * - 'ready' - Coordinator initialized and ready
 * - 'component:ready' - Component initialized
 * - 'component:data' - Component data received
 * - 'component:error' - Component error
 */

import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { createHardwareManagerClient } from '../hardware-manager-client/hardware-manager-client.js';

/**
 * Sensor Coordinator
 *
 * Main entry point for CrowPi3 framework.
 */
export class SensorCoordinator extends EventEmitter {
  // Default configuration
  static DEFAULT_CONFIG = {
    configFile: null,  // Path to config file (if using file-based config)
    components: {}      // Component definitions (if using programmatic config)
  };

  /**
   * Create sensor coordinator.
   *
   * @param {Object} config - Configuration options
   */
  constructor(config = {}) {
    super();

    // Merge with defaults
    this.#config = { ...SensorCoordinator.DEFAULT_CONFIG, ...config };

    // Internal state
    this.#hwClient = null;
    this.#components = new Map();
    this.#isInitialized = false;
    this.#circuitBreakers = new Map();
  }

  // Private fields
  #config;
  #hwClient;
  #components;
  #isInitialized;
  #circuitBreakers; // per-component failure tracking

  // Circuit breaker settings
  static BREAKER_THRESHOLD = 15;   // failures before opening
  static BREAKER_COOLDOWN = 5000;  // base cooldown ms (doubles on each re-open, max 60s)
  static BREAKER_MAX_COOLDOWN = 60000;

  /**
   * Initialize coordinator.
   *
   * Loads configuration, starts hardware manager, and registers components.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.#isInitialized) {
      return; // Idempotent
    }

    // Step 1: Load configuration
    const componentConfig = await this.#loadConfiguration();

    // Step 2: Start hardware manager client (or use injected client for testing)
    this.#hwClient = this.#config.hwClient || await createHardwareManagerClient();

    // Forward hardware manager events
    this.#hwClient.on('error', (error) => {
      this.emit('error', error);
    });

    this.#hwClient.on('exit', (info) => {
      this.emit('hardware-manager-exit', info);
    });

    // Step 3: Register and initialize components
    for (const [componentId, componentDef] of Object.entries(componentConfig)) {
      if (componentDef.enabled === false) {
        console.log(`Skipping disabled component: ${componentId}`);
        continue;
      }
      await this.#registerComponent(componentId, componentDef);
    }

    this.#isInitialized = true;
    this.emit('ready');
  }

  /**
   * Load configuration from file or use programmatic config.
   *
   * @returns {Promise<Object>} Component configuration
   * @private
   */
  async #loadConfiguration() {
    // If config file specified, load it
    if (this.#config.configFile) {
      const fileContent = await readFile(this.#config.configFile, 'utf-8');
      const fullConfig = JSON.parse(fileContent);
      return fullConfig.components || {};
    }

    // Otherwise use programmatic config
    return this.#config.components || {};
  }

  /**
   * Register and initialize a component.
   *
   * @param {string} componentId - Component identifier
   * @param {Object} componentDef - Component definition from config
   * @private
   */
  async #registerComponent(componentId, componentDef) {
    try {
      // Extract component info
      const { type, pins = {}, ...otherConfig } = componentDef;

      // Build driver config
      const driverConfig = {
        pins,
        ...otherConfig
      };

      // Register with hardware manager
      await this.#hwClient.register(componentId, type, driverConfig);

      // Initialize component
      await this.#hwClient.initialize(componentId);

      // Store component info
      this.#components.set(componentId, {
        id: componentId,
        type,
        config: componentDef
      });

      this.emit('component:ready', { componentId, type });
    } catch (error) {
      console.error(`Failed to initialize ${componentId}:`, error.message);
      this.emit('component:error', { componentId, error });
      // Don't re-throw - skip failed components and continue with others
    }
  }

  /**
   * Register a component programmatically.
   *
   * Alternative to config file - register components at runtime.
   *
   * @param {string} componentId - Component identifier
   * @param {Object} componentDef - Component definition
   * @returns {Promise<void>}
   */
  async register(componentId, componentDef) {
    if (!this.#isInitialized) {
      throw new Error('Coordinator not initialized. Call initialize() first.');
    }

    await this.#registerComponent(componentId, componentDef);
  }

  /**
   * Read data from a component.
   *
   * @param {string} componentId - Component to read from
   * @returns {Promise<Object>} Component data
   */
  async read(componentId) {
    this.#assertInitialized();

    if (!this.#components.has(componentId)) {
      throw new Error(`Component not registered: ${componentId}`);
    }

    // Circuit breaker check
    const breaker = this.#circuitBreakers.get(componentId);
    if (breaker && breaker.failures >= SensorCoordinator.BREAKER_THRESHOLD) {
      const cooldown = Math.min(
        SensorCoordinator.BREAKER_COOLDOWN * Math.pow(2, (breaker.opens || 1) - 1),
        SensorCoordinator.BREAKER_MAX_COOLDOWN
      );
      const elapsed = Date.now() - breaker.lastFailure;
      if (elapsed < cooldown) {
        // Still in cooldown - reject without hitting hardware
        throw new Error(`Circuit open for ${componentId} (${Math.ceil((cooldown - elapsed) / 1000)}s remaining)`);
      }
      // Cooldown elapsed - allow one attempt (half-open)
    }

    try {
      const data = await this.#hwClient.read(componentId);

      // Success - reset breaker
      if (breaker) {
        if (breaker.failures >= SensorCoordinator.BREAKER_THRESHOLD) {
          console.log(`Circuit closed for ${componentId} (recovered)`);
          this.emit('component:circuit-close', { componentId });
        }
        this.#circuitBreakers.delete(componentId);
      }

      this.emit('component:data', {
        componentId,
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      // Track failure
      const current = this.#circuitBreakers.get(componentId) || { failures: 0 };
      current.failures++;
      current.lastFailure = Date.now();
      this.#circuitBreakers.set(componentId, current);

      if (current.failures >= SensorCoordinator.BREAKER_THRESHOLD) {
        current.opens = (current.opens || 0) + 1;
        const cooldown = Math.min(
          SensorCoordinator.BREAKER_COOLDOWN * Math.pow(2, current.opens - 1),
          SensorCoordinator.BREAKER_MAX_COOLDOWN
        );
        console.error(`Circuit opened for ${componentId} after ${current.failures} failures (cooldown: ${cooldown / 1000}s)`);
        this.emit('component:circuit-open', { componentId, failures: current.failures, cooldown });
      }

      this.emit('component:error', { componentId, error });
      throw error;
    }
  }

  /**
   * Write data to a component.
   *
   * @param {string} componentId - Component to write to
   * @param {Object} data - Data to write
   * @returns {Promise<Object>} Write result
   */
  async write(componentId, data) {
    this.#assertInitialized();

    if (!this.#components.has(componentId)) {
      throw new Error(`Component not registered: ${componentId}`);
    }

    try {
      const result = await this.#hwClient.write(componentId, data);

      // Emit write event
      this.emit('component:write', {
        componentId,
        data,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      this.emit('component:error', { componentId, error });
      throw error;
    }
  }

  /**
   * Get list of registered components.
   *
   * @returns {Array<Object>} Component list
   */
  getComponents() {
    return Array.from(this.#components.values());
  }

  /**
   * Get component information.
   *
   * @param {string} componentId - Component to get info for
   * @returns {Object} Component info
   */
  getComponent(componentId) {
    if (!this.#components.has(componentId)) {
      throw new Error(`Component not registered: ${componentId}`);
    }

    return this.#components.get(componentId);
  }

  /**
   * Check if coordinator is initialized.
   *
   * @returns {boolean} True if initialized
   */
  isInitialized() {
    return this.#isInitialized;
  }

  /**
   * Assert that coordinator is initialized.
   *
   * @private
   * @throws {Error} If not initialized
   */
  #assertInitialized() {
    if (!this.#isInitialized) {
      throw new Error('Coordinator not initialized. Call initialize() first.');
    }
  }

  /**
   * Shut down coordinator and clean up resources.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this.#isInitialized) {
      return;
    }

    // Clean up hardware manager
    if (this.#hwClient) {
      this.#hwClient.removeAllListeners();
      this.#hwClient.cleanup();
      this.#hwClient = null;
    }

    // Clear state
    this.#components.clear();
    this.#circuitBreakers.clear();

    this.#isInitialized = false;
    this.emit('shutdown');

    // Remove all listeners to prevent leaks after shutdown
    this.removeAllListeners();
  }
}

/**
 * Create and initialize a sensor coordinator.
 *
 * Convenience function for common use case.
 *
 * @param {Object} config - Configuration options
 * @returns {Promise<SensorCoordinator>} Initialized coordinator
 */
export async function createSensorCoordinator(config = {}) {
  const coordinator = new SensorCoordinator(config);
  await coordinator.initialize();
  return coordinator;
}
