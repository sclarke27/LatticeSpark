import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * Per-module context providing sensor access, state persistence, and logging.
 * Wraps the module-service's shared Socket.IO connection to sensor-service.
 */
export class ModuleContext {
  #moduleId;
  #sensorSocket;
  #latestData;
  #components;
  #moduleIo;
  #stateDir;
  #subscriptions;
  #lastEmittedState;

  /**
   * @param {Object} opts
   * @param {string} opts.moduleId - Module identifier
   * @param {import('socket.io-client').Socket} opts.sensorSocket - Socket.IO client to sensor-service
   * @param {Map<string, Object>} opts.latestData - Shared cache of latest sensor data
   * @param {Array} opts.components - Component list from sensor-service
   * @param {import('socket.io').Server} opts.moduleIo - Module-service Socket.IO server (for emitState)
   * @param {string} opts.stateDir - Directory for persisted state files
   */
  constructor({ moduleId, sensorSocket, latestData, components, moduleIo, stateDir }) {
    this.#moduleId = moduleId;
    this.#sensorSocket = sensorSocket;
    this.#latestData = latestData;
    this.#components = components;
    this.#moduleIo = moduleIo;
    this.#stateDir = stateDir;
    this.#subscriptions = new Map();
    this.#lastEmittedState = null;
  }

  /**
   * Read the latest cached value for a component.
   * Returns a shallow copy — safe to mutate without corrupting the shared cache.
   * @param {string} componentId
   * @returns {Object|null}
   */
  read(componentId) {
    const data = this.#latestData.get(componentId);
    return data ? { ...data } : null;
  }

  /**
   * Write data to an output component via sensor-service.
   * Retries up to 3 times with exponential backoff on failure.
   * @param {string} componentId
   * @param {Object} data
   * @returns {Promise<{success: boolean}>}
   */
  async write(componentId, data) {
    const WRITE_TIMEOUT = 5000;
    const MAX_RETRIES = 3;
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          if (!this.#sensorSocket?.connected) {
            reject(new Error('sensor-service socket not connected'));
            return;
          }

          const timer = setTimeout(() => {
            reject(new Error(`write to "${componentId}" timed out after ${WRITE_TIMEOUT}ms`));
          }, WRITE_TIMEOUT);

          this.#sensorSocket.emit('component:write', { componentId, data }, (result) => {
            clearTimeout(timer);
            if (result?.error) {
              reject(new Error(result.error));
            } else {
              resolve(result || { success: true });
            }
          });
        });
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Subscribe to real-time data for a specific component.
   * @param {string} componentId
   * @param {(componentId: string, data: Object) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onData(componentId, callback) {
    if (!this.#subscriptions.has(componentId)) {
      this.#subscriptions.set(componentId, new Set());
    }
    this.#subscriptions.get(componentId).add(callback);

    return () => {
      const subs = this.#subscriptions.get(componentId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) this.#subscriptions.delete(componentId);
      }
    };
  }

  /**
   * Called by module-service when new sensor:batch data arrives.
   * Notifies any onData subscribers for this module.
   * @param {string} componentId
   * @param {Object} data
   */
  _notifyData(componentId, data) {
    const subs = this.#subscriptions.get(componentId);
    if (subs) {
      for (const cb of subs) {
        try { cb(componentId, data); } catch (err) {
          console.error(`[module:${this.#moduleId}] onData callback error:`, err.message);
        }
      }
    }
  }

  /**
   * Get a component's config from the components list.
   * @param {string} componentId
   * @returns {Object|null}
   */
  getComponentConfig(componentId) {
    return this.#components.find(c => c.id === componentId) ?? null;
  }

  /**
   * Push module state to connected UI pages via Socket.IO.
   * Stores a snapshot for late-connecting clients (state replay).
   * @param {Object} state
   */
  emitState(state) {
    this.#lastEmittedState = structuredClone(state);
    this.#moduleIo.emit('module:state', { moduleId: this.#moduleId, state });
  }

  /** Returns the last state passed to emitState(), or null if never called. */
  getLastEmittedState() {
    return this.#lastEmittedState;
  }

  /**
   * Load persisted module state from disk.
   * @returns {Promise<Object>}
   */
  async getState() {
    const filePath = join(this.#stateDir, `${this.#moduleId}.state.json`);
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * Save module state to disk (survives restarts).
   * @param {Object} state
   */
  async setState(state) {
    const filePath = join(this.#stateDir, `${this.#moduleId}.state.json`);
    const tmpPath = filePath + '.tmp';
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(state, null, 2));
    await rename(tmpPath, filePath);
  }

  log(msg)   { console.log(`[module:${this.#moduleId}] ${msg}`); }
  warn(msg)  { console.warn(`[module:${this.#moduleId}] ${msg}`); }
  error(msg) { console.error(`[module:${this.#moduleId}] ${msg}`); }

  /** Clean up subscriptions. Called by module-service on module stop. */
  _destroy() {
    this.#subscriptions.clear();
  }
}
