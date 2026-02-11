#!/usr/bin/env python3
from __future__ import annotations
"""
Base Driver Class

All hardware drivers inherit from this base class.
Provides common interface and utilities for component drivers.

Design principles:
- Simple, stateless drivers
- Type-safe with 100% type hints
- Clear interface for hardware operations
- No caching or circuit breakers (handled by coordinator)
"""

from abc import ABC, abstractmethod
from contextlib import contextmanager
from typing import Dict, Any, Optional
import logging
import threading
import time


class BaseDriver(ABC):
    """
    Abstract base class for all hardware drivers.

    Subclasses must implement:
    - initialize() - Setup hardware
    - read() - Read from component (sensors)
    - cleanup() - Release resources

    Optionally override:
    - write() - Write to component (actuators, default raises NotImplementedError)
    """

    # Minimum time between reads (seconds). Override in subclass.
    MIN_READ_INTERVAL: float = 0.05

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize base driver.

        Args:
            component_id: Unique identifier for this component
            config: Component configuration dict
        """
        self.component_id: str = component_id
        self.config: Dict[str, Any] = config
        self.logger: logging.Logger = logging.getLogger(
            f"hardware-manager.driver.{self.__class__.__name__}"
        )
        self._initialized: bool = False
        self._last_read_time: float = 0.0
        self._i2c_bus_lock: Optional[threading.Lock] = None

    @abstractmethod
    def initialize(self) -> None:
        """
        Initialize the hardware component.

        Must be idempotent - safe to call multiple times.

        Raises:
            RuntimeError: If hardware initialization fails
        """
        pass

    @abstractmethod
    def read(self) -> Dict[str, Any]:
        """
        Read data from the component.

        For sensors - returns sensor readings.
        For actuators - returns current state.

        Returns:
            Dict with component data

        Raises:
            RuntimeError: If hardware read fails
        """
        pass

    def write(self, data: Dict[str, Any]) -> None:
        """
        Write data to the component.

        Default implementation raises NotImplementedError for read-only sensors.
        Override in actuator drivers.

        Args:
            data: Data to write to component

        Raises:
            NotImplementedError: If component doesn't support write
        """
        raise NotImplementedError(
            f"{self.component_id} ({self.__class__.__name__}) is read-only"
        )

    @abstractmethod
    def cleanup(self) -> None:
        """
        Release hardware resources.

        Must be idempotent - safe to call multiple times.
        Called on shutdown or driver removal.
        """
        pass

    def set_bus_lock(self, lock: threading.Lock) -> None:
        """Set the shared I2C bus lock for bus-level serialization."""
        self._i2c_bus_lock = lock

    @contextmanager
    def _with_i2c_lock(self):
        """Context manager that acquires the I2C bus lock if set."""
        if self._i2c_bus_lock:
            with self._i2c_bus_lock:
                yield
        else:
            yield

    def get_info(self) -> Dict[str, Any]:
        """
        Get driver information.

        Returns:
            Dict with driver metadata
        """
        return {
            "component_id": self.component_id,
            "driver_type": self.__class__.__name__,
            "initialized": self._initialized,
            "config": self.config
        }

    def validate_config(self, required_keys: list[str]) -> None:
        """
        Validate that required config keys are present.

        Args:
            required_keys: List of required config keys

        Raises:
            ValueError: If required key is missing
        """
        for key in required_keys:
            if key not in self.config:
                raise ValueError(
                    f"Missing required config key: {key} "
                    f"for component {self.component_id}"
                )

    def _assert_initialized(self) -> None:
        """
        Assert that driver is initialized.

        Raises:
            RuntimeError: If driver is not initialized
        """
        if not self._initialized:
            raise RuntimeError(
                f"Driver {self.component_id} not initialized. "
                "Call initialize() first."
            )

    def _throttle_read(self) -> float:
        """
        Apply MIN_READ_INTERVAL throttling.

        Sleeps if called too soon after the previous read,
        then updates _last_read_time.

        Returns:
            Current timestamp (after any throttle sleep)
        """
        current_time = time.time()
        elapsed = current_time - self._last_read_time

        if elapsed < self.MIN_READ_INTERVAL:
            time.sleep(self.MIN_READ_INTERVAL - elapsed)
            current_time = time.time()

        self._last_read_time = current_time
        return current_time

    @staticmethod
    def parse_i2c_address(addr) -> int:
        """
        Parse an I2C address from config (string or int).

        Handles hex strings like '0x5c' and plain integers.

        Args:
            addr: Address value from config (str or int)

        Returns:
            Integer I2C address
        """
        if isinstance(addr, str):
            return int(addr, 16 if addr.startswith('0x') else 10)
        return int(addr)
