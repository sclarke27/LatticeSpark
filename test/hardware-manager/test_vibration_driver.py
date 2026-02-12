#!/usr/bin/env python3
"""
Unit Tests for Vibration Driver (GPIOOutputDriver)

Tests the VibrationDriver AND validates GPIOOutputDriver base class behavior,
including write(), test pulse on init, and state tracking. No actual hardware required.

Run:
    pytest test/hardware-manager/test_vibration_driver.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.vibration_driver import VibrationDriver


class TestVibrationDriverInitialization:
    """Test driver initialization without hardware."""

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_initialization_success(self, mock_output_cls, mock_time):
        """Test successful driver initialization with test pulse."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}

        # Act
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_output_cls.assert_called_once_with(27, active_high=True)
        # Test pulse: on, sleep, off
        mock_device.on.assert_called_once()
        mock_device.off.assert_called_once()

    @patch('drivers.gpio_output.OutputDevice')
    def test_initialization_gpio_failure(self, mock_output_cls):
        """Test initialization fails when GPIO setup fails."""
        # Arrange
        mock_output_cls.side_effect = Exception("GPIO pin busy")

        config = {'pins': {'signal': 27}}

        # Act & Assert
        driver = VibrationDriver('test_vibration', config)
        with pytest.raises(RuntimeError, match="Failed to initialize"):
            driver.initialize()

    @patch('drivers.gpio_output.OutputDevice')
    def test_missing_pins_configuration(self, mock_output_cls):
        """Test error when pins configuration is missing."""
        # Arrange
        config = {}  # Missing 'pins' key

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config"):
            VibrationDriver('test_vibration', config)

    @patch('drivers.gpio_output.OutputDevice')
    def test_missing_signal_pin(self, mock_output_cls):
        """Test error when signal pin is missing."""
        # Arrange
        config = {'pins': {}}

        # Act & Assert
        with pytest.raises(ValueError, match="pins.signal"):
            VibrationDriver('test_vibration', config)

    @patch('drivers.gpio_output.OutputDevice', None)
    def test_import_error_when_gpiozero_missing(self):
        """Test ImportError raised when gpiozero library is not available."""
        # Arrange
        config = {'pins': {'signal': 27}}

        # Act & Assert
        with pytest.raises(ImportError, match="gpiozero"):
            VibrationDriver('test_vibration', config)

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_idempotent_initialization(self, mock_output_cls, mock_time):
        """Test that calling initialize twice doesn't create issues."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        assert mock_output_cls.call_count == 1

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_active_high_default(self, mock_output_cls, mock_time):
        """Test that VibrationDriver uses ACTIVE_HIGH=True by default."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}

        # Act
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Assert
        mock_output_cls.assert_called_once_with(27, active_high=True)


class TestVibrationDriverReading:
    """Test state reading functionality."""

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_read_initial_state_off(self, mock_output_cls, mock_time):
        """Test read returns vibrating=0 initially (after test pulse turns off)."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['vibrating'] == 0
        assert 'timestamp' in result

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_read_after_write_on(self, mock_output_cls, mock_time):
        """Test read returns vibrating=1 after turning on."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Turn on
        driver.write({'vibrating': 1})

        # Act
        result = driver.read()

        # Assert
        assert result['vibrating'] == 1

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_read_uses_correct_state_key(self, mock_output_cls, mock_time):
        """Test that the STATE_KEY 'vibrating' is used in the result dict."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert 'vibrating' in result
        assert 'state' not in result  # Should use STATE_KEY, not base default

    @patch('drivers.gpio_output.OutputDevice')
    def test_read_without_initialization(self, mock_output_cls):
        """Test read fails if not initialized."""
        # Arrange
        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()


class TestVibrationDriverWrite:
    """Test write (actuator control) functionality."""

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_write_turn_on(self, mock_output_cls, mock_time):
        """Test writing vibrating=1 turns on the motor."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Reset mock to clear init test pulse calls
        mock_device.on.reset_mock()
        mock_device.off.reset_mock()

        # Act
        driver.write({'vibrating': 1})

        # Assert
        mock_device.on.assert_called_once()
        mock_device.off.assert_not_called()

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_write_turn_off(self, mock_output_cls, mock_time):
        """Test writing vibrating=0 turns off the motor."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Turn on first
        driver.write({'vibrating': 1})

        # Reset mock
        mock_device.on.reset_mock()
        mock_device.off.reset_mock()

        # Act
        driver.write({'vibrating': 0})

        # Assert
        mock_device.off.assert_called_once()
        mock_device.on.assert_not_called()

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_write_invalid_data_missing_key(self, mock_output_cls, mock_time):
        """Test write raises ValueError when state key is missing."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(ValueError, match="vibrating"):
            driver.write({'wrong_key': 1})

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_write_invalid_data_not_dict(self, mock_output_cls, mock_time):
        """Test write raises ValueError when data is not a dict."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(ValueError, match="vibrating"):
            driver.write("not a dict")

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_without_initialization(self, mock_output_cls):
        """Test write fails if not initialized."""
        # Arrange
        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.write({'vibrating': 1})

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_write_tracks_state(self, mock_output_cls, mock_time):
        """Test that write correctly updates internal state."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()
        mock_time.time = MagicMock(return_value=100.0)

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Act - toggle on and off
        driver.write({'vibrating': 1})
        result_on = driver.read()

        driver.write({'vibrating': 0})
        result_off = driver.read()

        # Assert
        assert result_on['vibrating'] == 1
        assert result_off['vibrating'] == 0


class TestVibrationDriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_cleanup_success(self, mock_output_cls, mock_time):
        """Test successful cleanup turns off and closes device."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Reset to isolate cleanup calls
        mock_device.off.reset_mock()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        mock_device.off.assert_called_once()
        mock_device.close.assert_called_once()

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_cleanup_resets_state(self, mock_output_cls, mock_time):
        """Test that cleanup resets internal state to 0."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()
        driver.write({'vibrating': 1})

        # Act
        driver.cleanup()

        # Assert
        assert driver._state == 0

    @patch('drivers.gpio_output.OutputDevice')
    def test_cleanup_without_initialization(self, mock_output_cls):
        """Test cleanup works even if never initialized."""
        # Arrange
        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False

    @patch('drivers.gpio_output.time')
    @patch('drivers.gpio_output.OutputDevice')
    def test_cleanup_idempotent(self, mock_output_cls, mock_time):
        """Test that cleanup can be called multiple times safely."""
        # Arrange
        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device
        mock_time.sleep = MagicMock()

        config = {'pins': {'signal': 27}}
        driver = VibrationDriver('test_vibration', config)
        driver.initialize()

        # Act
        driver.cleanup()
        driver.cleanup()  # Second cleanup

        # Assert
        assert driver._initialized is False
        # close should only be called once (second cleanup short-circuits)
        assert mock_device.close.call_count == 1
