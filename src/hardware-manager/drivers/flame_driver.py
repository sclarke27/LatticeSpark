#!/usr/bin/env python3
"""
Flame Sensor Driver

GPIO-based flame detection sensor.
Signal: GPIO 4 | Active-low: 0 = flame detected
"""

from .gpio_input import GPIOInputDriver


class FlameDriver(GPIOInputDriver):
    """Flame detection sensor."""

    OUTPUT_KEY = 'detected'
    ACTIVE_LOW = True
