#!/usr/bin/env python3
"""
7-Segment Display Driver

4-digit 7-segment display with HT16K33 I2C backpack (Adafruit LED Backpack).

Hardware:
- 4 digits (positions 0-3)
- Colon between digits 1 and 2
- I2C backpack at address 0x70

Specifications:
- Digits: 0-9, space (blank)
- Decimal dots: physically available after digit 1 and digit 3 only
  (e.g., "12.34" works, "1.234" cannot show a dot after digit 0)
- Colon: on/off (between digits 1 and 2)
- Communication: I2C via Adafruit_LED_Backpack library

Hardware dot mapping (HT16K33 quirk):
  Position 0's decimal bit → dot after digit 1
  Position 1's decimal bit → colon (not a dot)
  Position 2's decimal bit → dot after digit 3
  Position 3's decimal bit → no LED
"""

from typing import Dict, Any, Optional
import time

try:
    from Adafruit_LED_Backpack import SevenSegment
except ImportError:
    SevenSegment = None

from .base_driver import BaseDriver


DEFAULT_I2C_ADDRESS = 0x70
NUM_DIGITS = 4

VALID_CHARS = set('0123456789 .')


class SevenSegmentDriver(BaseDriver):
    """7-Segment display driver using Adafruit_LED_Backpack."""

    MIN_READ_INTERVAL = 0.1

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if SevenSegment is None:
            raise ImportError(
                "Adafruit_LED_Backpack library not installed. "
                "Install with: pip3 install Adafruit-LED-Backpack"
            )

        self._i2c_address: int = self.parse_i2c_address(
            self.config.get('i2c', {}).get('address', '0x70')
        )

        self._display: Optional[object] = None
        self._text: str = '    '
        self._colon: int = 0
        self.logger.info(
            f"SevenSegment driver created for {component_id} "
            f"(I2C 0x{self._i2c_address:02x})"
        )

    def initialize(self) -> None:
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing 7-segment display at I2C 0x{self._i2c_address:02x}"
        )

        try:
            self._display = SevenSegment.SevenSegment(
                address=self._i2c_address
            )
            self._display.begin()
            self._display.clear()
            self._display.write_display()

            self._initialized = True
            self.logger.info("7-segment display initialized successfully")

        except Exception as e:
            self._display = None
            self.logger.error(f"7-segment initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize 7-segment display at "
                f"I2C 0x{self._i2c_address:02x}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()

        current_time = self._throttle_read()

        return {
            'text': self._text,
            'colon': self._colon,
            'timestamp': current_time,
        }

    @staticmethod
    def _parse_text(text: str):
        """Parse text into digit/decimal pairs for display.

        Handles decimal points by attaching them to the preceding digit.
        E.g., "12.34" -> [(1,False), (2,True), (3,False), (4,False)]
              "1.2.3" -> [(1,True), (2,True), (3,False), (space,False)]

        Returns list of (digit_char, has_decimal) tuples, max 4.
        """
        digits = []
        i = 0
        while i < len(text) and len(digits) < NUM_DIGITS:
            ch = text[i]
            if ch == '.':
                # Leading dot — attach to a blank digit
                if not digits:
                    digits.append((' ', True))
                else:
                    # Attach to previous digit
                    prev_ch, _ = digits[-1]
                    digits[-1] = (prev_ch, True)
                i += 1
                continue
            # Check for trailing decimal
            has_decimal = (i + 1 < len(text) and text[i + 1] == '.')
            digits.append((ch, has_decimal))
            i += 2 if has_decimal else 1
        # Pad to 4 digits
        while len(digits) < NUM_DIGITS:
            digits.append((' ', False))
        return digits

    # Hardware decimal remap: to show a dot after digit N,
    # set the decimal bit on this buffer position.
    # None = no physical LED at that position.
    _DOT_REMAP = {
        0: None,  # No dot LED after digit 0
        1: 0,     # Dot after digit 1 → position 0's decimal bit
        2: None,  # Position 1's decimal = colon, not a dot
        3: 2,     # Dot after digit 3 → position 2's decimal bit
    }

    def _apply_display(self) -> None:
        """Write current state to display hardware."""
        with self._with_i2c_lock():
            self._display.clear()
            parsed = self._parse_text(self._text)

            # Set all digits without decimals first
            for i, (ch, _) in enumerate(parsed):
                if ch != ' ':
                    self._display.set_digit(i, int(ch))

            # Apply decimals with hardware remap
            for i, (_, has_decimal) in enumerate(parsed):
                if has_decimal:
                    hw_pos = self._DOT_REMAP.get(i)
                    if hw_pos is not None:
                        # OR the decimal bit (0x80) onto the remapped position
                        self._display.buffer[hw_pos * 2] |= 0x80

            self._display.set_colon(self._colon == 1)
            self._display.write_display()

    def write(self, data: Dict[str, Any]) -> None:
        self._assert_initialized()

        if not isinstance(data, dict):
            raise ValueError("Write data must be a dict")

        try:
            display_changed = False

            if 'text' in data:
                text = str(data['text'])
                for ch in text:
                    if ch not in VALID_CHARS:
                        raise ValueError(
                            f"Invalid character '{ch}'. "
                            f"Use 0-9, '.', or space."
                        )
                # Count actual digits (non-decimal chars)
                digit_count = sum(1 for c in text if c != '.')
                if digit_count > NUM_DIGITS:
                    text = text[:NUM_DIGITS + text[:NUM_DIGITS].count('.')]
                self._text = text
                display_changed = True

            if 'colon' in data:
                self._colon = 1 if int(data['colon']) else 0
                display_changed = True

            if display_changed:
                self._apply_display()
                self.logger.debug(
                    f"Display: [{self._text}] colon={self._colon}"
                )
            else:
                raise ValueError(
                    "Write data must contain 'text' or 'colon'"
                )

        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid write data: {e}") from e
        except Exception as e:
            self.logger.error(f"7-segment write failed: {e}")
            raise RuntimeError(
                f"Failed to write to 7-segment display: {e}"
            ) from e

    def cleanup(self) -> None:
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up 7-segment {self.component_id}")

        if self._display:
            try:
                self._display.clear()
                self._display.write_display()
            except Exception as e:
                self.logger.warning(
                    f"Display clear failed during cleanup: {e}"
                )
            finally:
                self._display = None

        self._text = '    '
        self._colon = 0
        self._initialized = False

        self.logger.info(f"7-segment {self.component_id} cleaned up")
