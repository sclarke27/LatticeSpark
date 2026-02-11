#!/usr/bin/env python3
"""
Servo Motor Driver

PWM-based servo motor using gpiozero Servo.

Hardware:
- SG90 micro servo on CrowPi3
- Signal: GPIO 19

Specifications:
- Angle range: 0-180 degrees
- PWM control via gpiozero (software PWM with lgpio on Pi 5)
"""

from typing import Dict, Any, Optional
import time

try:
    from gpiozero import Servo
except ImportError:
    Servo = None

from .base_driver import BaseDriver


class ServoDriver(BaseDriver):
    """Servo motor driver using gpiozero Servo."""

    MIN_READ_INTERVAL = 0.05

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if Servo is None:
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
        self._servo: Optional[Servo] = None
        self._angle: int = 90  # Default to center

    def initialize(self) -> None:
        if self._initialized:
            return

        try:
            self._servo = Servo(self.signal_pin)

            # Test: move to center position
            self._servo.mid()
            self._angle = 90
            time.sleep(0.3)
            # Detach to stop PWM (prevents jitter)
            self._servo.value = None

            self._initialized = True
            self.logger.info(f"Servo initialized on GPIO{self.signal_pin}")

        except Exception as e:
            self._cleanup_servo()
            raise RuntimeError(
                f"Failed to initialize servo on "
                f"GPIO{self.signal_pin}: {e}"
            ) from e

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()

        current_time = self._throttle_read()
        return {'angle': self._angle, 'timestamp': current_time}

    def write(self, data: Dict[str, Any]) -> None:
        self._assert_initialized()

        if not isinstance(data, dict) or 'angle' not in data:
            raise ValueError("Write data must contain 'angle'")

        angle = int(float(data['angle']))

        if angle < 0 or angle > 180:
            raise ValueError(f"Angle must be 0-180, got {angle}")

        # Map 0-180 degrees to gpiozero's -1..1 range
        value = (angle / 90.0) - 1.0
        self._servo.value = value
        self._angle = angle
        # Brief settle, then detach to stop PWM jitter
        time.sleep(0.05)
        self._servo.value = None
        self.logger.debug(f"Servo moved to {angle} degrees")

    def _cleanup_servo(self) -> None:
        if self._servo is not None:
            try:
                self._servo.mid()
                time.sleep(0.2)
            except Exception:
                pass
            try:
                self._servo.close()
            except Exception:
                pass
            finally:
                self._servo = None

    def cleanup(self) -> None:
        if not self._initialized:
            return

        self._cleanup_servo()
        self._angle = 90
        self._initialized = False
        self.logger.info(f"Servo {self.component_id} cleaned up")
