#!/usr/bin/env python3
"""
Active Buzzer Driver

GPIO-based active buzzer.
Signal: GPIO 18 | Active-low (active_high=False prevents default-on)
"""

from .gpio_output import GPIOOutputDriver


class BuzzerDriver(GPIOOutputDriver):
    """Active buzzer (fixed tone, on/off)."""

    STATE_KEY = 'buzzing'
    ACTIVE_HIGH = False
