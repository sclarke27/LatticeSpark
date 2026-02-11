# Python Bridge Patterns (CRITICAL)

> **JSON-RPC over stdin/stdout MANDATORY. Type hints required. Resource cleanup essential.**

---

## Rule 1: JSON-RPC Protocol (MANDATORY)

ALL Python bridges MUST use this exact protocol.

**Message Format:**

```python
# Command (Node.js → Python)
{
  "id": "uuid-v4-string",
  "method": "read" | "write" | "configure",
  "params": { ... }
}

# Response (Python → Node.js)
{
  "id": "uuid-v4-string",  # Same as command
  "result": { ... },       # Success data
  "error": null            # Or error object
}

# Event (Python → Node.js, unsolicited)
{
  "type": "event",
  "event": "motion-detected",
  "data": { ... },
  "timestamp": 1234567890
}
```

**WRONG:**
```python
# Line-based protocol - NO
print("TEMP:23.5")
result = input()  # Expects "OK" or "ERROR"

# Custom binary protocol - NO
import struct
data = struct.pack('!if', sensor_id, value)
sys.stdout.buffer.write(data)
```

**CORRECT:**
```python
import sys
import json
from typing import Dict, Any

def send_response(request_id: str, result: Any) -> None:
    """Send JSON-RPC response to Node.js."""
    response = {
        "id": request_id,
        "result": result,
        "error": None
    }
    print(json.dumps(response))
    sys.stdout.flush()  # CRITICAL: Force immediate send

def send_error(request_id: str, error_message: str) -> None:
    """Send JSON-RPC error to Node.js."""
    response = {
        "id": request_id,
        "result": None,
        "error": {"message": error_message}
    }
    print(json.dumps(response))
    sys.stdout.flush()

def send_event(event_name: str, data: Dict[str, Any]) -> None:
    """Send unsolicited event to Node.js."""
    event = {
        "type": "event",
        "event": event_name,
        "data": data,
        "timestamp": int(time.time() * 1000)
    }
    print(json.dumps(event))
    sys.stdout.flush()

# Main loop
while True:
    try:
        line = input()  # Blocking read from stdin
        command = json.loads(line)

        method = command.get("method")
        params = command.get("params", {})
        request_id = command.get("id")

        if method == "read":
            result = read_sensor(params)
            send_response(request_id, result)

        elif method == "write":
            result = write_actuator(params)
            send_response(request_id, result)

        else:
            send_error(request_id, f"Unknown method: {method}")

    except json.JSONDecodeError as e:
        send_error("unknown", f"Invalid JSON: {str(e)}")

    except EOFError:
        # stdin closed - Node.js process ended
        break

    except Exception as e:
        send_error(request_id, str(e))
```

**WHY:**
- Standard, well-defined protocol
- Easy to debug (human-readable)
- Error handling built-in
- Supports both request/response and events

---

## Rule 2: Type Hints (MANDATORY)

ALL functions MUST have type hints.

**WRONG:**
```python
def read_sensor(pin):
    value = GPIO.input(pin)
    return value
```

**CORRECT:**
```python
from typing import Dict, Any, Optional

def read_sensor(pin: int) -> Dict[str, Any]:
    """
    Read sensor value from GPIO pin.

    Args:
        pin: GPIO pin number (0-27)

    Returns:
        Dictionary with sensor reading

    Raises:
        ValueError: If pin is out of range
        IOError: If GPIO read fails
    """
    if not 0 <= pin <= 27:
        raise ValueError(f"Pin {pin} out of range (0-27)")

    try:
        value: bool = GPIO.input(pin)
        return {
            "value": int(value),
            "pin": pin,
            "timestamp": int(time.time() * 1000)
        }
    except Exception as e:
        raise IOError(f"GPIO read failed: {str(e)}")
```

**WHY:**
- Type checking catches bugs early
- Better IDE support
- Self-documenting code
- Easier to maintain

---

## Rule 3: Resource Cleanup (CRITICAL)

ALWAYS clean up GPIO/I2C/SPI resources.

**WRONG:**
```python
import RPi.GPIO as GPIO

GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.IN)

while True:
    value = GPIO.input(17)
    # ...
# GPIO never cleaned up - affects other programs!
```

**CORRECT:**
```python
import RPi.GPIO as GPIO
import sys
import atexit

class SensorBridge:
    def __init__(self, pin: int) -> None:
        self.pin = pin
        self._setup()

    def _setup(self) -> None:
        """Initialize GPIO resources."""
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

        # Register cleanup on exit
        atexit.register(self.cleanup)

    def read(self) -> Dict[str, Any]:
        """Read sensor value."""
        value = GPIO.input(self.pin)
        return {"value": int(value)}

    def cleanup(self) -> None:
        """Clean up GPIO resources."""
        try:
            GPIO.cleanup(self.pin)
        except Exception as e:
            print(f"Cleanup error: {e}", file=sys.stderr)

# Usage
bridge = SensorBridge(pin=17)

try:
    while True:
        # Main loop
        pass
except KeyboardInterrupt:
    pass
finally:
    bridge.cleanup()  # Explicit cleanup
    # atexit also runs cleanup
```

**WHY:**
- Other programs can use GPIO after
- Prevents "GPIO already in use" errors
- Clean system state on exit

---

## Rule 4: Logging to stderr (REQUIRED)

NEVER use print() for logs. Use stderr.

**WRONG:**
```python
print("Initializing sensor...")  # Goes to stdout, breaks protocol!
data = read_sensor()
print(json.dumps({"result": data}))  # Mixed with logs!
```

**CORRECT:**
```python
import sys
import logging

# Configure logging to stderr
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
    stream=sys.stderr  # CRITICAL: stderr, not stdout
)
logger = logging.getLogger(__name__)

# Logs go to stderr
logger.info("Initializing sensor...")

# Data goes to stdout
data = read_sensor()
print(json.dumps({"result": data}))
sys.stdout.flush()
```

**WHY:**
- stdout reserved for JSON-RPC protocol
- stderr for logs/debugging
- Node.js separates stdout/stderr streams

---

## Rule 5: Immediate Flush (CRITICAL)

ALWAYS flush stdout after sending.

**WRONG:**
```python
print(json.dumps(response))
# Data might be buffered - Node.js doesn't receive it!
```

**CORRECT:**
```python
print(json.dumps(response))
sys.stdout.flush()  # CRITICAL: Send immediately
```

**WHY:**
- Python buffers stdout by default
- Node.js waits indefinitely for data
- Causes timeouts and hangs

---

## Rule 6: Error Handling (REQUIRED)

Catch ALL exceptions in main loop.

**WRONG:**
```python
while True:
    line = input()
    command = json.loads(line)  # Can throw!
    result = process_command(command)  # Can throw!
    send_response(result)
```

**CORRECT:**
```python
while True:
    try:
        line = input()

        try:
            command = json.loads(line)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON: {e}")
            send_error("unknown", f"JSON parse error: {str(e)}")
            continue

        request_id = command.get("id", "unknown")

        try:
            result = process_command(command)
            send_response(request_id, result)
        except Exception as e:
            logger.error(f"Command failed: {e}", exc_info=True)
            send_error(request_id, str(e))

    except EOFError:
        logger.info("stdin closed, exiting")
        break

    except KeyboardInterrupt:
        logger.info("Interrupted, exiting")
        break

    except Exception as e:
        logger.critical(f"Unexpected error: {e}", exc_info=True)
        # Continue running if possible
```

**WHY:**
- Bridge stays alive despite errors
- Errors reported to Node.js
- Graceful shutdown

---

## Rule 7: Ready Signal (REQUIRED)

Send ready signal after initialization.

**WRONG:**
```python
# No ready signal
bridge = SensorBridge(pin=17)
while True:
    # Node.js doesn't know when ready!
```

**CORRECT:**
```python
def send_ready() -> None:
    """Signal that bridge is ready."""
    ready = {
        "type": "ready",
        "timestamp": int(time.time() * 1000)
    }
    print(json.dumps(ready))
    sys.stdout.flush()

# Initialize
bridge = SensorBridge(pin=17)
bridge.initialize()

# Signal ready
send_ready()

# Now accept commands
while True:
    # ...
```

**WHY:**
- Node.js knows when bridge is ready
- Avoids sending commands too early
- Clearer startup sequence

---

## Rule 8: Validate Inputs (REQUIRED)

Validate all inputs from Node.js.

**WRONG:**
```python
def configure(params: Dict[str, Any]) -> None:
    pin = params["pin"]  # Could be missing!
    GPIO.setup(pin, GPIO.IN)  # Could be wrong type!
```

**CORRECT:**
```python
def configure(params: Dict[str, Any]) -> None:
    """Configure sensor with validation."""

    # Check required field
    if "pin" not in params:
        raise ValueError("Missing required field: pin")

    pin = params["pin"]

    # Type validation
    if not isinstance(pin, int):
        raise TypeError(f"pin must be int, got {type(pin).__name__}")

    # Range validation
    if not 0 <= pin <= 27:
        raise ValueError(f"pin {pin} out of range (0-27)")

    # Safe to use
    GPIO.setup(pin, GPIO.IN)
```

**WHY:**
- Prevents crashes from invalid data
- Clear error messages
- Type safety

---

## Metrics

- **JSON-RPC compliance:** 100% (MANDATORY)
- **Type hints coverage:** 100% of functions
- **Resource cleanup:** 100% (atexit + finally)
- **stdout flush:** 100% after sends
- **Logging to stderr:** 100%
- **Input validation:** 100% of params

---

## Verification Checklist

- [ ] Uses JSON-RPC protocol (exact format)
- [ ] All functions have type hints
- [ ] GPIO.cleanup() in atexit + finally
- [ ] Logs go to stderr, data to stdout
- [ ] sys.stdout.flush() after every send
- [ ] Main loop catches all exceptions
- [ ] Sends ready signal after init
- [ ] Validates all input parameters
- [ ] No print() for logs (use logging)
- [ ] EOFError handled gracefully

---

## Complete Bridge Template

```python
#!/usr/bin/env python3
"""
DHT11 Temperature/Humidity Sensor Bridge

Communicates with Node.js via JSON-RPC over stdin/stdout.
"""

import sys
import json
import time
import logging
import atexit
from typing import Dict, Any, Optional

import RPi.GPIO as GPIO
import adafruit_dht

# Configure logging to stderr
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)


class DHT11Bridge:
    """Hardware bridge for DHT11 sensor."""

    def __init__(self, pin: int) -> None:
        """
        Initialize DHT11 bridge.

        Args:
            pin: GPIO pin number (BCM numbering)
        """
        self.pin = pin
        self.sensor: Optional[adafruit_dht.DHT11] = None

        # Register cleanup
        atexit.register(self.cleanup)

    def initialize(self) -> None:
        """Initialize hardware."""
        logger.info(f"Initializing DHT11 on pin {self.pin}")

        try:
            self.sensor = adafruit_dht.DHT11(self.pin)
            logger.info("DHT11 initialized successfully")
        except Exception as e:
            logger.error(f"Initialization failed: {e}")
            raise

    def read(self) -> Dict[str, float]:
        """
        Read temperature and humidity.

        Returns:
            Dictionary with temperature (°C) and humidity (%)

        Raises:
            RuntimeError: If sensor not initialized
            IOError: If read fails
        """
        if self.sensor is None:
            raise RuntimeError("Sensor not initialized")

        try:
            temperature = self.sensor.temperature
            humidity = self.sensor.humidity

            if temperature is None or humidity is None:
                raise IOError("Sensor returned None")

            return {
                "temperature": float(temperature),
                "humidity": float(humidity),
                "timestamp": int(time.time() * 1000)
            }

        except Exception as e:
            logger.error(f"Read failed: {e}")
            raise IOError(f"Failed to read sensor: {str(e)}")

    def cleanup(self) -> None:
        """Clean up resources."""
        logger.info("Cleaning up DHT11 bridge")
        if self.sensor:
            self.sensor.exit()


def send_response(request_id: str, result: Any) -> None:
    """Send JSON-RPC response."""
    response = {
        "id": request_id,
        "result": result,
        "error": None
    }
    print(json.dumps(response))
    sys.stdout.flush()


def send_error(request_id: str, error_message: str) -> None:
    """Send JSON-RPC error."""
    response = {
        "id": request_id,
        "result": None,
        "error": {"message": error_message}
    }
    print(json.dumps(response))
    sys.stdout.flush()


def send_ready() -> None:
    """Send ready signal."""
    ready = {
        "type": "ready",
        "timestamp": int(time.time() * 1000)
    }
    print(json.dumps(ready))
    sys.stdout.flush()


def main() -> None:
    """Main entry point."""
    logger.info("DHT11 Bridge starting...")

    # Get pin from command line
    if len(sys.argv) < 2:
        logger.error("Usage: dht11_bridge.py <pin>")
        sys.exit(1)

    try:
        pin = int(sys.argv[1])
    except ValueError:
        logger.error("Pin must be a number")
        sys.exit(1)

    # Initialize bridge
    bridge = DHT11Bridge(pin)

    try:
        bridge.initialize()
        send_ready()

        # Main command loop
        while True:
            try:
                line = input()

                try:
                    command = json.loads(line)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON: {e}")
                    send_error("unknown", str(e))
                    continue

                request_id = command.get("id", "unknown")
                method = command.get("method")

                if method == "read":
                    result = bridge.read()
                    send_response(request_id, result)

                else:
                    send_error(request_id, f"Unknown method: {method}")

            except EOFError:
                logger.info("stdin closed")
                break

            except Exception as e:
                logger.error(f"Command error: {e}", exc_info=True)
                send_error(request_id, str(e))

    except KeyboardInterrupt:
        logger.info("Interrupted")

    finally:
        bridge.cleanup()


if __name__ == "__main__":
    main()
```

---

## Anti-Patterns (NEVER DO THIS)

### ❌ Mixing stdout and logs

```python
# WRONG
print("Initializing...")  # Goes to stdout!
print(json.dumps(response))
```

### ❌ No type hints

```python
# WRONG
def read_sensor(pin):
    return GPIO.input(pin)
```

### ❌ No resource cleanup

```python
# WRONG
GPIO.setup(17, GPIO.IN)
# Never cleanup!
```

### ❌ Not flushing stdout

```python
# WRONG
print(json.dumps(response))
# Buffered - doesn't send immediately!
```

---

**Python Bridge Summary:**
1. ✅ JSON-RPC protocol (MANDATORY)
2. ✅ Type hints on all functions
3. ✅ Resource cleanup (atexit + finally)
4. ✅ Logging to stderr only
5. ✅ Flush stdout immediately
6. ✅ Catch all exceptions
7. ✅ Send ready signal
8. ✅ Validate all inputs
