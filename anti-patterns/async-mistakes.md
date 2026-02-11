# Async/Await Anti-Patterns

> **Common async mistakes that break hardware components. NEVER do these.**

---

## ❌ Anti-Pattern 1: Sequential When Parallel Possible

**WRONG:**
```javascript
// Takes 150ms total (50ms + 50ms + 50ms)
async function readAllSensors() {
  const temp = await sensors.dht11.read();        // Wait 50ms
  const distance = await sensors.ultrasonic.read(); // Wait 50ms
  const motion = await sensors.pir.read();        // Wait 50ms

  return { temp, distance, motion };
}
```

**WHY IT'S WRONG:**
- 3x slower than necessary
- Misses latency requirements (< 100ms)
- Poor user experience
- Wastes CPU time waiting

**CORRECT:**
```javascript
// Takes 50ms total (concurrent)
async function readAllSensors() {
  const [temp, distance, motion] = await Promise.all([
    sensors.dht11.read(),
    sensors.ultrasonic.read(),
    sensors.pir.read()
  ]);

  return { temp, distance, motion };
}
```

**DETECTION:**
```bash
# Search for sequential awaits
grep -A 3 "await.*\.read()" src/ | grep "await.*\.read()"
```

---

## ❌ Anti-Pattern 2: Async Fire and Forget

**WRONG:**
```javascript
function startPolling() {
  pollSensor(); // Floating promise - no error handling!
}

async function pollSensor() {
  const data = await sensor.read(); // Error silently crashes!
  process(data);
}
```

**WHY IT'S WRONG:**
- Unhandled promise rejection crashes Node.js
- Errors disappear silently
- Impossible to debug
- Violates error handling rules

**CORRECT:**
```javascript
function startPolling() {
  pollSensor().catch(error => {
    logger.error('Polling failed', error);
    // Optionally retry or alert
  });
}

async function pollSensor() {
  try {
    const data = await sensor.read();
    process(data);
  } catch (error) {
    throw error; // Propagate to .catch()
  }
}
```

**DETECTION:**
```javascript
// ESLint rule
"no-floating-promises": "error"
```

---

## ❌ Anti-Pattern 3: Try/Catch Around Non-Async

**WRONG:**
```javascript
async function readSensor() {
  try {
    const config = loadConfig(); // Synchronous!
    return await sensor.read();
  } catch (error) {
    // Only catches sensor.read() errors, not loadConfig()!
    logger.error('Read failed', error);
  }
}
```

**WHY IT'S WRONG:**
- Synchronous errors not caught by async try/catch
- loadConfig() errors crash the process
- False sense of security
- Inconsistent error handling

**CORRECT:**
```javascript
async function readSensor() {
  let config;

  // Separate try/catch for sync operations
  try {
    config = loadConfig();
  } catch (error) {
    throw new ConfigError('Config load failed', { cause: error });
  }

  // Try/catch for async operations
  try {
    return await sensor.read();
  } catch (error) {
    throw new SensorError('Read failed', { cause: error });
  }
}

// Or wrap everything
async function readSensor() {
  try {
    const config = loadConfig(); // Works for both sync and async
    return await sensor.read();
  } catch (error) {
    logger.error('Operation failed', error);
    throw error;
  }
}
```

---

## ❌ Anti-Pattern 4: Await in Loop (Wrong Place)

**WRONG:**
```javascript
// Processes one at a time - very slow
async function processSensors(sensors) {
  for (const sensor of sensors) {
    await sensor.read(); // Each waits for previous
    await sensor.process(); // Sequential processing
  }
}
```

**WHY IT'S WRONG:**
- Serializes independent operations
- N sensors = N × latency
- Doesn't scale
- Misses parallelism opportunity

**CORRECT:**
```javascript
// Process all in parallel
async function processSensors(sensors) {
  await Promise.all(
    sensors.map(async (sensor) => {
      const data = await sensor.read();
      await sensor.process();
    })
  );
}

// Or if order matters, use for...of with parallel batches
async function processSensors(sensors) {
  for (const sensor of sensors) {
    // Each sensor processed sequentially
    // But multiple steps in parallel
    const [data, metadata] = await Promise.all([
      sensor.read(),
      sensor.getMetadata()
    ]);
    await sensor.process(data, metadata);
  }
}
```

---

## ❌ Anti-Pattern 5: Missing Timeout

**WRONG:**
```javascript
async function readSensor() {
  return await sensor.read(); // Could hang forever!
}
```

**WHY IT'S WRONG:**
- Hardware can freeze
- Sensor can disconnect
- I2C bus can hang
- Process waits indefinitely
- System appears frozen

**CORRECT:**
```javascript
async function readSensor() {
  const timeout = 5000; // 5 seconds

  return await Promise.race([
    sensor.read(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError('Sensor timeout')), timeout)
    )
  ]);
}

// Or use utility
async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(`Timeout after ${ms}ms`)), ms)
    )
  ]);
}

const data = await withTimeout(sensor.read(), 5000);
```

---

## ❌ Anti-Pattern 6: Returning Await Unnecessarily

**WRONG:**
```javascript
async function readSensor() {
  return await sensor.read(); // Unnecessary await
}
```

**WHY IT'S WRONG:**
- Extra microtask in event loop
- Slightly slower
- No benefit
- Wastes resources

**CORRECT:**
```javascript
// If just returning, no need for await
async function readSensor() {
  return sensor.read(); // Returns promise directly
}

// Only await if you need the value
async function readAndLog() {
  const data = await sensor.read(); // Need value to log
  logger.info('Read data', data);
  return data;
}

// Or need try/catch
async function readSafely() {
  try {
    return await sensor.read(); // await needed for try/catch
  } catch (error) {
    logger.error('Read failed', error);
    throw error;
  }
}
```

**EXCEPTION:** It's OK to keep `return await` if you have try/catch.

---

## ❌ Anti-Pattern 7: Async EventEmitter Handlers

**WRONG:**
```javascript
emitter.on('data', async (data) => {
  await processData(data); // Errors silently swallowed!
});
```

**WHY IT'S WRONG:**
- EventEmitter doesn't handle async errors
- Unhandled rejection if processData() throws
- Error disappears completely
- Impossible to debug

**CORRECT:**
```javascript
emitter.on('data', (data) => {
  processDataAsync(data).catch(error => {
    logger.error('Event handler error', error);
    emitter.emit('error', error);
  });
});

async function processDataAsync(data) {
  await processData(data);
}

// Or wrap in utility
function asyncHandler(fn) {
  return function(...args) {
    fn(...args).catch(error => {
      logger.error('Async handler error', error);
      this.emit('error', error); // 'this' is emitter
    });
  };
}

emitter.on('data', asyncHandler(async (data) => {
  await processData(data);
}));
```

---

## ❌ Anti-Pattern 8: Promise Constructor Misuse

**WRONG:**
```javascript
async function readSensor() {
  return new Promise(async (resolve, reject) => { // async in Promise!
    try {
      const data = await sensor.read();
      resolve(data);
    } catch (error) {
      reject(error);
    }
  });
}
```

**WHY IT'S WRONG:**
- Unnecessary Promise wrapper
- async callback is anti-pattern
- Overly complex
- sensor.read() already returns Promise

**CORRECT:**
```javascript
// Just return the promise directly
async function readSensor() {
  return await sensor.read();
}

// Or even simpler
async function readSensor() {
  return sensor.read();
}

// Only use new Promise for callback-based APIs
function readSensorCallback(callback) {
  return new Promise((resolve, reject) => {
    callback((error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}
```

---

## ❌ Anti-Pattern 9: Mixing Callbacks and Promises

**WRONG:**
```javascript
async function readSensor(callback) { // Confused API
  try {
    const data = await sensor.read();
    callback(null, data);
  } catch (error) {
    callback(error);
  }
}
```

**WHY IT'S WRONG:**
- Confusing API (async but uses callback)
- Mixes paradigms
- Can't use with await properly
- Hard to compose

**CORRECT:**
```javascript
// Choose one paradigm

// Option 1: Async/await (preferred)
async function readSensor() {
  return await sensor.read();
}

// Usage
const data = await readSensor();

// Option 2: Callback only (legacy)
function readSensor(callback) {
  sensor.read()
    .then(data => callback(null, data))
    .catch(error => callback(error));
}

// Usage
readSensor((error, data) => { /* ... */ });
```

---

## ❌ Anti-Pattern 10: Ignoring Promise.allSettled Results

**WRONG:**
```javascript
async function readAllSensors() {
  const results = await Promise.allSettled([
    sensors.dht11.read(),
    sensors.ultrasonic.read(),
    sensors.pir.read()
  ]);

  // Ignores failures!
  return results.map(r => r.value);
}
```

**WHY IT'S WRONG:**
- Failures silently ignored
- Returns undefined for failed sensors
- No error logging
- System appears to work but missing data

**CORRECT:**
```javascript
async function readAllSensors() {
  const results = await Promise.allSettled([
    sensors.dht11.read(),
    sensors.ultrasonic.read(),
    sensors.pir.read()
  ]);

  // Handle both success and failure
  const readings = {};
  const failures = [];

  results.forEach((result, index) => {
    const sensorName = ['dht11', 'ultrasonic', 'pir'][index];

    if (result.status === 'fulfilled') {
      readings[sensorName] = result.value;
    } else {
      readings[sensorName] = null;
      failures.push({
        sensor: sensorName,
        error: result.reason
      });
    }
  });

  // Log failures
  if (failures.length > 0) {
    logger.warn('Some sensors failed', { failures });
  }

  return {
    readings,
    failures,
    partial: failures.length > 0
  };
}
```

---

## 🔍 Detection Checklist

Run these checks to find anti-patterns:

```bash
# Sequential awaits in loops
grep -rn "for.*of\|for.*in" src/ | xargs -I {} sh -c 'grep -A 5 "{}" | grep await'

# Floating promises
npm run lint -- --rule "no-floating-promises: error"

# Missing timeouts on I/O
grep -rn "sensor\.read()\|bridge\.send(" src/ | grep -v "timeout\|race"

# Async event handlers
grep -rn "\.on(.*async" src/

# Unnecessary return await
grep -rn "return await.*;" src/ | grep -v "try\|catch"

# Promise constructor with async
grep -rn "new Promise(async" src/

# Mixed callbacks and promises
grep -rn "async.*callback" src/
```

---

## 🎯 Quick Reference

| Anti-Pattern | Detection | Fix |
|-------------|-----------|-----|
| Sequential awaits | Multiple awaits in sequence | Use Promise.all() |
| Floating promises | Function calls without await/catch | Add .catch() |
| Missing timeout | I/O without Promise.race() | Add timeout wrapper |
| Async event handler | .on(..., async () =>) | Wrap with .catch() |
| Return await | return await (no try/catch) | Remove await |
| Promise constructor | new Promise(async ...) | Don't wrap async |
| Mixed paradigms | async + callback | Choose one |

---

## ✅ Verification

Before committing:

- [ ] No sequential awaits for independent operations
- [ ] All async calls have error handling
- [ ] All I/O operations have timeouts
- [ ] Event handlers wrap async with .catch()
- [ ] No unnecessary "return await"
- [ ] No async in Promise constructor
- [ ] No mixing callbacks and promises
- [ ] Promise.allSettled results checked
- [ ] ESLint no-floating-promises enabled
- [ ] All async functions in try/catch

---

**Remember:** If you're unsure, check the examples in [rules/javascript/async-await.md](../rules/javascript/async-await.md)
