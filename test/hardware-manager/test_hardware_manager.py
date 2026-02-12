#!/usr/bin/env python3
"""
Unit Tests for HardwareManager

Tests the HardwareManager class WITHOUT requiring actual hardware.
Uses mocking to simulate drivers, signal handlers, and filesystem.

Run:
    pytest test/hardware-manager/test_hardware_manager.py -v
"""

import pytest
import sys
import importlib
import importlib.util
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path so drivers package resolves
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.base_driver import BaseDriver

# ---------------------------------------------------------------------------
# Load hardware-manager module (filename has a hyphen, so use spec_from_file)
# ---------------------------------------------------------------------------
_HM_FILE = src_path / 'hardware-manager.py'
_MODULE_NAME = 'hardware_manager'  # importable alias (no hyphen)


def _load_hm_module():
    """Load hardware-manager.py as 'hardware_manager' in sys.modules."""
    spec = importlib.util.spec_from_file_location(_MODULE_NAME, _HM_FILE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_MODULE_NAME] = mod
    spec.loader.exec_module(mod)
    return mod


# Pre-load the module once (with side effects patched) so we can reference
# its HardwareManager class and module-level DRIVERS_DIR in patches.
with patch('signal.signal'), patch('atexit.register'), patch('logging.basicConfig'):
    hm = _load_hm_module()

HardwareManager = hm.HardwareManager


# ---------------------------------------------------------------------------
# Mock driver classes
# ---------------------------------------------------------------------------

class MockDriver(BaseDriver):
    """Concrete mock driver for testing (read-only sensor)."""

    def __init__(self, component_id, config):
        super().__init__(component_id, config)

    def initialize(self):
        self._initialized = True

    def read(self):
        return {'value': 42, 'timestamp': 100.0}

    def cleanup(self):
        self._initialized = False


class MockWritableDriver(BaseDriver):
    """Concrete mock driver that supports write."""

    def __init__(self, component_id, config):
        super().__init__(component_id, config)
        self.last_written = None

    def initialize(self):
        self._initialized = True

    def read(self):
        return {'state': 'on', 'timestamp': 100.0}

    def write(self, data):
        self.last_written = data

    def cleanup(self):
        self._initialized = False


# ---------------------------------------------------------------------------
# Fixture to create HardwareManager with side-effect-free init
# ---------------------------------------------------------------------------

@pytest.fixture
def manager():
    """Create a HardwareManager with patched side effects."""
    with patch('signal.signal'), \
         patch('atexit.register'), \
         patch('logging.basicConfig'):
        mgr = HardwareManager()
        yield mgr
        # Prevent cleanup_all from running atexit during test teardown
        mgr.components.clear()
        mgr._component_locks.clear()


# ===========================================================================
# Constructor tests
# ===========================================================================

class TestConstructor:
    """Test HardwareManager.__init__ sets up all fields correctly."""

    def test_initializes_empty_driver_cache(self, manager):
        """Constructor initializes an empty driver cache."""
        # Assert
        assert manager._driver_cache == {}

    def test_initializes_empty_components(self, manager):
        """Constructor initializes an empty components registry."""
        # Assert
        assert manager.components == {}

    def test_initializes_empty_component_locks(self, manager):
        """Constructor initializes an empty component locks dict."""
        # Assert
        assert manager._component_locks == {}

    def test_initializes_locks(self, manager):
        """Constructor creates stdout, registry, and i2c bus locks."""
        # Assert
        assert isinstance(manager._stdout_lock, type(threading.Lock()))
        assert isinstance(manager._registry_lock, type(threading.Lock()))
        assert isinstance(manager._i2c_bus_lock, type(threading.Lock()))

    def test_initializes_executor(self, manager):
        """Constructor creates a ThreadPoolExecutor."""
        # Assert
        assert manager._executor is not None


# ===========================================================================
# _discover_drivers tests
# ===========================================================================

class TestDiscoverDrivers:
    """Test _discover_drivers scans the drivers directory."""

    def test_discovers_driver_files(self, manager):
        """_discover_drivers finds *_driver.py files and derives type names."""
        # Arrange — use real Path objects so sorted() comparison works
        mock_paths = [
            Path('aht10_driver.py'),
            Path('base_driver.py'),
            Path('bh1750_driver.py'),
            Path('dht11_driver.py'),
        ]

        with patch.object(hm, 'DRIVERS_DIR') as mock_dir:
            mock_dir.glob.return_value = mock_paths

            # Act
            result = manager._discover_drivers()

        # Assert -- base_driver should be excluded
        assert result == ['AHT10', 'BH1750', 'DHT11']

    def test_returns_empty_when_no_drivers(self, manager):
        """_discover_drivers returns empty list when no driver files exist."""
        # Arrange
        with patch.object(hm, 'DRIVERS_DIR') as mock_dir:
            mock_dir.glob.return_value = []

            # Act
            result = manager._discover_drivers()

        # Assert
        assert result == []


# ===========================================================================
# _load_driver tests
# ===========================================================================

class TestLoadDriver:
    """Test _load_driver loads and caches driver classes."""

    def test_loads_driver_class(self, manager):
        """_load_driver imports module and returns driver class."""
        # Arrange
        mock_module = MagicMock()
        mock_module.BH1750Driver = MockDriver

        with patch('importlib.import_module', return_value=mock_module) as mock_import:
            # Act
            result = manager._load_driver('BH1750')

        # Assert
        mock_import.assert_called_once_with('drivers.bh1750_driver')
        assert result is MockDriver

    def test_caches_loaded_driver(self, manager):
        """_load_driver caches the class and returns it on subsequent calls."""
        # Arrange
        mock_module = MagicMock()
        mock_module.AHT10Driver = MockDriver

        with patch('importlib.import_module', return_value=mock_module) as mock_import:
            # Act
            first = manager._load_driver('AHT10')
            second = manager._load_driver('AHT10')

        # Assert -- import should only happen once
        mock_import.assert_called_once()
        assert first is second

    def test_raises_for_unknown_type(self, manager):
        """_load_driver raises ValueError when module is not found."""
        # Arrange
        with patch('importlib.import_module', side_effect=ModuleNotFoundError()), \
             patch.object(manager, '_discover_drivers', return_value=['AHT10', 'BH1750']):
            # Act & Assert
            with pytest.raises(ValueError, match="No driver module found"):
                manager._load_driver('NONEXISTENT')

    def test_raises_for_missing_class(self, manager):
        """_load_driver raises ValueError when class is not in the module."""
        # Arrange
        mock_module = MagicMock(spec=[])  # Empty module -- no attributes

        with patch('importlib.import_module', return_value=mock_module):
            # Act & Assert
            with pytest.raises(ValueError, match="does not contain class"):
                manager._load_driver('BH1750')

    def test_raises_for_non_basedriver_subclass(self, manager):
        """_load_driver raises ValueError when class does not inherit from BaseDriver."""
        # Arrange
        class NotADriver:
            pass

        mock_module = MagicMock()
        mock_module.FakeDriver = NotADriver

        with patch('importlib.import_module', return_value=mock_module):
            # Act & Assert
            with pytest.raises(ValueError, match="does not inherit from BaseDriver"):
                manager._load_driver('Fake')


# ===========================================================================
# register_component tests
# ===========================================================================

class TestRegisterComponent:
    """Test register_component adds drivers to the registry."""

    def test_register_success(self, manager):
        """register_component stores driver in components dict."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            # Act
            result = manager.register_component(
                'temp_sensor', 'AHT10', {'i2c': {'address': '0x38'}}
            )

        # Assert
        assert result['success'] is True
        assert 'temp_sensor' in manager.components
        assert isinstance(manager.components['temp_sensor'], MockDriver)

    def test_raises_for_duplicate_id(self, manager):
        """register_component raises ValueError for an already-registered ID."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

            # Act & Assert
            with pytest.raises(ValueError, match="already registered"):
                manager.register_component('temp_sensor', 'AHT10', {})

    def test_sets_bus_lock_on_driver(self, manager):
        """register_component calls set_bus_lock on the driver instance."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            # Act
            manager.register_component('temp_sensor', 'AHT10', {})

        # Assert -- driver should have the shared I2C bus lock
        driver = manager.components['temp_sensor']
        assert driver._i2c_bus_lock is manager._i2c_bus_lock

    def test_creates_component_lock(self, manager):
        """register_component creates a per-component lock."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            # Act
            manager.register_component('temp_sensor', 'AHT10', {})

        # Assert
        assert 'temp_sensor' in manager._component_locks
        assert isinstance(
            manager._component_locks['temp_sensor'], type(threading.Lock())
        )


# ===========================================================================
# initialize_component tests
# ===========================================================================

class TestInitializeComponent:
    """Test initialize_component calls driver.initialize()."""

    def test_initialize_success(self, manager):
        """initialize_component calls driver.initialize and returns success."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

        # Act
        result = manager.initialize_component('temp_sensor')

        # Assert
        assert result['success'] is True
        assert manager.components['temp_sensor']._initialized is True

    def test_raises_for_unknown_component(self, manager):
        """initialize_component raises ValueError for unregistered component."""
        # Act & Assert
        with pytest.raises(ValueError, match="not registered"):
            manager.initialize_component('nonexistent')


# ===========================================================================
# read_component tests
# ===========================================================================

class TestReadComponent:
    """Test read_component returns driver data."""

    def test_read_returns_driver_data(self, manager):
        """read_component returns the dict from driver.read()."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})
            manager.initialize_component('temp_sensor')

        # Act
        result = manager.read_component('temp_sensor')

        # Assert
        assert result == {'value': 42, 'timestamp': 100.0}

    def test_raises_for_unknown_component(self, manager):
        """read_component raises ValueError for unregistered component."""
        # Act & Assert
        with pytest.raises(ValueError, match="not registered"):
            manager.read_component('nonexistent')


# ===========================================================================
# write_component tests
# ===========================================================================

class TestWriteComponent:
    """Test write_component calls driver.write()."""

    def test_write_calls_driver(self, manager):
        """write_component passes data to driver.write() and returns success."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockWritableDriver):
            manager.register_component('motor', 'Vibration', {})
            manager.initialize_component('motor')

        # Act
        result = manager.write_component('motor', {'vibrating': True})

        # Assert
        assert result['success'] is True
        assert manager.components['motor'].last_written == {'vibrating': True}

    def test_raises_not_implemented_for_read_only(self, manager):
        """write_component raises NotImplementedError for read-only drivers."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})
            manager.initialize_component('temp_sensor')

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            manager.write_component('temp_sensor', {'value': 99})


# ===========================================================================
# cleanup_component tests
# ===========================================================================

class TestCleanupComponent:
    """Test cleanup_component removes driver from registry."""

    def test_cleanup_removes_from_registry(self, manager):
        """cleanup_component calls cleanup and removes from registry."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})
            manager.initialize_component('temp_sensor')

        # Act
        result = manager.cleanup_component('temp_sensor')

        # Assert
        assert result['success'] is True
        assert 'temp_sensor' not in manager.components
        assert 'temp_sensor' not in manager._component_locks

    def test_raises_for_unknown_component(self, manager):
        """cleanup_component raises ValueError for unregistered component."""
        # Act & Assert
        with pytest.raises(ValueError, match="not registered"):
            manager.cleanup_component('nonexistent')


# ===========================================================================
# cleanup_all tests
# ===========================================================================

class TestCleanupAll:
    """Test cleanup_all cleans up all components."""

    def test_cleanup_all_in_reverse_order(self, manager):
        """cleanup_all cleans up components in reverse registration order."""
        # Arrange
        cleanup_order = []

        class TrackingDriver(BaseDriver):
            def __init__(self, component_id, config):
                super().__init__(component_id, config)

            def initialize(self):
                self._initialized = True

            def read(self):
                return {}

            def cleanup(self):
                cleanup_order.append(self.component_id)
                self._initialized = False

        with patch.object(manager, '_load_driver', return_value=TrackingDriver):
            manager.register_component('first', 'T', {})
            manager.register_component('second', 'T', {})
            manager.register_component('third', 'T', {})

        # Act
        manager.cleanup_all()

        # Assert -- reverse order of registration
        assert cleanup_order == ['third', 'second', 'first']
        assert manager.components == {}
        assert manager._component_locks == {}

    def test_cleanup_all_handles_errors_gracefully(self, manager):
        """cleanup_all continues even if a driver's cleanup raises."""
        # Arrange
        class FailingDriver(BaseDriver):
            def __init__(self, component_id, config):
                super().__init__(component_id, config)

            def initialize(self):
                self._initialized = True

            def read(self):
                return {}

            def cleanup(self):
                raise RuntimeError("Hardware error during cleanup")

        with patch.object(manager, '_load_driver', return_value=FailingDriver):
            manager.register_component('failing1', 'T', {})
            manager.register_component('failing2', 'T', {})

        # Act -- should not raise despite cleanup errors
        manager.cleanup_all()

        # Assert -- registry should still be cleared
        assert manager.components == {}
        assert manager._component_locks == {}

    def test_cleanup_all_noop_when_empty(self, manager):
        """cleanup_all does nothing when no components are registered."""
        # Act -- should not raise
        manager.cleanup_all()

        # Assert
        assert manager.components == {}


# ===========================================================================
# list_components tests
# ===========================================================================

class TestListComponents:
    """Test list_components returns correct format."""

    def test_list_components_returns_correct_format(self, manager):
        """list_components returns count and component details."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})
            manager.initialize_component('temp_sensor')
            manager.register_component('light_sensor', 'BH1750', {})

        # Act
        result = manager.list_components()

        # Assert
        assert result['count'] == 2
        assert 'temp_sensor' in result['components']
        assert result['components']['temp_sensor']['type'] == 'MockDriver'
        assert result['components']['temp_sensor']['initialized'] is True
        assert 'light_sensor' in result['components']
        assert result['components']['light_sensor']['initialized'] is False

    def test_list_components_empty(self, manager):
        """list_components returns zero count when no components registered."""
        # Act
        result = manager.list_components()

        # Assert
        assert result == {'count': 0, 'components': {}}


# ===========================================================================
# get_component_info tests
# ===========================================================================

class TestGetComponentInfo:
    """Test get_component_info returns driver info."""

    def test_returns_driver_info(self, manager):
        """get_component_info returns the dict from driver.get_info()."""
        # Arrange
        config = {'i2c': {'address': '0x38'}}
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', config)

        # Act
        result = manager.get_component_info('temp_sensor')

        # Assert
        assert result['component_id'] == 'temp_sensor'
        assert result['driver_type'] == 'MockDriver'
        assert result['initialized'] is False
        assert result['config'] == config

    def test_raises_for_unknown_component(self, manager):
        """get_component_info raises ValueError for unregistered component."""
        # Act & Assert
        with pytest.raises(ValueError, match="not registered"):
            manager.get_component_info('nonexistent')


# ===========================================================================
# handle_request tests
# ===========================================================================

class TestHandleRequest:
    """Test handle_request routes JSON-RPC methods correctly."""

    def test_routes_register(self, manager):
        """handle_request routes 'register' to register_component."""
        # Arrange
        request = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'register',
            'params': {
                'component_id': 'temp_sensor',
                'component_type': 'AHT10',
                'config': {'i2c': {'address': '0x38'}}
            }
        }

        with patch.object(manager, '_load_driver', return_value=MockDriver):
            # Act
            response = manager.handle_request(request)

        # Assert
        assert response['jsonrpc'] == '2.0'
        assert response['id'] == 1
        assert response['result']['success'] is True
        assert 'temp_sensor' in manager.components

    def test_routes_read(self, manager):
        """handle_request routes 'read' to read_component."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})
            manager.initialize_component('temp_sensor')

        request = {
            'jsonrpc': '2.0',
            'id': 2,
            'method': 'read',
            'params': {'component_id': 'temp_sensor'}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['jsonrpc'] == '2.0'
        assert response['id'] == 2
        assert response['result'] == {'value': 42, 'timestamp': 100.0}

    def test_routes_ping(self, manager):
        """handle_request routes 'ping' and returns ok status."""
        # Arrange
        request = {
            'jsonrpc': '2.0',
            'id': 3,
            'method': 'ping',
            'params': {}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['jsonrpc'] == '2.0'
        assert response['id'] == 3
        assert response['result'] == {'status': 'ok'}

    def test_routes_initialize(self, manager):
        """handle_request routes 'initialize' to initialize_component."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

        request = {
            'jsonrpc': '2.0',
            'id': 4,
            'method': 'initialize',
            'params': {'component_id': 'temp_sensor'}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['result']['success'] is True
        assert manager.components['temp_sensor']._initialized is True

    def test_routes_write(self, manager):
        """handle_request routes 'write' to write_component."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockWritableDriver):
            manager.register_component('motor', 'Vibration', {})
            manager.initialize_component('motor')

        request = {
            'jsonrpc': '2.0',
            'id': 5,
            'method': 'write',
            'params': {
                'component_id': 'motor',
                'data': {'vibrating': True}
            }
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['result']['success'] is True

    def test_routes_cleanup(self, manager):
        """handle_request routes 'cleanup' to cleanup_component."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

        request = {
            'jsonrpc': '2.0',
            'id': 6,
            'method': 'cleanup',
            'params': {'component_id': 'temp_sensor'}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['result']['success'] is True
        assert 'temp_sensor' not in manager.components

    def test_routes_list(self, manager):
        """handle_request routes 'list' to list_components."""
        # Arrange
        request = {
            'jsonrpc': '2.0',
            'id': 7,
            'method': 'list',
            'params': {}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['result'] == {'count': 0, 'components': {}}

    def test_routes_get_info(self, manager):
        """handle_request routes 'get_info' to get_component_info."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

        request = {
            'jsonrpc': '2.0',
            'id': 8,
            'method': 'get_info',
            'params': {'component_id': 'temp_sensor'}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['result']['component_id'] == 'temp_sensor'

    def test_returns_error_for_unknown_method(self, manager):
        """handle_request returns JSON-RPC error for unknown method."""
        # Arrange
        request = {
            'jsonrpc': '2.0',
            'id': 9,
            'method': 'nonexistent_method',
            'params': {}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['jsonrpc'] == '2.0'
        assert response['id'] == 9
        assert 'error' in response
        assert response['error']['code'] == -32603
        assert 'Unknown method' in response['error']['message']

    def test_returns_error_on_exception(self, manager):
        """handle_request returns JSON-RPC error when handler raises."""
        # Arrange
        request = {
            'jsonrpc': '2.0',
            'id': 10,
            'method': 'read',
            'params': {'component_id': 'nonexistent'}
        }

        # Act
        response = manager.handle_request(request)

        # Assert
        assert response['jsonrpc'] == '2.0'
        assert response['id'] == 10
        assert 'error' in response
        assert response['error']['code'] == -32603
        assert 'not registered' in response['error']['message']
        assert response['error']['data']['type'] == 'ValueError'


# ===========================================================================
# _get_driver tests
# ===========================================================================

class TestGetDriver:
    """Test _get_driver retrieves registered drivers."""

    def test_returns_driver_for_registered_component(self, manager):
        """_get_driver returns the driver instance for a registered component."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

        # Act
        driver = manager._get_driver('temp_sensor')

        # Assert
        assert isinstance(driver, MockDriver)
        assert driver.component_id == 'temp_sensor'

    def test_raises_for_unregistered_component(self, manager):
        """_get_driver raises ValueError for an unregistered component ID."""
        # Act & Assert
        with pytest.raises(ValueError, match="not registered"):
            manager._get_driver('nonexistent')

    def test_error_message_lists_registered_components(self, manager):
        """_get_driver error message includes list of registered components."""
        # Arrange
        with patch.object(manager, '_load_driver', return_value=MockDriver):
            manager.register_component('temp_sensor', 'AHT10', {})

        # Act & Assert
        with pytest.raises(ValueError, match="temp_sensor"):
            manager._get_driver('nonexistent')
