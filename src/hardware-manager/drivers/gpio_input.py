#!/usr/bin/env python3
"""
GPIO Input Driver Base Class

Shared base for binary GPIO input sensors (hall, tilt, flame, PIR, sound, touch).
Uses gpiozero InputDevice. Subclasses only need to declare class attributes.

Usage:
    class HallDriver(GPIOInputDriver):
        OUTPUT_KEY = 'detected'
        ACTIVE_LOW = True
"""

from typing import Dict, Any, Optional
import time

try:
    from gpiozero import InputDevice
except ImportError:
    InputDevice = None

from .base_driver import BaseDriver


class GPIOInputDriver(BaseDriver):
    """
    Base driver for binary GPIO input sensors.

    Subclass attributes:
        OUTPUT_KEY (str): Key name in the read() return dict (e.g. 'detected', 'tilted')
        ACTIVE_LOW (bool): If True, raw 0 = active (1), raw 1 = inactive (0).
                           If False, raw value is used directly.
    """

    OUTPUT_KEY: str = 'value'
    ACTIVE_LOW: bool = False

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if InputDevice is None:
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
        self._sensor: Optional[InputDevice] = None

    def initialize(self) -> None:
        if self._initialized:
            return

        try:
            self._sensor = InputDevice(self.signal_pin)
            time.sleep(0.05)

            # Test read
            raw = self._sensor.value
            active = (1 if raw == 0 else 0) if self.ACTIVE_LOW else int(raw)

            self._initialized = True
            self.logger.info(
                f"Initialized on GPIO{self.signal_pin} "
                f"(test: {self.OUTPUT_KEY}={active})"
            )

        except Exception as e:
            self._cleanup_device()
            raise RuntimeError(
                f"Failed to initialize on GPIO{self.signal_pin}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()
        current_time = self._throttle_read()

        try:
            raw = self._sensor.value
        except Exception as e:
            raise RuntimeError(f"GPIO{self.signal_pin} read failed: {e}") from e

        if self.ACTIVE_LOW:
            value = 1 if raw == 0 else 0
        else:
            value = int(raw)

        return {self.OUTPUT_KEY: value, 'timestamp': current_time}

    def _cleanup_device(self) -> None:
        if self._sensor:
            try:
                self._sensor.close()
                time.sleep(0.05)
            except Exception:
                pass
            finally:
                self._sensor = None

    def cleanup(self) -> None:
        if not self._initialized:
            return

        self._cleanup_device()
        self._initialized = False
        self._last_read_time = 0.0
        self.logger.info(f"{self.component_id} cleaned up")
