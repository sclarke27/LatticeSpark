#!/usr/bin/env python3
"""
RFID Reader Driver

SPI-based MFRC522 NFC/RFID card reader.
Uses mfrc522 library for SPI communication.

Hardware:
- MFRC522 RFID module on CrowPi3
- SPI bus 0, device 0 (CE0)
- RST: GPIO 25

Specifications:
- ISO 14443A compatible
- 13.56 MHz operating frequency
- Supports MIFARE cards (4-byte UID)
- Background thread for continuous card scanning
"""

from typing import Dict, Any, Optional
import time
import threading

try:
    from mfrc522 import SimpleMFRC522
except ImportError:
    SimpleMFRC522 = None

from .base_driver import BaseDriver


class RFIDDriver(BaseDriver):
    """MFRC522 RFID/NFC card reader driver."""

    # Time between card scans (seconds)
    POLL_INTERVAL = 0.2

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize RFID reader driver.

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ImportError: If mfrc522 library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if SimpleMFRC522 is None:
            raise ImportError(
                "mfrc522 library not installed. "
                "Install with: pip3 install mfrc522"
            )

        # Hold duration for displaying detected card
        self._hold_duration: float = float(
            self.config.get('holdDuration', 2.0)
        )

        # State tracking (updated by background thread)
        self._reader = None
        self._last_uid: int = 0
        self._last_uid_time: float = 0.0
        self._state_lock = threading.Lock()  # protects _last_uid, _last_uid_time

        # Background thread
        self._running: bool = False
        self._scan_thread: Optional[threading.Thread] = None
        self._thread_last_heartbeat: float = 0.0

        self.logger.info(
            f"RFID reader driver created for {component_id}"
        )

    def initialize(self) -> None:
        """
        Initialize RFID reader and start background scan thread.

        Creates SimpleMFRC522 reader and starts daemon thread
        for continuous card scanning.

        Raises:
            RuntimeError: If initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info("Initializing RFID reader")

        try:
            self._reader = SimpleMFRC522()

            # Start background scan thread
            self._running = True
            self._scan_thread = threading.Thread(
                target=self._scan_loop,
                name=f"rfid-{self.component_id}",
                daemon=True
            )
            self._scan_thread.start()

            self._initialized = True
            self.logger.info(
                "RFID reader initialized with background scan thread"
            )

        except Exception as e:
            self._running = False
            self._reader = None
            self.logger.error(f"RFID reader initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize RFID reader: {e}"
            ) from e

    def _scan_loop(self) -> None:
        """
        Background thread: continuously scan for RFID cards.

        Uses MFRC522_Request + MFRC522_Anticoll for non-blocking
        card detection.
        """
        while self._running:
            try:
                # Request any card (PICC_REQIDL = 0x26)
                (error, _data) = self._reader.READER.MFRC522_Request(
                    self._reader.READER.PICC_REQIDL
                )

                if not error:
                    # Card detected, get UID
                    (error, uid_bytes) = (
                        self._reader.READER.MFRC522_Anticoll()
                    )

                    if not error and uid_bytes:
                        # Convert 4-byte UID to integer
                        uid_int = 0
                        for byte in uid_bytes[:4]:
                            uid_int = (uid_int << 8) | byte

                        with self._state_lock:
                            self._last_uid = uid_int
                            self._last_uid_time = time.time()
                        self.logger.debug(
                            f"RFID card detected: "
                            f"0x{uid_int:08X}"
                        )

                self._thread_last_heartbeat = time.time()
                time.sleep(self.POLL_INTERVAL)

            except Exception:
                self._thread_last_heartbeat = time.time()
                time.sleep(0.5)

    def read(self) -> Dict[str, Any]:
        """
        Return last detected RFID card UID.

        This method does NOT perform SPI reads - it returns the state
        tracked by the background scan thread. The UID is held for
        the configured hold duration before clearing.

        Returns:
            Dict with keys:
            - uid: Card UID as integer (0 = no card)
            - detected: Whether a card is detected (int, 1/0)
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
                    f"RFID scan thread stale ({stale:.1f}s since last heartbeat)"
                )
                raise RuntimeError(
                    f"RFID background thread appears dead "
                    f"(no heartbeat for {stale:.1f}s)"
                )

        now = time.time()
        with self._state_lock:
            uid = self._last_uid
            uid_time = self._last_uid_time

            # Hold UID for configured duration, then clear
            if uid != 0 and (now - uid_time) > self._hold_duration:
                self._last_uid = 0
                uid = 0

        reading = {
            'uid': uid,
            'detected': 1 if uid != 0 else 0,
            'timestamp': now
        }

        if uid:
            self.logger.debug(f"RFID read: 0x{uid:08X}")

        return reading

    def cleanup(self) -> None:
        """
        Stop background thread and clean up RFID reader resources.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up RFID reader {self.component_id}")

        # Stop background thread
        self._running = False
        if self._scan_thread:
            self._scan_thread.join(timeout=1.0)
            self._scan_thread = None

        # Close reader SPI connection
        if self._reader and hasattr(self._reader, 'READER'):
            try:
                if hasattr(self._reader.READER, 'Close_MFRC522'):
                    self._reader.READER.Close_MFRC522()
            except Exception as e:
                self.logger.warning(f"Reader cleanup warning: {e}")

        self._reader = None
        self._initialized = False
        self._last_uid = 0
        self._last_uid_time = 0.0

        self.logger.info(f"RFID reader {self.component_id} cleaned up")
