#!/usr/bin/env python3
"""
Unit Tests for BaseDriver

Tests the BaseDriver abstract class WITHOUT requiring actual hardware.
Uses a ConcreteDriver subclass to test non-abstract methods.

Run:
    pytest test/hardware-manager/test_base_driver.py -v
"""

import pytest
import sys
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.base_driver import BaseDriver


class ConcreteDriver(BaseDriver):
    """Concrete subclass for testing the abstract BaseDriver."""

    def initialize(self):
        self._initialized = True

    def read(self):
        self._assert_initialized()
        return {'value': 42}

    def cleanup(self):
        self._initialized = False


class TestBaseDriverConstructor:
    """Test driver constructor and field initialization."""

    def test_constructor_sets_fields(self):
        """Test that constructor sets all fields correctly."""
        # Arrange
        config = {'i2c': {'address': '0x38'}, 'retries': 3}

        # Act
        driver = ConcreteDriver('test_component', config)

        # Assert
        assert driver.component_id == 'test_component'
        assert driver.config == config
        assert driver._initialized is False
        assert driver._last_read_time == 0.0
        assert driver._i2c_bus_lock is None

    def test_min_read_interval_default(self):
        """Test that MIN_READ_INTERVAL has default value."""
        # Arrange & Act
        driver = ConcreteDriver('test_component', {})

        # Assert
        assert driver.MIN_READ_INTERVAL == 0.05

    def test_logger_is_configured(self):
        """Test that logger is created with correct name."""
        # Arrange & Act
        driver = ConcreteDriver('test_component', {})

        # Assert
        assert driver.logger.name == 'hardware-manager.driver.ConcreteDriver'


class TestBaseDriverValidateConfig:
    """Test config validation."""

    def test_validate_config_succeeds_with_valid_keys(self):
        """Test validate_config passes when all required keys exist."""
        # Arrange
        config = {'pins': {'signal': 12}, 'retries': 3}
        driver = ConcreteDriver('test_component', config)

        # Act & Assert - should not raise
        driver.validate_config(['pins', 'retries'])

    def test_validate_config_raises_for_missing_key(self):
        """Test validate_config raises ValueError for missing key."""
        # Arrange
        config = {'retries': 3}
        driver = ConcreteDriver('test_component', config)

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config key: pins"):
            driver.validate_config(['pins'])

    def test_validate_config_includes_component_id_in_error(self):
        """Test that ValueError message includes component_id."""
        # Arrange
        config = {}
        driver = ConcreteDriver('my_sensor', config)

        # Act & Assert
        with pytest.raises(ValueError, match="my_sensor"):
            driver.validate_config(['i2c'])


class TestBaseDriverAssertInitialized:
    """Test initialization assertion."""

    def test_assert_initialized_raises_when_not_initialized(self):
        """Test _assert_initialized raises RuntimeError when not initialized."""
        # Arrange
        driver = ConcreteDriver('test_component', {})

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver._assert_initialized()

    def test_assert_initialized_succeeds_when_initialized(self):
        """Test _assert_initialized passes after initialize()."""
        # Arrange
        driver = ConcreteDriver('test_component', {})
        driver.initialize()

        # Act & Assert - should not raise
        driver._assert_initialized()


class TestBaseDriverGetInfo:
    """Test get_info method."""

    def test_get_info_returns_correct_dict(self):
        """Test get_info returns expected metadata."""
        # Arrange
        config = {'type': 'AHT10', 'i2c': {'address': '0x38'}}
        driver = ConcreteDriver('temp_sensor', config)

        # Act
        info = driver.get_info()

        # Assert
        assert info['component_id'] == 'temp_sensor'
        assert info['driver_type'] == 'ConcreteDriver'
        assert info['initialized'] is False
        assert info['config'] == config

    def test_get_info_reflects_initialized_state(self):
        """Test get_info shows initialized=True after initialize()."""
        # Arrange
        driver = ConcreteDriver('temp_sensor', {})
        driver.initialize()

        # Act
        info = driver.get_info()

        # Assert
        assert info['initialized'] is True


class TestBaseDriverParseI2CAddress:
    """Test I2C address parsing."""

    def test_parse_hex_string(self):
        """Test parsing hex string like '0x38'."""
        # Act & Assert
        assert BaseDriver.parse_i2c_address('0x38') == 0x38
        assert BaseDriver.parse_i2c_address('0x5c') == 0x5c

    def test_parse_decimal_string(self):
        """Test parsing decimal string like '56'."""
        # Act & Assert
        assert BaseDriver.parse_i2c_address('56') == 56

    def test_parse_integer(self):
        """Test parsing integer value."""
        # Act & Assert
        assert BaseDriver.parse_i2c_address(56) == 56
        assert BaseDriver.parse_i2c_address(0x38) == 0x38


class TestBaseDriverThrottleRead:
    """Test read throttling."""

    @patch('drivers.base_driver.time')
    def test_throttle_read_returns_timestamp(self, mock_time):
        """Test _throttle_read returns the current timestamp."""
        # Arrange
        mock_time.time.return_value = 1000.0
        mock_time.sleep = MagicMock()
        driver = ConcreteDriver('test_component', {})

        # Act
        result = driver._throttle_read()

        # Assert
        assert result == 1000.0

    @patch('drivers.base_driver.time')
    def test_throttle_read_sleeps_when_called_too_quickly(self, mock_time):
        """Test _throttle_read sleeps when called within MIN_READ_INTERVAL."""
        # Arrange
        # First call: time=100.0, second call: time=100.02 (only 0.02s elapsed, < 0.05s)
        # After sleep: time=100.05
        mock_time.time.side_effect = [100.0, 100.02, 100.05]
        mock_time.sleep = MagicMock()
        driver = ConcreteDriver('test_component', {})

        # Act
        driver._throttle_read()  # First read at 100.0
        driver._throttle_read()  # Second read at 100.02 - should sleep

        # Assert
        mock_time.sleep.assert_called_once()
        sleep_duration = mock_time.sleep.call_args[0][0]
        assert abs(sleep_duration - 0.03) < 0.001  # Should sleep ~0.03s

    @patch('drivers.base_driver.time')
    def test_throttle_read_no_sleep_when_enough_time_elapsed(self, mock_time):
        """Test _throttle_read does not sleep when enough time has passed."""
        # Arrange
        mock_time.time.side_effect = [100.0, 100.1]
        mock_time.sleep = MagicMock()
        driver = ConcreteDriver('test_component', {})

        # Act
        driver._throttle_read()  # First read at 100.0
        driver._throttle_read()  # Second read at 100.1 (0.1s > 0.05s)

        # Assert
        mock_time.sleep.assert_not_called()


class TestBaseDriverWrite:
    """Test default write behavior."""

    def test_write_raises_not_implemented(self):
        """Test that default write() raises NotImplementedError."""
        # Arrange
        driver = ConcreteDriver('test_component', {})
        driver.initialize()

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            driver.write({'value': 42})


class TestBaseDriverBusLock:
    """Test I2C bus lock functionality."""

    def test_set_bus_lock(self):
        """Test set_bus_lock stores the lock."""
        # Arrange
        driver = ConcreteDriver('test_component', {})
        lock = threading.Lock()

        # Act
        driver.set_bus_lock(lock)

        # Assert
        assert driver._i2c_bus_lock is lock

    def test_with_i2c_lock_acquires_lock(self):
        """Test _with_i2c_lock acquires and releases the lock."""
        # Arrange
        driver = ConcreteDriver('test_component', {})
        lock = threading.Lock()
        driver.set_bus_lock(lock)

        # Act & Assert
        with driver._with_i2c_lock():
            # Lock should be acquired inside the context
            assert lock.locked()
        # Lock should be released after the context
        assert not lock.locked()

    def test_with_i2c_lock_yields_without_lock(self):
        """Test _with_i2c_lock yields normally when no lock is set."""
        # Arrange
        driver = ConcreteDriver('test_component', {})
        # No lock set (default None)

        # Act & Assert - should not raise
        with driver._with_i2c_lock():
            pass  # Should execute without error
