#!/usr/bin/env python3
"""
Touch Sensor Driver

GPIO-based capacitive touch sensor.
Signal: GPIO 17 | Active-high: 1 = touched
"""

from .gpio_input import GPIOInputDriver


class TouchDriver(GPIOInputDriver):
    """Capacitive touch sensor."""

    OUTPUT_KEY = 'touched'
    ACTIVE_LOW = False
