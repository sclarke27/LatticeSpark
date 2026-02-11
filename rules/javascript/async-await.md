# Async/Await Patterns (CRITICAL)

> **ALWAYS use async/await. NEVER use callbacks or raw promise chains.**

---

## Rule 1: Async/Await Only (CRITICAL)

NEVER use callbacks or `.then()` chains.

**WRONG:**
```javascript
// Callback hell
sensor.read((error, data) => {
  if (error) return handleError(error);
  processData(data, (error, result) => {
    if (error) return handleError(error);
    saveResult(result, (error) => {
      // ...
    });
  });
});

// Promise chains
sensor.read()
  .then(data => processData(data))
  .then(result => saveResult(result))
  .catch(error => handleError(error));
```

**CORRECT:**
```javascript
async function readAndProcess() {
  try {
    const data = await sensor.read();
    const result = await processData(data);
    await saveResult(result);
  } catch (error) {
    handleError(error);
  }
}
```

**WHY:**
- Easier to read and maintain
- Better error handling
- Avoids callback hell
- Matches synchronous code structure

---

## Rule 2: Parallel Operations (CRITICAL)

Use `Promise.all()` for independent async operations.

**WRONG (Sequential - Slow):**
```javascript
// Takes 150ms total (50ms + 50ms + 50ms)
const temp = await sensors.dht11.read();      // 50ms
const distance = await sensors.ultrasonic.read(); // 50ms
const motion = await sensors.pir.read();      // 50ms
```

**CORRECT (Parallel - Fast):**
```javascript
// Takes 50ms total (concurrent)
const [temp, distance, motion] = await Promise.all([
  sensors.dht11.read(),
  sensors.ultrasonic.read(),
  sensors.pir.read()
]);
```

**WHY:**
- 3x faster for independent operations
- Better resource utilization
- Meets latency requirements

---

## Rule 3: Error Handling (CRITICAL)

ALWAYS wrap async calls in try/catch.

**WRONG:**
```javascript
async function readSensor() {
  const data = await sensor.read(); // Unhandled rejection risk
  return data;
}
```

**CORRECT:**
```javascript
async function readSensor() {
  try {
    const data = await sensor.read();
    return data;
  } catch (error) {
    logger.error('Sensor read failed', {
      sensor: 'dht11',
      error: error.message
    });
    throw new SensorError('Read failed', { cause: error });
  }
}
```

**WHY:**
- Prevents unhandled promise rejections
- Provides context for debugging
- Enables proper error propagation

---

## Rule 4: Promise.allSettled for Best Effort

Use `Promise.allSettled()` when some failures are acceptable.

**WRONG:**
```javascript
// Promise.all fails completely if ANY sensor fails
try {
  const [temp, distance, motion] = await Promise.all([
    sensors.dht11.read(),
    sensors.ultrasonic.read(),
    sensors.pir.read()
  ]);
} catch (error) {
  // Lost ALL data if one sensor failed
}
```

**CORRECT:**
```javascript
// Get partial results even if some sensors fail
const results = await Promise.allSettled([
  sensors.dht11.read(),
  sensors.ultrasonic.read(),
  sensors.pir.read()
]);

const readings = results
  .filter(r => r.status === 'fulfilled')
  .map(r => r.value);

const failures = results
  .filter(r => r.status === 'rejected')
  .map(r => r.reason);

if (failures.length > 0) {
  logger.warn('Some sensors failed', { failures });
}
```

**WHY:**
- Graceful degradation
- Partial data is better than no data
- System continues with available sensors

---

## Rule 5: Async Constructors (Anti-Pattern)

NEVER make constructors async. Use separate `initialize()`.

**WRONG:**
```javascript
class Sensor {
  async constructor(config) { // ILLEGAL - constructors can't be async
    this.bridge = await createBridge(config);
  }
}
```

**CORRECT:**
```javascript
class Sensor {
  #bridge = null;
  #isInitialized = false;

  constructor(config) {
    // Synchronous setup only
    this.config = config;
  }

  async initialize() {
    if (this.#isInitialized) return; // Idempotent

    this.#bridge = await createBridge(this.config);
    this.#isInitialized = true;
  }

  async read() {
    if (!this.#isInitialized) {
      throw new Error('Call initialize() first');
    }
    return await this.#bridge.send({ method: 'read' });
  }
}

// Usage
const sensor = new Sensor({ pin: 17 });
await sensor.initialize();
const data = await sensor.read();
```

**WHY:**
- Constructors can't be async in JavaScript
- Separates object creation from async initialization
- Initialize can be idempotent

---

## Rule 6: EventEmitter + Async

Async operations in event handlers MUST be wrapped.

**WRONG:**
```javascript
emitter.on('data', async (data) => {
  await processData(data); // Errors silently swallowed
});
```

**CORRECT:**
```javascript
emitter.on('data', (data) => {
  processDataAsync(data).catch(error => {
    logger.error('Event handler failed', error);
    emitter.emit('error', error);
  });
});

async function processDataAsync(data) {
  await processData(data);
}
```

**WHY:**
- Event emitters don't catch async errors
- Explicit error handling required
- Errors are properly logged/emitted

---

## Rule 7: Timeouts for All I/O

ALWAYS add timeouts to prevent hanging.

**WRONG:**
```javascript
async function readSensor() {
  return await sensor.read(); // Could hang forever
}
```

**CORRECT:**
```javascript
async function readSensor() {
  const timeout = 5000; // 5 seconds

  return await Promise.race([
    sensor.read(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError('Sensor read timeout')), timeout)
    )
  ]);
}

// Or use a utility
async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(`Timeout after ${ms}ms`)), ms)
    )
  ]);
}

// Usage
await withTimeout(sensor.read(), 5000);
```

**WHY:**
- Hardware can freeze/disconnect
- Prevents indefinite waiting
- Enables recovery strategies

---

## Rule 8: No Floating Promises

ALWAYS await or explicitly handle promises.

**WRONG:**
```javascript
function startPolling() {
  pollSensor(); // Floating promise - no error handling
}

async function pollSensor() {
  const data = await sensor.read();
  process(data);
}
```

**CORRECT:**
```javascript
function startPolling() {
  pollSensor().catch(error => {
    logger.error('Polling failed', error);
  });
}

async function pollSensor() {
  const data = await sensor.read();
  process(data);
}
```

**WHY:**
- Unhandled rejections crash Node.js
- Explicit error handling required
- Makes async control flow visible

---

## Metrics

- **All I/O operations:** MUST be async/await
- **No callbacks:** 0 allowed
- **No .then() chains:** 0 allowed
- **Try/catch coverage:** 100% of async calls
- **Timeout coverage:** 100% of I/O operations

---

## Verification Checklist

Before submitting code, verify:

- [ ] No callback functions for async operations
- [ ] No `.then()` or `.catch()` chains
- [ ] All async operations in try/catch blocks
- [ ] Independent operations use `Promise.all()`
- [ ] Best-effort operations use `Promise.allSettled()`
- [ ] No async constructors (separate `initialize()`)
- [ ] Event handlers wrap async with `.catch()`
- [ ] All I/O operations have timeouts
- [ ] No floating promises (all awaited or .catch())
- [ ] ESLint passes with no-floating-promises rule

---

## Common Patterns

### Pattern: Retry with Backoff

```javascript
async function readWithRetry(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sensor.read();
    } catch (error) {
      if (attempt === maxAttempts) throw error;

      const delay = Math.pow(2, attempt) * 100; // Exponential backoff
      await sleep(delay);
    }
  }
}
```

### Pattern: Debounced Async

```javascript
function debounceAsync(fn, delayMs) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    return new Promise((resolve) => {
      timeoutId = setTimeout(async () => {
        resolve(await fn.apply(this, args));
      }, delayMs);
    });
  };
}
```

### Pattern: Queue for Sequential Processing

```javascript
class AsyncQueue {
  #queue = [];
  #processing = false;

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.#queue.push(async () => {
        try {
          resolve(await fn());
        } catch (error) {
          reject(error);
        }
      });
      this.#process();
    });
  }

  async #process() {
    if (this.#processing || this.#queue.length === 0) return;

    this.#processing = true;
    const fn = this.#queue.shift();
    await fn();
    this.#processing = false;

    this.#process(); // Process next
  }
}
```

---

## Anti-Patterns (NEVER DO THIS)

### ❌ Mixing Callbacks and Promises

```javascript
// WRONG - Confusing mix
async function bad() {
  return new Promise((resolve) => {
    setTimeout(async () => {
      const data = await fetch(); // Mixing!
      resolve(data);
    }, 1000);
  });
}
```

### ❌ Unnecessary async Keyword

```javascript
// WRONG - Function doesn't await anything
async function getData() {
  return { value: 123 }; // Not async operation
}

// CORRECT
function getData() {
  return { value: 123 };
}
```

### ❌ Await in Loop (when parallel possible)

```javascript
// WRONG - Sequential (slow)
for (const sensor of sensors) {
  await sensor.read(); // Each waits for previous
}

// CORRECT - Parallel (fast)
await Promise.all(sensors.map(s => s.read()));
```

---

**Rule Summary:**
1. ✅ Async/await only, never callbacks
2. ✅ Promise.all() for parallel operations
3. ✅ Always use try/catch
4. ✅ Promise.allSettled() for best effort
5. ✅ No async constructors
6. ✅ Handle errors in event handlers
7. ✅ Add timeouts to all I/O
8. ✅ No floating promises
