#!/usr/bin/env python3
"""
Vibration Motor Driver

GPIO-based vibration motor.
Signal: GPIO 27 | Active-high
"""

from .gpio_output import GPIOOutputDriver


class VibrationDriver(GPIOOutputDriver):
    """Vibration motor."""

    STATE_KEY = 'vibrating'
