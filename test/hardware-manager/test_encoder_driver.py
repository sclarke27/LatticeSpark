#!/usr/bin/env python3
"""
Unit Tests for Encoder Driver - poll-thread heartbeat semantics

Locks the changed behavior only: the heartbeat is refreshed on successful
polls, never on the error path, so a wedged I2C bus surfaces via the
stale-heartbeat check in read() instead of silently serving frozen data.

Run:
    pytest test/hardware-manager/test_encoder_driver.py -v
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
src_path = Path(__file__).parent.parent.parent / 'src' / 'hardware-manager'
sys.path.insert(0, str(src_path))

from drivers.encoder_driver import EncoderDriver


def _make_driver():
    with patch('drivers.encoder_driver.SMBus'):
        driver = EncoderDriver('test_encoder', {'i2c': {'address': '0x3c'}})
    driver._bus = MagicMock()
    return driver


class TestEncoderPollHeartbeat:
    """Test _poll_loop heartbeat updates."""

    def test_poll_loop_error_does_not_update_heartbeat(self):
        """A failing poll iteration must leave the heartbeat stale."""
        # Arrange - one failing iteration that also stops the loop
        driver = _make_driver()
        driver._running = True

        def fail_and_stop(*args, **kwargs):
            driver._running = False
            raise OSError('I2C error')

        driver._bus.read_byte_data.side_effect = fail_and_stop

        # Act - run the loop inline (no thread; it exits after one iteration)
        driver._poll_loop()

        # Assert - heartbeat untouched, so read()'s stale check can fire
        assert driver._thread_last_heartbeat == 0.0

    def test_poll_loop_success_updates_heartbeat(self):
        """A successful poll iteration refreshes the heartbeat."""
        # Arrange - one good read, then stop the loop
        driver = _make_driver()
        driver._running = True

        def read_and_stop(*args, **kwargs):
            driver._running = False
            return 0x03  # both encoder pins high, no transition

        driver._bus.read_byte_data.side_effect = read_and_stop

        # Act
        driver._poll_loop()

        # Assert
        assert driver._thread_last_heartbeat > 0.0
