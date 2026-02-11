"""
Camera HTTP Server - MJPEG streaming, REST control, and SSE detection events.

Endpoints:
- GET  /stream                  — Continuous MJPEG stream (multipart/x-mixed-replace)
- GET  /snapshot                — Single JPEG frame
- GET  /health                  — Health check
- GET  /api/status              — Camera status + processor info
- GET  /api/processors          — List processors with enabled state
- POST /api/processors/enable   — Enable a processor (body: {"name": "..."})
- POST /api/processors/disable  — Disable a processor (body: {"name": "..."})
- GET  /api/detections/stream   — SSE stream of detection events

Runs as the main HTTP server for the camera service (port 8081).
"""

import json
import os
import time
import queue
import select
import logging
import threading
from socketserver import ThreadingMixIn
from http.server import HTTPServer, BaseHTTPRequestHandler

logger = logging.getLogger('camera-server')

# Module-level references set by start_camera_server()
_camera_manager = None
_camera_service = None
_api_key = os.environ.get('CROWPI_API_KEY', '')

MAX_REQUEST_BODY = 4096  # 4KB cap on POST bodies

MAX_CONCURRENT_STREAMS = 5
_active_streams = 0
_streams_lock = threading.Lock()

MAX_CONCURRENT_SSE = 3
_active_sse = 0
_sse_lock = threading.Lock()


class CameraHTTPServer(ThreadingMixIn, HTTPServer):
    """Threaded HTTPServer — each request in its own thread.
    Required because MJPEG stream and SSE handlers are long-running."""
    allow_reuse_address = True
    daemon_threads = True


class CameraHTTPHandler(BaseHTTPRequestHandler):
    """HTTP handler for MJPEG streaming, REST control, and SSE detections."""

    def do_GET(self):
        if self.path == '/stream':
            self._handle_stream()
        elif self.path == '/snapshot':
            self._handle_snapshot()
        elif self.path == '/health':
            self._handle_health()
        elif self.path == '/api/status':
            self._handle_api_status()
        elif self.path == '/api/processors':
            self._handle_api_processors()
        elif self.path == '/api/detections/stream':
            self._handle_detections_stream()
        else:
            self.send_error(404)

    def do_POST(self):
        # Require API key on mutation endpoints when configured
        if _api_key:
            provided = self.headers.get('X-API-Key', '')
            if provided != _api_key:
                self._send_json({'error': 'unauthorized'}, status=401)
                return

        if self.path == '/api/processors/enable':
            self._handle_processor_toggle(enable=True)
        elif self.path == '/api/processors/disable':
            self._handle_processor_toggle(enable=False)
        else:
            self.send_error(404)

    # --- Helpers ---

    def _send_json(self, data, status=200):
        """Send JSON response with CORS headers."""
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        """Read and parse JSON request body (capped at MAX_REQUEST_BODY bytes)."""
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        if length > MAX_REQUEST_BODY:
            raise ValueError(f'Request body too large ({length} > {MAX_REQUEST_BODY})')
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    # --- MJPEG Streaming (unchanged) ---

    def _handle_stream(self):
        """Serve continuous MJPEG stream."""
        global _active_streams

        with _streams_lock:
            if _active_streams >= MAX_CONCURRENT_STREAMS:
                self.send_error(503, 'Too many stream connections')
                logger.warning(f'Rejected stream connection (limit {MAX_CONCURRENT_STREAMS})')
                return
            _active_streams += 1

        try:
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            cam = _camera_manager
            if not cam:
                return

            target_interval = 1.0 / cam.target_fps

            while cam.is_running:
                jpeg = cam.get_jpeg()
                if jpeg is None:
                    # Wait 0.1s AND check for client disconnect (readable = EOF)
                    try:
                        r, _, _ = select.select([self.connection], [], [], 0.1)
                        if r:
                            break  # Client disconnected
                    except (ValueError, OSError):
                        break  # Socket already closed
                    continue

                try:
                    self.wfile.write(b'--frame\r\n')
                    self.wfile.write(b'Content-Type: image/jpeg\r\n')
                    self.wfile.write(f'Content-Length: {len(jpeg)}\r\n'.encode())
                    self.wfile.write(b'\r\n')
                    self.wfile.write(jpeg)
                    self.wfile.write(b'\r\n')
                except (BrokenPipeError, ConnectionResetError):
                    break

                time.sleep(target_interval)
        finally:
            with _streams_lock:
                _active_streams -= 1

    def _handle_snapshot(self):
        """Serve single JPEG frame."""
        cam = _camera_manager
        if not cam:
            self.send_error(503, 'Camera not available')
            return

        jpeg = cam.get_jpeg()
        if jpeg is None:
            self.send_error(503, 'No frame available')
            return

        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(len(jpeg)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(jpeg)

    # --- REST Control Endpoints ---

    def _handle_health(self):
        """Health check — matches storage-service/module-service pattern."""
        cam = _camera_manager
        if cam and cam.camera_available:
            self._send_json({
                'status': 'ok',
                'camera_available': True,
                'streaming': cam.is_running,
                'fps': cam.actual_fps,
                'resolution': cam.resolution,
            })
        else:
            self._send_json({
                'status': 'degraded',
                'camera_available': False,
                'streaming': False,
            }, status=503)

    def _handle_api_status(self):
        """Full camera status including processor info."""
        cam = _camera_manager
        if not cam:
            self._send_json({'error': 'Camera not started'}, status=503)
            return

        status = cam.get_status()
        status['processors'] = cam.pipeline.get_status()
        self._send_json(status)

    def _handle_api_processors(self):
        """List available processors with status."""
        cam = _camera_manager
        if not cam:
            self._send_json({'processors': []})
            return

        self._send_json({'processors': cam.pipeline.get_info()})

    def _handle_processor_toggle(self, enable):
        """Enable or disable a processor by name."""
        try:
            body = self._read_json_body()
        except (json.JSONDecodeError, ValueError):
            self._send_json({'error': 'Invalid JSON body'}, status=400)
            return

        name = body.get('name')
        if not name:
            self._send_json({'error': 'Missing processor name'}, status=400)
            return

        cam = _camera_manager
        if not cam:
            self._send_json({'error': 'Camera not started'}, status=503)
            return

        if enable:
            ok = cam.pipeline.enable(name)
        else:
            ok = cam.pipeline.disable(name)

        if not ok:
            self._send_json({'error': f'Unknown processor: {name}'}, status=404)
            return

        self._send_json({'status': 'ok', 'processor': name, 'enabled': enable})

    # --- SSE Detection Stream ---

    def _handle_detections_stream(self):
        """SSE stream of detection events — mirrors MJPEG streaming pattern."""
        global _active_sse

        with _sse_lock:
            if _active_sse >= MAX_CONCURRENT_SSE:
                self.send_error(503, 'Too many SSE connections')
                logger.warning(f'Rejected SSE connection (limit {MAX_CONCURRENT_SSE})')
                return
            _active_sse += 1

        cam = _camera_manager
        if not cam:
            with _sse_lock:
                _active_sse -= 1
            self.send_error(503, 'Camera not available')
            return

        # Subscribe to detection events
        det_queue = cam.subscribe_detections()

        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            while cam.is_running:
                try:
                    detections = det_queue.get(timeout=15.0)
                    data = json.dumps(detections)
                    self.wfile.write(f'data: {data}\n\n'.encode())
                    self.wfile.flush()
                except queue.Empty:
                    # Send keepalive comment
                    try:
                        self.wfile.write(b': keepalive\n\n')
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        break
                except (BrokenPipeError, ConnectionResetError):
                    break
        finally:
            cam.unsubscribe_detections(det_queue)
            with _sse_lock:
                _active_sse -= 1

    def log_message(self, format, *args):
        """Suppress default HTTP logging — use our logger instead."""
        logger.debug(f'{self.client_address[0]} - {format % args}')


def start_camera_server(camera_manager, camera_service=None, port=8081):
    """
    Start camera HTTP server in a background thread.

    Args:
        camera_manager: CameraManager instance to read frames from.
        camera_service: CameraService instance for control operations.
        port: TCP port to bind (default 8081).

    Returns:
        HTTPServer instance (call .shutdown() to stop).
    """
    global _camera_manager, _camera_service
    _camera_manager = camera_manager
    _camera_service = camera_service

    server = CameraHTTPServer(('0.0.0.0', port), CameraHTTPHandler)
    logger.info(f'Camera server started on port {port}')
    return server


# Keep backward-compatible alias
start_mjpeg_server = start_camera_server
