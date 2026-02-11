#!/usr/bin/env python3
"""
GOLDEN EXAMPLE: GPIO-Based Sensor Driver (DHT11)

This is the PERFECT template for GPIO-based sensor drivers.
Copy this for: temperature sensors, humidity sensors, digital input sensors, etc.

What this demonstrates:
✅ BaseDriver inheritance and interface implementation
✅ Type hints 100%
✅ Configuration validation
✅ Initialization with test read
✅ Minimum read interval enforcement
✅ Retry logic with configurable attempts
✅ Range validation (sensor specs)
✅ Read-only sensor pattern (write raises NotImplementedError)
✅ Proper cleanup and resource management
✅ Comprehensive docstrings
✅ Logging (info, debug, warning, error)

Copy this file and adapt for your sensor:
1. Replace DHT11 with your sensor name
2. Update SENSOR_TYPE constant
3. Update MIN_READ_INTERVAL for your sensor
4. Modify read() to use your sensor's library
5. Update range validation for your sensor's specs
6. Adjust return data structure
"""

from typing import Dict, Any
import time

try:
    import Adafruit_DHT
except ImportError:
    # For development/testing without hardware
    Adafruit_DHT = None

from .base_driver import BaseDriver


class DHT11Driver(BaseDriver):
    """
    DHT11 temperature and humidity sensor driver.

    Perfect example of GPIO-based digital sensor driver.
    """

    # Sensor type constant (library-specific)
    SENSOR_TYPE = Adafruit_DHT.DHT11 if Adafruit_DHT else None

    # Minimum time between reads (seconds) - DHT11 spec
    MIN_READ_INTERVAL = 1.0

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize DHT11 driver.

        Required config keys:
        - pins.data: GPIO pin number

        Optional config keys:
        - retries: Number of retry attempts (default: 3)
        - delay: Delay between retries in seconds (default: 2)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If Adafruit_DHT library not available
        """
        # PATTERN: Call super().__init__ first
        super().__init__(component_id, config)

        # PATTERN: Validate library availability
        if Adafruit_DHT is None:
            raise ImportError(
                "Adafruit_DHT library not installed. "
                "Install with: pip3 install Adafruit_DHT"
            )

        # PATTERN: Validate required config
        self.validate_config(['pins'])

        if 'data' not in self.config['pins']:
            raise ValueError(
                f"Missing required config: pins.data for {component_id}"
            )

        # PATTERN: Extract and store configuration with type conversion
        self.gpio_pin: int = int(self.config['pins']['data'])
        self.retries: int = self.config.get('retries', 3)
        self.retry_delay: float = self.config.get('delay', 2.0)

        # PATTERN: Initialize instance variables for state tracking
        self._last_read_time: float = 0.0

        # PATTERN: Log initialization
        self.logger.info(
            f"DHT11 driver created for {component_id} on GPIO{self.gpio_pin}"
        )

    def initialize(self) -> None:
        """
        Initialize DHT11 sensor.

        PATTERN: Idempotent initialization
        - Check _initialized flag first
        - Perform test read to verify hardware
        - Set _initialized = True on success
        - Raise RuntimeError on failure

        Raises:
            RuntimeError: If sensor initialization fails
        """
        # PATTERN: Idempotent check
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(f"Initializing DHT11 on GPIO{self.gpio_pin}")

        # PATTERN: Test read to verify sensor works
        try:
            humidity, temperature = Adafruit_DHT.read_retry(
                self.SENSOR_TYPE,
                self.gpio_pin,
                retries=self.retries,
                delay_seconds=self.retry_delay
            )

            # PATTERN: Validate test read result
            if humidity is None or temperature is None:
                raise RuntimeError(
                    f"DHT11 sensor on GPIO{self.gpio_pin} not responding. "
                    "Check sensor connection."
                )

            # PATTERN: Set initialized flag
            self._initialized = True

            # PATTERN: Log success with sample data
            self.logger.info(
                f"DHT11 initialized successfully. "
                f"Test reading: {temperature:.1f}°C, {humidity:.1f}%"
            )

        except Exception as e:
            self.logger.error(f"DHT11 initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize DHT11 on GPIO{self.gpio_pin}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        """
        Read temperature and humidity from DHT11.

        PATTERN: Sensor read implementation
        - Assert initialized first
        - Enforce minimum read interval
        - Call hardware library
        - Validate result
        - Validate ranges (sensor specs)
        - Round values appropriately
        - Return standardized dict with timestamp

        Returns:
            Dict with keys:
            - temperature: Temperature in Celsius (float)
            - humidity: Relative humidity percentage (float)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized or read fails
        """
        # PATTERN: Assert initialized
        self._assert_initialized()

        # PATTERN: Enforce minimum read interval (hardware limitation)
        current_time = time.time()
        time_since_last_read = current_time - self._last_read_time

        if time_since_last_read < self.MIN_READ_INTERVAL:
            wait_time = self.MIN_READ_INTERVAL - time_since_last_read
            self.logger.warning(
                f"DHT11 read too soon. Waiting {wait_time:.2f}s"
            )
            time.sleep(wait_time)
            current_time = time.time()

        # PATTERN: Read sensor with debug logging
        self.logger.debug(f"Reading DHT11 on GPIO{self.gpio_pin}")

        # PATTERN: Call hardware library with retry
        humidity, temperature = Adafruit_DHT.read_retry(
            self.SENSOR_TYPE,
            self.gpio_pin,
            retries=self.retries,
            delay_seconds=self.retry_delay
        )

        # PATTERN: Update state
        self._last_read_time = current_time

        # PATTERN: Validate reading result
        if humidity is None or temperature is None:
            error_msg = f"DHT11 read failed after {self.retries} retries"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)

        # PATTERN: Validate ranges (sensor specifications)
        if not (0 <= temperature <= 50):
            self.logger.warning(
                f"DHT11 temperature {temperature}°C out of spec range (0-50°C)"
            )

        if not (0 <= humidity <= 100):
            self.logger.warning(
                f"DHT11 humidity {humidity}% out of valid range (0-100%)"
            )

        # PATTERN: Build standardized response
        reading = {
            'temperature': round(temperature, 1),
            'humidity': round(humidity, 1),
            'timestamp': current_time
        }

        # PATTERN: Log success at debug level
        self.logger.debug(
            f"DHT11 read: {reading['temperature']}°C, {reading['humidity']}%"
        )

        return reading

    def write(self, data: Dict[str, Any]) -> None:
        """
        DHT11 is read-only sensor, write not supported.

        PATTERN: Read-only sensor write implementation
        - Always raise NotImplementedError
        - Include helpful message

        Args:
            data: Ignored

        Raises:
            NotImplementedError: Always (DHT11 is read-only)
        """
        raise NotImplementedError(
            f"{self.component_id} (DHT11) is a read-only sensor"
        )

    def cleanup(self) -> None:
        """
        Clean up DHT11 resources.

        PATTERN: Cleanup implementation (idempotent)
        - Check if initialized first
        - Release hardware resources (if any)
        - Reset state variables
        - Set _initialized = False

        DHT11 doesn't require explicit cleanup, but we reset state.
        """
        # PATTERN: Idempotent check
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up DHT11 {self.component_id}")

        # PATTERN: Reset state variables
        self._initialized = False
        self._last_read_time = 0.0

        # PATTERN: Log completion
        self.logger.info(f"DHT11 {self.component_id} cleaned up")


# ADAPTATION GUIDE
# ================

# To adapt this for a different GPIO sensor (e.g., Ultrasonic, PIR, etc.):

# 1. RENAME: Replace "DHT11" with your sensor name (e.g., "Ultrasonic")
# 2. UPDATE SENSOR_TYPE: Change library constant
# 3. UPDATE MIN_READ_INTERVAL: Set appropriate interval for your sensor
# 4. MODIFY read(): Call your sensor's library instead of Adafruit_DHT
# 5. UPDATE VALIDATION: Change range checks for your sensor's specs
# 6. ADJUST RETURN DATA: Modify dict structure (e.g., 'distance' instead of 'temperature')

# Example for Ultrasonic sensor:
"""
class UltrasonicDriver(BaseDriver):
    MIN_READ_INTERVAL = 0.06  # 60ms minimum for HC-SR04

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)
        self.validate_config(['pins'])
        self.trigger_pin = int(self.config['pins']['trigger'])
        self.echo_pin = int(self.config['pins']['echo'])
        # Setup GPIO pins...

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()
        # ... enforce interval ...
        distance = measure_distance(self.trigger_pin, self.echo_pin)

        # Validate range (HC-SR04: 2-400cm)
        if not (2 <= distance <= 400):
            self.logger.warning(f"Distance {distance}cm out of range")

        return {
            'distance': round(distance, 1),
            'unit': 'cm',
            'timestamp': time.time()
        }
"""
