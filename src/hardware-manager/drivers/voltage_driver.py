#!/usr/bin/env python3
"""
Voltage Sensor Driver

SPI-based voltage sensor using ADC channel 6.
Reads analog voltage via MCP3008-compatible ADC on SPI(0,1).

Hardware:
- ADC on SPI bus 0, CE1
- Voltage sensor on ADC channel 6

Specifications:
- Voltage range: 0-3.3V
- 10-bit ADC resolution (0-1023)

NOTE: SPI CE1 is broken on Pi 5 (RP1 chip incompatibility).
This driver is disabled by default (enabled: false in config).
"""

from typing import Dict, Any, Optional
import time

try:
    import spidev
except ImportError:
    spidev = None

from .base_driver import BaseDriver


class VoltageDriver(BaseDriver):
    """SPI ADC voltage sensor driver."""

    ADC_CHANNEL = 6
    ADC_MAX = 1023
    VREF = 3.3
    MIN_READ_INTERVAL = 0.2

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if spidev is None:
            raise ImportError(
                "spidev library not installed. "
                "Install with: pip3 install spidev"
            )

        self.validate_config(['spi'])

        spi_config = self.config['spi']
        self._spi_bus: int = int(spi_config.get('bus', 0))
        self._spi_device: int = int(spi_config.get('device', 1))
        self._spi_speed: int = int(spi_config.get('speed', 1000000))
        self._channel: int = int(
            self.config.get('channel', self.ADC_CHANNEL)
        )

        self._spi: Optional[spidev.SpiDev] = None

    def initialize(self) -> None:
        if self._initialized:
            return

        try:
            self._spi = spidev.SpiDev()
            self._spi.open(self._spi_bus, self._spi_device)
            self._spi.max_speed_hz = self._spi_speed

            # Test read
            voltage = self._read_voltage()

            self._initialized = True
            self.logger.info(
                f"Voltage sensor initialized on SPI({self._spi_bus},"
                f"{self._spi_device}) channel {self._channel}. "
                f"Test reading: {voltage:.2f}V"
            )

        except Exception as e:
            self._cleanup_spi()
            raise RuntimeError(
                f"Failed to initialize voltage sensor: {e}"
            ) from e

    def _read_adc(self) -> int:
        """Read raw ADC value from the configured channel."""
        adc = self._spi.xfer2([1, (8 + self._channel) << 4, 0])
        return ((adc[1] & 3) << 8) + adc[2]

    def _read_voltage(self) -> float:
        """Read voltage from ADC and convert to volts."""
        raw = self._read_adc()
        return (raw / self.ADC_MAX) * self.VREF

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()

        self._throttle_read()

        try:
            voltage = self._read_voltage()
        except Exception as e:
            self.logger.error(f"Voltage read failed: {e}")
            raise RuntimeError(f"Failed to read voltage: {e}") from e

        return {
            'voltage': round(voltage, 2),
            'timestamp': time.time()
        }

    def _cleanup_spi(self) -> None:
        if self._spi is not None:
            try:
                self._spi.close()
            except Exception:
                pass
            self._spi = None

    def cleanup(self) -> None:
        if not self._initialized:
            return

        self._cleanup_spi()
        self._initialized = False
        self.logger.info(f"Voltage sensor {self.component_id} cleaned up")
