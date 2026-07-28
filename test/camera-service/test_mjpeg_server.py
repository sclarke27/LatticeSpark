#!/usr/bin/env python3
"""
Unit Tests for mjpeg_server - half-open client timeout handling

Verifies the handler applies a socket timeout and that timed-out writes free
stream/SSE slots instead of pinning handler threads forever.

Run:
    pytest test/camera-service/test_mjpeg_server.py -v
"""

import queue
import socket
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'src' / 'camera-service'))

# test_camera_service.py installs sys.modules['mjpeg_server'] = MagicMock()
# at import time and pytest may collect it first — evict the mock so this
# file tests the real module.
sys.modules.pop('mjpeg_server', None)
import importlib
mjpeg_server = importlib.import_module('mjpeg_server')


def _bare_handler():
    """Build a handler instance without a real socket."""
    handler = mjpeg_server.CameraHTTPHandler.__new__(mjpeg_server.CameraHTTPHandler)
    handler.wfile = MagicMock()
    handler.connection = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.send_error = MagicMock()
    return handler


def _mock_cam():
    cam = MagicMock()
    cam.is_running = True
    cam.target_fps = 15
    cam.get_jpeg.return_value = b'\xff\xd8fakejpeg'
    return cam


class TestSocketTimeout:
    def test_handler_has_socket_timeout(self):
        """StreamRequestHandler.setup() applies this via connection.settimeout."""
        assert mjpeg_server.CameraHTTPHandler.timeout == 30


class TestStreamSlotRelease:
    def _run_stream(self, write_side_effect):
        handler = _bare_handler()
        handler.wfile.write.side_effect = write_side_effect
        cam = _mock_cam()
        saved_cam = mjpeg_server._camera_manager
        saved_streams = mjpeg_server._active_streams
        mjpeg_server._camera_manager = cam
        mjpeg_server._active_streams = 0
        try:
            handler._handle_stream()
            return mjpeg_server._active_streams
        finally:
            mjpeg_server._camera_manager = saved_cam
            mjpeg_server._active_streams = saved_streams

    def test_stream_frees_slot_on_socket_timeout(self):
        """A timed-out write exits the loop and frees the stream slot."""
        # Act
        remaining = self._run_stream(socket.timeout())

        # Assert
        assert remaining == 0

    def test_stream_frees_slot_on_broken_pipe(self):
        """Regression: disconnects still exit cleanly under `except OSError`."""
        # Act
        remaining = self._run_stream(BrokenPipeError())

        # Assert
        assert remaining == 0

    def test_stream_rejects_over_limit(self):
        """At the concurrency cap, new streams get 503 and no slot change."""
        # Arrange
        handler = _bare_handler()
        saved_streams = mjpeg_server._active_streams
        mjpeg_server._active_streams = mjpeg_server.MAX_CONCURRENT_STREAMS
        try:
            # Act
            handler._handle_stream()

            # Assert
            handler.send_error.assert_called_once()
            assert handler.send_error.call_args[0][0] == 503
            assert mjpeg_server._active_streams == mjpeg_server.MAX_CONCURRENT_STREAMS
        finally:
            mjpeg_server._active_streams = saved_streams


class TestSseSlotRelease:
    def test_sse_unsubscribes_on_socket_timeout(self):
        """A timed-out SSE write unsubscribes and frees the SSE slot."""
        # Arrange
        handler = _bare_handler()
        handler.wfile.write.side_effect = socket.timeout()
        cam = _mock_cam()
        det_queue = queue.Queue()
        det_queue.put({'detections': []})
        cam.subscribe_detections.return_value = det_queue

        saved_cam = mjpeg_server._camera_manager
        saved_sse = mjpeg_server._active_sse
        mjpeg_server._camera_manager = cam
        mjpeg_server._active_sse = 0
        try:
            # Act
            handler._handle_detections_stream()

            # Assert
            cam.unsubscribe_detections.assert_called_once_with(det_queue)
            assert mjpeg_server._active_sse == 0
        finally:
            mjpeg_server._camera_manager = saved_cam
            mjpeg_server._active_sse = saved_sse
