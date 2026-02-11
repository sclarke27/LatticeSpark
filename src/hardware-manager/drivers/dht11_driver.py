#!/usr/bin/env python3
"""
DHT11 Temperature & Humidity Sensor Driver

Reads temperature and humidity from DHT11 sensor.
Uses adafruit-circuitpython-dht library (supports modern Raspberry Pi models).

Hardware:
- DHT11 sensor connected to GPIO pin (default: GPIO4)
- Requires adafruit-circuitpython-dht library

Specifications:
- Temperature: 0-50°C (±2°C accuracy)
- Humidity: 20-90% RH (±5% accuracy)
- Read interval: Minimum 2 seconds between reads
"""

from typing import Dict, Any, Optional
import time

try:
    import board
    import adafruit_dht
except ImportError:
    # For development/testing without hardware
    board = None
    adafruit_dht = None

from .base_driver import BaseDriver


class DHT11Driver(BaseDriver):
    """DHT11 temperature and humidity sensor driver."""

    # Minimum time between reads (seconds) - DHT11 needs 2s
    MIN_READ_INTERVAL = 2.0

    # GPIO pin to board mapping
    PIN_MAP = {
        4: 'D4', 17: 'D17', 18: 'D18', 27: 'D27',
        22: 'D22', 23: 'D23', 24: 'D24', 25: 'D25',
        5: 'D5', 6: 'D6', 13: 'D13', 19: 'D19',
        26: 'D26', 12: 'D12', 16: 'D16', 20: 'D20',
        21: 'D21'
    }

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize DHT11 driver.

        Required config keys:
        - pins.data: GPIO pin number

        Optional config keys:
        - retries: Number of retry attempts (default: 3)
        - delay: Delay between retries in seconds (default: 0.5)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If adafruit-circuitpython-dht library not available
        """
        super().__init__(component_id, config)

        # Validate library is available
        if adafruit_dht is None or board is None:
            raise ImportError(
                "adafruit-circuitpython-dht library not installed. "
                "Install with: pip3 install adafruit-circuitpython-dht"
            )

        # Validate required config
        self.validate_config(['pins'])

        if 'data' not in self.config['pins']:
            raise ValueError(
                f"Missing required config: pins.data for {component_id}"
            )

        # Get configuration
        self.gpio_pin: int = int(self.config['pins']['data'])
        self.retries: int = self.config.get('retries', 3)
        self.retry_delay: float = self.config.get('delay', 0.5)

        # Track device
        self._device: Optional[adafruit_dht.DHT11] = None

        self.logger.info(
            f"DHT11 driver created for {component_id} on GPIO{self.gpio_pin}"
        )

    def initialize(self) -> None:
        """
        Initialize DHT11 sensor.

        Creates device instance and performs test read.

        Raises:
            RuntimeError: If sensor initialization fails
            ValueError: If GPIO pin is invalid
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(f"Initializing DHT11 on GPIO{self.gpio_pin}")

        try:
            # Map GPIO number to board pin
            if self.gpio_pin not in self.PIN_MAP:
                raise ValueError(
                    f"GPIO{self.gpio_pin} not supported. "
                    f"Supported pins: {list(self.PIN_MAP.keys())}"
                )

            pin_name = self.PIN_MAP[self.gpio_pin]
            board_pin = getattr(board, pin_name)

            # Create DHT11 device
            self._device = adafruit_dht.DHT11(board_pin)

            # Perform test read
            temperature = None
            humidity = None

            for attempt in range(self.retries):
                try:
                    temperature = self._device.temperature
                    humidity = self._device.humidity
                    if temperature is not None and humidity is not None:
                        break
                except RuntimeError:
                    if attempt < self.retries - 1:
                        time.sleep(self.retry_delay)
                    continue

            if temperature is None or humidity is None:
                raise RuntimeError(
                    f"DHT11 sensor on GPIO{self.gpio_pin} not responding. "
                    "Check sensor connection."
                )

            self._initialized = True
            self.logger.info(
                f"DHT11 initialized successfully. "
                f"Test reading: {temperature:.1f}°C, {humidity:.1f}%"
            )

        except Exception as e:
            if self._device:
                self._device.exit()
                self._device = None
            self.logger.error(f"DHT11 initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize DHT11 on GPIO{self.gpio_pin}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        """
        Read temperature and humidity from DHT11.

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

        # Read sensor with retries
        self.logger.debug(f"Reading DHT11 on GPIO{self.gpio_pin}")

        temperature = None
        humidity = None

        for attempt in range(self.retries):
            try:
                temperature = self._device.temperature
                humidity = self._device.humidity

                if temperature is not None and humidity is not None:
                    break

            except RuntimeError as e:
                if attempt < self.retries - 1:
                    time.sleep(self.retry_delay)
                    continue
                else:
                    raise

        # Validate reading
        if humidity is None or temperature is None:
            error_msg = f"DHT11 read failed after {self.retries} retries"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)

        # Validate ranges (DHT11 specs)
        if not (0 <= temperature <= 50):
            self.logger.warning(
                f"DHT11 temperature {temperature}°C out of spec range (0-50°C)"
            )

        if not (0 <= humidity <= 100):
            self.logger.warning(
                f"DHT11 humidity {humidity}% out of valid range (0-100%)"
            )

        reading = {
            'temperature': round(temperature, 1),
            'humidity': round(humidity, 1),
            'timestamp': current_time
        }

        self.logger.debug(
            f"DHT11 read: {reading['temperature']}°C, {reading['humidity']}%"
        )

        return reading

    def cleanup(self) -> None:
        """
        Clean up DHT11 resources.

        Releases GPIO pin and device resources.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up DHT11 {self.component_id}")

        # Release device
        if self._device:
            self._device.exit()
            self._device = None

        # Reset state
        self._initialized = False

        self.logger.info(f"DHT11 {self.component_id} cleaned up")
