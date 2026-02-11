#!/usr/bin/env python3
"""
BH1750 Ambient Light Sensor Driver

I2C-based ambient light sensor.
Uses smbus2 library for direct I2C communication.

Hardware:
- BH1750 sensor on I2C bus (address 0x5c)
- Connected via SCL1/SDA1 pins

Specifications:
- Light intensity: 1-65535 lux
- Resolution: 1 lux (high-res mode)
- Measurement time: ~120ms (high-res mode)
- I2C address: 0x5c
"""

from typing import Dict, Any, Optional
import time

try:
    from smbus2 import SMBus
except ImportError:
    SMBus = None

from .base_driver import BaseDriver


class BH1750Driver(BaseDriver):
    """BH1750 ambient light sensor driver."""

    # I2C address
    I2C_ADDRESS = 0x5c

    # BH1750 commands
    POWER_DOWN = 0x00
    POWER_ON = 0x01
    RESET = 0x07

    # Measurement modes
    CONTINUOUS_HIGH_RES_MODE_1 = 0x10   # 1 lux resolution, 120ms
    CONTINUOUS_HIGH_RES_MODE_2 = 0x11   # 0.5 lux resolution, 120ms
    CONTINUOUS_LOW_RES_MODE = 0x13      # 4 lux resolution, 16ms
    ONE_TIME_HIGH_RES_MODE_1 = 0x20     # 1 lux resolution, 120ms, auto power-down
    ONE_TIME_HIGH_RES_MODE_2 = 0x21     # 0.5 lux resolution, 120ms, auto power-down
    ONE_TIME_LOW_RES_MODE = 0x23        # 4 lux resolution, 16ms, auto power-down

    # Minimum time between reads (seconds)
    MIN_READ_INTERVAL = 0.2

    # Measurement wait time (seconds) - sensor needs ~120ms for high-res
    MEASUREMENT_WAIT = 0.18

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize BH1750 driver.

        Required config keys:
        - i2c.address: I2C address (default: 0x5c)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If smbus2 library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if SMBus is None:
            raise ImportError(
                "smbus2 library not installed. "
                "Install with: pip3 install smbus2"
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
        self._bus: Optional[SMBus] = None

        self.logger.info(
            f"BH1750 driver created for {component_id} at I2C address 0x{self.i2c_address:02x}"
        )

    def initialize(self) -> None:
        """
        Initialize BH1750 sensor.

        Creates I2C connection and performs test read.

        Raises:
            RuntimeError: If sensor initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(f"Initializing BH1750 at I2C address 0x{self.i2c_address:02x}")

        try:
            # Open I2C bus
            self._bus = SMBus(1)

            # Power on the sensor
            self._bus.write_byte(self.i2c_address, self.POWER_ON)
            time.sleep(0.01)

            # Perform test read
            lux = self._read_lux()

            self._initialized = True
            self.logger.info(
                f"BH1750 initialized successfully. "
                f"Test reading: {lux:.1f} lx"
            )

        except Exception as e:
            if self._bus:
                try:
                    self._bus.close()
                except Exception:
                    pass
                self._bus = None
            self.logger.error(f"BH1750 initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize BH1750 at 0x{self.i2c_address:02x}: {e}"
            ) from e

    def _read_lux(self) -> float:
        """
        Perform a single lux reading from the sensor.

        Returns:
            Light intensity in lux

        Raises:
            RuntimeError: If read fails
        """
        # Trigger one-time high resolution measurement
        with self._with_i2c_lock():
            self._bus.write_byte(self.i2c_address, self.ONE_TIME_HIGH_RES_MODE_1)

        # Wait for measurement to complete (no lock held during sleep)
        time.sleep(self.MEASUREMENT_WAIT)

        # Read 2 bytes of data
        with self._with_i2c_lock():
            data = self._bus.read_i2c_block_data(self.i2c_address, self.ONE_TIME_HIGH_RES_MODE_1, 2)

        # Convert to lux: (byte1 + 256 * byte0) / 1.2
        lux = (data[1] + (256 * data[0])) / 1.2

        return lux

    def read(self) -> Dict[str, Any]:
        """
        Read light intensity from BH1750.

        Returns:
            Dict with keys:
            - light: Light intensity in lux (float)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized or read fails
        """
        self._assert_initialized()

        current_time = self._throttle_read()

        # Read sensor
        self.logger.debug(f"Reading BH1750 at 0x{self.i2c_address:02x}")

        try:
            lux = self._read_lux()
        except Exception as e:
            self.logger.error(f"BH1750 read failed: {e}")
            raise RuntimeError(f"Failed to read BH1750: {e}") from e

        # Validate range (BH1750 max is 65535 lux)
        if not (0 <= lux <= 65535):
            self.logger.warning(
                f"BH1750 light {lux} lx out of spec range (0-65535 lx)"
            )

        reading = {
            'light': round(lux, 1),
            'timestamp': current_time
        }

        self.logger.debug(f"BH1750 read: {reading['light']} lx")

        return reading

    def cleanup(self) -> None:
        """
        Clean up BH1750 resources.

        Powers down sensor and releases I2C bus.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up BH1750 {self.component_id}")

        # Power down sensor and close bus
        if self._bus:
            try:
                self._bus.write_byte(self.i2c_address, self.POWER_DOWN)
            except Exception:
                pass
            try:
                self._bus.close()
            except Exception:
                pass
            self._bus = None

        self._initialized = False

        self.logger.info(f"BH1750 {self.component_id} cleaned up")
