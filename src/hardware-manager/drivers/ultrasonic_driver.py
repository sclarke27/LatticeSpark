#!/usr/bin/env python3
"""
Ultrasonic Distance Sensor Driver

Measures distance using ultrasonic sensor (HC-SR04 style).
Uses gpiozero library (compatible with Raspberry Pi 5).

Hardware:
- Ultrasonic sensor on LatticeSpark
- Trigger: GPIO27
- Echo: GPIO25

Specifications:
- Range: 2cm - 400cm
- Accuracy: ±3mm
- Operating voltage: 3.3V
"""

from typing import Dict, Any, Optional
import time

try:
    from gpiozero import DistanceSensor
    from gpiozero.exc import GPIOZeroError
except ImportError:
    DistanceSensor = None
    GPIOZeroError = Exception

from .base_driver import BaseDriver


class UltrasonicDriver(BaseDriver):
    """Ultrasonic distance sensor driver using gpiozero."""

    # Minimum time between reads (sensor settling time)
    MIN_READ_INTERVAL = 0.1

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize ultrasonic driver.

        Required config keys:
        - pins.trigger: GPIO pin for trigger
        - pins.echo: GPIO pin for echo

        Optional config keys:
        - retries: Number of retry attempts (default: 3)
        - max_distance: Maximum distance in meters (default: 4)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If gpiozero library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if DistanceSensor is None:
            raise ImportError(
                "gpiozero library not installed. "
                "Install with: pip3 install gpiozero"
            )

        # Validate required config
        self.validate_config(['pins'])

        if 'trigger' not in self.config['pins']:
            raise ValueError(
                f"Missing required config: pins.trigger for {component_id}"
            )

        if 'echo' not in self.config['pins']:
            raise ValueError(
                f"Missing required config: pins.echo for {component_id}"
            )

        # Get configuration
        self.trigger_pin: int = int(self.config['pins']['trigger'])
        self.echo_pin: int = int(self.config['pins']['echo'])
        self.retries: int = self.config.get('retries', 3)
        self.max_distance: float = self.config.get('max_distance', 4.0)

        # Track state
        self._sensor: Optional[DistanceSensor] = None

        self.logger.info(
            f"Ultrasonic driver created for {component_id} "
            f"(TRIG: GPIO{self.trigger_pin}, ECHO: GPIO{self.echo_pin})"
        )

    def initialize(self) -> None:
        """
        Initialize ultrasonic sensor.

        Creates DistanceSensor instance and performs test measurement.

        Raises:
            RuntimeError: If sensor initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing ultrasonic sensor (TRIG: GPIO{self.trigger_pin}, "
            f"ECHO: GPIO{self.echo_pin})"
        )

        try:
            self._sensor = DistanceSensor(
                echo=self.echo_pin,
                trigger=self.trigger_pin,
                max_distance=self.max_distance
            )

            # Wait for sensor to settle
            time.sleep(0.1)

            # Perform test read
            distance = self._measure_distance()

            if distance is None:
                raise RuntimeError(
                    f"Ultrasonic sensor on GPIO{self.trigger_pin}/{self.echo_pin} "
                    "not responding. Check sensor connection."
                )

            self._initialized = True
            self.logger.info(
                f"Ultrasonic sensor initialized successfully. "
                f"Test reading: {distance:.1f}cm"
            )

        except GPIOZeroError as e:
            self._cleanup_sensor()
            self.logger.error(f"Ultrasonic sensor initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize ultrasonic sensor: {e}"
            ) from e
        except Exception as e:
            self._cleanup_sensor()
            self.logger.error(f"Ultrasonic sensor initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize ultrasonic sensor: {e}"
            ) from e

    def _measure_distance(self) -> Optional[float]:
        """
        Measure distance using ultrasonic sensor.

        Returns:
            Distance in centimeters, or None if measurement failed
        """
        if not self._sensor:
            return None

        try:
            # Get distance in meters, convert to cm
            distance_m = self._sensor.distance

            # gpiozero returns None if out of range
            if distance_m is None:
                return None

            distance_cm = distance_m * 100
            return distance_cm

        except Exception as e:
            self.logger.warning(f"Distance measurement error: {e}")
            return None

    def read(self) -> Dict[str, Any]:
        """
        Read distance from ultrasonic sensor.

        Returns:
            Dict with keys:
            - distance: Distance in centimeters (float)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized or read fails
        """
        self._assert_initialized()

        current_time = self._throttle_read()

        # Read sensor with retries
        self.logger.debug(f"Reading ultrasonic sensor on GPIO{self.trigger_pin}")

        distance = None

        for attempt in range(self.retries):
            try:
                distance = self._measure_distance()

                if distance is not None:
                    break

                if attempt < self.retries - 1:
                    time.sleep(0.05)  # Short delay between retries

            except Exception as e:
                if attempt < self.retries - 1:
                    time.sleep(0.05)
                    continue
                else:
                    raise RuntimeError(f"Ultrasonic sensor read failed: {e}") from e

        # Validate reading
        if distance is None:
            error_msg = f"Ultrasonic sensor read failed after {self.retries} retries"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg)

        # Validate range against configured max distance
        max_cm = self.max_distance * 100
        if distance < 2 or distance > max_cm:
            self.logger.debug(
                f"Ultrasonic distance {distance:.1f}cm outside range (2-{max_cm:.0f}cm)"
            )

        reading = {
            'distance': round(distance, 1),
            'timestamp': current_time
        }

        self.logger.debug(f"Ultrasonic read: {reading['distance']}cm")

        return reading

    def _cleanup_sensor(self) -> None:
        """Clean up sensor instance."""
        if self._sensor:
            try:
                self._sensor.close()
                time.sleep(0.1)
            except Exception as e:
                self.logger.warning(f"Sensor cleanup warning: {e}")
            finally:
                self._sensor = None

    def cleanup(self) -> None:
        """
        Clean up ultrasonic sensor resources.

        Releases GPIO pins.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up ultrasonic sensor {self.component_id}")

        # Cleanup sensor
        self._cleanup_sensor()

        # Reset state
        self._initialized = False

        self.logger.info(f"Ultrasonic sensor {self.component_id} cleaned up")
