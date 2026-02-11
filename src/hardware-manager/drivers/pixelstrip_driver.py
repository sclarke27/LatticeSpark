#!/usr/bin/env python3
"""
PixelStrip RGB LED Driver

WS2812B addressable LED strip driver using elecrow_ws281x library.

Hardware:
- 6x WS2812B RGB LEDs on CrowPi3
- Data: GPIO 10 (SPI MOSI)

Specifications:
- 24-bit color per LED (8 bits per channel: R, G, B)
- Brightness: 0-255 (software-scaled)
- Communication: SPI-based via elecrow_ws281x
"""

from typing import Dict, Any, List, Optional, Tuple
import time

try:
    from elecrow_ws281x import PixelStrip as _PixelStrip
except ImportError:
    _PixelStrip = None

from .base_driver import BaseDriver


DEFAULT_LED_COUNT = 6
DEFAULT_GPIO_PIN = 10


class PixelStripDriver(BaseDriver):
    """WS2812B addressable RGB LED strip driver using elecrow_ws281x."""

    MIN_READ_INTERVAL = 0.05

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize PixelStrip driver.

        Optional config keys:
        - pins.data: GPIO pin for data line (default: 10)
        - numLeds: Number of LEDs (default: 6)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ImportError: If elecrow_ws281x library not available
        """
        super().__init__(component_id, config)

        if _PixelStrip is None:
            raise ImportError(
                "elecrow_ws281x library not installed. "
                "Install with: pip3 install elecrow_ws281x"
            )

        # Get configuration
        pins = self.config.get('pins', {})
        self._gpio_pin: int = int(pins.get('data', DEFAULT_GPIO_PIN))
        self._num_leds: int = int(self.config.get('numLeds', DEFAULT_LED_COUNT))
        self._brightness: int = 255

        # Internal state
        self._strip: Optional[_PixelStrip] = None
        self._colors: List[Tuple[int, int, int]] = [(0, 0, 0)] * self._num_leds
        self.logger.info(
            f"PixelStrip driver created for {component_id} "
            f"({self._num_leds} LEDs on GPIO{self._gpio_pin})"
        )

    def initialize(self) -> None:
        """
        Initialize LED strip hardware.

        Creates PixelStrip instance and turns all LEDs off.

        Raises:
            RuntimeError: If strip initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing PixelStrip on GPIO{self._gpio_pin} "
            f"({self._num_leds} LEDs)"
        )

        try:
            self._strip = _PixelStrip(self._num_leds, self._gpio_pin)
            self._strip.begin()

            # Turn all LEDs off
            self._strip.clear()

            self._initialized = True
            self.logger.info(
                f"PixelStrip initialized successfully "
                f"({self._num_leds} LEDs)"
            )

        except Exception as e:
            self._strip = None
            self.logger.error(f"PixelStrip initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize PixelStrip on "
                f"GPIO{self._gpio_pin}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        """
        Read current LED strip state.

        Returns:
            Dict with per-LED RGB values and brightness:
            - led_N_r, led_N_g, led_N_b: RGB values for LED N (int, 0-255)
            - brightness: Strip brightness (int, 0-255)
            - timestamp: Unix timestamp (float)

        Raises:
            RuntimeError: If driver not initialized
        """
        self._assert_initialized()

        current_time = self._throttle_read()

        reading: Dict[str, Any] = {
            'brightness': self._brightness,
            'timestamp': current_time,
        }

        for i in range(self._num_leds):
            r, g, b = self._colors[i]
            reading[f'led_{i}_r'] = r
            reading[f'led_{i}_g'] = g
            reading[f'led_{i}_b'] = b

        return reading

    def _apply_all(self) -> None:
        """Rewrite all LEDs to hardware with current brightness."""
        for i in range(self._num_leds):
            r, g, b = self._colors[i]
            scaled_r = int(r * self._brightness / 255)
            scaled_g = int(g * self._brightness / 255)
            scaled_b = int(b * self._brightness / 255)
            self._strip.fill(scaled_r, scaled_g, scaled_b, 0, i, i + 1)

    def write(self, data: Dict[str, Any]) -> None:
        """
        Write to LED strip.

        Supported commands:
        - Set single LED: {led: 0, r: 255, g: 0, b: 128}
        - Set brightness: {brightness: 128}
        - Set all LEDs: {all_r: 255, all_g: 0, all_b: 0}

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
            # Set brightness (reapply all colors with new brightness)
            if 'brightness' in data and 'led' not in data:
                brightness = int(data['brightness'])
                if not 0 <= brightness <= 255:
                    raise ValueError(
                        f"Brightness must be 0-255, got {brightness}"
                    )
                self._brightness = brightness
                self._apply_all()
                self.logger.debug(f"Set brightness to {brightness}")
                return

            # Set all LEDs to same color
            if 'all_r' in data:
                r = self._clamp(int(data['all_r']))
                g = self._clamp(int(data.get('all_g', 0)))
                b = self._clamp(int(data.get('all_b', 0)))
                for i in range(self._num_leds):
                    self._colors[i] = (r, g, b)
                self._apply_all()
                self.logger.debug(f"Set all LEDs to ({r}, {g}, {b})")
                return

            # Set single LED
            if 'led' in data:
                led_index = int(data['led'])
                if not 0 <= led_index < self._num_leds:
                    raise ValueError(
                        f"LED index must be 0-{self._num_leds - 1}, "
                        f"got {led_index}"
                    )
                r = self._clamp(int(data.get('r', 0)))
                g = self._clamp(int(data.get('g', 0)))
                b = self._clamp(int(data.get('b', 0)))

                self._colors[led_index] = (r, g, b)
                self._apply_all()
                self.logger.debug(
                    f"Set LED {led_index} to ({r}, {g}, {b})"
                )
                return

            raise ValueError(
                "Write data must contain 'led', 'brightness', or 'all_r'"
            )

        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid write data: {e}") from e
        except Exception as e:
            self.logger.error(f"PixelStrip write failed: {e}")
            raise RuntimeError(
                f"Failed to write to PixelStrip: {e}"
            ) from e

    @staticmethod
    def _clamp(value: int) -> int:
        """Clamp value to 0-255 range."""
        return max(0, min(255, value))

    def cleanup(self) -> None:
        """
        Clean up LED strip resources.

        Turns all LEDs off and releases hardware.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up PixelStrip {self.component_id}")

        if self._strip:
            try:
                self._strip.clear()
            except Exception as e:
                self.logger.warning(f"LED clear failed during cleanup: {e}")
            finally:
                self._strip = None

        self._colors = [(0, 0, 0)] * self._num_leds
        self._initialized = False

        self.logger.info(f"PixelStrip {self.component_id} cleaned up")
