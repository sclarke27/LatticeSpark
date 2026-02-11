#!/usr/bin/env python3
"""
8x8 RGB LED Matrix Driver

WS2812B 8x8 addressable LED matrix using elecrow_ws281x library.

Hardware:
- 64x WS2812B RGB LEDs in 8x8 grid on CrowPi3
- Data: GPIO 10 (SPI MOSI)
- Same SPI bus as 6-LED strip (separate PixelStrip instance)

Specifications:
- 24-bit color per LED (8 bits per channel: R, G, B)
- 64 LEDs indexed 0-63 (row-major: row0=[0-7], row1=[8-15], ...)
- Communication: SPI-based via elecrow_ws281x
"""

from typing import Dict, Any, List, Optional, Tuple
import time
import json

try:
    from elecrow_ws281x import PixelStrip as _PixelStrip
except ImportError:
    _PixelStrip = None

from .base_driver import BaseDriver


NUM_LEDS = 64
DEFAULT_GPIO_PIN = 10

# Presets: name -> {pixels: [indices], color: (r, g, b)}
# or None for programmatically generated presets
PRESETS = {
    'heart': {
        'pixels': [
            1, 6, 8, 9, 10, 13, 14, 15,
            16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31,
            32, 33, 34, 35, 36, 37, 38, 39,
            41, 42, 43, 44, 45, 46,
            50, 51, 52, 53,
            59, 60,
        ],
        'color': (255, 0, 0),
    },
    'smiley': {
        'pixels': [
            2, 3, 4, 5,
            9, 14,
            16, 18, 21, 23,
            24, 31,
            32, 34, 37, 39,
            40, 42, 43, 44, 45, 47,
            49, 54,
            58, 59, 60, 61,
        ],
        'color': (255, 255, 0),
    },
    'checkerboard': None,  # generated programmatically
    'border': {
        'pixels': [
            0, 1, 2, 3, 4, 5, 6, 7,
            8, 15, 16, 23, 24, 31, 32, 39, 40, 47,
            48, 55, 56, 57, 58, 59, 60, 61, 62, 63,
        ],
        'color': (0, 255, 0),
    },
    'x_mark': {
        'pixels': [0, 7, 9, 14, 18, 21, 27, 28, 35, 36, 42, 45, 49, 54, 56, 63],
        'color': (255, 0, 0),
    },
    'diamond': {
        'pixels': [3, 4, 10, 13, 17, 22, 24, 31, 32, 39, 41, 46, 50, 53, 59, 60],
        'color': (0, 255, 255),
    },
}

PRESET_NAMES = list(PRESETS.keys())


class LEDMatrixDriver(BaseDriver):
    """8x8 RGB LED matrix driver using elecrow_ws281x."""

    MIN_READ_INTERVAL = 0.1

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if _PixelStrip is None:
            raise ImportError(
                "elecrow_ws281x library not installed. "
                "Install with: pip3 install elecrow_ws281x"
            )

        pins = self.config.get('pins', {})
        self._gpio_pin: int = int(pins.get('data', DEFAULT_GPIO_PIN))
        self._num_leds: int = int(self.config.get('numLeds', NUM_LEDS))
        self._strip: Optional[_PixelStrip] = None
        self._grid: List[Tuple[int, int, int]] = [(0, 0, 0)] * self._num_leds
        self._current_preset: str = ''

    def initialize(self) -> None:
        if self._initialized:
            return

        try:
            self._strip = _PixelStrip(self._num_leds, self._gpio_pin)
            self._strip.begin()
            self._strip.clear()
            self._initialized = True
            self.logger.info(
                f"LED Matrix initialized ({self._num_leds} LEDs on GPIO{self._gpio_pin})"
            )
        except Exception as e:
            self._strip = None
            raise RuntimeError(f"Failed to initialize LED matrix: {e}") from e

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()

        current_time = self._throttle_read()

        return {
            'grid': json.dumps([list(c) for c in self._grid]),
            'preset': self._current_preset,
            'timestamp': current_time,
        }

    def _apply_grid(self) -> None:
        """Write all pixels to hardware."""
        flat: List[int] = []
        for r, g, b in self._grid:
            flat.extend([r, g, b])
        self._strip.sendAllPixRGB(flat)

    def _apply_preset(self, name: str) -> None:
        """Apply a named preset pattern."""
        if name not in PRESETS:
            raise ValueError(
                f"Unknown preset: {name}. Available: {PRESET_NAMES}"
            )

        self._grid = [(0, 0, 0)] * self._num_leds

        if name == 'checkerboard':
            for i in range(self._num_leds):
                row, col = divmod(i, 8)
                if (row + col) % 2 == 0:
                    self._grid[i] = (255, 255, 255)
                else:
                    self._grid[i] = (0, 0, 128)
        else:
            preset = PRESETS[name]
            color = preset['color']
            for idx in preset['pixels']:
                if 0 <= idx < self._num_leds:
                    self._grid[idx] = color

        self._current_preset = name
        self._apply_grid()

    def write(self, data: Dict[str, Any]) -> None:
        self._assert_initialized()

        if not isinstance(data, dict):
            raise ValueError("Write data must be a dict")

        try:
            # Clear all
            if 'clear' in data and data['clear']:
                self._grid = [(0, 0, 0)] * self._num_leds
                self._current_preset = ''
                self._strip.clear()
                return

            # Apply preset
            if 'preset' in data:
                self._apply_preset(str(data['preset']))
                return

            # Fill all with one color
            if 'fill' in data and data['fill']:
                r = self._clamp(int(data.get('r', 0)))
                g = self._clamp(int(data.get('g', 0)))
                b = self._clamp(int(data.get('b', 0)))
                self._grid = [(r, g, b)] * self._num_leds
                self._current_preset = ''
                self._apply_grid()
                return

            # Set single pixel
            if 'pixel' in data:
                idx = int(data['pixel'])
                if not 0 <= idx < self._num_leds:
                    raise ValueError(
                        f"Pixel index must be 0-{self._num_leds - 1}"
                    )
                r = self._clamp(int(data.get('r', 0)))
                g = self._clamp(int(data.get('g', 0)))
                b = self._clamp(int(data.get('b', 0)))
                self._grid[idx] = (r, g, b)
                self._current_preset = ''
                self._apply_grid()
                return

            # Set full grid from JSON array
            if 'grid' in data:
                grid_data = data['grid']
                if isinstance(grid_data, str):
                    grid_data = json.loads(grid_data)
                if len(grid_data) != self._num_leds:
                    raise ValueError(
                        f"Grid must have {self._num_leds} entries"
                    )
                for i, pixel in enumerate(grid_data):
                    self._grid[i] = (
                        self._clamp(int(pixel[0])),
                        self._clamp(int(pixel[1])),
                        self._clamp(int(pixel[2])),
                    )
                self._current_preset = ''
                self._apply_grid()
                return

            raise ValueError(
                "Write data must contain 'pixel', 'fill', 'preset', "
                "'clear', or 'grid'"
            )

        except (ValueError, TypeError) as e:
            raise ValueError(f"Invalid write data: {e}") from e

    @staticmethod
    def _clamp(value: int) -> int:
        return max(0, min(255, value))

    def cleanup(self) -> None:
        if not self._initialized:
            return

        if self._strip:
            try:
                self._strip.clear()
            except Exception:
                pass
            finally:
                self._strip = None

        self._grid = [(0, 0, 0)] * self._num_leds
        self._current_preset = ''
        self._initialized = False
        self.logger.info(f"LED Matrix {self.component_id} cleaned up")
