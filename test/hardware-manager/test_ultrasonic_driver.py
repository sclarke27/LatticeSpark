#!/usr/bin/env python3
"""
Unit Tests for Ultrasonic Driver

Tests the UltrasonicDriver WITHOUT requiring actual hardware.
Uses mocking to simulate gpiozero DistanceSensor responses.

Run:
    pytest test/hardware-manager/test_ultrasonic_driver.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.ultrasonic_driver import UltrasonicDriver


class TestUltrasonicDriverInitialization:
    """Test driver initialization without hardware."""

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_initialization_success(self, mock_sensor_cls, mock_time):
        """Test successful driver initialization."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.5  # 0.5m = 50cm
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()

        config = {
            'pins': {'trigger': 16, 'echo': 26},
            'retries': 3,
            'max_distance': 4.0
        }

        # Act
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_sensor_cls.assert_called_once_with(
            echo=26, trigger=16, max_distance=4.0
        )

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_initialization_sensor_not_responding(self, mock_sensor_cls, mock_time):
        """Test initialization fails when sensor returns None."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = None  # No response
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()

        config = {'pins': {'trigger': 16, 'echo': 26}}

        # Act & Assert
        driver = UltrasonicDriver('test_ultrasonic', config)
        with pytest.raises(RuntimeError, match="not responding"):
            driver.initialize()

    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_initialization_gpio_failure(self, mock_sensor_cls):
        """Test initialization fails when GPIO setup fails."""
        # Arrange
        mock_sensor_cls.side_effect = Exception("GPIO pin in use")

        config = {'pins': {'trigger': 16, 'echo': 26}}

        # Act & Assert
        driver = UltrasonicDriver('test_ultrasonic', config)
        with pytest.raises(RuntimeError, match="Failed to initialize ultrasonic"):
            driver.initialize()

    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_missing_pins_configuration(self, mock_sensor_cls):
        """Test error when pins configuration is missing."""
        # Arrange
        config = {'retries': 3}  # Missing 'pins' key

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config"):
            UltrasonicDriver('test_ultrasonic', config)

    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_missing_trigger_pin(self, mock_sensor_cls):
        """Test error when trigger pin is missing."""
        # Arrange
        config = {'pins': {'echo': 26}}

        # Act & Assert
        with pytest.raises(ValueError, match="pins.trigger"):
            UltrasonicDriver('test_ultrasonic', config)

    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_missing_echo_pin(self, mock_sensor_cls):
        """Test error when echo pin is missing."""
        # Arrange
        config = {'pins': {'trigger': 16}}

        # Act & Assert
        with pytest.raises(ValueError, match="pins.echo"):
            UltrasonicDriver('test_ultrasonic', config)

    @patch('drivers.ultrasonic_driver.DistanceSensor', None)
    def test_import_error_when_gpiozero_missing(self):
        """Test ImportError raised when gpiozero library is not available."""
        # Arrange
        config = {'pins': {'trigger': 16, 'echo': 26}}

        # Act & Assert
        with pytest.raises(ImportError, match="gpiozero"):
            UltrasonicDriver('test_ultrasonic', config)

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_idempotent_initialization(self, mock_sensor_cls, mock_time):
        """Test that calling initialize twice doesn't create issues."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.5
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()

        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        # Should only create DistanceSensor once (idempotent)
        assert mock_sensor_cls.call_count == 1

    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_default_config_values(self, mock_sensor_cls):
        """Test that default config values are applied."""
        # Arrange
        config = {'pins': {'trigger': 16, 'echo': 26}}

        # Act
        driver = UltrasonicDriver('test_ultrasonic', config)

        # Assert
        assert driver.retries == 3
        assert driver.max_distance == 4.0


class TestUltrasonicDriverReading:
    """Test distance reading functionality."""

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_read_success(self, mock_sensor_cls, mock_time):
        """Test successful distance reading."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.5  # 0.5m = 50cm
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['distance'] == 50.0
        assert 'timestamp' in result

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_read_without_initialization(self, mock_sensor_cls, mock_time):
        """Test read fails if not initialized."""
        # Arrange
        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_read_retries_on_none(self, mock_sensor_cls, mock_time):
        """Test that read retries when measurement returns None."""
        # Arrange
        mock_sensor = MagicMock()
        # First call: None (fail), second call: valid distance
        type(mock_sensor).distance = PropertyMock(side_effect=[
            0.5,   # init test read
            None,  # first retry returns None
            0.3    # second retry succeeds: 30cm
        ])
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'trigger': 16, 'echo': 26}, 'retries': 3}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['distance'] == 30.0

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_read_fails_after_max_retries(self, mock_sensor_cls, mock_time):
        """Test that read raises RuntimeError after all retries fail."""
        # Arrange
        mock_sensor = MagicMock()
        # Init succeeds, then all reads return None
        type(mock_sensor).distance = PropertyMock(side_effect=[
            0.5,   # init test read
            None,  # retry 1
            None,  # retry 2
            None   # retry 3
        ])
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'trigger': 16, 'echo': 26}, 'retries': 3}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(RuntimeError, match="failed after 3 retries"):
            driver.read()

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_read_close_distance(self, mock_sensor_cls, mock_time):
        """Test reading a very close distance."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.03  # 3cm
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['distance'] == 3.0


class TestUltrasonicDriverWrite:
    """Test write operation (should not be supported)."""

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_write_not_supported(self, mock_sensor_cls, mock_time):
        """Test that write operation raises NotImplementedError."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.5
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()

        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            driver.write({'distance': 50})


class TestUltrasonicDriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_cleanup_success(self, mock_sensor_cls, mock_time):
        """Test successful cleanup."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.5
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()

        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        mock_sensor.close.assert_called_once()

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_cleanup_without_initialization(self, mock_sensor_cls, mock_time):
        """Test cleanup works even if never initialized."""
        # Arrange
        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False

    @patch('drivers.ultrasonic_driver.time')
    @patch('drivers.ultrasonic_driver.DistanceSensor')
    def test_cleanup_idempotent(self, mock_sensor_cls, mock_time):
        """Test that cleanup can be called multiple times safely."""
        # Arrange
        mock_sensor = MagicMock()
        mock_sensor.distance = 0.5
        mock_sensor_cls.return_value = mock_sensor
        mock_time.sleep = MagicMock()

        config = {'pins': {'trigger': 16, 'echo': 26}}
        driver = UltrasonicDriver('test_ultrasonic', config)
        driver.initialize()

        # Act
        driver.cleanup()
        driver.cleanup()  # Second cleanup

        # Assert
        assert driver._initialized is False
        # close should only be called once (second cleanup short-circuits)
        assert mock_sensor.close.call_count == 1
