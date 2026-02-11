#!/usr/bin/env python3
"""
Unit Tests for Hall Driver (GPIOInputDriver)

Tests the HallDriver AND validates GPIOInputDriver base class behavior,
especially ACTIVE_LOW inversion logic. No actual hardware required.

Run:
    pytest test/hardware-manager/test_hall_driver.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.hall_driver import HallDriver


class TestHallDriverInitialization:
    """Test driver initialization without hardware."""

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_initialization_success(self, mock_input_cls, mock_time):
        """Test successful driver initialization."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1  # raw 1 = no magnet (ACTIVE_LOW)
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 12}}

        # Act
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_input_cls.assert_called_once_with(12)

    @patch('drivers.gpio_input.InputDevice')
    def test_initialization_gpio_failure(self, mock_input_cls):
        """Test initialization fails when GPIO setup fails."""
        # Arrange
        mock_input_cls.side_effect = Exception("GPIO pin busy")

        config = {'pins': {'signal': 12}}

        # Act & Assert
        driver = HallDriver('test_hall', config)
        with pytest.raises(RuntimeError, match="Failed to initialize"):
            driver.initialize()

    @patch('drivers.gpio_input.InputDevice')
    def test_missing_pins_configuration(self, mock_input_cls):
        """Test error when pins configuration is missing."""
        # Arrange
        config = {}  # Missing 'pins' key

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config"):
            HallDriver('test_hall', config)

    @patch('drivers.gpio_input.InputDevice')
    def test_missing_signal_pin(self, mock_input_cls):
        """Test error when signal pin is missing."""
        # Arrange
        config = {'pins': {}}

        # Act & Assert
        with pytest.raises(ValueError, match="pins.signal"):
            HallDriver('test_hall', config)

    @patch('drivers.gpio_input.InputDevice', None)
    def test_import_error_when_gpiozero_missing(self):
        """Test ImportError raised when gpiozero library is not available."""
        # Arrange
        config = {'pins': {'signal': 12}}

        # Act & Assert
        with pytest.raises(ImportError, match="gpiozero"):
            HallDriver('test_hall', config)

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_idempotent_initialization(self, mock_input_cls, mock_time):
        """Test that calling initialize twice doesn't create issues."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        assert mock_input_cls.call_count == 1


class TestHallDriverReading:
    """Test sensor reading functionality with ACTIVE_LOW inversion."""

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_read_magnet_detected_active_low(self, mock_input_cls, mock_time):
        """Test read returns detected=1 when raw value is 0 (ACTIVE_LOW)."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1  # init read
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Simulate magnet present: raw 0 -> ACTIVE_LOW -> detected=1
        mock_device.value = 0

        # Act
        result = driver.read()

        # Assert
        assert result['detected'] == 1
        assert 'timestamp' in result

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_read_no_magnet_active_low(self, mock_input_cls, mock_time):
        """Test read returns detected=0 when raw value is 1 (ACTIVE_LOW)."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1  # init read + no magnet
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # raw 1 -> ACTIVE_LOW -> detected=0
        mock_device.value = 1

        # Act
        result = driver.read()

        # Assert
        assert result['detected'] == 0
        assert 'timestamp' in result

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_read_uses_correct_output_key(self, mock_input_cls, mock_time):
        """Test that the OUTPUT_KEY 'detected' is used in the result dict."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 0
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert 'detected' in result
        assert 'value' not in result  # Should use OUTPUT_KEY, not base default

    @patch('drivers.gpio_input.InputDevice')
    def test_read_without_initialization(self, mock_input_cls):
        """Test read fails if not initialized."""
        # Arrange
        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_read_gpio_failure(self, mock_input_cls, mock_time):
        """Test read raises RuntimeError on GPIO failure."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1  # init read
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Now make reads fail
        type(mock_device).value = property(
            lambda self: (_ for _ in ()).throw(OSError("GPIO read error"))
        )

        # Act & Assert
        with pytest.raises(RuntimeError, match="read failed"):
            driver.read()


class TestHallDriverWrite:
    """Test write operation (should not be supported)."""

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_write_not_supported(self, mock_input_cls, mock_time):
        """Test that write operation raises NotImplementedError."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(NotImplementedError, match="read-only"):
            driver.write({'detected': 1})


class TestHallDriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_cleanup_success(self, mock_input_cls, mock_time):
        """Test successful cleanup."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        mock_device.close.assert_called_once()

    @patch('drivers.gpio_input.InputDevice')
    def test_cleanup_without_initialization(self, mock_input_cls):
        """Test cleanup works even if never initialized."""
        # Arrange
        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False

    @patch('drivers.gpio_input.time')
    @patch('drivers.gpio_input.InputDevice')
    def test_cleanup_idempotent(self, mock_input_cls, mock_time):
        """Test that cleanup can be called multiple times safely."""
        # Arrange
        mock_device = MagicMock()
        mock_device.value = 1
        mock_input_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 12}}
        driver = HallDriver('test_hall', config)
        driver.initialize()

        # Act
        driver.cleanup()
        driver.cleanup()  # Second cleanup

        # Assert
        assert driver._initialized is False
        # close should only be called once (second cleanup short-circuits)
        assert mock_device.close.call_count == 1
