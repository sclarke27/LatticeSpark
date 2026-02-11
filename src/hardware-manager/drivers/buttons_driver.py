#!/usr/bin/env python3
"""
4-Button Panel Driver

SPI/ADC-based button panel using resistor ladder.
Reads analog values from ADC channel 4 via SPI to determine
which of 4 buttons is pressed.

Hardware:
- 4-button panel on LatticeSpark
- SPI bus 0, device 1 (CE1)
- ADC channel 4

Specifications:
- Resistor ladder: each button produces a distinct analog voltage
- Thresholds: [780, 840, 890, 960] map to buttons 1-4
- Values >= 960 with no threshold match = no button pressed
"""

from typing import Dict, Any, Optional
import time

try:
    import spidev
except ImportError:
    spidev = None

from .base_driver import BaseDriver


class ButtonsDriver(BaseDriver):
    """4-button panel driver using SPI/ADC."""

    # Minimum time between reads (seconds)
    MIN_READ_INTERVAL = 0.05

    # ADC channel for button input
    ADC_CHANNEL = 4

    # Minimum ADC value to consider a valid button press.
    # Idle state reads low (~0); real presses read 700+.
    ADC_MIN = 700

    # Analog thresholds for each button (resistor ladder)
    # Values between ADC_MIN and threshold[i] map to button i+1
    ADC_THRESHOLDS = [780, 840, 890, 960]

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize button panel driver.

        Args:
            component_id: Unique component identifier
            config: Component configuration

        Raises:
            ImportError: If spidev library not available
        """
        super().__init__(component_id, config)

        # Validate library
        if spidev is None:
            raise ImportError(
                "spidev library not installed. "
                "Install with: pip3 install spidev"
            )

        # SPI configuration
        self._spi_bus: int = int(self.config.get('spi', {}).get('bus', 0))
        self._spi_device: int = int(self.config.get('spi', {}).get('device', 1))
        self._spi_speed: int = int(self.config.get('spi', {}).get('speed', 1000000))

        # Track state
        self._spi: Optional[spidev.SpiDev] = None
        self._last_button: int = 0

        self.logger.info(
            f"Button panel driver created for {component_id} "
            f"(SPI{self._spi_bus}.{self._spi_device})"
        )

    def initialize(self) -> None:
        """
        Initialize button panel.

        Opens SPI connection and performs test read.

        Raises:
            RuntimeError: If initialization fails
        """
        if self._initialized:
            self.logger.debug(f"{self.component_id} already initialized")
            return

        self.logger.info(
            f"Initializing button panel on SPI{self._spi_bus}.{self._spi_device}"
        )

        try:
            self._spi = spidev.SpiDev()
            self._spi.open(self._spi_bus, self._spi_device)
            self._spi.max_speed_hz = self._spi_speed

            # Wait for SPI to settle
            time.sleep(0.05)

            # Perform test read
            adc_value = self._read_adc()
            button = self._get_button(adc_value)

            self._initialized = True
            self.logger.info(
                f"Button panel initialized successfully. "
                f"Test reading: ADC={adc_value}, button={button}"
            )

        except Exception as e:
            self._cleanup_spi()
            self.logger.error(f"Button panel initialization failed: {e}")
            raise RuntimeError(
                f"Failed to initialize button panel on "
                f"SPI{self._spi_bus}.{self._spi_device}: {e}"
            ) from e

    def _read_adc(self) -> int:
        """
        Read raw ADC value from the button channel.

        Returns:
            int: 10-bit ADC value (0-1023)
        """
        adc = self._spi.xfer2([1, (8 + self.ADC_CHANNEL) << 4, 0])
        data = ((adc[1] & 3) << 8) + adc[2]
        return data

    def _get_button(self, adc_value: int) -> int:
        """
        Determine which button is pressed from ADC value.

        Args:
            adc_value: Raw ADC reading

        Returns:
            int: Button number (1-4) or 0 if no button pressed
        """
        # Idle state reads low (~0); ignore values below minimum
        if adc_value < self.ADC_MIN:
            return 0

        for i, threshold in enumerate(self.ADC_THRESHOLDS):
            if adc_value < threshold:
                return i + 1
        return 0

    def read(self) -> Dict[str, Any]:
        """
        Read button panel state with debouncing.

        Double-reads with 50ms delay to debounce, matching
        the LatticeSpark example code pattern.

        Returns:
            Dict with keys:
            - button: Which button is pressed (int, 0=none, 1-4=button)
            - timestamp: Unix timestamp of reading (float)

        Raises:
            RuntimeError: If driver not initialized or read fails
        """
        self._assert_initialized()

        self._throttle_read()

        self.logger.debug("Reading button panel")

        try:
            # First read
            adc_value = self._read_adc()
            button = self._get_button(adc_value)

            # Debounce: if state changed, wait and re-read to confirm
            if button != self._last_button:
                time.sleep(0.05)
                adc_value = self._read_adc()
                button = self._get_button(adc_value)

            self._last_button = button

        except Exception as e:
            self.logger.error(f"Button panel read failed: {e}")
            raise RuntimeError(f"Failed to read button panel: {e}") from e

        reading = {
            'button': button,
            'timestamp': time.time()
        }

        self.logger.debug(
            f"Button read: button={button} (ADC={adc_value})"
        )

        return reading

    def _cleanup_spi(self) -> None:
        """Clean up SPI connection."""
        if self._spi:
            try:
                self._spi.close()
            except Exception as e:
                self.logger.warning(f"SPI cleanup warning: {e}")
            finally:
                self._spi = None

    def cleanup(self) -> None:
        """
        Clean up button panel resources.

        Closes SPI connection.
        """
        if not self._initialized:
            return

        self.logger.info(f"Cleaning up button panel {self.component_id}")

        self._cleanup_spi()

        self._initialized = False
        self._last_button = 0

        self.logger.info(f"Button panel {self.component_id} cleaned up")
