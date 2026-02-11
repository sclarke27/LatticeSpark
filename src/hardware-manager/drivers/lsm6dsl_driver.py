#!/usr/bin/env python3
"""
LSM6DSL 6-Axis IMU Driver

I2C-based 6-axis inertial measurement unit (ST Microelectronics).
Provides accelerometer and gyroscope data.
Uses direct SMBus register access.

Hardware:
- LSM6DSL sensor on I2C bus (address 0x6b)
- Connected via SCL1/SDA1 pins

Specifications:
- Accelerometer: ±2g/±4g/±8g/±16g
- Gyroscope: ±125/±250/±500/±1000/±2000 °/s
- WHO_AM_I register 0x0F returns 0x6A
- I2C address: 0x6b
"""

from typing import Dict, Any, Optional
import time

try:
    import smbus
except ImportError:
    smbus = None

from .base_driver import BaseDriver


class LSM6DSLDriver(BaseDriver):
    """LSM6DSL 6-axis IMU driver (accelerometer + gyroscope)."""

    # I2C address
    I2C_ADDRESS_DEFAULT = 0x6b

    # Register addresses
    WHO_AM_I = 0x0F       # Returns 0x6A for LSM6DSL
    CTRL1_XL = 0x10       # Accelerometer control
    CTRL2_G = 0x11        # Gyroscope control
    CTRL3_C = 0x12        # Control register 3 (BDU, IF_INC, SW_RESET)
    STATUS_REG = 0x1E     # Status register

    # Gyroscope output registers (little-endian: low byte first)
    OUTX_L_G = 0x22
    OUTX_H_G = 0x23
    OUTY_L_G = 0x24
    OUTY_H_G = 0x25
    OUTZ_L_G = 0x26
    OUTZ_H_G = 0x27

    # Accelerometer output registers (little-endian: low byte first)
    OUTX_L_XL = 0x28
    OUTX_H_XL = 0x29
    OUTY_L_XL = 0x2A
    OUTY_H_XL = 0x2B
    OUTZ_L_XL = 0x2C
    OUTZ_H_XL = 0x2D

    # WHO_AM_I expected value
    WHO_AM_I_VALUE = 0x6A

    # Scaling factors for default ranges
    GYRO_SCALE = 8.75 / 1000.0      # ±250 °/s: 8.75 mdps/LSB -> °/s
    ACCEL_SCALE = 0.061 / 1000.0     # ±2g: 0.061 mg/LSB -> g
    GRAVITY_MS2 = 9.80665

    # Minimum time between reads (seconds)
    MIN_READ_INTERVAL = 0.01  # 100Hz max

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize LSM6DSL driver.

        Required config keys:
        - i2c.address: I2C address (default: 0x6b)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If smbus library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if smbus is None:
            raise ImportError(
                "smbus library not installed. "
                "Install with: pip3 install smbus"
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
        self._bus: Optional[smbus.SMBus] = None

        self.logger.info(
            f"LSM6DSL driver created for {component_id} at I2C address 0x{self.i2c_address:02x}"
        )

    def _read_word_le(self, reg_low: int) -> int:
        """Read a 16-bit signed value from two consecutive registers (little-endian)."""
        low = self._bus.read_byte_data(self.i2c_address, reg_low)
        high = self._bus.read_byte_data(self.i2c_address, reg_low + 1)
        value = (high << 8) | low
        # Two's complement
        if value >= 0x8000:
            value -= 0x10000
        return value

    def initialize(self) -> None:
        """
        Initialize LSM6DSL sensor.

        Performs software reset, configures accelerometer and gyroscope,
        and verifies WHO_AM_I register.

        Raises:
            RuntimeError: If sensor initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(f"Initializing LSM6DSL at I2C address 0x{self.i2c_address:02x}")

        try:
            # Create I2C bus
            self._bus = smbus.SMBus(1)

            # Verify WHO_AM_I
            who_am_i = self._bus.read_byte_data(self.i2c_address, self.WHO_AM_I)
            if who_am_i != self.WHO_AM_I_VALUE:
                raise RuntimeError(
                    f"WHO_AM_I mismatch: expected 0x{self.WHO_AM_I_VALUE:02x}, "
                    f"got 0x{who_am_i:02x}. Not an LSM6DSL sensor."
                )

            self.logger.info(f"WHO_AM_I confirmed: 0x{who_am_i:02x} (LSM6DSL)")

            # Software reset (bit 0 of CTRL3_C)
            self._bus.write_byte_data(self.i2c_address, self.CTRL3_C, 0x01)
            time.sleep(0.05)

            # Configure accelerometer: 104 Hz ODR, ±2g range
            # CTRL1_XL: ODR_XL[3:0]=0100 (104Hz), FS_XL[1:0]=00 (±2g)
            self._bus.write_byte_data(self.i2c_address, self.CTRL1_XL, 0x40)

            # Configure gyroscope: 104 Hz ODR, ±250 °/s range
            # CTRL2_G: ODR_G[3:0]=0100 (104Hz), FS_G[1:0]=00 (±250°/s)
            self._bus.write_byte_data(self.i2c_address, self.CTRL2_G, 0x40)

            # Enable block data update (BDU) and auto-increment (IF_INC)
            # CTRL3_C: BDU=1 (bit 6), IF_INC=1 (bit 2) -> 0x44
            self._bus.write_byte_data(self.i2c_address, self.CTRL3_C, 0x44)

            # Wait for first samples
            time.sleep(0.05)

            # Perform test read
            accel_x = self._read_word_le(self.OUTX_L_XL)
            gyro_x = self._read_word_le(self.OUTX_L_G)

            self._initialized = True
            self.logger.info(
                f"LSM6DSL initialized successfully. "
                f"Test reading - Accel X raw: {accel_x}, Gyro X raw: {gyro_x}"
            )

        except Exception as e:
            if self._bus:
                try:
                    self._bus.close()
                except Exception:
                    pass
                self._bus = None
            self.logger.error(f"LSM6DSL initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize LSM6DSL at 0x{self.i2c_address:02x}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        """
        Read accelerometer and gyroscope data from LSM6DSL.

        Returns:
            Dict with keys:
            - accel_x, accel_y, accel_z: Acceleration in m/s² (float)
            - gyro_x, gyro_y, gyro_z: Angular velocity in °/s (float)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized or read fails
        """
        self._assert_initialized()

        current_time = self._throttle_read()

        self.logger.debug(f"Reading LSM6DSL at 0x{self.i2c_address:02x}")

        try:
            with self._with_i2c_lock():
                # Read gyroscope raw data
                gyro_x_raw = self._read_word_le(self.OUTX_L_G)
                gyro_y_raw = self._read_word_le(self.OUTY_L_G)
                gyro_z_raw = self._read_word_le(self.OUTZ_L_G)

                # Read accelerometer raw data
                accel_x_raw = self._read_word_le(self.OUTX_L_XL)
                accel_y_raw = self._read_word_le(self.OUTY_L_XL)
                accel_z_raw = self._read_word_le(self.OUTZ_L_XL)

        except Exception as e:
            self.logger.error(f"LSM6DSL read failed: {e}")
            raise RuntimeError(f"Failed to read LSM6DSL: {e}") from e

        # Convert to physical units
        # Gyroscope: °/s
        gyro_x = gyro_x_raw * self.GYRO_SCALE
        gyro_y = gyro_y_raw * self.GYRO_SCALE
        gyro_z = gyro_z_raw * self.GYRO_SCALE

        # Accelerometer: m/s²
        accel_x = accel_x_raw * self.ACCEL_SCALE * self.GRAVITY_MS2
        accel_y = accel_y_raw * self.ACCEL_SCALE * self.GRAVITY_MS2
        accel_z = accel_z_raw * self.ACCEL_SCALE * self.GRAVITY_MS2

        reading = {
            'accel_x': round(accel_x, 2),
            'accel_y': round(accel_y, 2),
            'accel_z': round(accel_z, 2),
            'gyro_x': round(gyro_x, 2),
            'gyro_y': round(gyro_y, 2),
            'gyro_z': round(gyro_z, 2),
            'timestamp': current_time
        }

        self.logger.debug(
            f"LSM6DSL read - Accel: ({reading['accel_x']}, {reading['accel_y']}, {reading['accel_z']}) m/s², "
            f"Gyro: ({reading['gyro_x']}, {reading['gyro_y']}, {reading['gyro_z']}) °/s"
        )

        return reading

    def cleanup(self) -> None:
        """
        Clean up LSM6DSL resources.

        Powers down sensor and closes I2C bus.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up LSM6DSL {self.component_id}")

        if self._bus:
            try:
                # Power down accelerometer and gyroscope (ODR = 0)
                self._bus.write_byte_data(self.i2c_address, self.CTRL1_XL, 0x00)
                self._bus.write_byte_data(self.i2c_address, self.CTRL2_G, 0x00)
            except Exception:
                pass

            try:
                self._bus.close()
            except Exception:
                pass
            self._bus = None

        self._initialized = False

        self.logger.info(f"LSM6DSL {self.component_id} cleaned up")
