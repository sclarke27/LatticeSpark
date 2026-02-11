#!/usr/bin/env python3
"""
IR Remote Receiver Driver

GPIO-based infrared remote control receiver.
Uses gpiozero library (compatible with Raspberry Pi 5).
Decodes NEC protocol IR signals via bit-banging in a background thread.

Hardware:
- IR receiver module on CrowPi3
- Signal: GPIO 20

Specifications:
- NEC protocol: 32-bit (address + address_inv + command + command_inv)
- Carrier frequency: 38kHz
- Active-low: signal goes low when receiving
- Background thread for precise timing (~60us intervals)
"""

from typing import Dict, Any, Optional
import time
import threading

try:
    from gpiozero import InputDevice, Device
    from gpiozero.exc import GPIOZeroError
    from gpiozero.pins.lgpio import LGPIOFactory
except ImportError:
    InputDevice = None
    Device = None
    LGPIOFactory = None
    GPIOZeroError = Exception

from .base_driver import BaseDriver


# NEC remote key code -> name mapping
KEY_NAMES: Dict[int, str] = {
    0x45: "CH-",
    0x46: "CH",
    0x47: "CH+",
    0x44: "PREV",
    0x40: "NEXT",
    0x43: "PLAY/PAUSE",
    0x07: "VOL-",
    0x15: "VOL+",
    0x09: "EQ",
    0x16: "0",
    0x19: "100+",
    0x0D: "200+",
    0x0C: "1",
    0x18: "2",
    0x5E: "3",
    0x08: "4",
    0x1C: "5",
    0x5A: "6",
    0x42: "7",
    0x52: "8",
    0x4A: "9",
}


class IRDriver(BaseDriver):
    """NEC protocol IR remote receiver driver using gpiozero."""

    # Timing constants for NEC decode (seconds)
    PULSE_TIMEOUT = 0.00006  # 60us per timing loop iteration

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize IR receiver driver.

        Required config keys:
        - pins.signal: GPIO pin for IR receiver input

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If gpiozero library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if InputDevice is None:
            raise ImportError(
                "gpiozero library not installed. "
                "Install with: pip3 install gpiozero"
            )

        # Validate required config
        self.validate_config(['pins'])

        if 'signal' not in self.config['pins']:
            raise ValueError(
                f"Missing required config: pins.signal for {component_id}"
            )

        # Get configuration
        self.signal_pin: int = int(self.config['pins']['signal'])
        self._hold_duration: float = float(self.config.get('holdDuration', 1.0))

        # State tracking (updated by background thread)
        self._sensor: Optional[InputDevice] = None
        self._pin_factory = None
        self._last_key_code: int = 0
        self._last_key_time: float = 0.0
        self._state_lock = threading.Lock()  # protects _last_key_code, _last_key_time

        # Background thread
        self._running: bool = False
        self._receive_thread: Optional[threading.Thread] = None
        self._thread_last_heartbeat: float = 0.0

        # Create pin factory for Pi 5 (lgpio) if available
        if LGPIOFactory:
            try:
                self._pin_factory = LGPIOFactory()
                self.logger.info(
                    f"Created lgpio pin factory for Pi 5: "
                    f"{type(self._pin_factory)}"
                )
            except Exception as e:
                self.logger.error(
                    f"Failed to create lgpio factory: {e}", exc_info=True
                )
                self._pin_factory = None
        else:
            self.logger.warning(
                "LGPIOFactory not available - IR receiver may not work on Pi 5"
            )

        self.logger.info(
            f"IR receiver driver created for {component_id} "
            f"(GPIO{self.signal_pin})"
        )

    def initialize(self) -> None:
        """
        Initialize IR receiver and start background receive thread.

        Creates InputDevice and starts daemon thread for NEC decode.

        Raises:
            RuntimeError: If initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing IR receiver on GPIO{self.signal_pin}"
        )

        try:
            # Create InputDevice with lgpio pin factory for Pi 5
            sensor_kwargs: Dict[str, Any] = {'pin': self.signal_pin}

            if self._pin_factory:
                sensor_kwargs['pin_factory'] = self._pin_factory
                self.logger.info("Using lgpio pin factory for InputDevice")

            self._sensor = InputDevice(**sensor_kwargs)

            # Wait for sensor to settle
            time.sleep(0.05)

            # Verify we can read the pin
            _ = self._sensor.value

            # Start background receive thread
            self._running = True
            self._receive_thread = threading.Thread(
                target=self._receive_loop,
                name=f"ir-{self.component_id}",
                daemon=True
            )
            self._receive_thread.start()

            self._initialized = True
            self.logger.info(
                "IR receiver initialized with background decode thread"
            )

        except GPIOZeroError as e:
            self._running = False
            self._cleanup_sensor()
            self.logger.error(f"IR receiver initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize IR receiver on "
                f"GPIO{self.signal_pin}: {e}"
            ) from e
        except Exception as e:
            self._running = False
            self._cleanup_sensor()
            self.logger.error(f"IR receiver initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize IR receiver on "
                f"GPIO{self.signal_pin}: {e}"
            ) from e

    def _decode_nec(self) -> Optional[int]:
        """
        Decode a single NEC IR frame.

        Waits for the leading pulse, then reads 32 bits of data.
        Validates address and command checksums.

        Returns:
            Key code (int) if valid frame decoded, None otherwise
        """
        # Wait for leading low pulse (9ms burst)
        count = 0
        while self._sensor.value == 0 and count < 200 and self._running:
            count += 1
            time.sleep(self.PULSE_TIMEOUT)

        if not self._running:
            return None

        # Wait for leading high pulse (4.5ms space)
        count = 0
        while self._sensor.value == 1 and count < 80 and self._running:
            count += 1
            time.sleep(self.PULSE_TIMEOUT)

        if not self._running:
            return None

        # Read 32 bits of data (4 bytes)
        data = [0, 0, 0, 0]
        idx = 0
        cnt = 0

        for i in range(32):
            if not self._running:
                return None

            # Wait for low pulse (562.5us burst)
            count = 0
            while self._sensor.value == 0 and count < 15 and self._running:
                count += 1
                time.sleep(self.PULSE_TIMEOUT)

            # Wait for high pulse (562.5us=0 or 1687.5us=1)
            count = 0
            while self._sensor.value == 1 and count < 40 and self._running:
                count += 1
                time.sleep(self.PULSE_TIMEOUT)

            # Long high = 1 bit, short high = 0 bit
            if count > 8:
                data[idx] |= 1 << cnt

            if cnt == 7:
                cnt = 0
                idx += 1
            else:
                cnt += 1

        # Validate checksums: address + ~address = 0xFF, cmd + ~cmd = 0xFF
        if data[0] + data[1] == 0xFF and data[2] + data[3] == 0xFF:
            return data[2]

        return None

    def _receive_loop(self) -> None:
        """
        Background thread: continuously monitor for IR signals.

        Watches for the leading low pulse that starts an NEC frame,
        then decodes the full 32-bit message.
        """
        while self._running:
            try:
                # Wait for signal to go low (start of transmission)
                if self._sensor.value == 0:
                    key_code = self._decode_nec()

                    if key_code is not None:
                        with self._state_lock:
                            self._last_key_code = key_code
                            self._last_key_time = time.time()
                        self.logger.debug(
                            f"IR received: 0x{key_code:02X} "
                            f"({KEY_NAMES.get(key_code, 'unknown')})"
                        )
                else:
                    # No signal - short sleep to avoid busy-waiting
                    time.sleep(0.001)

                self._thread_last_heartbeat = time.time()

            except Exception:
                self._thread_last_heartbeat = time.time()
                time.sleep(0.01)

    def read(self) -> Dict[str, Any]:
        """
        Return last received IR key (accumulated by background thread).

        This method does NOT perform GPIO reads - it returns the state
        tracked by the background receive thread.

        Returns:
            Dict with keys:
            - key_code: Last received key code (int, 0=none)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized
        """
        self._assert_initialized()

        # Check background thread health
        if self._running and self._thread_last_heartbeat > 0:
            stale = time.time() - self._thread_last_heartbeat
            if stale > 5.0:
                self.logger.error(
                    f"IR receive thread stale ({stale:.1f}s since last heartbeat)"
                )
                raise RuntimeError(
                    f"IR background thread appears dead "
                    f"(no heartbeat for {stale:.1f}s)"
                )

        now = time.time()
        with self._state_lock:
            key_code = self._last_key_code
            key_time = self._last_key_time

            # Hold key code for configured duration, then clear
            if key_code != 0 and (now - key_time) > self._hold_duration:
                self._last_key_code = 0
                key_code = 0

        reading = {
            'key_code': key_code,
            'timestamp': now
        }

        if key_code:
            self.logger.debug(
                f"IR read: 0x{key_code:02X} "
                f"({KEY_NAMES.get(key_code, 'unknown')})"
            )

        return reading

    def _cleanup_sensor(self) -> None:
        """Clean up sensor instance and pin factory."""
        if self._sensor:
            try:
                self._sensor.close()
                time.sleep(0.05)
            except Exception as e:
                self.logger.warning(f"Sensor cleanup warning: {e}")
            finally:
                self._sensor = None

        if self._pin_factory:
            try:
                self._pin_factory.close()
            except Exception as e:
                self.logger.warning(f"Pin factory cleanup warning: {e}")
            finally:
                self._pin_factory = None

    def cleanup(self) -> None:
        """
        Stop background thread and clean up IR receiver resources.

        Releases GPIO pin.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up IR receiver {self.component_id}")

        # Stop background thread
        self._running = False
        if self._receive_thread:
            self._receive_thread.join(timeout=1.0)
            self._receive_thread = None

        self._cleanup_sensor()

        self._initialized = False
        self._last_key_code = 0
        self._last_key_time = 0.0

        self.logger.info(f"IR receiver {self.component_id} cleaned up")
