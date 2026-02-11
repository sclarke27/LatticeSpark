# Error Handling (CRITICAL)

> **Circuit breaker pattern MANDATORY. All errors must have context. Never silent failures.**

---

## Rule 1: Circuit Breaker Pattern (CRITICAL)

MANDATORY for all hardware components.

**States:**
- **CLOSED:** Normal operation
- **OPEN:** After failures, stop trying
- **HALF_OPEN:** Test if recovered

**Implementation:**

```javascript
class CircuitBreaker {
  #state = 'CLOSED';
  #failureCount = 0;
  #failureThreshold = 3;
  #resetTimeout = 30000; // 30s
  #lastFailureTime = 0;

  async execute(fn) {
    if (this.#state === 'OPEN') {
      if (Date.now() - this.#lastFailureTime > this.#resetTimeout) {
        this.#state = 'HALF_OPEN';
      } else {
        throw new CircuitOpenError('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();

      // Success in HALF_OPEN → CLOSED
      if (this.#state === 'HALF_OPEN') {
        this.#state = 'CLOSED';
        this.#failureCount = 0;
      }

      return result;
    } catch (error) {
      this.#failureCount++;
      this.#lastFailureTime = Date.now();

      // Too many failures → OPEN
      if (this.#failureCount >= this.#failureThreshold) {
        this.#state = 'OPEN';
      }

      throw error;
    }
  }

  get state() {
    return this.#state;
  }
}

// Usage
class Sensor {
  #circuitBreaker = new CircuitBreaker();

  async read() {
    return await this.#circuitBreaker.execute(async () => {
      return await this.#doRead();
    });
  }
}
```

**WHY:**
- Prevents cascading failures
- Gives failing components time to recover
- System continues with degraded functionality

---

## Rule 2: Error Hierarchy (REQUIRED)

Create domain-specific error classes.

**WRONG:**
```javascript
throw new Error('Sensor failed'); // Too generic
throw new Error(`Pin ${pin} invalid`); // String only
```

**CORRECT:**
```javascript
// Base error class
export class CrowPi3Error extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.timestamp = Date.now();

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Domain-specific errors
export class SensorError extends CrowPi3Error {
  constructor(message, { sensor, code, recoverable = false, cause } = {}) {
    super(message, { sensor, code, recoverable, cause });
  }
}

export class BridgeError extends CrowPi3Error {
  constructor(message, { bridgeId, process, cause } = {}) {
    super(message, { bridgeId, process, cause });
  }
}

export class ValidationError extends CrowPi3Error {
  constructor(message, { field, value, constraint } = {}) {
    super(message, { field, value, constraint });
  }
}

export class TimeoutError extends CrowPi3Error {
  constructor(message, { operation, timeout } = {}) {
    super(message, { operation, timeout });
  }
}

export class CircuitOpenError extends CrowPi3Error {
  constructor(message, { component, state } = {}) {
    super(message, { component, state });
  }
}

// Usage
if (pin < 0 || pin > 27) {
  throw new ValidationError('Invalid GPIO pin', {
    field: 'pin',
    value: pin,
    constraint: '0-27'
  });
}

try {
  await sensor.read();
} catch (error) {
  throw new SensorError('Failed to read sensor', {
    sensor: 'dht11',
    code: 'READ_FAILED',
    recoverable: true,
    cause: error
  });
}
```

**WHY:**
- Error type identifies category
- Context enables debugging
- Recoverable flag guides retry logic
- Cause preserves error chain

---

## Rule 3: Error Context (MANDATORY)

ALWAYS add context when catching and re-throwing.

**WRONG:**
```javascript
try {
  await bridge.send(command);
} catch (error) {
  throw error; // Lost context!
}
```

**CORRECT:**
```javascript
try {
  await bridge.send(command);
} catch (error) {
  throw new BridgeError('Command failed', {
    bridgeId: this.id,
    command: command.method,
    cause: error
  });
}
```

**WHY:**
- Preserves error chain
- Adds context at each layer
- Easier debugging
- Better log messages

---

## Rule 4: Retry with Exponential Backoff (REQUIRED)

For transient failures, retry with increasing delays.

**WRONG:**
```javascript
// Fixed retry without backoff
for (let i = 0; i < 3; i++) {
  try {
    return await operation();
  } catch (error) {
    await sleep(1000); // Same delay every time
  }
}
```

**CORRECT:**
```javascript
async function retryWithBackoff(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Last attempt - throw
      if (attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff: 100ms, 200ms, 400ms, 800ms...
      const delay = Math.min(
        100 * Math.pow(2, attempt),
        5000 // Max 5 seconds
      );

      logger.warn('Operation failed, retrying...', {
        attempt,
        maxAttempts,
        delayMs: delay,
        error: error.message
      });

      await sleep(delay);
    }
  }
}

// Usage
const data = await retryWithBackoff(
  () => sensor.read(),
  3 // Max 3 attempts
);
```

**WHY:**
- Gives time for transient issues to clear
- Exponential backoff prevents overwhelming system
- Logged attempts aid debugging

---

## Rule 5: Graceful Degradation (REQUIRED)

System continues with reduced functionality, not total failure.

**WRONG:**
```javascript
async function readAllSensors() {
  const temp = await sensors.dht11.read(); // Throws, stops everything
  const distance = await sensors.ultrasonic.read();
  const motion = await sensors.pir.read();

  return { temp, distance, motion };
}
```

**CORRECT:**
```javascript
async function readAllSensors() {
  const results = await Promise.allSettled([
    sensors.dht11.read().catch(e => null),
    sensors.ultrasonic.read().catch(e => null),
    sensors.pir.read().catch(e => null)
  ]);

  const [temp, distance, motion] = results.map(r =>
    r.status === 'fulfilled' ? r.value : null
  );

  // Log failures but continue
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn('Sensor read failed', {
        sensor: ['dht11', 'ultrasonic', 'pir'][index],
        error: result.reason.message
      });
    }
  });

  return {
    temp: temp ?? { temperature: null, humidity: null },
    distance: distance ?? null,
    motion: motion ?? null,
    partial: results.some(r => r.status === 'rejected')
  };
}
```

**WHY:**
- Partial data better than no data
- UI shows available sensors
- System remains functional

---

## Rule 6: Log ALL Errors (MANDATORY)

NEVER silently catch errors.

**WRONG:**
```javascript
try {
  await sensor.read();
} catch (error) {
  // Silent failure - impossible to debug!
}

try {
  await sensor.read();
} catch (error) {
  console.log(error); // Lost in production
}
```

**CORRECT:**
```javascript
try {
  await sensor.read();
} catch (error) {
  logger.error('Sensor read failed', {
    sensor: 'dht11',
    error: error.message,
    stack: error.stack,
    context: error.context
  });

  throw error; // Re-throw after logging
}

// Or if error is expected and handled:
try {
  await sensor.read();
} catch (error) {
  logger.warn('Sensor read failed, using cached value', {
    sensor: 'dht11',
    error: error.message,
    fallback: 'cached'
  });

  return this.cachedValue; // Graceful fallback
}
```

**WHY:**
- Structured logs enable debugging
- Error context preserved
- Production issues traceable

---

## Rule 7: Input Validation (REQUIRED)

Validate at system boundaries.

**WRONG:**
```javascript
class Sensor {
  constructor(config) {
    this.pin = config.pin; // No validation!
  }
}
```

**CORRECT:**
```javascript
class Sensor {
  constructor(config) {
    this.#validateConfig(config);
    this.pin = config.pin;
  }

  #validateConfig(config) {
    // Check required fields
    if (!config.pin) {
      throw new ValidationError('Pin is required', {
        field: 'pin',
        value: config.pin
      });
    }

    // Type validation
    if (typeof config.pin !== 'number') {
      throw new ValidationError('Pin must be a number', {
        field: 'pin',
        value: config.pin,
        expectedType: 'number',
        actualType: typeof config.pin
      });
    }

    // Range validation
    if (config.pin < 0 || config.pin > 27) {
      throw new ValidationError('Pin out of range', {
        field: 'pin',
        value: config.pin,
        constraint: '0-27'
      });
    }

    // Optional field validation
    if (config.timeout !== undefined) {
      if (typeof config.timeout !== 'number' || config.timeout < 0) {
        throw new ValidationError('Invalid timeout', {
          field: 'timeout',
          value: config.timeout,
          constraint: 'positive number'
        });
      }
    }
  }
}
```

**WHY:**
- Fail fast with clear messages
- Prevents invalid state
- Easier to debug
- Security (prevent injection)

---

## Rule 8: Resource Cleanup (CRITICAL)

ALWAYS clean up, even on errors.

**WRONG:**
```javascript
async function processData() {
  const bridge = await createBridge();
  await bridge.send(data); // If this throws, bridge leaks
  await bridge.close();
}
```

**CORRECT:**
```javascript
async function processData() {
  let bridge;
  try {
    bridge = await createBridge();
    await bridge.send(data);
  } finally {
    // ALWAYS runs, even on error
    if (bridge) {
      await bridge.close();
    }
  }
}

// Or use resource manager
class ResourceManager {
  #resources = [];

  register(resource, cleanup) {
    this.#resources.push({ resource, cleanup });
    return resource;
  }

  async dispose() {
    for (const { cleanup } of this.#resources.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        logger.error('Cleanup failed', error);
      }
    }
    this.#resources = [];
  }
}

// Usage
async function processData() {
  const rm = new ResourceManager();
  try {
    const bridge = rm.register(
      await createBridge(),
      (b) => b.close()
    );

    await bridge.send(data);
  } finally {
    await rm.dispose(); // Guaranteed cleanup
  }
}
```

**WHY:**
- Prevents resource leaks
- Stable long-running processes
- Proper shutdown

---

## Metrics

- **Error catching:** 100% of async operations in try/catch
- **Error logging:** 100% of caught errors logged
- **Circuit breaker:** 100% of hardware components
- **Input validation:** 100% at boundaries
- **Resource cleanup:** 100% guaranteed via finally
- **Silent failures:** 0 allowed

---

## Verification Checklist

- [ ] All async operations in try/catch
- [ ] Circuit breaker implemented for hardware
- [ ] Custom error classes used (not generic Error)
- [ ] Errors include context (sensor, operation, etc.)
- [ ] Retry logic uses exponential backoff
- [ ] Failed sensors don't crash entire system
- [ ] All errors logged with structured context
- [ ] Input validation at constructors/methods
- [ ] Resources cleaned up in finally blocks
- [ ] No silent catch blocks (all log or re-throw)

---

## Common Patterns

### Pattern: Error Boundary Component

```javascript
class ErrorBoundary {
  #component;
  #fallback;
  #onError;

  constructor(component, { fallback, onError } = {}) {
    this.#component = component;
    this.#fallback = fallback;
    this.#onError = onError;
  }

  async execute(method, ...args) {
    try {
      return await this.#component[method](...args);
    } catch (error) {
      logger.error('Component error', {
        component: this.#component.constructor.name,
        method,
        error: error.message
      });

      if (this.#onError) {
        this.#onError(error);
      }

      if (this.#fallback) {
        return this.#fallback;
      }

      throw error;
    }
  }
}

// Usage
const safeSensor = new ErrorBoundary(sensor, {
  fallback: { temperature: null, humidity: null },
  onError: (error) => ui.showSensorOffline('dht11')
});

const reading = await safeSensor.execute('read');
```

### Pattern: Result Type (No Exceptions)

```javascript
class Result {
  constructor(value, error) {
    this.value = value;
    this.error = error;
  }

  get isSuccess() {
    return this.error === null;
  }

  get isFailure() {
    return this.error !== null;
  }

  static success(value) {
    return new Result(value, null);
  }

  static failure(error) {
    return new Result(null, error);
  }

  unwrap() {
    if (this.isFailure) {
      throw this.error;
    }
    return this.value;
  }
}

async function readSensorSafe() {
  try {
    const value = await sensor.read();
    return Result.success(value);
  } catch (error) {
    return Result.failure(error);
  }
}

// Usage
const result = await readSensorSafe();
if (result.isSuccess) {
  console.log('Value:', result.value);
} else {
  console.error('Error:', result.error);
}
```

---

## Anti-Patterns (NEVER DO THIS)

### ❌ Catching to Suppress

```javascript
// WRONG - Hiding errors
try {
  await dangerousOperation();
} catch (error) {
  return null; // Silent failure!
}

// CORRECT - Log and handle
try {
  await dangerousOperation();
} catch (error) {
  logger.error('Operation failed', error);
  throw new OperationError('Failed', { cause: error });
}
```

### ❌ String Errors

```javascript
// WRONG
throw 'Something went wrong'; // String, not Error

// CORRECT
throw new Error('Something went wrong');
```

### ❌ No Error Context

```javascript
// WRONG
throw new Error('Read failed');

// CORRECT
throw new SensorError('Read failed', {
  sensor: 'dht11',
  pin: 17,
  operation: 'read',
  timestamp: Date.now()
});
```

---

**Error Handling Summary:**
1. ✅ Circuit breaker for all hardware (CRITICAL)
2. ✅ Custom error hierarchy with context
3. ✅ Add context when re-throwing
4. ✅ Retry with exponential backoff
5. ✅ Graceful degradation (partial results OK)
6. ✅ Log all errors (no silent failures)
7. ✅ Validate inputs at boundaries
8. ✅ Clean up resources in finally
