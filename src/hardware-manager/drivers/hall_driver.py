#!/usr/bin/env python3
"""
Hall Effect Sensor Driver

GPIO-based magnetic field detection sensor.
Signal: GPIO 12 | Active-low: 0 = magnet detected
"""

from .gpio_input import GPIOInputDriver


class HallDriver(GPIOInputDriver):
    """Hall effect magnetic field sensor."""

    OUTPUT_KEY = 'detected'
    ACTIVE_LOW = True
