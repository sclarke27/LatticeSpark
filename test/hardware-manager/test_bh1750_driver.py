#!/usr/bin/env python3
"""
Unit Tests for BH1750 Driver

Tests the BH1750 ambient light sensor driver WITHOUT requiring actual hardware.
Uses mocking to simulate smbus2 library responses.

Run:
    pytest test/hardware-manager/test_bh1750_driver.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.bh1750_driver import BH1750Driver


class TestBH1750DriverInitialization:
    """Test driver initialization without hardware."""

    @patch('drivers.bh1750_driver.SMBus')
    def test_initialization_success(self, mock_smbus_cls):
        """Test successful driver initialization."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        # _read_lux reads 2 bytes: lux = (data[1] + 256*data[0]) / 1.2
        # Return [0, 120] -> (120 + 0) / 1.2 = 100.0 lux
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}

        # Act
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_smbus_cls.assert_called_once_with(1)
        mock_bus.write_byte.assert_any_call(0x5c, BH1750Driver.POWER_ON)

    @patch('drivers.bh1750_driver.SMBus')
    def test_initialization_i2c_failure(self, mock_smbus_cls):
        """Test initialization fails when I2C bus cannot be opened."""
        # Arrange
        mock_smbus_cls.side_effect = OSError("I2C bus not available")

        config = {'i2c': {'address': '0x5c'}}

        # Act & Assert
        driver = BH1750Driver('test_bh1750', config)
        with pytest.raises(RuntimeError, match="Failed to initialize BH1750"):
            driver.initialize()

    @patch('drivers.bh1750_driver.SMBus')
    def test_initialization_sensor_not_responding(self, mock_smbus_cls):
        """Test initialization fails when sensor doesn't respond."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.write_byte.side_effect = OSError("I2C device not found")

        config = {'i2c': {'address': '0x5c'}}

        # Act & Assert
        driver = BH1750Driver('test_bh1750', config)
        with pytest.raises(RuntimeError, match="Failed to initialize BH1750"):
            driver.initialize()

    @patch('drivers.bh1750_driver.SMBus')
    def test_missing_i2c_configuration(self, mock_smbus_cls):
        """Test error when I2C configuration is missing."""
        # Arrange
        config = {'retries': 3}  # Missing 'i2c' key

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config"):
            BH1750Driver('test_bh1750', config)

    @patch('drivers.bh1750_driver.SMBus')
    def test_missing_i2c_address(self, mock_smbus_cls):
        """Test error when I2C address is missing."""
        # Arrange
        config = {'i2c': {}}  # Missing 'address' key

        # Act & Assert
        with pytest.raises(ValueError, match="i2c.address"):
            BH1750Driver('test_bh1750', config)

    @patch('drivers.bh1750_driver.SMBus', None)
    def test_import_error_when_smbus2_missing(self):
        """Test ImportError raised when smbus2 library is not available."""
        # Arrange
        config = {'i2c': {'address': '0x5c'}}

        # Act & Assert
        with pytest.raises(ImportError, match="smbus2"):
            BH1750Driver('test_bh1750', config)

    @patch('drivers.bh1750_driver.SMBus')
    def test_idempotent_initialization(self, mock_smbus_cls):
        """Test that calling initialize twice doesn't create issues."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        # Should only open SMBus once (idempotent)
        assert mock_smbus_cls.call_count == 1


class TestBH1750DriverReading:
    """Test sensor reading functionality."""

    @patch('drivers.bh1750_driver.SMBus')
    def test_read_success(self, mock_smbus_cls):
        """Test successful sensor reading."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        # [0, 120] -> (120 + 0) / 1.2 = 100.0 lux
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['light'] == 100.0
        assert 'timestamp' in result

    @patch('drivers.bh1750_driver.SMBus')
    def test_read_high_lux_value(self, mock_smbus_cls):
        """Test reading a high lux value."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        # Init read
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # [0xFF, 0xFF] -> (255 + 256*255) / 1.2 = 54612.5 lux
        mock_bus.read_i2c_block_data.return_value = [0xFF, 0xFF]

        # Act
        result = driver.read()

        # Assert
        assert result['light'] == 54612.5
        assert 'timestamp' in result

    @patch('drivers.bh1750_driver.SMBus')
    def test_read_without_initialization(self, mock_smbus_cls):
        """Test read fails if not initialized."""
        # Arrange
        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()

    @patch('drivers.bh1750_driver.SMBus')
    def test_read_i2c_failure(self, mock_smbus_cls):
        """Test read raises RuntimeError on I2C failure."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Now make reads fail
        mock_bus.write_byte.side_effect = OSError("I2C bus error")

        # Act & Assert
        with pytest.raises(RuntimeError, match="Failed to read BH1750"):
            driver.read()

    @patch('drivers.bh1750_driver.SMBus')
    @patch('drivers.base_driver.time')
    def test_read_minimum_interval(self, mock_time, mock_smbus_cls):
        """Test that reads respect minimum interval."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        # Simulate time progression
        mock_time.time.side_effect = [100.0, 100.05, 100.3]
        mock_time.sleep = MagicMock()

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Act
        driver.read()  # First read
        driver.read()  # Second read too soon

        # Assert
        mock_time.sleep.assert_called()  # Should sleep to enforce interval


class TestBH1750DriverWrite:
    """Test write operation (should not be supported)."""

    @patch('drivers.bh1750_driver.SMBus')
    def test_write_not_supported(self, mock_smbus_cls):
        """Test that write operation raises NotImplementedError."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            driver.write({'light': 500})


class TestBH1750DriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.bh1750_driver.SMBus')
    def test_cleanup_success(self, mock_smbus_cls):
        """Test successful cleanup."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        mock_bus.write_byte.assert_any_call(0x5c, BH1750Driver.POWER_DOWN)
        mock_bus.close.assert_called_once()

    @patch('drivers.bh1750_driver.SMBus')
    def test_cleanup_without_initialization(self, mock_smbus_cls):
        """Test cleanup works even if never initialized."""
        # Arrange
        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False

    @patch('drivers.bh1750_driver.SMBus')
    def test_cleanup_idempotent(self, mock_smbus_cls):
        """Test that cleanup can be called multiple times safely."""
        # Arrange
        mock_bus = MagicMock()
        mock_smbus_cls.return_value = mock_bus
        mock_bus.read_i2c_block_data.return_value = [0, 120]

        config = {'i2c': {'address': '0x5c'}}
        driver = BH1750Driver('test_bh1750', config)
        driver.initialize()

        # Act
        driver.cleanup()
        driver.cleanup()  # Second cleanup

        # Assert
        assert driver._initialized is False
        # close should only be called once (second cleanup short-circuits)
        assert mock_bus.close.call_count == 1
