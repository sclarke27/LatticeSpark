#!/usr/bin/env python3
"""
LCD1602 Character Display Driver

16x2 character LCD with I2C backpack (Adafruit_CharLCDBackpack).

Hardware:
- 16 columns x 2 rows character LCD
- I2C backpack at address 0x21

Specifications:
- 16 characters per line, 2 lines
- Backlight control (on/off)
- Communication: I2C via Adafruit_CharLCD library
"""

from typing import Dict, Any, Optional
import time

try:
    import Adafruit_CharLCD as LCD
except ImportError:
    LCD = None

from .base_driver import BaseDriver


DEFAULT_I2C_ADDRESS = 0x21
DEFAULT_COLUMNS = 16
DEFAULT_ROWS = 2


class LCD1602Driver(BaseDriver):
    """LCD1602 character display driver using Adafruit_CharLCDBackpack."""

    MIN_READ_INTERVAL = 0.1

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize LCD1602 driver.

        Optional config keys:
        - i2c.address: I2C address (default: 0x21)
        - columns: Display width (default: 16)
        - rows: Display height (default: 2)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ImportError: If Adafruit_CharLCD library not available
        """
        super().__init__(component_id, config)

        if LCD is None:
            raise ImportError(
                "Adafruit_CharLCD library not installed. "
                "Install with: pip3 install Adafruit-CharLCD"
            )

        self._i2c_address: int = self.parse_i2c_address(
            self.config.get('i2c', {}).get('address', '0x21')
        )
        self._columns: int = int(self.config.get('columns', DEFAULT_COLUMNS))
        self._rows: int = int(self.config.get('rows', DEFAULT_ROWS))

        self._lcd: Optional[object] = None
        self._line1: str = ''
        self._line2: str = ''
        self._backlight: int = 1  # 1=on, 0=off (user-facing)
        self.logger.info(
            f"LCD1602 driver created for {component_id} "
            f"(I2C 0x{self._i2c_address:02x}, "
            f"{self._columns}x{self._rows})"
        )

    def initialize(self) -> None:
        """
        Initialize LCD hardware.

        Creates LCD instance, turns backlight on, and clears display.

        Raises:
            RuntimeError: If LCD initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing LCD1602 at I2C 0x{self._i2c_address:02x}"
        )

        try:
            self._lcd = LCD.Adafruit_CharLCDBackpack(
                address=self._i2c_address
            )
            # Backlight on (hardware: 0=on, 1=off)
            self._lcd.set_backlight(0)
            self._backlight = 1
            self._lcd.clear()

            self._initialized = True
            self.logger.info("LCD1602 initialized successfully")

        except Exception as e:
            self._lcd = None
            self.logger.error(f"LCD1602 initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize LCD1602 at "
                f"I2C 0x{self._i2c_address:02x}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        """
        Read current LCD state.

        Returns:
            Dict with current display text and backlight state:
            - line1: First line text (str)
            - line2: Second line text (str)
            - backlight: Backlight state (int, 1=on, 0=off)
            - timestamp: Unix timestamp (float)

        Raises:
            RuntimeError: If driver not initialized
        """
        self._assert_initialized()

        current_time = self._throttle_read()

        return {
            'line1': self._line1,
            'line2': self._line2,
            'backlight': self._backlight,
            'timestamp': current_time,
        }

    def _apply_display(self) -> None:
        """Write current text state to LCD hardware."""
        with self._with_i2c_lock():
            self._lcd.clear()
            l1 = self._line1[:self._columns].ljust(self._columns)
            l2 = self._line2[:self._columns].ljust(self._columns)
            self._lcd.message(f"{l1}\n{l2}")

    def write(self, data: Dict[str, Any]) -> None:
        """
        Write to LCD display.

        Supported commands:
        - Set text: {line1: "Hello", line2: "World"}
        - Set backlight: {backlight: 1}  (1=on, 0=off)
        - Combined: {line1: "Hi", line2: "!", backlight: 1}

        Args:
            data: Command data

        Raises:
            RuntimeError: If driver not initialized or write fails
            ValueError: If data is invalid
        """
        self._assert_initialized()

        if not isinstance(data, dict):
            raise ValueError("Write data must be a dict")

        try:
            text_changed = False

            if 'line1' in data:
                self._line1 = str(data['line1'])[:self._columns]
                text_changed = True

            if 'line2' in data:
                self._line2 = str(data['line2'])[:self._columns]
                text_changed = True

            if 'backlight' in data:
                bl = int(data['backlight'])
                self._backlight = 1 if bl else 0
                # Hardware: 0=on, 1=off (inverted)
                with self._with_i2c_lock():
                    self._lcd.set_backlight(0 if self._backlight else 1)
                self.logger.debug(
                    f"Set backlight {'on' if self._backlight else 'off'}"
                )

            if text_changed:
                self._apply_display()
                self.logger.debug(
                    f"Display: [{self._line1}] [{self._line2}]"
                )

            if not text_changed and 'backlight' not in data:
                raise ValueError(
                    "Write data must contain 'line1', 'line2', "
                    "or 'backlight'"
                )

        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid write data: {e}") from e
        except Exception as e:
            self.logger.error(f"LCD1602 write failed: {e}")
            raise RuntimeError(
                f"Failed to write to LCD1602: {e}"
            ) from e

    def cleanup(self) -> None:
        """
        Clean up LCD resources.

        Clears display and turns backlight off.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up LCD1602 {self.component_id}")

        if self._lcd:
            try:
                self._lcd.clear()
                self._lcd.set_backlight(1)  # backlight off
            except Exception as e:
                self.logger.warning(
                    f"LCD clear failed during cleanup: {e}"
                )
            finally:
                self._lcd = None

        self._line1 = ''
        self._line2 = ''
        self._backlight = 0
        self._initialized = False

        self.logger.info(f"LCD1602 {self.component_id} cleaned up")
