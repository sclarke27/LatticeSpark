#!/usr/bin/env python3
"""
Tilt Sensor Driver

GPIO-based tilt detection sensor.
Signal: GPIO 22 | Active-high: 1 = tilted
"""

from .gpio_input import GPIOInputDriver


class TiltDriver(GPIOInputDriver):
    """Tilt switch sensor."""

    OUTPUT_KEY = 'tilted'
    ACTIVE_LOW = False
