#!/usr/bin/env python3
"""
PIR Motion Sensor Driver

GPIO-based passive infrared motion sensor.
Signal: GPIO 23 | Active-high: 1 = motion detected
"""

from .gpio_input import GPIOInputDriver


class PIRDriver(GPIOInputDriver):
    """Passive infrared motion sensor."""

    OUTPUT_KEY = 'motion'
    ACTIVE_LOW = False
