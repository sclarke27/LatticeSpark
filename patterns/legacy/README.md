# Golden Examples - Copy These Exactly

> **Production-ready, battle-tested code templates. Use these as starting points for all new components.**

---

## 🎯 Purpose

These are **PERFECT** examples that follow ALL our rules and avoid ALL anti-patterns. Don't start from scratch—copy these and adapt them.

---

## 📁 Golden Examples

### 1. [sensor-component.js](sensor-component.js) ⭐
**Perfect JavaScript/Node.js sensor component**

**What it demonstrates:**
- ✅ Component structure (EventEmitter, private fields)
- ✅ Async/await patterns (Promise.all, timeouts)
- ✅ Error handling (circuit breaker, retries, custom errors)
- ✅ Memory management (cleanup, no leaks)
- ✅ Caching strategy (TTL, invalidation)
- ✅ Polling with change detection
- ✅ Comprehensive JSDoc
- ✅ Input validation
- ✅ Idempotent initialize/destroy

**Lines:** 550+ lines of production-ready code

**Rules followed:**
- rules/javascript/component-structure.md
- rules/javascript/async-await.md
- rules/common/error-handling.md

**Anti-patterns avoided:**
- anti-patterns/async-mistakes.md (all 10)
- anti-patterns/memory-leaks.md (all 10)
- anti-patterns/security-issues.md (input validation)

**Copy this for:** ANY sensor, actuator, or hardware component

---

### 2. [python-bridge.py](python-bridge.py) ⭐
**Perfect Python hardware bridge**

**What it demonstrates:**
- ✅ JSON-RPC protocol (exact format)
- ✅ Type hints (100% coverage)
- ✅ Input validation (type, range, enum)
- ✅ Resource cleanup (atexit, signal handlers)
- ✅ Logging to stderr (stdout reserved for data)
- ✅ Flush stdout (immediate send)
- ✅ Error handling (try/except, graceful degradation)
- ✅ Main loop (stdin processing)

**Lines:** 350+ lines with complete protocol implementation

**Rules followed:**
- rules/python/bridge-patterns.md (100%)

**Anti-patterns avoided:**
- anti-patterns/memory-leaks.md (GPIO cleanup)
- anti-patterns/security-issues.md (input validation)

**Copy this for:** ANY Python hardware bridge

---

### 3. [web-component.js](web-component.js) ⭐
**Perfect Lit web component**

**What it demonstrates:**
- ✅ Lit component structure
- ✅ NO shadow DOM (user preference)
- ✅ Reactive properties
- ✅ Custom events (bubbling, composed)
- ✅ WebSocket integration
- ✅ Accessibility (ARIA labels, keyboard support)
- ✅ CSS custom properties (theming)
- ✅ Lifecycle methods (connectedCallback, disconnectedCallback)
- ✅ Memory cleanup (remove listeners)
- ✅ Animation (change detection)

**Lines:** 400+ lines with complete UI component

**Rules followed:**
- rules/web/lit-components.md (when added)
- Minimal shadow DOM approach
- Event-driven communication

**Anti-patterns avoided:**
- anti-patterns/memory-leaks.md (listener cleanup)
- anti-patterns/async-mistakes.md (WebSocket handling)

**Copy this for:** ANY Lit web component

---

### 4. [test-suite.test.js](test-suite.test.js) ⭐
**Perfect test suite structure**

**What it demonstrates:**
- ✅ AAA pattern (Arrange → Act → Assert)
- ✅ Test isolation (beforeEach, afterEach)
- ✅ Mocking strategy (external dependencies)
- ✅ Descriptive test names
- ✅ Happy path coverage
- ✅ Error case coverage
- ✅ Edge case coverage (boundary values)
- ✅ Resource cleanup testing
- ✅ 30+ tests with > 90% coverage
- ✅ Mock helpers

**Lines:** 500+ lines demonstrating all test scenarios

**Rules followed:**
- rules/common/testing.md (100%)
- TDD workflow
- 80%+ coverage

**Anti-patterns avoided:**
- Shared state between tests
- Testing implementation details
- Missing cleanup

**Copy this for:** ANY component test suite

---

## 🚀 Quick Start Guide

### Step 1: Copy the Relevant Template

```bash
# For a new sensor
cp patterns/sensor-component.js src/components/sensors/MySensor.js

# For its Python bridge
cp patterns/python-bridge.py bridges/sensors/mysensor_bridge.py

# For its tests
cp patterns/test-suite.test.js tests/unit/sensors/MySensor.test.js

# For a UI component
cp patterns/web-component.js ui/components/my-component.js
```

### Step 2: Search and Replace

```bash
# Replace DHT11 with your sensor name
sed -i 's/DHT11/MySensor/g' src/components/sensors/MySensor.js
sed -i 's/dht11/mysensor/g' src/components/sensors/MySensor.js

# Replace pin with your hardware config
# Update temperature/humidity with your sensor data
```

### Step 3: Customize

- Update constants (pin numbers, timeouts, etc.)
- Modify `#doRead()` for your sensor's protocol
- Adjust validation rules for your data ranges
- Update events for your use case
- Customize error messages

### Step 4: Test

```bash
# Run tests
npm test -- MySensor.test.js

# Check coverage
npm run test:coverage -- MySensor.test.js

# Should be > 80%
```

---

## 📊 What's Included

### Sensor Component Template

```javascript
class MySensor extends EventEmitter {
  // Private fields with #
  #bridge = null;
  #config = {};
  #isInitialized = false;

  constructor(config) {
    // Validation
    // Merge with defaults
  }

  async initialize() {
    // Idempotent
    // Spawn bridge
    // Wait for ready
  }

  async read() {
    // Circuit breaker
    // Caching
    // Retry with backoff
    // Event emission
  }

  async destroy() {
    // Stop polling
    // Remove listeners
    // Kill bridge
  }
}
```

### Python Bridge Template

```python
class MySensorBridge:
    def __init__(self, pin: int) -> None:
        # Validate
        # Register cleanup
        pass

    def initialize(self) -> None:
        # Setup hardware
        # Send ready signal
        pass

    def read(self) -> Dict[str, Any]:
        # Read from hardware
        # Validate
        # Return formatted data
        pass

    def cleanup(self) -> None:
        # Release resources
        pass

def main() -> None:
    # Parse args
    # Create bridge
    # Initialize
    # Command loop
    pass
```

### Web Component Template

```javascript
class MyComponent extends LitElement {
  static properties = {
    value: { type: Number },
    status: { type: String }
  };

  constructor() {
    // Initialize properties
  }

  connectedCallback() {
    // Connect WebSocket
    // Add listeners
  }

  disconnectedCallback() {
    // Disconnect WebSocket
    // Remove listeners
  }

  render() {
    // Template
  }
}
```

### Test Suite Template

```javascript
describe('MyComponent', () => {
  let component;
  let mockDependency;

  beforeEach(() => {
    // Fresh instances
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('happy path', () => {
    it('should work normally', () => {
      // AAA pattern
    });
  });

  describe('error cases', () => {
    it('should handle errors', () => {
      // Error scenarios
    });
  });

  describe('edge cases', () => {
    it('should handle boundaries', () => {
      // Boundary values
    });
  });
});
```

---

## ✅ Verification Checklist

After copying and adapting, verify:

### Code Quality
- [ ] All private fields use # prefix
- [ ] All public methods have JSDoc
- [ ] No console.log (use logger)
- [ ] No hardcoded values (use constants)
- [ ] File size < 300 lines (or split)

### Functionality
- [ ] Initialize is idempotent
- [ ] Destroy is idempotent
- [ ] Destroy removes ALL listeners
- [ ] Destroy stops ALL timers
- [ ] Destroy kills ALL child processes

### Error Handling
- [ ] Circuit breaker implemented
- [ ] Retry with exponential backoff
- [ ] Timeouts on all I/O
- [ ] Custom error classes used
- [ ] Errors include context

### Testing
- [ ] Tests follow AAA pattern
- [ ] Tests are isolated
- [ ] Coverage > 80%
- [ ] Happy path tested
- [ ] Error cases tested
- [ ] Edge cases tested
- [ ] Cleanup tested

---

## 🎯 Common Adaptations

### Change Sensor Type

```javascript
// Change from DHT11 (temp/humidity) to Ultrasonic (distance)

// Before
return {
  temperature: response.temperature,
  humidity: response.humidity,
  timestamp: Date.now()
};

// After
return {
  distance: response.distance,
  unit: 'cm',
  timestamp: Date.now()
};
```

### Change Communication Protocol

```javascript
// Change from I2C to GPIO

// Before (I2C)
this.sensor = adafruit_dht.DHT11(self.pin)

// After (GPIO)
GPIO.setup(self.pin, GPIO.IN)
value = GPIO.input(self.pin)
```

### Add New Events

```javascript
// Add threshold event

if (reading.temperature > this.#config.threshold) {
  this.emit('threshold-exceeded', reading);
}
```

---

## 📚 Related Documentation

- **[rules/](../rules/)** - Rules these examples follow
- **[anti-patterns/](../anti-patterns/)** - Mistakes these examples avoid
- **[ARCHITECTURE.md](../ARCHITECTURE.md)** - How everything fits together

---

## 💡 Tips

**Tip 1:** Don't modify the examples in `patterns/`. Copy them first, then adapt.

**Tip 2:** Keep the structure intact. The template is proven—don't reinvent it.

**Tip 3:** If you find yourself deviating significantly, ask: "Why is my case special?"

**Tip 4:** Update examples if you discover improvements. These evolve with experience.

---

## 🎓 Learning Path

### For New Developers
1. Read sensor-component.js completely
2. Copy and create a simple sensor
3. Read test-suite.test.js
4. Write tests for your sensor
5. Read python-bridge.py
6. Create the Python bridge
7. Test end-to-end

### For Experienced Developers
1. Scan all 4 examples
2. Note the patterns
3. Copy relevant template
4. Adapt quickly
5. Run tests
6. Ship it

---

**Remember: These are STARTING POINTS. Adapt as needed, but keep the structure and principles intact. 🚀**
