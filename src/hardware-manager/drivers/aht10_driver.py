#!/usr/bin/env python3
"""
AHT10/AHT20 Temperature & Humidity Sensor Driver

I2C-based temperature and humidity sensor.
Uses adafruit-circuitpython-ahtx0 library.

Hardware:
- AHT10/AHT20 sensor on I2C bus (address 0x38)
- Connected via SCL1/SDA1 pins

Specifications:
- Temperature: -40 to 85°C (±0.3°C accuracy)
- Humidity: 0-100% RH (±2% accuracy)
- I2C address: 0x38
"""

from typing import Dict, Any, Optional
import time

try:
    import board
    import adafruit_ahtx0
except ImportError:
    board = None
    adafruit_ahtx0 = None

from .base_driver import BaseDriver


class AHT10Driver(BaseDriver):
    """AHT10/AHT20 temperature and humidity sensor driver."""

    # I2C address
    I2C_ADDRESS = 0x38

    # Minimum time between reads (seconds)
    MIN_READ_INTERVAL = 0.5

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize AHT10 driver.

        Required config keys:
        - i2c.address: I2C address (default: 0x38)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If adafruit-circuitpython-ahtx0 library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if adafruit_ahtx0 is None or board is None:
            raise ImportError(
                "adafruit-circuitpython-ahtx0 library not installed. "
                "Install with: pip3 install adafruit-circuitpython-ahtx0"
            )

        # Validate required config
        self.validate_config(['i2c'])

        if 'address' not in self.config.get('i2c', {}):
            raise ValueError(
                f"Missing required config: i2c.address for {component_id}"
            )

        # Get configuration
        self.i2c_address = self.parse_i2c_address(self.config['i2c']['address'])

        # Track state
        self._device: Optional[adafruit_ahtx0.AHTx0] = None
        self._i2c = None

        self.logger.info(
            f"AHT10 driver created for {component_id} at I2C address 0x{self.i2c_address:02x}"
        )

    def initialize(self) -> None:
        """
        Initialize AHT10 sensor.

        Creates I2C connection and device instance.

        Raises:
            RuntimeError: If sensor initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(f"Initializing AHT10 at I2C address 0x{self.i2c_address:02x}")

        try:
            # Create I2C interface
            self._i2c = board.I2C()

            # Create sensor instance (pass I2C address from config)
            self._device = adafruit_ahtx0.AHTx0(self._i2c, address=self.i2c_address)

            # Perform test read
            temperature = self._device.temperature
            humidity = self._device.relative_humidity

            if temperature is None or humidity is None:
                raise RuntimeError(
                    f"AHT10 sensor at 0x{self.i2c_address:02x} not responding. "
                    "Check sensor connection."
                )

            self._initialized = True
            self.logger.info(
                f"AHT10 initialized successfully. "
                f"Test reading: {temperature:.1f}°C, {humidity:.1f}%"
            )

        except Exception as e:
            if self._i2c:
                try:
                    self._i2c.deinit()
                except Exception:
                    pass
                self._i2c = None
            self._device = None
            self.logger.error(f"AHT10 initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize AHT10 at 0x{self.i2c_address:02x}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        """
        Read temperature and humidity from AHT10.

        Returns:
            Dict with keys:
            - temperature: Temperature in Celsius (float)
            - humidity: Relative humidity percentage (float)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized or read fails
        """
        self._assert_initialized()

        current_time = self._throttle_read()

        # Read sensor
        self.logger.debug(f"Reading AHT10 at 0x{self.i2c_address:02x}")

        try:
            with self._with_i2c_lock():
                temperature = self._device.temperature
                humidity = self._device.relative_humidity
        except Exception as e:
            self.logger.error(f"AHT10 read failed: {e}")
            raise RuntimeError(f"Failed to read AHT10: {e}") from e

        # Validate reading
        if temperature is None or humidity is None:
            error_msg = "AHT10 read returned None"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)

        # Validate ranges
        if not (-40 <= temperature <= 85):
            self.logger.warning(
                f"AHT10 temperature {temperature}°C out of spec range (-40 to 85°C)"
            )

        if not (0 <= humidity <= 100):
            self.logger.warning(
                f"AHT10 humidity {humidity}% out of valid range (0-100%)"
            )

        reading = {
            'temperature': round(temperature, 1),
            'temperature_f': round(temperature * 9 / 5 + 32, 1),
            'humidity': round(humidity, 1),
            'timestamp': current_time
        }

        self.logger.debug(
            f"AHT10 read: {reading['temperature']}°C, {reading['humidity']}%"
        )

        return reading

    def cleanup(self) -> None:
        """
        Clean up AHT10 resources.

        Releases I2C interface.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up AHT10 {self.component_id}")

        # Release I2C
        if self._i2c:
            try:
                self._i2c.deinit()
            except Exception:
                pass
            self._i2c = None

        self._device = None
        self._initialized = False

        self.logger.info(f"AHT10 {self.component_id} cleaned up")
