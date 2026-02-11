#!/usr/bin/env node
/**
 * Hardware Manager Client
 *
 * Node.js client for communicating with Python Hardware Manager.
 * Handles process spawning, JSON-RPC communication, and lifecycle management.
 *
 * Features:
 * - Spawns hardware-manager.py as child process
 * - JSON-RPC 2.0 protocol over stdin/stdout
 * - Request/response matching with timeouts
 * - EventEmitter for notifications and errors
 * - Automatic cleanup on exit
 *
 * Events:
 * - 'ready' - Hardware manager is ready
 * - 'error' - Error occurred
 * - 'exit' - Process exited
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Hardware Manager Client
 *
 * Manages communication with Python hardware manager process.
 */
export class HardwareManagerClient extends EventEmitter {
  // Default configuration
  static DEFAULT_CONFIG = {
    timeout: 10000,             // Request timeout (ms)
    pythonPath: 'python3',      // Python executable
    managerPath: join(__dirname, '..', 'hardware-manager', 'hardware-manager.py')
  };

  // Auto-restart settings
  static RESTART_BASE_DELAY = 1000;  // 1s initial
  static RESTART_MAX_DELAY = 30000;  // 30s max
  static RESTART_MAX_RETRIES = 10;

  // Private fields
  #config;
  #process;
  #isReady;
  #pendingRequests;
  #nextRequestId;
  #lineReader;
  #exitHandler;
  #sigintHandler;
  #sigtermHandler;
  #restartAttempts;
  #restartTimer;
  #shuttingDown;

  /**
   * Create hardware manager client.
   *
   * @param {Object} config - Configuration options
   */
  constructor(config = {}) {
    super();

    // Merge with defaults
    this.#config = { ...HardwareManagerClient.DEFAULT_CONFIG, ...config };

    // Internal state
    this.#process = null;
    this.#isReady = false;
    this.#pendingRequests = new Map();
    this.#nextRequestId = 1;
    this.#lineReader = null;
    this.#restartAttempts = 0;
    this.#restartTimer = null;
    this.#shuttingDown = false;

    // Setup cleanup - store refs so we can remove them later
    this.#exitHandler = () => this.cleanup();
    this.#sigintHandler = () => this.cleanup();
    this.#sigtermHandler = () => this.cleanup();
    process.on('exit', this.#exitHandler);
    process.on('SIGINT', this.#sigintHandler);
    process.on('SIGTERM', this.#sigtermHandler);
  }

  /**
   * Start the hardware manager process.
   *
   * Spawns Python process and waits for ready notification.
   *
   * @returns {Promise<void>}
   * @throws {Error} If process fails to start or doesn't send ready signal
   */
  async start() {
    if (this.#process) {
      throw new Error('Hardware manager already started');
    }

    return new Promise((resolve, reject) => {
      // Spawn Python process
      this.#process = spawn(
        this.#config.pythonPath,
        [this.#config.managerPath],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: process.env
        }
      );

      // Setup stdout line reader (JSON-RPC responses)
      this.#lineReader = readline.createInterface({
        input: this.#process.stdout,
        crlfDelay: Infinity
      });

      this.#lineReader.on('line', (line) => {
        this.#handleMessage(line);
      });

      // Setup stderr passthrough (Python logs)
      this.#process.stderr.on('data', (data) => {
        // Forward Python logs to our stderr
        process.stderr.write(`[HW-Manager] ${data}`);
      });

      // Handle process exit
      this.#process.on('exit', (code, signal) => {
        this.#isReady = false;
        this.#process = null;

        // Reject all pending requests
        for (const [id, request] of this.#pendingRequests.entries()) {
          clearTimeout(request.timeout);
          request.reject(new Error(`Process exited (code: ${code}, signal: ${signal})`));
        }
        this.#pendingRequests.clear();

        this.emit('exit', { code, signal });

        // Auto-restart if not intentionally shutting down
        if (!this.#shuttingDown) {
          this.#scheduleRestart();
        }
      });

      // Handle process errors
      this.#process.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      // Wait for ready notification
      const readyTimeout = setTimeout(() => {
        this.cleanup();
        reject(new Error('Hardware manager did not send ready signal'));
      }, this.#config.timeout);

      this.once('ready', () => {
        clearTimeout(readyTimeout);
        this.#restartAttempts = 0;  // Reset on successful start
        resolve();
      });
    });
  }

  /**
   * Schedule an auto-restart with exponential backoff.
   * @private
   */
  #scheduleRestart() {
    if (this.#restartAttempts >= HardwareManagerClient.RESTART_MAX_RETRIES) {
      console.error(`[HW-Manager] Max restart attempts (${HardwareManagerClient.RESTART_MAX_RETRIES}) reached. Giving up.`);
      this.emit('error', new Error('Hardware manager failed to restart after max attempts'));
      return;
    }

    this.#restartAttempts++;
    const delay = Math.min(
      HardwareManagerClient.RESTART_BASE_DELAY * Math.pow(2, this.#restartAttempts - 1),
      HardwareManagerClient.RESTART_MAX_DELAY
    );

    console.error(`[HW-Manager] Process died. Restarting in ${delay / 1000}s (attempt ${this.#restartAttempts}/${HardwareManagerClient.RESTART_MAX_RETRIES})`);

    this.#restartTimer = setTimeout(async () => {
      this.#restartTimer = null;
      try {
        await this.start();
        console.log('[HW-Manager] Restart successful');
        this.emit('restart');
      } catch (err) {
        console.error(`[HW-Manager] Restart failed: ${err.message}`);
        // The exit handler will trigger the next restart attempt
      }
    }, delay);
    this.#restartTimer.unref();
  }

  /**
   * Handle incoming message from hardware manager.
   *
   * @param {string} line - JSON-RPC message
   * @private
   */
  #handleMessage(line) {
    try {
      const message = JSON.parse(line);

      // Check if this is a response or notification
      if (message.id !== undefined) {
        // Response to a request
        this.#handleResponse(message);
      } else if (message.method) {
        // Notification from hardware manager
        this.#handleNotification(message);
      }
    } catch (error) {
      this.emit('error', new Error(`Failed to parse message: ${error.message}`));
    }
  }

  /**
   * Handle JSON-RPC response.
   *
   * @param {Object} response - JSON-RPC response
   * @private
   */
  #handleResponse(response) {
    const request = this.#pendingRequests.get(response.id);

    if (!request) {
      // Late response for a timed-out request — ignore silently
      return;
    }

    // Clear timeout
    clearTimeout(request.timeout);

    // Remove from pending
    this.#pendingRequests.delete(response.id);

    // Resolve or reject based on response
    if (response.error) {
      const error = new Error(response.error.message);
      error.code = response.error.code;
      error.data = response.error.data;
      request.reject(error);
    } else {
      request.resolve(response.result);
    }
  }

  /**
   * Handle JSON-RPC notification.
   *
   * @param {Object} notification - JSON-RPC notification
   * @private
   */
  #handleNotification(notification) {
    const { method, params } = notification;

    if (method === 'ready') {
      this.#isReady = true;
      this.emit('ready', params);
    } else {
      // Emit other notifications as events
      this.emit(method, params);
    }
  }

  /**
   * Send JSON-RPC request to hardware manager.
   *
   * @param {string} method - RPC method name
   * @param {Object} params - Method parameters
   * @returns {Promise<any>} Method result
   * @throws {Error} If request fails or times out
   */
  async request(method, params = {}) {
    if (!this.#process) {
      throw new Error('Hardware manager not started');
    }

    if (!this.#isReady) {
      throw new Error('Hardware manager not ready');
    }

    return new Promise((resolve, reject) => {
      // Generate request ID
      const id = this.#nextRequestId++;

      // Create JSON-RPC request
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      // Setup timeout
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.#config.timeout);

      // Store pending request
      this.#pendingRequests.set(id, { resolve, reject, timeout });

      // Send request
      const message = JSON.stringify(request) + '\n';
      this.#process.stdin.write(message);
    });
  }

  /**
   * Register a hardware component.
   *
   * @param {string} componentId - Unique component identifier
   * @param {string} componentType - Component type (e.g., 'DHT11')
   * @param {Object} config - Component configuration
   * @returns {Promise<Object>} Registration result
   */
  async register(componentId, componentType, config) {
    return this.request('register', {
      component_id: componentId,
      component_type: componentType,
      config
    });
  }

  /**
   * Initialize a component.
   *
   * @param {string} componentId - Component to initialize
   * @returns {Promise<Object>} Initialization result
   */
  async initialize(componentId) {
    return this.request('initialize', {
      component_id: componentId
    });
  }

  /**
   * Read from a component.
   *
   * @param {string} componentId - Component to read from
   * @returns {Promise<Object>} Component data
   */
  async read(componentId) {
    return this.request('read', {
      component_id: componentId
    });
  }

  /**
   * Write to a component.
   *
   * @param {string} componentId - Component to write to
   * @param {Object} data - Data to write
   * @returns {Promise<Object>} Write result
   */
  async write(componentId, data) {
    return this.request('write', {
      component_id: componentId,
      data
    });
  }

  /**
   * Clean up hardware manager process.
   *
   * Stops the process and cleans up resources.
   */
  /**
   * Check if the hardware manager is ready.
   *
   * @returns {boolean} True if ready to accept requests
   */
  isReady() {
    return this.#isReady;
  }

  cleanup() {
    // Mark as intentional shutdown — suppress auto-restart
    this.#shuttingDown = true;

    // Cancel any pending restart timer
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }

    // Remove process-level listeners
    if (this.#exitHandler) {
      process.removeListener('exit', this.#exitHandler);
      process.removeListener('SIGINT', this.#sigintHandler);
      process.removeListener('SIGTERM', this.#sigtermHandler);
      this.#exitHandler = null;
      this.#sigintHandler = null;
      this.#sigtermHandler = null;
    }

    if (!this.#process) {
      return;
    }

    // Close line reader
    if (this.#lineReader) {
      this.#lineReader.close();
      this.#lineReader = null;
    }

    // Kill process with SIGKILL fallback
    const proc = this.#process;
    this.#process = null;
    this.#isReady = false;

    try {
      proc.kill('SIGTERM');
    } catch (e) { /* already dead */ }

    // If process doesn't exit within 2s, force-kill
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) { /* already dead */ }
    }, 2000).unref();

    // Clear pending requests
    for (const [id, request] of this.#pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Hardware manager shut down'));
    }
    this.#pendingRequests.clear();
  }
}

/**
 * Create and start a hardware manager client.
 *
 * Convenience function for common use case.
 *
 * @param {Object} config - Configuration options
 * @returns {Promise<HardwareManagerClient>} Started client
 */
export async function createHardwareManagerClient(config = {}) {
  const client = new HardwareManagerClient(config);
  await client.start();
  return client;
}
