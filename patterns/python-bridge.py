#!/usr/bin/env python3
"""
GOLDEN EXAMPLE: Python Hardware Bridge

This is the PERFECT structure for ALL Python bridges.
Copy this file and adapt it for your specific hardware.

Rules followed:
- rules/python/bridge-patterns.md

Anti-patterns avoided:
- anti-patterns/memory-leaks.md (GPIO cleanup)
- anti-patterns/security-issues.md (input validation)

Protocol: JSON-RPC over stdin/stdout
- Commands come via stdin as JSON
- Responses go to stdout as JSON
- Logs go to stderr only

Example usage:
    python3 dht11_bridge.py 17
"""

import sys
import json
import time
import logging
import atexit
import signal
from typing import Dict, Any, Optional

# Hardware imports
import RPi.GPIO as GPIO
import adafruit_dht

# ===== CONSTANTS =====
DEFAULT_TIMEOUT = 5000  # 5 seconds
MIN_PIN = 0
MAX_PIN = 27

# ===== LOGGING SETUP =====
# CRITICAL: Log to stderr only, stdout reserved for JSON-RPC
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    stream=sys.stderr  # CRITICAL: stderr, not stdout!
)
logger = logging.getLogger(__name__)


class DHT11Bridge:
    """
    Hardware bridge for DHT11 temperature/humidity sensor.

    Communicates with Node.js via JSON-RPC protocol over stdin/stdout.

    Attributes:
        pin (int): GPIO pin number (BCM numbering)
        sensor (Optional[adafruit_dht.DHT11]): Sensor instance
    """

    def __init__(self, pin: int) -> None:
        """
        Initialize DHT11 bridge.

        Args:
            pin: GPIO pin number (BCM numbering, 0-27)

        Raises:
            ValueError: If pin is out of range
        """
        # Validate pin
        if not isinstance(pin, int):
            raise TypeError(f"Pin must be int, got {type(pin).__name__}")

        if not MIN_PIN <= pin <= MAX_PIN:
            raise ValueError(f"Pin {pin} out of range ({MIN_PIN}-{MAX_PIN})")

        self.pin: int = pin
        self.sensor: Optional[adafruit_dht.DHT11] = None

        # Register cleanup on exit
        atexit.register(self.cleanup)

        # Handle signals gracefully
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        logger.info(f"DHT11 bridge created for pin {pin}")

    def initialize(self) -> None:
        """
        Initialize hardware connection.

        Raises:
            RuntimeError: If initialization fails
        """
        logger.info("Initializing DHT11 sensor")

        try:
            # Initialize sensor
            self.sensor = adafruit_dht.DHT11(self.pin)

            logger.info("DHT11 sensor initialized successfully")

        except Exception as e:
            logger.error(f"Initialization failed: {str(e)}")
            raise RuntimeError(f"Failed to initialize sensor: {str(e)}")

    def read(self) -> Dict[str, Any]:
        """
        Read temperature and humidity from sensor.

        Returns:
            Dictionary containing:
                - temperature (float): Temperature in Celsius
                - humidity (float): Relative humidity percentage
                - timestamp (int): Unix timestamp in milliseconds

        Raises:
            RuntimeError: If sensor not initialized
            IOError: If sensor read fails
        """
        # Guard: Ensure initialized
        if self.sensor is None:
            raise RuntimeError("Sensor not initialized")

        try:
            # Read from sensor
            temperature = self.sensor.temperature
            humidity = self.sensor.humidity

            # Validate readings
            if temperature is None or humidity is None:
                raise IOError("Sensor returned None (read failed)")

            # Type conversion and validation
            temperature = float(temperature)
            humidity = float(humidity)

            # Range validation
            if not -40 <= temperature <= 80:
                raise ValueError(f"Temperature {temperature}°C out of range")

            if not 0 <= humidity <= 100:
                raise ValueError(f"Humidity {humidity}% out of range")

            # Return formatted result
            return {
                "temperature": temperature,
                "humidity": humidity,
                "timestamp": int(time.time() * 1000)
            }

        except Exception as e:
            logger.error(f"Sensor read failed: {str(e)}")
            raise IOError(f"Failed to read sensor: {str(e)}")

    def handle_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle incoming command from Node.js.

        Args:
            command: Command dictionary with:
                - id (str): Request ID
                - method (str): Method name ('read', 'configure', etc.)
                - params (dict): Method parameters

        Returns:
            Result dictionary

        Raises:
            ValueError: If command method is unknown
        """
        method = command.get("method")

        # Validate method
        if not method:
            raise ValueError("Missing 'method' field in command")

        if not isinstance(method, str):
            raise TypeError(f"Method must be str, got {type(method).__name__}")

        # Route to appropriate handler
        if method == "read":
            return self.read()

        elif method == "configure":
            params = command.get("params", {})
            return self.configure(params)

        else:
            raise ValueError(f"Unknown method: {method}")

    def configure(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Configure sensor parameters.

        Args:
            params: Configuration parameters

        Returns:
            Success confirmation

        Note:
            DHT11 doesn't have configurable parameters, but this
            method is included as a template for other sensors.
        """
        logger.info(f"Configure called with params: {params}")

        # Validate params if needed
        # For DHT11, there's nothing to configure

        return {
            "success": True,
            "message": "DHT11 has no configurable parameters"
        }

    def cleanup(self) -> None:
        """
        Clean up GPIO resources.

        CRITICAL: This MUST be called on exit to prevent GPIO conflicts.
        Registered with atexit to ensure cleanup happens.
        """
        logger.info("Cleaning up DHT11 bridge")

        try:
            if self.sensor:
                self.sensor.exit()
                self.sensor = None

            # Note: DHT11 library handles GPIO cleanup
            # For other sensors, you may need:
            # GPIO.cleanup(self.pin)

            logger.info("Cleanup completed")

        except Exception as e:
            logger.error(f"Cleanup error: {str(e)}")
            # Don't raise - cleanup should be best-effort

    def _signal_handler(self, signum: int, frame: Any) -> None:
        """
        Handle termination signals gracefully.

        Args:
            signum: Signal number
            frame: Current stack frame
        """
        logger.info(f"Received signal {signum}, shutting down")
        self.cleanup()
        sys.exit(0)


# ===== JSON-RPC PROTOCOL =====

def send_response(request_id: str, result: Any) -> None:
    """
    Send JSON-RPC success response to Node.js.

    Args:
        request_id: Request ID from incoming command
        result: Result data to send
    """
    response = {
        "id": request_id,
        "result": result,
        "error": None
    }
    print(json.dumps(response))
    sys.stdout.flush()  # CRITICAL: Force immediate send


def send_error(request_id: str, error_message: str, error_code: Optional[str] = None) -> None:
    """
    Send JSON-RPC error response to Node.js.

    Args:
        request_id: Request ID from incoming command
        error_message: Human-readable error message
        error_code: Optional error code for programmatic handling
    """
    response = {
        "id": request_id,
        "result": None,
        "error": {
            "message": error_message,
            "code": error_code
        }
    }
    print(json.dumps(response))
    sys.stdout.flush()  # CRITICAL: Force immediate send


def send_ready() -> None:
    """
    Send ready signal to Node.js.

    Called after initialization to signal that bridge is ready to
    receive commands.
    """
    ready = {
        "type": "ready",
        "timestamp": int(time.time() * 1000)
    }
    print(json.dumps(ready))
    sys.stdout.flush()  # CRITICAL: Force immediate send


def send_event(event_name: str, data: Dict[str, Any]) -> None:
    """
    Send unsolicited event to Node.js.

    Args:
        event_name: Name of the event
        data: Event data
    """
    event = {
        "type": "event",
        "event": event_name,
        "data": data,
        "timestamp": int(time.time() * 1000)
    }
    print(json.dumps(event))
    sys.stdout.flush()  # CRITICAL: Force immediate send


# ===== MAIN LOOP =====

def main() -> None:
    """
    Main entry point for bridge process.

    Process flow:
    1. Parse command line arguments
    2. Create and initialize bridge
    3. Send ready signal
    4. Enter command loop (read from stdin, process, respond)
    5. Exit gracefully on EOF or error
    """
    logger.info("DHT11 Bridge starting...")

    # Parse command line arguments
    if len(sys.argv) < 2:
        logger.error("Usage: dht11_bridge.py <pin>")
        sys.exit(1)

    try:
        pin = int(sys.argv[1])
    except ValueError:
        logger.error(f"Invalid pin: {sys.argv[1]} (must be integer)")
        sys.exit(1)

    # Create bridge instance
    try:
        bridge = DHT11Bridge(pin)
    except Exception as e:
        logger.error(f"Failed to create bridge: {str(e)}")
        sys.exit(1)

    # Initialize hardware
    try:
        bridge.initialize()
        logger.info("Bridge initialized successfully")

        # Send ready signal to Node.js
        send_ready()

    except Exception as e:
        logger.error(f"Initialization failed: {str(e)}")
        send_error("init", str(e), "INIT_FAILED")
        sys.exit(1)

    # Main command loop
    logger.info("Entering command loop")

    while True:
        try:
            # Read line from stdin (blocking)
            line = input()

            # Parse JSON command
            try:
                command = json.loads(line)
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON: {str(e)}")
                send_error("unknown", f"JSON parse error: {str(e)}", "INVALID_JSON")
                continue

            # Extract request ID
            request_id = command.get("id", "unknown")

            # Validate command structure
            if not isinstance(command, dict):
                send_error(request_id, "Command must be object", "INVALID_COMMAND")
                continue

            # Handle command
            try:
                result = bridge.handle_command(command)
                send_response(request_id, result)

            except ValueError as e:
                # Invalid method or parameters
                logger.warning(f"Invalid command: {str(e)}")
                send_error(request_id, str(e), "INVALID_METHOD")

            except Exception as e:
                # Other errors
                logger.error(f"Command failed: {str(e)}", exc_info=True)
                send_error(request_id, str(e), "COMMAND_FAILED")

        except EOFError:
            # stdin closed - Node.js process ended
            logger.info("stdin closed, exiting")
            break

        except KeyboardInterrupt:
            # Ctrl+C pressed
            logger.info("Interrupted, exiting")
            break

        except Exception as e:
            # Unexpected error - log but continue
            logger.critical(f"Unexpected error: {str(e)}", exc_info=True)
            # Try to continue running

    # Cleanup
    logger.info("Bridge shutting down")
    bridge.cleanup()


if __name__ == "__main__":
    main()


# ===== USAGE EXAMPLES =====
"""
Command line usage:
    python3 dht11_bridge.py 17

JSON-RPC commands (send to stdin):
    {"id": "1", "method": "read"}
    {"id": "2", "method": "configure", "params": {}}

JSON-RPC responses (received from stdout):
    {"id": "1", "result": {"temperature": 23.5, "humidity": 65.0, "timestamp": 1234567890}, "error": null}
    {"id": "2", "result": {"success": true}, "error": null}

Error response:
    {"id": "1", "result": null, "error": {"message": "Sensor not found", "code": "SENSOR_ERROR"}}

Ready signal:
    {"type": "ready", "timestamp": 1234567890}

Event (unsolicited):
    {"type": "event", "event": "threshold-exceeded", "data": {"temperature": 30}, "timestamp": 1234567890}
"""


# ===== TYPE DEFINITIONS =====
"""
Type hints for all functions ensure:
- Type checking with mypy
- Better IDE support
- Self-documenting code
- Fewer runtime errors

Command structure:
    {
        "id": str,
        "method": "read" | "configure",
        "params": dict (optional)
    }

Response structure:
    {
        "id": str,
        "result": any,
        "error": null | {"message": str, "code": str}
    }

Reading result:
    {
        "temperature": float,  # -40 to 80 Celsius
        "humidity": float,     # 0 to 100 percent
        "timestamp": int       # Unix timestamp in milliseconds
    }
"""
