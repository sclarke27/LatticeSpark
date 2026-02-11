#!/usr/bin/env python3
"""
Camera Service - Standalone USB camera service managed by PM2.

- OpenCV capture with background thread
- HTTP server for MJPEG streaming, REST control, and SSE detection events
- Reads config from components.json (CAMERA_CONFIG env var for path override)

All logging goes to stderr (captured by PM2 error log).
"""

import os
import sys
import json
import signal
import logging

from camera_manager import CameraManager
from mjpeg_server import start_camera_server

# Setup logging to stderr
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger('camera-service')


class CameraService:
    """Main camera service — manages camera + HTTP server."""

    def __init__(self):
        self._camera = None
        self._server = None
        self._config = {}

    def start(self, config):
        """Initialize camera, processors, and HTTP server."""
        self._config = config
        mjpeg_port = config.get('mjpeg_port', 8081)

        # Start camera
        self._camera = CameraManager(config)
        self._camera.start()

        # Initialize ML processors
        processor_config = config.get('processors', {})
        self._camera.pipeline.discover_and_initialize(processor_config)

        # Start HTTP server (MJPEG + REST + SSE — does NOT call serve_forever yet)
        self._server = start_camera_server(self._camera, self, port=mjpeg_port)

        logger.info(f'Camera service ready (port {mjpeg_port}, '
                     f'camera_available={self._camera.camera_available})')

    def serve_forever(self):
        """Block on HTTP server — PM2 keeps the process alive."""
        if self._server:
            self._server.serve_forever()

    def shutdown(self):
        """Clean shutdown."""
        if self._server:
            self._server.shutdown()
            self._server = None
        if self._camera:
            self._camera.stop()
            self._camera = None
        logger.info('Camera service shut down')


def load_config():
    """Load camera config from components.json."""
    config_path = os.environ.get('CAMERA_CONFIG', 'config/components.json')

    # Default config
    config = {
        'device': 0,
        'resolution': [640, 480],
        'fps': 15,
        'jpeg_quality': 80,
        'mjpeg_port': 8081
    }

    try:
        with open(config_path, 'r') as f:
            full_config = json.load(f)

        camera_config = full_config.get('camera', {})
        if camera_config.get('enabled') is False:
            logger.info('Camera disabled in config, exiting')
            sys.exit(0)

        config.update({
            'device': camera_config.get('device', config['device']),
            'resolution': camera_config.get('resolution', config['resolution']),
            'fps': camera_config.get('fps', config['fps']),
            'jpeg_quality': camera_config.get('jpeg_quality', config['jpeg_quality']),
            'mjpeg_port': camera_config.get('mjpeg_port', config['mjpeg_port']),
            'processors': camera_config.get('processors', {}),
        })
    except FileNotFoundError:
        logger.warning(f'Config file not found: {config_path}, using defaults')
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning(f'Error reading config: {e}, using defaults')

    return config


def main():
    """Entry point — standalone service managed by PM2."""
    config = load_config()

    logger.info(f'Starting camera service: device={config["device"]}, '
                f'resolution={config["resolution"]}, fps={config["fps"]}, '
                f'mjpeg_port={config["mjpeg_port"]}')

    service = CameraService()

    # Signal handlers for clean shutdown
    def handle_signal(signum, frame):
        logger.info(f'Received signal {signum}')
        service.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    service.start(config)
    service.serve_forever()


if __name__ == '__main__':
    main()
