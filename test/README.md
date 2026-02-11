# Tests

All tests run without CrowPi3 hardware. Hardware interactions are mocked.

## Running Tests

```bash
# All tests (Python + Node.js)
pnpm test

# Python driver tests
pnpm run test:py

# Node.js tests
pnpm run test:js

# Watch mode (JS only — re-runs on file changes)
pnpm run test:watch

# Coverage report
pnpm run test:coverage
```

## Test Structure

```
test/
├── hardware-manager/                          # Python driver tests
│   ├── test_dht11_driver.py                   # DHT11 GPIO driver (20 tests)
│   └── test_aht10_driver.py                   # AHT10 I2C driver
│
├── coordinator/                               # Node.js coordinator tests
│   ├── sensor-coordinator.test.js             # Coordinator lifecycle + events
│   └── sensor-coordinator-breaker.test.js     # Circuit breaker behavior
│
└── hardware-manager-client/                   # JSON-RPC bridge tests
    └── hardware-manager-client.test.js        # Client <-> Python communication
```

## Setup

### Python

```bash
pip3 install pytest pytest-mock pytest-cov
```

### Node.js

Node.js 18+ has a built-in test runner — no additional dependencies needed.

## Writing Tests

### Python Driver Test

```python
import pytest
from unittest.mock import patch

class TestNewDriver:
    @patch('src.hardware_manager.drivers.new_driver.HardwareLibrary')
    def test_read_success(self, mock_library):
        # Arrange
        mock_library.read.return_value = expected_value
        driver = NewDriver('test', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['value'] == expected_value
```

### Node.js Test

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('NewComponent', () => {
  it('should behave as expected', async () => {
    // Arrange
    const component = new NewComponent();

    // Act
    const result = await component.method();

    // Assert
    assert.equal(result.property, expectedValue);
  });
});
```

### Key Principles

- **AAA pattern** — Arrange, Act, Assert in every test
- **Mock hardware** — Never depend on real GPIO/I2C/SPI
- **Test isolation** — Use `beforeEach`/`afterEach` for setup/teardown
- **Test error paths** — Not just happy paths
- **80% coverage minimum** — Target 90%+ for production code
