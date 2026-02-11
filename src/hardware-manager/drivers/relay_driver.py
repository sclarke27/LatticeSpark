#!/usr/bin/env python3
"""
Relay Driver

GPIO-based relay module.
Signal: GPIO 21 | Active-high
"""

from .gpio_output import GPIOOutputDriver


class RelayDriver(GPIOOutputDriver):
    """Relay module."""

    STATE_KEY = 'active'
