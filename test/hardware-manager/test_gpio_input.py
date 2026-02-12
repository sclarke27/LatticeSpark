#!/usr/bin/env python3
"""
Unit Tests for GPIOInputDriver

Tests the GPIOInputDriver base class WITHOUT requiring actual hardware.
Uses mocking to simulate gpiozero InputDevice responses.

Run:
    pytest test/hardware-manager/test_gpio_input.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))


class TestGPIOInputDriverConstructor:
    """Test driver constructor and config validation."""

    @patch('drivers.gpio_input.InputDevice', MagicMock())
    def test_constructor_validates_pins_config(self):
        """Test constructor succeeds with valid pins config."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        config = {'pins': {'signal': 12}}

        # Act
        driver = GPIOInputDriver('test_hall', config)

        # Assert
        assert driver.signal_pin == 12
        assert driver._sensor is None

    @patch('drivers.gpio_input.InputDevice', MagicMock())
    def test_constructor_raises_for_missing_pins(self):
        """Test constructor raises ValueError when pins config is missing."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        config = {'retries': 3}

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config key: pins"):
            GPIOInputDriver('test_hall', config)

    @patch('drivers.gpio_input.InputDevice', MagicMock())
    def test_constructor_raises_for_missing_signal_pin(self):
        """Test constructor raises ValueError when signal pin is missing."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        config = {'pins': {'data': 12}}  # 'signal' key missing

        # Act & Assert
        with pytest.raises(ValueError, match="pins.signal"):
            GPIOInputDriver('test_hall', config)

    def test_constructor_raises_when_gpiozero_not_available(self):
        """Test constructor raises ImportError when gpiozero is not installed."""
        # Arrange & Act & Assert
        with patch('drivers.gpio_input.InputDevice', None):
            from drivers.gpio_input import GPIOInputDriver

            with pytest.raises(ImportError, match="gpiozero"):
                GPIOInputDriver('test_hall', {'pins': {'signal': 12}})


class TestGPIOInputDriverInitialization:
    """Test driver initialization."""

    @patch('drivers.gpio_input.InputDevice')
    def test_initialize_creates_input_device(self, mock_input_cls):
        """Test initialize creates InputDevice on correct pin."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_device = MagicMock()
        mock_device.value = 0
        mock_input_cls.return_value = mock_device

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)

        # Act
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_input_cls.assert_called_once_with(12)
        assert driver._sensor is mock_device

    @patch('drivers.gpio_input.InputDevice')
    def test_initialize_is_idempotent(self, mock_input_cls):
        """Test that calling initialize twice does not recreate device."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_device = MagicMock()
        mock_device.value = 0
        mock_input_cls.return_value = mock_device

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        assert mock_input_cls.call_count == 1

    @patch('drivers.gpio_input.InputDevice')
    def test_initialize_raises_on_device_failure(self, mock_input_cls):
        """Test initialize raises RuntimeError when device creation fails."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_input_cls.side_effect = OSError("GPIO busy")

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="Failed to initialize"):
            driver.initialize()
        assert driver._initialized is False


class TestGPIOInputDriverReading:
    """Test sensor reading functionality."""

    @patch('drivers.gpio_input.InputDevice')
    def test_read_returns_correct_value_active_high(self, mock_input_cls):
        """Test read returns raw value when ACTIVE_LOW=False."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_device = MagicMock()
        mock_device.value = 1
        mock_input_cls.return_value = mock_device

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_sensor', config)
        driver.ACTIVE_LOW = False
        driver.OUTPUT_KEY = 'detected'
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['detected'] == 1
        assert 'timestamp' in result

    @patch('drivers.gpio_input.InputDevice')
    def test_read_returns_inverted_value_active_low(self, mock_input_cls):
        """Test read inverts value when ACTIVE_LOW=True."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_device = MagicMock()
        mock_input_cls.return_value = mock_device

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)
        driver.ACTIVE_LOW = True
        driver.OUTPUT_KEY = 'detected'

        # Initialize with raw=0 (test read during init)
        mock_device.value = 0
        driver.initialize()

        # Now read with raw=0 -> active_low inversion -> 1
        mock_device.value = 0
        result = driver.read()
        assert result['detected'] == 1

        # Read with raw=1 -> active_low inversion -> 0
        mock_device.value = 1
        result = driver.read()
        assert result['detected'] == 0

    @patch('drivers.gpio_input.InputDevice')
    def test_read_raises_when_not_initialized(self, mock_input_cls):
        """Test read raises RuntimeError when driver not initialized."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()

    @patch('drivers.gpio_input.InputDevice')
    def test_read_raises_on_device_failure(self, mock_input_cls):
        """Test read raises RuntimeError when device read fails."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_device = MagicMock()
        mock_device.value = 0
        mock_input_cls.return_value = mock_device

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)
        driver.initialize()

        # Make subsequent reads fail
        type(mock_device).value = PropertyMock(side_effect=OSError("GPIO error"))

        # Act & Assert
        with pytest.raises(RuntimeError, match="read failed"):
            driver.read()


class TestGPIOInputDriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.gpio_input.InputDevice')
    def test_cleanup_releases_device(self, mock_input_cls):
        """Test cleanup closes the device and resets state."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        mock_device = MagicMock()
        mock_device.value = 0
        mock_input_cls.return_value = mock_device

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)
        driver.initialize()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        assert driver._sensor is None
        mock_device.close.assert_called_once()

    @patch('drivers.gpio_input.InputDevice')
    def test_cleanup_is_idempotent(self, mock_input_cls):
        """Test cleanup is a no-op when not initialized."""
        # Arrange
        from drivers.gpio_input import GPIOInputDriver

        config = {'pins': {'signal': 12}}
        driver = GPIOInputDriver('test_hall', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False
