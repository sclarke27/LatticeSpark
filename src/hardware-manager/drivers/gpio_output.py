#!/usr/bin/env python3
"""
GPIO Output Driver Base Class

Shared base for binary GPIO output actuators (vibration, relay, buzzer).
Uses gpiozero OutputDevice. Subclasses only need to declare class attributes.

Usage:
    class VibrationDriver(GPIOOutputDriver):
        STATE_KEY = 'vibrating'

    class BuzzerDriver(GPIOOutputDriver):
        STATE_KEY = 'buzzing'
        ACTIVE_HIGH = False
"""

from typing import Dict, Any, Optional
import time

try:
    from gpiozero import OutputDevice
except ImportError:
    OutputDevice = None

from .base_driver import BaseDriver


class GPIOOutputDriver(BaseDriver):
    """
    Base driver for binary GPIO output actuators.

    Subclass attributes:
        STATE_KEY (str): Key name for read/write state (e.g. 'vibrating', 'active')
        ACTIVE_HIGH (bool): Passed to OutputDevice (default True, buzzer uses False)
    """

    STATE_KEY: str = 'state'
    ACTIVE_HIGH: bool = True

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if OutputDevice is None:
            raise ImportError(
                "gpiozero library not installed. "
                "Install with: pip3 install gpiozero"
            )

        self.validate_config(['pins'])
        if 'signal' not in self.config['pins']:
            raise ValueError(
                f"Missing required config: pins.signal for {component_id}"
            )

        self.signal_pin: int = int(self.config['pins']['signal'])
        self._device: Optional[OutputDevice] = None
        self._state: int = 0

    def initialize(self) -> None:
        if self._initialized:
            return

        try:
            self._device = OutputDevice(
                self.signal_pin, active_high=self.ACTIVE_HIGH
            )

            # Test pulse
            self._device.on()
            time.sleep(0.05)
            self._device.off()
            self._state = 0

            self._initialized = True
            self.logger.info(f"Initialized on GPIO{self.signal_pin}")

        except Exception as e:
            self._cleanup_device()
            raise RuntimeError(
                f"Failed to initialize on GPIO{self.signal_pin}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()
        current_time = self._throttle_read()
        return {self.STATE_KEY: self._state, 'timestamp': current_time}

    def write(self, data: Dict[str, Any]) -> None:
        self._assert_initialized()

        if not isinstance(data, dict) or self.STATE_KEY not in data:
            raise ValueError(f"Write data must contain '{self.STATE_KEY}'")

        value = 1 if int(data[self.STATE_KEY]) else 0

        if value:
            self._device.on()
        else:
            self._device.off()

        self._state = value
        self.logger.info(f"{'on' if value else 'off'}")

    def _cleanup_device(self) -> None:
        if self._device is not None:
            try:
                self._device.off()
            except Exception:
                pass
            try:
                self._device.close()
            except Exception:
                pass
            finally:
                self._device = None

    def cleanup(self) -> None:
        if not self._initialized:
            return

        self._cleanup_device()
        self._state = 0
        self._initialized = False
        self._last_read_time = 0.0
        self.logger.info(f"{self.component_id} cleaned up")
