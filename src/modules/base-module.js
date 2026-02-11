/**
 * Base class for all CrowPi3 modules.
 *
 * Subclasses override lifecycle methods:
 *   initialize()    — called once after construction
 *   execute()       — called on interval trigger
 *   onSensorChange(componentId, newData, prevData) — called on sensor data change
 *   handleCommand(command, params) — called from UI page
 *   cleanup()       — called on shutdown/disable
 */
export class BaseModule {
  #context;
  #config;

  constructor(context, config) {
    this.#context = context;
    this.#config = config;
  }

  /** @returns {import('./module-context.js').ModuleContext} */
  get ctx() { return this.#context; }

  /** @returns {Object} Parsed module.json */
  get config() { return this.#config; }

  /** Called once after construction. Setup resources here. */
  async initialize() {}

  /** Called on interval trigger (if triggers.interval is set). */
  async execute() {}

  /**
   * Called when a watched sensor value changes (if triggers.onChange is set).
   * @param {string} componentId - The component whose data changed
   * @param {Object} newData - The new sensor data
   * @param {Object|null} prevData - The previous sensor data (null on first read)
   */
  async onSensorChange(componentId, newData, prevData) {}

  /**
   * Called when the UI page sends a command via module-service.
   * @param {string} command - Command name
   * @param {Object} params - Command parameters
   * @returns {*} Optional return value sent back to UI
   */
  async handleCommand(command, params) {}

  /** Called on shutdown or disable. Clean up resources, turn off actuators. */
  async cleanup() {}
}
