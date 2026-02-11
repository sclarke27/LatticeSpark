#!/usr/bin/env python3
"""
Unit Tests for AHT10 Driver

Tests the AHT10 driver WITHOUT requiring actual hardware.
Uses mocking to simulate adafruit_ahtx0 library responses.

Run:
    pytest test/hardware-manager/test_aht10_driver.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.aht10_driver import AHT10Driver


class TestAHT10DriverInitialization:
    """Test driver initialization without hardware."""

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_initialization_success(self, mock_ahtx0, mock_board):
        """Test successful driver initialization."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.relative_humidity = 60.0
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        config = {
            'i2c': {'address': '0x38'},
            'retries': 3,
            'delay': 0.5
        }

        # Act
        driver = AHT10Driver('test_aht10', config)
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_board.I2C.assert_called_once()
        mock_ahtx0.AHTx0.assert_called_once_with(mock_i2c, address=0x38)

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_initialization_sensor_not_responding(self, mock_ahtx0, mock_board):
        """Test initialization fails when sensor doesn't respond."""
        # Arrange
        mock_i2c = MagicMock()
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.side_effect = OSError("I2C device not found")

        config = {'i2c': {'address': '0x38'}}

        # Act & Assert
        driver = AHT10Driver('test_aht10', config)
        with pytest.raises(RuntimeError, match="Failed to initialize AHT10"):
            driver.initialize()

    def test_missing_i2c_configuration(self):
        """Test error when I2C configuration is missing."""
        # Arrange
        config = {'retries': 3}  # Missing 'i2c' key

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config"):
            AHT10Driver('test_aht10', config)

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_idempotent_initialization(self, mock_ahtx0, mock_board):
        """Test that calling initialize twice doesn't create issues."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.relative_humidity = 60.0
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        # Should only call I2C once (idempotent)
        assert mock_board.I2C.call_count == 1


class TestAHT10DriverReading:
    """Test sensor reading functionality."""

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_read_success(self, mock_ahtx0, mock_board):
        """Test successful sensor reading."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.3
        mock_device.relative_humidity = 60.5
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['temperature'] == 25.3
        assert result['humidity'] == 60.5
        assert 'timestamp' in result

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_read_without_initialization(self, mock_ahtx0, mock_board):
        """Test read fails if not initialized."""
        # Arrange
        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    @patch('drivers.base_driver.time')
    def test_read_minimum_interval(self, mock_time, mock_ahtx0, mock_board):
        """Test that reads respect minimum interval."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.relative_humidity = 60.0
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        # Simulate time progression
        # time.time() is called multiple times: first read, check interval, after sleep
        mock_time.time.side_effect = [100.0, 100.2, 100.8]  # 0.2s apart then after sleep
        mock_time.sleep = MagicMock()

        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)
        driver.initialize()

        # Act
        driver.read()  # First read
        driver.read()  # Second read too soon

        # Assert
        mock_time.sleep.assert_called()  # Should sleep to enforce interval


class TestAHT10DriverWrite:
    """Test write operation (should not be supported)."""

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_write_not_supported(self, mock_ahtx0, mock_board):
        """Test that write operation raises NotImplementedError."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.relative_humidity = 60.0
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            driver.write({'temperature': 30})


class TestAHT10DriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_cleanup_success(self, mock_ahtx0, mock_board):
        """Test successful cleanup."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.relative_humidity = 60.0
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)
        driver.initialize()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        mock_i2c.deinit.assert_called_once()

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_cleanup_without_initialization(self, mock_ahtx0, mock_board):
        """Test cleanup works even if never initialized."""
        # Arrange
        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False

    @patch('drivers.aht10_driver.board')
    @patch('drivers.aht10_driver.adafruit_ahtx0')
    def test_cleanup_idempotent(self, mock_ahtx0, mock_board):
        """Test that cleanup can be called multiple times safely."""
        # Arrange
        mock_i2c = MagicMock()
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.relative_humidity = 60.0
        mock_board.I2C.return_value = mock_i2c
        mock_ahtx0.AHTx0.return_value = mock_device

        config = {'i2c': {'address': '0x38'}}
        driver = AHT10Driver('test_aht10', config)
        driver.initialize()

        # Act
        driver.cleanup()
        driver.cleanup()  # Second cleanup

        # Assert
        assert driver._initialized is False
        # deinit should only be called once
        assert mock_i2c.deinit.call_count == 1
