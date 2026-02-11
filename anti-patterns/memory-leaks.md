# Memory Leak Anti-Patterns

> **Common patterns that leak memory in long-running hardware processes. NEVER do these.**

---

## ❌ Anti-Pattern 1: Event Listeners Not Removed

**WRONG:**
```javascript
class Sensor extends EventEmitter {
  async initialize() {
    // Adds listener every time initialize() is called
    this.#bridge.on('data', (data) => this.emit('data', data));
  }

  async destroy() {
    await this.#bridge.kill();
    // Listeners never removed - MEMORY LEAK!
  }
}

// After 100 destroy/initialize cycles:
// 100 listeners attached, all keeping references
```

**WHY IT'S WRONG:**
- Listeners accumulate on each initialization
- Old listeners keep objects alive
- Memory grows indefinitely
- Eventually: "MaxListenersExceededWarning"
- Then: Out of memory crash

**CORRECT:**
```javascript
class Sensor extends EventEmitter {
  #dataHandler = null;

  async initialize() {
    // Remove old listener if exists
    if (this.#dataHandler) {
      this.#bridge.off('data', this.#dataHandler);
    }

    // Add new listener
    this.#dataHandler = (data) => this.emit('data', data);
    this.#bridge.on('data', this.#dataHandler);
  }

  async destroy() {
    // CRITICAL: Remove listener
    if (this.#dataHandler) {
      this.#bridge.off('data', this.#dataHandler);
      this.#dataHandler = null;
    }

    // Remove ALL listeners from this object
    this.removeAllListeners();

    await this.#bridge.kill();
  }
}
```

**DETECTION:**
```javascript
// Check listener count
console.log(emitter.listenerCount('data'));

// Enable warnings
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    console.error('Memory leak: Too many listeners', warning);
  }
});
```

---

## ❌ Anti-Pattern 2: Timers Not Cleared

**WRONG:**
```javascript
class Sensor {
  startPolling() {
    setInterval(() => {
      this.read(); // Runs forever!
    }, 1000);
  }

  async destroy() {
    // Timer keeps running - MEMORY LEAK!
  }
}
```

**WHY IT'S WRONG:**
- Timer keeps firing after destroy
- Holds reference to `this`
- Prevents garbage collection
- CPU waste
- Memory grows with each read

**CORRECT:**
```javascript
class Sensor {
  #pollInterval = null;

  startPolling() {
    // Clear any existing interval
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
    }

    this.#pollInterval = setInterval(() => {
      this.read();
    }, 1000);
  }

  stopPolling() {
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = null;
    }
  }

  async destroy() {
    // CRITICAL: Clear timer
    this.stopPolling();
    this.removeAllListeners();
  }
}
```

**DETECTION:**
```bash
# Search for setInterval without clearInterval
grep -rn "setInterval" src/ | while read line; do
  file=$(echo $line | cut -d: -f1)
  if ! grep -q "clearInterval" "$file"; then
    echo "Potential leak: $line"
  fi
done
```

---

## ❌ Anti-Pattern 3: Circular References

**WRONG:**
```javascript
class Sensor {
  #bridge = null;

  async initialize() {
    this.#bridge = await createBridge();

    // Circular reference!
    this.#bridge.sensor = this; // Bridge points to sensor
    // Sensor already points to bridge via this.#bridge
  }

  async destroy() {
    await this.#bridge.kill();
    // Circular reference prevents GC!
  }
}
```

**WHY IT'S WRONG:**
- Circular references prevent garbage collection
- Both objects stay in memory
- Accumulates with each new sensor
- Hard to debug
- Subtle memory leak

**CORRECT:**
```javascript
class Sensor {
  #bridge = null;

  async initialize() {
    this.#bridge = await createBridge();
    // No back-reference - one-way only
  }

  async destroy() {
    if (this.#bridge) {
      await this.#bridge.kill();
      this.#bridge = null; // CRITICAL: Break reference
    }
  }
}

// If you need back-reference, use WeakMap
const sensorMap = new WeakMap();

class Sensor {
  async initialize() {
    this.#bridge = await createBridge();
    sensorMap.set(this.#bridge, this); // Weak reference
  }

  async destroy() {
    if (this.#bridge) {
      sensorMap.delete(this.#bridge);
      await this.#bridge.kill();
      this.#bridge = null;
    }
  }
}
```

---

## ❌ Anti-Pattern 4: Closures Holding Large Objects

**WRONG:**
```javascript
class SensorManager {
  #sensors = [];

  async addSensor(config) {
    const sensor = new Sensor(config);
    await sensor.initialize();

    // Closure captures entire 'this' including all sensors!
    sensor.on('data', (data) => {
      this.processData(sensor, data); // 'this' captured
    });

    this.#sensors.push(sensor);
    // Each sensor holds reference to all other sensors!
  }
}
```

**WHY IT'S WRONG:**
- Closure captures entire `this` object
- Each sensor holds all previous sensors
- Memory compounds: N sensors = N² memory
- Prevents any sensor from being collected
- Grows exponentially

**CORRECT:**
```javascript
class SensorManager {
  #sensors = [];

  async addSensor(config) {
    const sensor = new Sensor(config);
    await sensor.initialize();

    // Extract method to avoid capturing 'this'
    const handler = this.#createDataHandler(sensor);
    sensor.on('data', handler);

    this.#sensors.push(sensor);
  }

  #createDataHandler(sensor) {
    // Only captures sensor, not entire 'this'
    return (data) => {
      this.processData(sensor, data);
    };
  }

  // Or use arrow function carefully
  async addSensor(config) {
    const sensor = new Sensor(config);
    await sensor.initialize();

    // Use WeakMap to avoid closure
    const manager = this;
    sensor.on('data', function(data) {
      // 'this' is sensor, not manager
      manager.processData(this, data);
    });

    this.#sensors.push(sensor);
  }
}
```

---

## ❌ Anti-Pattern 5: Growing Arrays Never Cleared

**WRONG:**
```javascript
class DataLogger {
  #readings = [];

  logReading(data) {
    this.#readings.push(data); // Grows forever!
  }

  getReadings() {
    return this.#readings;
  }
}

// After 1 million readings: Out of memory!
```

**WHY IT'S WRONG:**
- Array grows indefinitely
- No size limit
- Old data never removed
- Eventually: Out of memory
- Common in long-running processes

**CORRECT:**
```javascript
class DataLogger {
  #readings = [];
  #maxReadings = 1000; // Limit size

  logReading(data) {
    this.#readings.push(data);

    // CRITICAL: Maintain size limit
    if (this.#readings.length > this.#maxReadings) {
      this.#readings.shift(); // Remove oldest
    }
  }

  getReadings() {
    return [...this.#readings]; // Return copy
  }

  clear() {
    this.#readings = []; // Explicit clear
  }
}

// Or use circular buffer
class CircularBuffer {
  #buffer;
  #size;
  #index = 0;

  constructor(size) {
    this.#size = size;
    this.#buffer = new Array(size);
  }

  push(item) {
    this.#buffer[this.#index] = item;
    this.#index = (this.#index + 1) % this.#size;
  }

  getAll() {
    return this.#buffer.filter(x => x !== undefined);
  }
}
```

---

## ❌ Anti-Pattern 6: Caches Without Eviction

**WRONG:**
```javascript
class SensorCache {
  #cache = new Map();

  set(sensor, value) {
    this.#cache.set(sensor, value); // Grows forever!
  }

  get(sensor) {
    return this.#cache.get(sensor);
  }
}
```

**WHY IT'S WRONG:**
- Cache grows indefinitely
- Old entries never removed
- Dead sensors stay in memory
- No TTL or size limit
- Eventually: Out of memory

**CORRECT:**
```javascript
class SensorCache {
  #cache = new Map();
  #maxSize = 100;
  #ttl = 60000; // 60 seconds

  set(sensor, value) {
    // Add timestamp
    this.#cache.set(sensor, {
      value,
      timestamp: Date.now()
    });

    // Evict old entries
    this.#evict();
  }

  get(sensor) {
    const entry = this.#cache.get(sensor);

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.#ttl) {
      this.#cache.delete(sensor);
      return null;
    }

    return entry.value;
  }

  #evict() {
    // Size-based eviction (LRU would be better)
    if (this.#cache.size > this.#maxSize) {
      const firstKey = this.#cache.keys().next().value;
      this.#cache.delete(firstKey);
    }

    // TTL-based eviction
    const now = Date.now();
    for (const [key, entry] of this.#cache.entries()) {
      if (now - entry.timestamp > this.#ttl) {
        this.#cache.delete(key);
      }
    }
  }

  clear() {
    this.#cache.clear();
  }
}

// Or use WeakMap for automatic cleanup
class SensorCache {
  #cache = new WeakMap(); // Automatically GC'd when sensor is GC'd

  set(sensor, value) {
    this.#cache.set(sensor, value);
  }

  get(sensor) {
    return this.#cache.get(sensor);
  }
}
```

---

## ❌ Anti-Pattern 7: Global Registries Never Cleaned

**WRONG:**
```javascript
// Global registry
const globalSensors = new Map();

class Sensor {
  constructor(id) {
    this.id = id;
    globalSensors.set(id, this); // Registered globally
  }

  async destroy() {
    // Never removed from global registry - LEAK!
  }
}
```

**WHY IT'S WRONG:**
- Global map holds references
- Destroyed sensors stay in memory
- Prevents garbage collection
- Grows indefinitely
- Hard to track

**CORRECT:**
```javascript
const globalSensors = new Map();

class Sensor {
  constructor(id) {
    this.id = id;
    globalSensors.set(id, this);
  }

  async destroy() {
    // CRITICAL: Remove from global registry
    globalSensors.delete(this.id);

    // Clean up everything else
    this.removeAllListeners();
  }
}

// Or use WeakMap
const globalSensors = new WeakMap(); // Auto cleanup

class Sensor {
  constructor(id, metadata) {
    this.id = id;
    globalSensors.set(this, metadata); // Weak reference
  }

  async destroy() {
    // WeakMap auto-removes when sensor is GC'd
    this.removeAllListeners();
  }
}
```

---

## ❌ Anti-Pattern 8: Promise Chains Holding References

**WRONG:**
```javascript
class Sensor {
  #dataPromise = null;

  async read() {
    // Chains promises infinitely!
    this.#dataPromise = (this.#dataPromise || Promise.resolve())
      .then(() => this.#doRead());

    return this.#dataPromise;
  }
}
```

**WHY IT'S WRONG:**
- Promise chain grows with each read
- Each promise holds reference to previous
- Memory grows linearly
- Never garbage collected
- Subtle leak

**CORRECT:**
```javascript
class Sensor {
  #readQueue = [];
  #isReading = false;

  async read() {
    return new Promise((resolve, reject) => {
      this.#readQueue.push({ resolve, reject });
      this.#processQueue();
    });
  }

  async #processQueue() {
    if (this.#isReading || this.#readQueue.length === 0) {
      return;
    }

    this.#isReading = true;
    const { resolve, reject } = this.#readQueue.shift(); // Remove from queue

    try {
      const data = await this.#doRead();
      resolve(data);
    } catch (error) {
      reject(error);
    } finally {
      this.#isReading = false;
      this.#processQueue(); // Process next
    }
  }
}
```

---

## ❌ Anti-Pattern 9: Buffers Not Released

**WRONG:**
```javascript
class ImageProcessor {
  #imageBuffer = null;

  async processImage(data) {
    // Allocates large buffer
    this.#imageBuffer = Buffer.alloc(1024 * 1024); // 1MB

    // Process...

    // Buffer never released!
  }
}
```

**WHY IT'S WRONG:**
- Large buffers stay in memory
- Not automatically garbage collected
- Multiple instances = multiple MBs
- Especially bad for images/video
- Quick out-of-memory

**CORRECT:**
```javascript
class ImageProcessor {
  #imageBuffer = null;

  async processImage(data) {
    try {
      // Allocate buffer
      this.#imageBuffer = Buffer.alloc(1024 * 1024);

      // Process...

    } finally {
      // CRITICAL: Release buffer
      if (this.#imageBuffer) {
        this.#imageBuffer = null; // Allow GC
      }
    }
  }

  async destroy() {
    // Clean up any lingering buffers
    this.#imageBuffer = null;
  }
}

// Or use buffer pooling
class BufferPool {
  #pool = [];
  #maxSize = 10;

  acquire(size) {
    let buffer = this.#pool.pop();
    if (!buffer || buffer.length < size) {
      buffer = Buffer.alloc(size);
    }
    return buffer;
  }

  release(buffer) {
    if (this.#pool.length < this.#maxSize) {
      buffer.fill(0); // Clear data
      this.#pool.push(buffer);
    }
    // Otherwise let it be GC'd
  }
}
```

---

## ❌ Anti-Pattern 10: Child Processes Not Killed

**WRONG:**
```javascript
class BridgeManager {
  async spawn(script) {
    const process = spawn('python3', [script]);
    return process;
    // Process orphaned if parent doesn't track it!
  }
}
```

**WHY IT'S WRONG:**
- Child process keeps running
- Consumes memory and CPU
- Multiple spawns = multiple processes
- Eventually: System resource exhaustion
- Zombie processes

**CORRECT:**
```javascript
class BridgeManager {
  #processes = new Map();

  async spawn(script) {
    const process = spawn('python3', [script]);

    // Track process
    this.#processes.set(process.pid, process);

    // Clean up on exit
    process.on('exit', () => {
      this.#processes.delete(process.pid);
    });

    // Handle parent exit
    process.on('disconnect', () => {
      this.kill(process.pid);
    });

    return process;
  }

  async kill(pid) {
    const process = this.#processes.get(pid);
    if (process) {
      process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.#processes.has(pid)) {
          process.kill('SIGKILL');
        }
      }, 5000);

      this.#processes.delete(pid);
    }
  }

  async destroyAll() {
    // CRITICAL: Kill all processes
    for (const pid of this.#processes.keys()) {
      await this.kill(pid);
    }
  }
}

// Register cleanup on process exit
process.on('exit', () => {
  bridgeManager.destroyAll();
});
```

---

## 🔍 Detection Tools

```javascript
// 1. Track memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('Memory:', {
    rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(usage.external / 1024 / 1024)} MB`
  });
}, 10000);

// 2. Track event listeners
function trackListeners(emitter, name) {
  const counts = emitter.eventNames().map(event => ({
    event,
    count: emitter.listenerCount(event)
  }));
  console.log(`${name} listeners:`, counts);
}

// 3. Heap snapshot (Node.js)
const v8 = require('v8');
const fs = require('fs');

function takeHeapSnapshot() {
  const snapshot = v8.writeHeapSnapshot();
  console.log('Heap snapshot written to:', snapshot);
}

// 4. Use clinic.js
// npm install -g clinic
// clinic doctor -- node src/index.js
```

---

## ✅ Prevention Checklist

Before deploying:

- [ ] All event listeners removed in destroy()
- [ ] All timers cleared (setInterval, setTimeout)
- [ ] No circular references
- [ ] Arrays have size limits
- [ ] Caches have eviction policies
- [ ] Global registries cleaned up
- [ ] Buffers released after use
- [ ] Child processes tracked and killed
- [ ] Memory usage monitored
- [ ] Heap snapshots analyzed

---

## 🎯 Quick Reference

| Leak Source | Detection | Prevention |
|------------|-----------|------------|
| Event listeners | Check listener count | removeAllListeners() |
| Timers | Search for setInterval | clearInterval() in destroy |
| Arrays | Monitor array.length | Limit size or use circular buffer |
| Caches | Track Map.size | TTL + size limits |
| Child processes | ps aux \| grep python | Kill in destroy, track PIDs |
| Closures | Heap snapshot | Avoid capturing large objects |
| Circular refs | Memory profiler | Break references in destroy |

---

**Remember:** In long-running hardware processes, even small leaks become big problems. Monitor memory religiously!
