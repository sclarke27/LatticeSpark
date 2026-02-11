#!/usr/bin/env python3
"""
Unit Tests for GPIOOutputDriver

Tests the GPIOOutputDriver base class WITHOUT requiring actual hardware.
Uses mocking to simulate gpiozero OutputDevice responses.

Run:
    pytest test/hardware-manager/test_gpio_output.py -v
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch, call

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))


class TestGPIOOutputDriverConstructor:
    """Test driver constructor and config validation."""

    @patch('drivers.gpio_output.OutputDevice', MagicMock())
    def test_constructor_validates_pins_config(self):
        """Test constructor succeeds with valid pins config."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        config = {'pins': {'signal': 27}}

        # Act
        driver = GPIOOutputDriver('test_vibration', config)

        # Assert
        assert driver.signal_pin == 27
        assert driver._device is None
        assert driver._state == 0

    @patch('drivers.gpio_output.OutputDevice', MagicMock())
    def test_constructor_raises_for_missing_pins(self):
        """Test constructor raises ValueError when pins config is missing."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        config = {'retries': 3}

        # Act & Assert
        with pytest.raises(ValueError, match="Missing required config key: pins"):
            GPIOOutputDriver('test_vibration', config)

    @patch('drivers.gpio_output.OutputDevice', MagicMock())
    def test_constructor_raises_for_missing_signal_pin(self):
        """Test constructor raises ValueError when signal pin is missing."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        config = {'pins': {'data': 27}}  # 'signal' key missing

        # Act & Assert
        with pytest.raises(ValueError, match="pins.signal"):
            GPIOOutputDriver('test_vibration', config)

    def test_constructor_raises_when_gpiozero_not_available(self):
        """Test constructor raises ImportError when gpiozero is not installed."""
        # Arrange & Act & Assert
        with patch('drivers.gpio_output.OutputDevice', None):
            from drivers.gpio_output import GPIOOutputDriver

            with pytest.raises(ImportError, match="gpiozero"):
                GPIOOutputDriver('test_vibration', {'pins': {'signal': 27}})


class TestGPIOOutputDriverInitialization:
    """Test driver initialization."""

    @patch('drivers.gpio_output.OutputDevice')
    def test_initialize_creates_output_device(self, mock_output_cls):
        """Test initialize creates OutputDevice with correct args."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act
        driver.initialize()

        # Assert
        assert driver._initialized is True
        mock_output_cls.assert_called_once_with(27, active_high=True)
        assert driver._device is mock_device

    @patch('drivers.gpio_output.OutputDevice')
    def test_initialize_performs_test_pulse(self, mock_output_cls):
        """Test initialize performs on/off test pulse."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act
        driver.initialize()

        # Assert - should call on() then off() for test pulse
        mock_device.on.assert_called_once()
        mock_device.off.assert_called_once()
        # Verify on was called before off
        assert mock_device.on.call_args_list[0] == call()
        assert mock_device.off.call_args_list[0] == call()

    @patch('drivers.gpio_output.OutputDevice')
    def test_initialize_with_active_high_false(self, mock_output_cls):
        """Test initialize passes ACTIVE_HIGH=False to OutputDevice."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 18}}
        driver = GPIOOutputDriver('test_buzzer', config)
        driver.ACTIVE_HIGH = False

        # Act
        driver.initialize()

        # Assert
        mock_output_cls.assert_called_once_with(18, active_high=False)

    @patch('drivers.gpio_output.OutputDevice')
    def test_initialize_is_idempotent(self, mock_output_cls):
        """Test that calling initialize twice does not recreate device."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act
        driver.initialize()
        driver.initialize()  # Second call

        # Assert
        assert driver._initialized is True
        assert mock_output_cls.call_count == 1

    @patch('drivers.gpio_output.OutputDevice')
    def test_initialize_raises_on_device_failure(self, mock_output_cls):
        """Test initialize raises RuntimeError when device creation fails."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_output_cls.side_effect = OSError("GPIO busy")

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="Failed to initialize"):
            driver.initialize()
        assert driver._initialized is False


class TestGPIOOutputDriverReading:
    """Test reading current state."""

    @patch('drivers.gpio_output.OutputDevice')
    def test_read_returns_current_state(self, mock_output_cls):
        """Test read returns the current state of the output."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()

        # Act
        result = driver.read()

        # Assert
        assert result['state'] == 0  # Default state after init
        assert 'timestamp' in result

    @patch('drivers.gpio_output.OutputDevice')
    def test_read_raises_when_not_initialized(self, mock_output_cls):
        """Test read raises RuntimeError when driver not initialized."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.read()


class TestGPIOOutputDriverWrite:
    """Test write functionality."""

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_turns_device_on(self, mock_output_cls):
        """Test write with state=1 turns device on."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()
        mock_device.reset_mock()  # Clear init calls

        # Act
        driver.write({'state': 1})

        # Assert
        mock_device.on.assert_called_once()
        assert driver._state == 1

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_turns_device_off(self, mock_output_cls):
        """Test write with state=0 turns device off."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()
        mock_device.reset_mock()

        # Turn on first, then off
        driver.write({'state': 1})
        mock_device.reset_mock()
        driver.write({'state': 0})

        # Assert
        mock_device.off.assert_called_once()
        assert driver._state == 0

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_raises_for_invalid_data_not_dict(self, mock_output_cls):
        """Test write raises ValueError when data is not a dict."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(ValueError, match="state"):
            driver.write("invalid")

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_raises_for_missing_state_key(self, mock_output_cls):
        """Test write raises ValueError when STATE_KEY is missing from data."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()

        # Act & Assert
        with pytest.raises(ValueError, match="state"):
            driver.write({'value': 1})  # Wrong key

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_raises_when_not_initialized(self, mock_output_cls):
        """Test write raises RuntimeError when driver not initialized."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act & Assert
        with pytest.raises(RuntimeError, match="not initialized"):
            driver.write({'state': 1})

    @patch('drivers.gpio_output.OutputDevice')
    def test_write_reflects_in_read(self, mock_output_cls):
        """Test that write state is reflected in subsequent read."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()

        # Act
        driver.write({'state': 1})
        result = driver.read()

        # Assert
        assert result['state'] == 1


class TestGPIOOutputDriverCleanup:
    """Test cleanup functionality."""

    @patch('drivers.gpio_output.OutputDevice')
    def test_cleanup_turns_off_and_releases_device(self, mock_output_cls):
        """Test cleanup turns off device, closes it, and resets state."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        mock_device = MagicMock()
        mock_output_cls.return_value = mock_device

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)
        driver.initialize()
        driver.write({'state': 1})
        mock_device.reset_mock()

        # Act
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        assert driver._state == 0
        assert driver._device is None
        mock_device.off.assert_called_once()
        mock_device.close.assert_called_once()

    @patch('drivers.gpio_output.OutputDevice')
    def test_cleanup_is_idempotent(self, mock_output_cls):
        """Test cleanup is a no-op when not initialized."""
        # Arrange
        from drivers.gpio_output import GPIOOutputDriver

        config = {'pins': {'signal': 27}}
        driver = GPIOOutputDriver('test_vibration', config)

        # Act - cleanup without initialize should not fail
        driver.cleanup()

        # Assert
        assert driver._initialized is False
        assert driver._state == 0
