# Testing Requirements (MANDATORY)

> **Minimum 80% coverage. TDD workflow required. No exceptions.**

---

## Rule 1: Coverage Minimum (CRITICAL)

**MANDATORY: 80% line coverage for all new code.**

**Verify:**
```bash
npm run test:coverage

# Check output:
# Statements   : 85.23% ( 523/613 )  ✓ PASS (> 80%)
# Branches     : 81.45% ( 201/247 )  ✓ PASS (> 80%)
# Functions    : 87.67% ( 128/146 )  ✓ PASS (> 80%)
# Lines        : 85.11% ( 518/609 )  ✓ PASS (> 80%)
```

**WHY:**
- Catches bugs before production
- Enables confident refactoring
- Documents expected behavior
- Industry standard for quality

---

## Rule 2: TDD Workflow (MANDATORY)

Follow RED → GREEN → IMPROVE cycle.

**Process:**

### 🔴 RED: Write Failing Test

```javascript
// FIRST: Write test that fails
test('should read temperature from DHT11', async () => {
  const sensor = new DHT11Sensor({ pin: 17 });
  await sensor.initialize();

  const reading = await sensor.read();

  expect(reading.temperature).toBeGreaterThan(-40);
  expect(reading.temperature).toBeLessThan(80);
});

// Run: npm test
// Result: FAIL - DHT11Sensor not implemented
```

### 🟢 GREEN: Make It Pass (Minimal Code)

```javascript
// SECOND: Write minimum code to pass
export class DHT11Sensor {
  async initialize() {}

  async read() {
    return { temperature: 23.5 }; // Hardcoded - just pass test
  }
}

// Run: npm test
// Result: PASS
```

### 🔧 IMPROVE: Refactor

```javascript
// THIRD: Implement properly + refactor
export class DHT11Sensor {
  #bridge = null;

  async initialize() {
    this.#bridge = await BridgeManager.spawn({
      script: 'bridges/sensors/dht11_bridge.py'
    });
  }

  async read() {
    return await this.#bridge.send({ method: 'read' });
  }
}

// Run: npm test
// Result: PASS (with real implementation)
```

**WHY:**
- Ensures tests actually fail when code is wrong
- Prevents false positives
- Drives minimal, focused implementation

---

## Rule 3: AAA Pattern (MANDATORY)

Structure ALL tests as Arrange → Act → Assert.

**WRONG:**
```javascript
test('sensor test', async () => {
  const sensor = new Sensor({ pin: 17 });
  expect(sensor).toBeDefined();
  await sensor.initialize();
  const data = await sensor.read();
  expect(data.temperature).toBe(23.5);
  expect(sensor.isReady).toBe(true);
});
```

**CORRECT:**
```javascript
test('should read temperature after initialization', async () => {
  // ARRANGE - Set up test conditions
  const sensor = new Sensor({ pin: 17 });
  const mockBridge = createMockBridge();
  sensor._bridge = mockBridge;

  // ACT - Execute the code being tested
  await sensor.initialize();
  const data = await sensor.read();

  // ASSERT - Verify results
  expect(data).toEqual({
    temperature: 23.5,
    humidity: 65.0,
    timestamp: expect.any(Number)
  });
  expect(sensor.isReady).toBe(true);
});
```

**WHY:**
- Clear test structure
- Easy to understand intent
- Separates setup from verification

---

## Rule 4: Test Isolation (CRITICAL)

Each test MUST be independent. No shared state.

**WRONG:**
```javascript
// Shared state between tests - BAD
let sensor;

beforeAll(() => {
  sensor = new Sensor({ pin: 17 }); // Created once
});

test('test 1', async () => {
  await sensor.read(); // Modifies sensor state
});

test('test 2', async () => {
  await sensor.read(); // Depends on test 1!
});
```

**CORRECT:**
```javascript
describe('Sensor', () => {
  let sensor;

  // Fresh sensor for EACH test
  beforeEach(() => {
    sensor = new Sensor({ pin: 17 });
  });

  // Clean up after EACH test
  afterEach(async () => {
    await sensor.destroy();
  });

  test('test 1', async () => {
    await sensor.initialize();
    await sensor.read(); // Independent
  });

  test('test 2', async () => {
    await sensor.initialize();
    await sensor.read(); // Independent
  });
});
```

**WHY:**
- Tests can run in any order
- Failures don't cascade
- Parallel execution possible

---

## Rule 5: Test Categories (REQUIRED)

Write tests in ALL three categories:

### 1. Happy Path
```javascript
test('should read valid sensor data', async () => {
  // Normal operation - everything works
  const data = await sensor.read();
  expect(data.temperature).toBeDefined();
});
```

### 2. Error Cases
```javascript
test('should handle sensor timeout', async () => {
  mockBridge.simulateTimeout();

  await expect(sensor.read()).rejects.toThrow(TimeoutError);
});

test('should handle invalid reading', async () => {
  mockBridge.returnInvalidData();

  await expect(sensor.read()).rejects.toThrow(ValidationError);
});
```

### 3. Edge Cases
```javascript
test('should handle min temperature (-40°C)', async () => {
  mockBridge.returnValue({ temperature: -40 });

  const data = await sensor.read();
  expect(data.temperature).toBe(-40);
});

test('should handle max temperature (80°C)', async () => {
  mockBridge.returnValue({ temperature: 80 });

  const data = await sensor.read();
  expect(data.temperature).toBe(80);
});

test('should handle rapid consecutive reads', async () => {
  const reads = await Promise.all([
    sensor.read(),
    sensor.read(),
    sensor.read()
  ]);

  expect(reads).toHaveLength(3);
});
```

**WHY:**
- Happy path confirms functionality
- Error cases ensure robustness
- Edge cases catch boundary bugs

---

## Rule 6: Mock External Dependencies (REQUIRED)

NEVER hit real hardware or external services in unit tests.

**WRONG:**
```javascript
test('should read from real GPIO', async () => {
  const sensor = new Sensor({ pin: 17 });
  await sensor.initialize(); // Spawns real Python process!

  const data = await sensor.read(); // Reads real hardware!
  expect(data).toBeDefined();
});
```

**CORRECT:**
```javascript
test('should read from sensor', async () => {
  const sensor = new Sensor({ pin: 17 });

  // Mock the bridge - no real I/O
  const mockBridge = {
    send: jest.fn().mockResolvedValue({
      temperature: 23.5,
      humidity: 65.0
    })
  };
  sensor._bridge = mockBridge;

  const data = await sensor.read();

  expect(data.temperature).toBe(23.5);
  expect(mockBridge.send).toHaveBeenCalledWith({
    method: 'read'
  });
});
```

**WHY:**
- Fast (no I/O wait)
- Reliable (no hardware dependencies)
- Runnable in CI/CD
- Repeatable results

---

## Rule 7: Test Naming (REQUIRED)

Test names MUST describe behavior, not implementation.

**WRONG:**
```javascript
test('test1', () => {});
test('dht11', () => {});
test('it works', () => {});
test('read() returns data', () => {}); // Too vague
```

**CORRECT:**
```javascript
test('should return temperature and humidity when sensor is read', () => {});
test('should throw TimeoutError when sensor does not respond within 5s', () => {});
test('should emit "change" event when temperature changes by more than 0.5°C', () => {});
test('should retry 3 times before failing on I2C timeout', () => {});
```

**Pattern:**
```
should [expected behavior] when [condition]
```

**WHY:**
- Clear documentation
- Failure messages are meaningful
- Easy to find relevant tests

---

## Rule 8: Resource Cleanup (CRITICAL)

ALWAYS clean up in afterEach/afterAll.

**WRONG:**
```javascript
test('should initialize sensor', async () => {
  const sensor = new Sensor({ pin: 17 });
  await sensor.initialize();

  expect(sensor.isReady).toBe(true);
  // Sensor left running - memory leak!
});
```

**CORRECT:**
```javascript
describe('Sensor', () => {
  let sensor;

  beforeEach(() => {
    sensor = new Sensor({ pin: 17 });
  });

  afterEach(async () => {
    // CRITICAL: Clean up resources
    if (sensor) {
      await sensor.destroy();
      sensor = null;
    }
  });

  test('should initialize sensor', async () => {
    await sensor.initialize();
    expect(sensor.isReady).toBe(true);
  });
});
```

**WHY:**
- Prevents memory leaks
- Prevents resource exhaustion
- Keeps tests fast

---

## Metrics

- **Minimum coverage:** 80% (MANDATORY)
- **Target coverage:** 90%
- **Critical paths:** 100% coverage
- **Test categories:** All 3 required (happy, error, edge)
- **Test isolation:** 100% independent tests
- **Mock coverage:** 100% of external dependencies

---

## Verification Checklist

Before committing code:

- [ ] `npm test` passes
- [ ] `npm run test:coverage` shows > 80%
- [ ] All tests follow AAA pattern
- [ ] All tests have descriptive names
- [ ] Happy path tests exist
- [ ] Error case tests exist
- [ ] Edge case tests exist
- [ ] No tests hit real hardware
- [ ] Resources cleaned up in afterEach
- [ ] Tests are isolated (no shared state)
- [ ] TDD workflow followed (RED → GREEN → IMPROVE)

---

## Test File Organization

```
tests/
├── unit/                      # Fast, isolated tests
│   ├── sensors/
│   │   ├── DHT11Sensor.test.js
│   │   └── UltrasonicSensor.test.js
│   ├── actuators/
│   └── displays/
│
├── integration/               # Multi-component tests
│   ├── sensor-bridge.test.js
│   └── api-endpoints.test.js
│
└── hardware/                  # Real hardware tests
    └── hardware-validation.test.js
    # Mark with: @hardware
    # Run manually, not in CI
```

---

## Common Test Patterns

### Pattern: Mock Bridge

```javascript
function createMockBridge(options = {}) {
  return {
    send: jest.fn().mockResolvedValue(options.response || {}),
    on: jest.fn(),
    kill: jest.fn().mockResolvedValue(undefined)
  };
}

// Usage
const mockBridge = createMockBridge({
  response: { temperature: 23.5 }
});
```

### Pattern: Test Helpers

```javascript
// tests/helpers/sensor-helpers.js
export async function createInitializedSensor(SensorClass, config) {
  const sensor = new SensorClass(config);
  await sensor.initialize();
  return sensor;
}

export function expectValidReading(reading) {
  expect(reading).toMatchObject({
    temperature: expect.any(Number),
    humidity: expect.any(Number),
    timestamp: expect.any(Number)
  });
}

// Usage in tests
const sensor = await createInitializedSensor(DHT11Sensor, { pin: 17 });
const reading = await sensor.read();
expectValidReading(reading);
```

### Pattern: Async Timeout Testing

```javascript
test('should timeout after 5 seconds', async () => {
  jest.useFakeTimers();

  const promise = sensor.read();

  jest.advanceTimersByTime(6000); // Fast-forward time

  await expect(promise).rejects.toThrow(TimeoutError);

  jest.useRealTimers();
});
```

---

## Anti-Patterns (NEVER DO THIS)

### ❌ Testing Implementation Details

```javascript
// WRONG - Testing private internals
test('should set #initialized to true', async () => {
  await sensor.initialize();
  expect(sensor.#initialized).toBe(true); // Private field!
});

// CORRECT - Test observable behavior
test('should be ready after initialization', async () => {
  await sensor.initialize();
  expect(sensor.isReady).toBe(true);
});
```

### ❌ One Assertion Per Test (Too Strict)

```javascript
// WRONG - Too granular
test('should have temperature', async () => {
  const data = await sensor.read();
  expect(data.temperature).toBeDefined();
});

test('should have humidity', async () => {
  const data = await sensor.read(); // Duplicate setup!
  expect(data.humidity).toBeDefined();
});

// CORRECT - Related assertions grouped
test('should return complete sensor reading', async () => {
  const data = await sensor.read();

  expect(data.temperature).toBeDefined();
  expect(data.humidity).toBeDefined();
  expect(data.timestamp).toBeDefined();
});
```

### ❌ Testing Framework Code

```javascript
// WRONG - Testing library, not your code
test('should create instance', () => {
  const sensor = new Sensor({ pin: 17 });
  expect(sensor).toBeInstanceOf(Sensor); // Pointless!
});

// CORRECT - Test your logic
test('should validate pin number in constructor', () => {
  expect(() => new Sensor({ pin: -1 }))
    .toThrow(ValidationError);
});
```

---

**Test Summary:**
1. ✅ 80% coverage minimum (MANDATORY)
2. ✅ TDD workflow (RED → GREEN → IMPROVE)
3. ✅ AAA pattern (Arrange → Act → Assert)
4. ✅ Test isolation (no shared state)
5. ✅ All categories (happy, error, edge)
6. ✅ Mock external dependencies
7. ✅ Descriptive test names
8. ✅ Resource cleanup
