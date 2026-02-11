#!/usr/bin/env python3
"""
Rotary Encoder Driver

I2C-based rotary encoder via TCA9534 GPIO expander.
Uses smbus2 library for I2C communication.

A background thread continuously polls the TCA9534 at ~1ms intervals
to catch every quadrature transition. The read() method returns the
accumulated position without touching I2C.

Hardware:
- TCA9534 GPIO expander on I2C bus (address 0x3c)
- Encoder Channel A on bit 6 (ECA)
- Encoder Channel B on bit 7 (ECB)

Specifications:
- Quadrature encoder with position tracking
- I2C address: 0x3c

TCA9534 pin mapping (encoder uses bits 7,6 only):
  Bit:  7    6     5    4     3      2      1      0
        ECB  ECA  HALL  VIB  STEP4  STEP3  STEP2  STEP1
"""

from typing import Dict, Any, Optional
import time
import threading

try:
    from smbus2 import SMBus
except ImportError:
    SMBus = None

from .base_driver import BaseDriver


class EncoderDriver(BaseDriver):
    """TCA9534-based rotary encoder driver."""

    # TCA9534 registers
    REG_INPUT = 0x00     # Input register (read-only)
    REG_OUTPUT = 0x01    # Output register
    REG_POLARITY = 0x02  # Polarity register
    REG_CONFIG = 0x03    # Configuration register (0=output, 1=input)

    # Pin assignments (bit positions)
    PIN_ECB = 7    # Encoder Channel B
    PIN_ECA = 6    # Encoder Channel A

    # Config: ALL bits as input (high-Z) = 0xFF
    # Encoder only reads bits 7,6 (ECA/ECB). All other bits must be
    # input (high-Z) so the TCA9534 doesn't fight with Pi GPIO pins:
    # - Bit 4 (VIB): shared with vibration motor GPIO 27
    # - Bits 3-0 (STEP1-4): shared with stepper motor GPIO 5/6/13/25
    # Output LOW on any of these clamps the line and blocks GPIO control.
    CONFIG_VALUE = 0xFF

    # Background poll interval (seconds) - 1ms to catch fast rotation
    POLL_INTERVAL = 0.001

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize encoder driver.

        Required config keys:
        - i2c.address: I2C address (default: 0x3c)

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ValueError: If required config is missing
            ImportError: If smbus2 library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if SMBus is None:
            raise ImportError(
                "smbus2 library not installed. "
                "Install with: pip3 install smbus2"
            )

        # Validate required config
        self.validate_config(['i2c'])

        if 'address' not in self.config.get('i2c', {}):
            raise ValueError(
                f"Missing required config: i2c.address for {component_id}"
            )

        # Parse I2C address
        self.i2c_address = self.parse_i2c_address(self.config['i2c']['address'])

        # State tracking (updated by background thread)
        self._bus: Optional[SMBus] = None
        self._position: int = 0
        self._direction: int = 0
        self._last_a: int = 0
        self._state_lock = threading.Lock()  # protects _position, _direction, _last_a

        # Background polling thread
        self._running: bool = False
        self._poll_thread: Optional[threading.Thread] = None
        self._thread_last_heartbeat: float = 0.0

        self.logger.info(
            f"Encoder driver created for {component_id} "
            f"at I2C address 0x{self.i2c_address:02x}"
        )

    def initialize(self) -> None:
        """
        Initialize TCA9534 GPIO expander and start background polling.

        Configures all pins as input (high-Z) to avoid clamping shared GPIOs.
        Starts a daemon thread that continuously reads encoder transitions.

        Raises:
            RuntimeError: If initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing encoder at I2C address 0x{self.i2c_address:02x}"
        )

        try:
            # Open I2C bus
            self._bus = SMBus(1)

            # Configure pins: 7,6,5,4 as input, 3-0 as output
            self._bus.write_byte_data(
                self.i2c_address, self.REG_CONFIG, self.CONFIG_VALUE
            )

            # Initialize output pins (bits 3-0) to 0
            self._bus.write_byte_data(
                self.i2c_address, self.REG_OUTPUT, 0x00
            )

            # Capture initial encoder A state
            value = self._bus.read_byte_data(
                self.i2c_address, self.REG_INPUT
            )
            self._last_a = (value >> self.PIN_ECA) & 0x01

            # Start background polling thread
            self._running = True
            self._poll_thread = threading.Thread(
                target=self._poll_loop,
                name=f"encoder-{self.component_id}",
                daemon=True
            )
            self._poll_thread.start()

            self._initialized = True
            self.logger.info(
                f"Encoder initialized with background polling. "
                f"Initial state: A={self._last_a}"
            )

        except Exception as e:
            self._running = False
            if self._bus:
                try:
                    self._bus.close()
                except Exception:
                    pass
                self._bus = None
            self.logger.error(f"Encoder initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize encoder at "
                f"0x{self.i2c_address:02x}: {e}"
            ) from e

    def _poll_loop(self) -> None:
        """
        Background thread: continuously poll TCA9534 for encoder transitions.

        Runs at ~1ms intervals to catch every quadrature step.
        Updates position and direction atomically (CPython GIL).
        """
        while self._running:
            try:
                with self._with_i2c_lock():
                    value = self._bus.read_byte_data(
                        self.i2c_address, self.REG_INPUT
                    )

                val_a = (value >> self.PIN_ECA) & 0x01
                val_b = (value >> self.PIN_ECB) & 0x01

                # Quadrature decode on A transitions
                with self._state_lock:
                    if val_a != self._last_a:
                        self._last_a = val_a
                        if val_a == 0:
                            if val_b == 0:
                                self._position -= 1
                                self._direction = -1
                        else:
                            if val_b == 0:
                                self._position += 1
                                self._direction = 1

                self._thread_last_heartbeat = time.time()
                time.sleep(self.POLL_INTERVAL)

            except Exception as e:
                # Back off on I2C errors, don't crash the thread
                self.logger.debug(f"Encoder poll I2C error: {e}")
                self._thread_last_heartbeat = time.time()
                time.sleep(0.01)

    def read(self) -> Dict[str, Any]:
        """
        Return current encoder state (accumulated by background thread).

        This method does NOT perform I2C reads - it returns the state
        tracked by the background polling thread.

        Returns:
            Dict with keys:
            - position: Cumulative position count (int)
            - direction: Last direction (-1=CCW, 0=none, 1=CW) (int)
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
                    f"Encoder poll thread stale ({stale:.1f}s since last heartbeat)"
                )
                raise RuntimeError(
                    f"Encoder background thread appears dead "
                    f"(no heartbeat for {stale:.1f}s)"
                )

        # Capture and reset direction under lock
        with self._state_lock:
            direction = self._direction
            self._direction = 0
            position = self._position

        reading = {
            'position': position,
            'direction': direction,
            'timestamp': time.time()
        }

        self.logger.debug(
            f"Encoder: pos={position}, dir={direction}"
        )

        return reading

    def write(self, data: Dict[str, Any]) -> None:
        """
        Write to encoder (reset position counter).

        Args:
            data: Dict with key 'position' (int) to reset counter

        Raises:
            RuntimeError: If driver not initialized
            ValueError: If data keys are invalid
        """
        self._assert_initialized()

        if 'position' in data:
            with self._state_lock:
                self._position = int(data['position'])
            self.logger.info(f"Encoder position reset to {data['position']}")
        else:
            raise ValueError(
                f"Unsupported write data for {self.component_id}. "
                "Supported keys: 'position'"
            )

    def cleanup(self) -> None:
        """
        Stop background thread, clean up TCA9534 resources.

        Sets all pins to input (low power) and releases I2C bus.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up encoder {self.component_id}")

        # Stop background polling thread
        self._running = False
        if self._poll_thread:
            self._poll_thread.join(timeout=1.0)
            self._poll_thread = None

        if self._bus:
            try:
                # Set all pins to input (low power)
                self._bus.write_byte_data(
                    self.i2c_address, self.REG_CONFIG, 0xFF
                )
            except Exception:
                pass
            try:
                self._bus.close()
            except Exception:
                pass
            self._bus = None

        self._initialized = False
        self._position = 0
        self._direction = 0
        self._last_a = 0

        self.logger.info(f"Encoder {self.component_id} cleaned up")
