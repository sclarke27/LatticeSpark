import { LitElement } from 'lit';

/**
 * Base class for module UI pages.
 * Provides shared properties and command dispatch.
 *
 * Properties set by dashboard:
 *   moduleId    - The module's ID string
 *   moduleState - Latest state from ctx.emitState()
 *   sensorData  - All sensor readings (same object as dashboard)
 *   theme       - Current theme name
 */
export class BaseModulePage extends LitElement {
  static properties = {
    moduleId: { type: String },
    moduleState: { type: Object },
    sensorData: { type: Object },
    theme: { type: String, reflect: true }
  };

  constructor() {
    super();
    this.moduleId = '';
    this.moduleState = null;
    this.sensorData = {};
    this.theme = 'default';
    this._pendingTimers = new Set();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const timer of this._pendingTimers) {
      clearTimeout(timer);
    }
    this._pendingTimers.clear();
  }

  /**
   * Send a command to this module via the module-service.
   * Returns a Promise that resolves with the module's response.
   * Rejects after 10 seconds if no response is received.
   */
  sendCommand(command, params = {}) {
    const COMMAND_TIMEOUT = 10000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingTimers.delete(timer);
        reject(new Error(`Command "${command}" timed out after ${COMMAND_TIMEOUT}ms`));
      }, COMMAND_TIMEOUT);
      this._pendingTimers.add(timer);

      const callback = (result) => {
        clearTimeout(timer);
        this._pendingTimers.delete(timer);
        if (result?.error) {
          reject(new Error(result.error));
        } else {
          resolve(result?.result ?? null);
        }
      };
      this.dispatchEvent(new CustomEvent('module-command', {
        detail: { moduleId: this.moduleId, command, params, callback },
        bubbles: true,
        composed: true
      }));
    });
  }
}
