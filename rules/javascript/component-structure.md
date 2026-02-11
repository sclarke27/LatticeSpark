# Component Structure (MANDATORY)

> **ALL hardware components MUST follow this exact structure. No exceptions.**

---

## Rule 1: Class Structure (CRITICAL)

MANDATORY structure for all sensors/actuators/displays.

**Template:**

```javascript
import { EventEmitter } from 'events';
import { BridgeManager } from '../../core/BridgeManager.js';
import { Logger } from '../../utils/logger.js';

export class ComponentName extends EventEmitter {
  // ===== PRIVATE FIELDS (ALWAYS use #) =====
  #bridge = null;
  #config = {};
  #isInitialized = false;
  #logger;

  // ===== CONSTRUCTOR (ALWAYS validate) =====
  constructor(config) {
    super();
    this.#validateConfig(config);
    this.#config = { ...DEFAULT_CONFIG, ...config };
    this.#logger = Logger.create('ComponentName');
  }

  // ===== PUBLIC INTERFACE =====

  /**
   * Initialize the component.
   * MUST be idempotent (safe to call multiple times).
   *
   * @returns {Promise<void>}
   * @throws {InitializationError} If initialization fails
   */
  async initialize() {
    if (this.#isInitialized) return; // Idempotent

    this.#logger.info('Initializing component');

    this.#bridge = await BridgeManager.spawn({
      script: 'bridges/category/component_bridge.py',
      args: [this.#config.pin]
    });

    this.#setupEventHandlers();
    await this.#waitForReady();

    this.#isInitialized = true;
    this.emit('ready');
  }

  /**
   * Primary operation (read, write, etc.).
   *
   * @returns {Promise<Result>}
   * @throws {ComponentError} If operation fails
   */
  async primaryOperation() {
    this.#ensureInitialized();

    try {
      return await this.#bridge.send({ method: 'operation' });
    } catch (error) {
      throw new ComponentError('Operation failed', {
        component: this.constructor.name,
        cause: error
      });
    }
  }

  /**
   * Clean up resources.
   * MUST be safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  async destroy() {
    if (!this.#isInitialized) return; // Idempotent

    this.#logger.info('Destroying component');

    if (this.#bridge) {
      await this.#bridge.kill();
      this.#bridge = null;
    }

    this.removeAllListeners();
    this.#isInitialized = false;
  }

  // ===== GETTERS (read-only state) =====

  /**
   * Check if component is ready.
   * @returns {boolean}
   */
  get isReady() {
    return this.#isInitialized;
  }

  // ===== PRIVATE METHODS (ALWAYS use #) =====

  #validateConfig(config) {
    if (!config.pin || typeof config.pin !== 'number') {
      throw new ValidationError('Invalid pin', {
        field: 'pin',
        value: config.pin
      });
    }
  }

  #ensureInitialized() {
    if (!this.#isInitialized) {
      throw new Error('Component not initialized. Call initialize() first.');
    }
  }

  #setupEventHandlers() {
    this.#bridge.on('data', (data) => this.emit('data', data));
    this.#bridge.on('error', (error) => this.#handleBridgeError(error));
  }

  #handleBridgeError(error) {
    this.#logger.error('Bridge error', error);
    this.emit('error', error);
  }

  async #waitForReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Bridge initialization timeout'));
      }, 5000);

      this.#bridge.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

// ===== MODULE EXPORTS =====
export default ComponentName;
```

---

## Rule 2: Private Fields (MANDATORY)

ALWAYS use # for private fields. NEVER use underscore.

**WRONG:**
```javascript
class Sensor {
  _bridge = null;        // NO - underscore convention
  __bridge = null;       // NO - double underscore
  bridge = null;         // NO - public field
  this.bridge = null;    // NO - instance property
}
```

**CORRECT:**
```javascript
class Sensor {
  #bridge = null;        // YES - true private field
  #config = {};          // YES
  #isInitialized = false; // YES
}
```

**WHY:**
- True privacy (not accessible outside class)
- Modern JavaScript standard
- Better encapsulation
- Type checking support

---

## Rule 3: Idempotent Initialize/Destroy (CRITICAL)

MUST be safe to call multiple times.

**WRONG:**
```javascript
async initialize() {
  this.#bridge = await createBridge(); // Crashes if called twice!
}

async destroy() {
  await this.#bridge.kill(); // Crashes if already destroyed!
}
```

**CORRECT:**
```javascript
async initialize() {
  if (this.#isInitialized) {
    this.#logger.debug('Already initialized');
    return; // Safe to call again
  }

  this.#bridge = await createBridge();
  this.#isInitialized = true;
}

async destroy() {
  if (!this.#isInitialized) {
    this.#logger.debug('Already destroyed');
    return; // Safe to call again
  }

  if (this.#bridge) {
    await this.#bridge.kill();
    this.#bridge = null;
  }

  this.#isInitialized = false;
}
```

**WHY:**
- Safe to call in cleanup handlers
- No crashes on double-destroy
- Predictable behavior

---

## Rule 4: Async Constructor Anti-Pattern (NEVER)

NEVER do async work in constructor.

**WRONG:**
```javascript
class Sensor {
  constructor(config) {
    super();
    this.bridge = await createBridge(config); // ILLEGAL!
  }
}
```

**CORRECT:**
```javascript
class Sensor {
  #bridge = null;
  #config = {};

  constructor(config) {
    super();
    // Only synchronous setup
    this.#config = config;
  }

  async initialize() {
    // Async work here
    this.#bridge = await createBridge(this.#config);
  }
}

// Usage
const sensor = new Sensor({ pin: 17 });
await sensor.initialize(); // Explicit async initialization
```

**WHY:**
- Constructors can't be async
- Separates object creation from initialization
- Clear initialization lifecycle

---

## Rule 5: Event Emitter Inheritance (REQUIRED)

ALL components MUST extend EventEmitter.

**WRONG:**
```javascript
export class Sensor {
  // No EventEmitter - can't emit events!
}
```

**CORRECT:**
```javascript
import { EventEmitter } from 'events';

export class Sensor extends EventEmitter {
  constructor(config) {
    super(); // CRITICAL: Call parent constructor

    // Now can emit events
    this.emit('created');
  }

  async read() {
    const data = await this.#doRead();
    this.emit('data', data); // Emit events
    return data;
  }
}

// Usage
const sensor = new Sensor({ pin: 17 });
sensor.on('data', (data) => console.log(data));
```

**WHY:**
- Standard Node.js event pattern
- Enables reactive programming
- Decouples components

---

## Rule 6: Standard Events (REQUIRED)

ALL components MUST emit these events:

**Required Events:**

```javascript
// 1. ready - Component initialized and ready
this.emit('ready');

// 2. data - New data available
this.emit('data', sensorReading);

// 3. error - Error occurred
this.emit('error', errorObject);

// 4. change - Value changed significantly
this.emit('change', newValue);
```

**Usage Example:**

```javascript
sensor.on('ready', () => {
  console.log('Sensor ready');
});

sensor.on('data', (data) => {
  console.log('New data:', data);
});

sensor.on('change', (newValue) => {
  console.log('Value changed:', newValue);
});

sensor.on('error', (error) => {
  console.error('Sensor error:', error);
});
```

**WHY:**
- Consistent API across all components
- Predictable behavior
- Easy integration

---

## Rule 7: Cleanup in Destroy (CRITICAL)

MUST remove ALL listeners and resources.

**WRONG:**
```javascript
async destroy() {
  await this.#bridge.kill();
  // Listeners still attached - memory leak!
}
```

**CORRECT:**
```javascript
async destroy() {
  // Clean up bridge
  if (this.#bridge) {
    await this.#bridge.kill();
    this.#bridge = null;
  }

  // CRITICAL: Remove all event listeners
  this.removeAllListeners();

  // Clear any timers
  if (this.#pollInterval) {
    clearInterval(this.#pollInterval);
    this.#pollInterval = null;
  }

  // Mark as destroyed
  this.#isInitialized = false;

  this.#logger.info('Component destroyed');
}
```

**WHY:**
- Prevents memory leaks
- Clean shutdown
- Can be garbage collected

---

## Rule 8: Validate Config in Constructor (REQUIRED)

ALWAYS validate before storing config.

**WRONG:**
```javascript
constructor(config) {
  super();
  this.#config = config; // No validation!
}
```

**CORRECT:**
```javascript
constructor(config) {
  super();
  this.#validateConfig(config);
  this.#config = { ...DEFAULT_CONFIG, ...config };
}

#validateConfig(config) {
  // Required fields
  if (!config.pin) {
    throw new ValidationError('Pin is required', {
      field: 'pin'
    });
  }

  // Type checks
  if (typeof config.pin !== 'number') {
    throw new ValidationError('Pin must be a number', {
      field: 'pin',
      value: config.pin,
      expectedType: 'number'
    });
  }

  // Range checks
  if (config.pin < 0 || config.pin > 27) {
    throw new ValidationError('Pin out of range', {
      field: 'pin',
      value: config.pin,
      constraint: '0-27'
    });
  }

  // Optional fields
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || config.timeout < 0) {
      throw new ValidationError('Invalid timeout', {
        field: 'timeout',
        value: config.timeout
      });
    }
  }
}
```

**WHY:**
- Fail fast with clear errors
- Prevents invalid state
- Better debugging

---

## Rule 9: JSDoc Required (MANDATORY)

ALL public methods MUST have JSDoc.

**WRONG:**
```javascript
async read() {
  return await this.#bridge.send({ method: 'read' });
}
```

**CORRECT:**
```javascript
/**
 * Read current sensor value.
 *
 * @returns {Promise<SensorReading>} Sensor reading with temperature and humidity
 * @throws {ComponentError} If sensor read fails
 * @throws {Error} If component not initialized
 *
 * @example
 * const sensor = new DHT11Sensor({ pin: 17 });
 * await sensor.initialize();
 * const reading = await sensor.read();
 * console.log(`Temp: ${reading.temperature}°C`);
 */
async read() {
  this.#ensureInitialized();

  try {
    return await this.#bridge.send({ method: 'read' });
  } catch (error) {
    throw new ComponentError('Read failed', {
      component: this.constructor.name,
      cause: error
    });
  }
}
```

**WHY:**
- Better IDE autocomplete
- Generated documentation
- Type checking with TypeScript
- Examples for users

---

## Rule 10: File Size Limit (REQUIRED)

Maximum 300 lines per file.

**IF file > 300 lines:**
- Extract helpers to separate files
- Split into multiple classes
- Move utilities to utils/

**Example:**

```javascript
// WRONG: sensor.js (500 lines)
export class Sensor {
  // 500 lines of code
}

// CORRECT: Split into modules
// sensor.js (200 lines)
export class Sensor { /* core logic */ }

// sensor-helpers.js (150 lines)
export function validateReading() { /* ... */ }
export function formatOutput() { /* ... */ }

// sensor-constants.js (50 lines)
export const DEFAULT_CONFIG = { /* ... */ };
export const PIN_MAP = { /* ... */ };
```

---

## Metrics

- **Private fields:** 100% use # prefix
- **Idempotent init/destroy:** 100%
- **EventEmitter inheritance:** 100%
- **Standard events:** 100% (ready, data, error, change)
- **Cleanup in destroy:** 100%
- **Config validation:** 100%
- **JSDoc coverage:** 100% of public methods
- **File size:** < 300 lines

---

## Verification Checklist

- [ ] Extends EventEmitter
- [ ] All private fields use # prefix
- [ ] Constructor validates config
- [ ] initialize() is idempotent
- [ ] destroy() is idempotent
- [ ] destroy() removes all listeners
- [ ] Emits standard events (ready, data, error)
- [ ] All public methods have JSDoc
- [ ] No async work in constructor
- [ ] File size < 300 lines
- [ ] ensureInitialized() checks before operations

---

## Complete Example

See `patterns/sensor-component.js` for complete golden example.

---

## Anti-Patterns (NEVER DO THIS)

### ❌ Public Fields

```javascript
// WRONG
class Sensor {
  bridge = null; // Public - can be modified externally
}
```

### ❌ Non-Idempotent Initialize

```javascript
// WRONG
async initialize() {
  this.#bridge = await create(); // Crashes if called twice
}
```

### ❌ No Listener Cleanup

```javascript
// WRONG
async destroy() {
  await this.#bridge.kill();
  // Listeners still attached!
}
```

### ❌ Missing JSDoc

```javascript
// WRONG
async read() { // No documentation
  return await this.#doRead();
}
```

---

**Component Structure Summary:**
1. ✅ Extends EventEmitter
2. ✅ Private fields with #
3. ✅ Idempotent initialize/destroy
4. ✅ Separate async initialization
5. ✅ Standard events (ready, data, error, change)
6. ✅ Cleanup all listeners in destroy
7. ✅ Validate config in constructor
8. ✅ JSDoc on all public methods
9. ✅ Files < 300 lines
10. ✅ ensureInitialized() guard
