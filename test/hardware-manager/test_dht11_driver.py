#!/usr/bin/env python3
"""
Unit Tests for DHT11 Driver

Tests the DHT11 driver WITHOUT requiring actual hardware.
Uses mocking to simulate adafruit_dht library responses.

Run:
    pytest test/hardware-manager/test_dht11_driver.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.dht11_driver import DHT11Driver


class TestDHT11DriverInitialization:
    """Test driver initialization without hardware."""

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_initialization_success(self, mock_dht, mock_board):
        """Test successful driver initialization."""
        # Arrange
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.humidity = 60.0
        mock_dht.DHT11.return_value = mock_device
        mock_board.D4 = MagicMock()

        config = {
            'pins': {'data': 4},
            'retries': 3,
            'delay': 0.5
        }

        # Act
        driver = DHT11Driver('test_dht11', config)
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_dht.DHT11.assert_called_once()

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_initialization_sensor_not_responding(self, mock_dht, mock_board):
        """Test initialization fails when sensor doesn't respond."""
        # Arrange
        mock_device = MagicMock()
        mock_device.temperature = None
        mock_device.humidity = None
        mock_dht.DHT11.return_value = mock_device
        mock_board.D4 = MagicMock()

        config = {'pins': {'data': 4}}

        # Act & Assert
        driver = DHT11Driver('test_dht11', config)
        with pytest.raises(RuntimeError, match="not responding"):
            driver.initialize()

    def test_missing_pin_configuration(self):
        """Test error when pin configuration is missing."""
        # Arrange
        config = {'retries': 3}  # Missing 'pins' key

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config"):
            DHT11Driver('test_dht11', config)

    def test_invalid_gpio_pin(self):
        """Test error when GPIO pin is not supported."""
        # Arrange
        config = {'pins': {'data': 99}}  # Invalid pin

        # Act & Assert
        with patch('drivers.dht11_driver.board'):
            with patch('drivers.dht11_driver.adafruit_dht'):
                driver = DHT11Driver('test_dht11', config)
                with pytest.raises(RuntimeError, match="not supported"):
                    driver.initialize()


class TestDHT11DriverReading:
    """Test sensor reading functionality."""

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_read_success(self, mock_dht, mock_board):
        """Test successful sensor reading."""
        # Arrange
        mock_device = MagicMock()
        mock_device.temperature = 25.3
        mock_device.humidity = 60.5
        mock_dht.DHT11.return_value = mock_device
        mock_board.D4 = MagicMock()

        config = {'pins': {'data': 4}}
        driver = DHT11Driver('test_dht11', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['temperature'] == 25.3
        assert result['humidity'] == 60.5
        assert 'timestamp' in result

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_read_without_initialization(self, mock_dht, mock_board):
        """Test read fails if not initialized."""
        # Arrange
        config = {'pins': {'data': 4}}
        driver = DHT11Driver('test_dht11', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()


class TestDHT11DriverWrite:
    """Test write operation (should not be supported)."""

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_write_not_supported(self, mock_dht, mock_board):
        """Test that write operation raises NotImplementedError."""
        # Arrange
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.humidity = 60.0
        mock_dht.DHT11.return_value = mock_device
        mock_board.D4 = MagicMock()

        config = {'pins': {'data': 4}}
        driver = DHT11Driver('test_dht11', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            driver.write({'temperature': 30})


class TestDHT11DriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_cleanup_success(self, mock_dht, mock_board):
        """Test successful cleanup."""
        # Arrange
        mock_device = MagicMock()
        mock_device.temperature = 25.0
        mock_device.humidity = 60.0
        mock_dht.DHT11.return_value = mock_device
        mock_board.D4 = MagicMock()

        config = {'pins': {'data': 4}}
        driver = DHT11Driver('test_dht11', config)
        driver.initialize()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        mock_device.exit.assert_called_once()

    @patch('drivers.dht11_driver.board')
    @patch('drivers.dht11_driver.adafruit_dht')
    def test_cleanup_without_initialization(self, mock_dht, mock_board):
        """Test cleanup works even if never initialized."""
        # Arrange
        config = {'pins': {'data': 4}}
        driver = DHT11Driver('test_dht11', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False
