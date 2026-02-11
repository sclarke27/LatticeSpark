#!/usr/bin/env python3
from __future__ import annotations
"""
Hardware Manager - Central hardware interface

Single Python process managing all LatticeSpark hardware components.
Communicates via JSON-RPC protocol over stdin/stdout (local) or TCP (remote).

Architecture:
- Component registry for tracking registered components
- Driver loading and lifecycle management
- Thread pool for concurrent sensor reads
- JSON-RPC server for command routing
- Resource management and cleanup

Design principles:
- Concurrent I/O via ThreadPoolExecutor
- Per-component locks prevent conflicting access
- Thread-safe stdout writes via lock
- Type-safe with 100% type hints
- Clean separation of concerns
"""

import sys
import json
import logging
import select
import signal
import atexit
import importlib
import threading
import concurrent.futures
from typing import Dict, Any, Optional, Type
from pathlib import Path

# Add drivers directory to path
sys.path.insert(0, str(Path(__file__).parent))

from drivers.base_driver import BaseDriver

# Set a single shared gpiozero pin factory for all GPIO drivers.
# Multiple LGPIOFactory instances opening gpiochip4 causes conflicts
# where output pins can't be driven (character device overrides pinctrl).
try:
    from gpiozero import Device
    from gpiozero.pins.lgpio import LGPIOFactory
    Device.pin_factory = LGPIOFactory()
except Exception:
    pass  # Not on Pi or gpiozero not installed

# Directory containing driver modules
DRIVERS_DIR = Path(__file__).parent / 'drivers'


class HardwareManager:
    """
    Central hardware management system.

    Manages component lifecycle and routes JSON-RPC commands to drivers.
    Uses a thread pool for concurrent sensor reads.

    Drivers are auto-discovered from the drivers/ directory using naming convention:
    - Type 'BH1750' -> module 'bh1750_driver' -> class 'BH1750Driver'
    - Type 'AHT10' -> module 'aht10_driver' -> class 'AHT10Driver'
    """

    def __init__(self) -> None:
        """Initialize hardware manager."""
        # Setup logging to stderr (stdout reserved for JSON-RPC)
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            stream=sys.stderr
        )
        self.logger = logging.getLogger('hardware-manager')

        # Cache for loaded driver classes: type_name -> driver_class
        self._driver_cache: Dict[str, Type[BaseDriver]] = {}

        # Component registry: component_id -> driver instance
        self.components: Dict[str, BaseDriver] = {}

        # Thread pool for concurrent driver operations
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)

        # Thread-safe stdout lock (prevents interleaved JSON messages)
        self._stdout_lock = threading.Lock()

        # Per-component locks (prevents concurrent reads to same sensor)
        self._component_locks: Dict[str, threading.Lock] = {}

        # Registry lock (protects components dict during register/cleanup)
        self._registry_lock = threading.Lock()

        # Global I2C bus lock (prevents concurrent I2C ops from colliding)
        self._i2c_bus_lock = threading.Lock()

        # Setup cleanup handlers
        atexit.register(self.cleanup_all)
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        self.logger.info("Hardware Manager initialized (threaded)")

    def _send_response(self, response: Dict[str, Any]) -> None:
        """
        Send JSON-RPC response to stdout (thread-safe).

        Args:
            response: JSON-RPC response object
        """
        with self._stdout_lock:
            print(json.dumps(response), flush=True)

    def _load_driver(self, component_type: str) -> Type[BaseDriver]:
        """
        Load a driver class by component type name.

        Uses naming convention: type 'BH1750' -> module 'bh1750_driver' -> class 'BH1750Driver'.

        Args:
            component_type: Component type name (e.g. 'BH1750', 'AHT10')

        Returns:
            Driver class

        Raises:
            ValueError: If driver module or class not found
        """
        # Return cached driver if already loaded
        if component_type in self._driver_cache:
            return self._driver_cache[component_type]

        # Derive module and class names from type
        module_name = f"drivers.{component_type.lower()}_driver"
        class_name = f"{component_type}Driver"

        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError:
            available = ', '.join(self._discover_drivers())
            raise ValueError(
                f"No driver module found for type '{component_type}' "
                f"(expected module: {module_name}.py). "
                f"Available types: {available}"
            )

        driver_class = getattr(module, class_name, None)
        if driver_class is None:
            raise ValueError(
                f"Driver module '{module_name}' does not contain class '{class_name}'"
            )

        if not issubclass(driver_class, BaseDriver):
            raise ValueError(
                f"Class '{class_name}' in '{module_name}' does not inherit from BaseDriver"
            )

        # Cache for future use
        self._driver_cache[component_type] = driver_class
        self.logger.info(f"Loaded driver: {class_name} for type '{component_type}'")

        return driver_class

    def _discover_drivers(self) -> list[str]:
        """
        Discover available driver types by scanning the drivers directory.

        Returns:
            List of available type names (e.g. ['AHT10', 'BH1750', 'DHT11'])
        """
        types: list[str] = []
        for path in sorted(DRIVERS_DIR.glob('*_driver.py')):
            name = path.stem  # e.g. 'bh1750_driver'
            if name == 'base_driver':
                continue
            # Derive type name: 'bh1750_driver' -> 'BH1750'
            type_name = name.replace('_driver', '').upper()
            types.append(type_name)
        return types

    def _signal_handler(self, signum: int, frame: Any) -> None:
        """
        Handle termination signals gracefully.

        Args:
            signum: Signal number
            frame: Current stack frame
        """
        self.logger.info(f"Received signal {signum}, shutting down...")
        self.cleanup_all()
        sys.exit(0)

    def register_component(
        self,
        component_id: str,
        component_type: str,
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Register a new hardware component.

        Args:
            component_id: Unique identifier for component
            component_type: Type of component
            config: Component configuration

        Returns:
            Dict with success status and message

        Raises:
            ValueError: If component type unknown or ID already registered
        """
        with self._registry_lock:
            # Check if component already registered
            if component_id in self.components:
                raise ValueError(
                    f"Component ID already registered: {component_id}"
                )

            # Load driver class (validates type exists)
            driver_class = self._load_driver(component_type)

            # Create driver instance
            driver = driver_class(component_id, config)

            # Pass shared I2C bus lock to driver
            driver.set_bus_lock(self._i2c_bus_lock)

            # Store in registry with per-component lock
            self.components[component_id] = driver
            self._component_locks[component_id] = threading.Lock()

        self.logger.info(
            f"Registered component: {component_id} (type: {component_type})"
        )

        return {
            'success': True,
            'message': f"Component {component_id} registered successfully"
        }

    def initialize_component(self, component_id: str) -> Dict[str, Any]:
        """
        Initialize a registered component.

        Args:
            component_id: Component to initialize

        Returns:
            Dict with success status and message

        Raises:
            ValueError: If component not registered
            RuntimeError: If initialization fails
        """
        driver = self._get_driver(component_id)

        self.logger.info(f"Initializing component: {component_id}")
        with self._component_locks[component_id]:
            driver.initialize()

        return {
            'success': True,
            'message': f"Component {component_id} initialized successfully"
        }

    def read_component(self, component_id: str) -> Dict[str, Any]:
        """
        Read data from a component.

        Args:
            component_id: Component to read from

        Returns:
            Component data (driver-specific format)

        Raises:
            ValueError: If component not registered
            RuntimeError: If read fails
        """
        driver = self._get_driver(component_id)

        self.logger.debug(f"Reading component: {component_id}")
        with self._component_locks[component_id]:
            data = driver.read()

        return data

    def write_component(
        self,
        component_id: str,
        data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Write data to a component.

        Args:
            component_id: Component to write to
            data: Data to write (driver-specific format)

        Returns:
            Dict with success status and message

        Raises:
            ValueError: If component not registered or data invalid
            RuntimeError: If write fails
            NotImplementedError: If component doesn't support write
        """
        driver = self._get_driver(component_id)

        self.logger.debug(f"Writing to component: {component_id}")
        with self._component_locks[component_id]:
            driver.write(data)

        return {
            'success': True,
            'message': f"Write to {component_id} successful"
        }

    def cleanup_component(self, component_id: str) -> Dict[str, Any]:
        """
        Clean up a specific component.

        Args:
            component_id: Component to clean up

        Returns:
            Dict with success status and message

        Raises:
            ValueError: If component not registered
        """
        with self._registry_lock:
            driver = self._get_driver(component_id)

            self.logger.info(f"Cleaning up component: {component_id}")
            with self._component_locks[component_id]:
                driver.cleanup()

            # Remove from registry
            del self.components[component_id]
            del self._component_locks[component_id]

        return {
            'success': True,
            'message': f"Component {component_id} cleaned up successfully"
        }

    def cleanup_all(self) -> None:
        """Clean up all registered components and shut down thread pool."""
        if not self.components:
            return

        self.logger.info("Cleaning up all components...")

        # Cleanup in reverse order of registration
        for component_id in reversed(list(self.components.keys())):
            try:
                self.components[component_id].cleanup()
                self.logger.info(f"Cleaned up: {component_id}")
            except Exception as e:
                self.logger.error(f"Error cleaning up {component_id}: {e}")

        self.components.clear()
        self._component_locks.clear()

        # Shut down thread pool — wait for in-flight ops to complete safely
        shutdown_thread = threading.Thread(
            target=self._executor.shutdown,
            kwargs={'wait': True, 'cancel_futures': True}
        )
        shutdown_thread.start()
        shutdown_thread.join(timeout=5.0)
        if shutdown_thread.is_alive():
            self.logger.warning("Thread pool shutdown timed out after 5s")

        self.logger.info("All components cleaned up")

    def get_component_info(self, component_id: str) -> Dict[str, Any]:
        """
        Get information about a component.

        Args:
            component_id: Component to get info for

        Returns:
            Dict with component metadata

        Raises:
            ValueError: If component not registered
        """
        driver = self._get_driver(component_id)
        return driver.get_info()

    def list_components(self) -> Dict[str, Any]:
        """
        List all registered components.

        Returns:
            Dict with component IDs and their types
        """
        components = {}
        for component_id, driver in self.components.items():
            components[component_id] = {
                'type': driver.__class__.__name__,
                'initialized': driver._initialized
            }

        return {
            'count': len(components),
            'components': components
        }

    def _get_driver(self, component_id: str) -> BaseDriver:
        """
        Get driver instance for component.

        Args:
            component_id: Component ID

        Returns:
            Driver instance

        Raises:
            ValueError: If component not registered
        """
        if component_id not in self.components:
            raise ValueError(
                f"Component not registered: {component_id}. "
                f"Registered components: {list(self.components.keys())}"
            )

        return self.components[component_id]

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle a JSON-RPC request.

        Args:
            request: JSON-RPC request object

        Returns:
            JSON-RPC response object
        """
        # Extract request fields
        request_id = request.get('id')
        method = request.get('method')
        params = request.get('params', {})

        try:
            # Route to appropriate method
            if method == 'register':
                result = self.register_component(
                    params['component_id'],
                    params['component_type'],
                    params['config']
                )
            elif method == 'initialize':
                result = self.initialize_component(params['component_id'])
            elif method == 'read':
                result = self.read_component(params['component_id'])
            elif method == 'write':
                result = self.write_component(
                    params['component_id'],
                    params['data']
                )
            elif method == 'cleanup':
                result = self.cleanup_component(params['component_id'])
            elif method == 'get_info':
                result = self.get_component_info(params['component_id'])
            elif method == 'list':
                result = self.list_components()
            elif method == 'ping':
                result = {'status': 'ok'}
            else:
                raise ValueError(f"Unknown method: {method}")

            # Build success response
            response = {
                'jsonrpc': '2.0',
                'id': request_id,
                'result': result
            }

        except Exception as e:
            # Build error response
            self.logger.error(f"Error handling request: {e}", exc_info=True)
            response = {
                'jsonrpc': '2.0',
                'id': request_id,
                'error': {
                    'code': -32603,  # Internal error
                    'message': str(e),
                    'data': {
                        'type': type(e).__name__
                    }
                }
            }

        return response

    def _handle_and_respond(self, request: Dict[str, Any]) -> None:
        """
        Handle a request and send response (runs in thread pool).

        Args:
            request: JSON-RPC request object
        """
        response = self.handle_request(request)
        self._send_response(response)

    def run(self) -> None:
        """
        Main event loop.

        Reads JSON-RPC requests from stdin and dispatches them to
        the thread pool for concurrent processing. Responses are
        sent back via thread-safe stdout writes.
        """
        self.logger.info("Hardware Manager ready (8 worker threads)")

        # Send ready notification
        ready_notification = {
            'jsonrpc': '2.0',
            'method': 'ready',
            'params': {
                'available_drivers': self._discover_drivers()
            }
        }
        self._send_response(ready_notification)

        # Main command loop with non-blocking stdin (5s timeout)
        # Allows signal handling and cleanup if parent Node process dies
        try:
            while True:
                ready, _, _ = select.select([sys.stdin], [], [], 5.0)
                if not ready:
                    continue  # timeout — loop, allows signal handling

                line = sys.stdin.readline()
                if not line:
                    break  # EOF — stdin closed (parent died)

                line = line.strip()
                if not line:
                    continue

                try:
                    # Parse JSON-RPC request
                    request = json.loads(line)

                    method = request.get('method')

                    # Register/initialize/cleanup run synchronously
                    # (they modify shared state and happen at startup/shutdown)
                    if method in ('register', 'initialize', 'cleanup', 'list',
                                  'get_info', 'ping'):
                        response = self.handle_request(request)
                        self._send_response(response)
                    else:
                        # Read/write dispatched to thread pool for concurrency
                        self._executor.submit(self._handle_and_respond, request)

                except json.JSONDecodeError as e:
                    self.logger.error(f"Invalid JSON: {e}")
                    error_response = {
                        'jsonrpc': '2.0',
                        'id': None,
                        'error': {
                            'code': -32700,  # Parse error
                            'message': f"Invalid JSON: {e}"
                        }
                    }
                    self._send_response(error_response)

        except KeyboardInterrupt:
            self.logger.info("Interrupted by user")
        except Exception as e:
            self.logger.error(f"Unexpected error in main loop: {e}", exc_info=True)
        finally:
            self.cleanup_all()


def main() -> None:
    """Entry point for hardware manager."""
    manager = HardwareManager()
    manager.run()


if __name__ == '__main__':
    main()
