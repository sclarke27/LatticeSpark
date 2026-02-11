#!/usr/bin/env python3
"""
Sound Sensor Driver

GPIO-based sound detection sensor.
Signal: GPIO 24 | Active-high: 1 = sound detected
"""

from .gpio_input import GPIOInputDriver


class SoundDriver(GPIOInputDriver):
    """Sound detection sensor."""

    OUTPUT_KEY = 'detected'
    ACTIVE_LOW = False
