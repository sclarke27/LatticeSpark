#!/usr/bin/env python3
"""
Unit Tests for CameraService and load_config

Tests the CameraService class and load_config function WITHOUT requiring
actual hardware or camera. Uses mocking for CameraManager, mjpeg_server,
and filesystem access.

Run:
    pytest test/camera-service/test_camera_service.py -v
"""

import pytest
import sys
import json
from pathlib import Path
from unittest.mock import MagicMock, patch, mock_open

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'src' / 'camera-service'))


# ---------------------------------------------------------------------------
# Patch heavy imports before importing the module under test
# ---------------------------------------------------------------------------

sys.modules['camera_manager'] = MagicMock()
sys.modules['mjpeg_server'] = MagicMock()

from importlib import reload
import importlib

camera_service_module = importlib.import_module('camera-service')
reload(camera_service_module)

CameraService = camera_service_module.CameraService
load_config = camera_service_module.load_config


# ===========================================================================
# CameraService constructor tests
# ===========================================================================

class TestCameraServiceConstructor:
    """Test CameraService.__init__ sets up fields correctly."""

    def test_camera_is_none(self):
        """Constructor initializes _camera to None."""
        # Arrange & Act
        service = CameraService()

        # Assert
        assert service._camera is None

    def test_server_is_none(self):
        """Constructor initializes _server to None."""
        # Arrange & Act
        service = CameraService()

        # Assert
        assert service._server is None

    def test_config_is_empty_dict(self):
        """Constructor initializes _config to empty dict."""
        # Arrange & Act
        service = CameraService()

        # Assert
        assert service._config == {}


# ===========================================================================
# CameraService.start() tests
# ===========================================================================

class TestCameraServiceStart:
    """Test CameraService.start() initializes components."""

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_start_creates_camera_manager(self, MockCameraManager, mock_start_server):
        """start() creates a CameraManager with the provided config."""
        # Arrange
        service = CameraService()
        config = {'mjpeg_port': 9090, 'device': 0}
        mock_camera = MagicMock()
        MockCameraManager.return_value = mock_camera

        # Act
        service.start(config)

        # Assert
        MockCameraManager.assert_called_once_with(config)

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_start_starts_camera(self, MockCameraManager, mock_start_server):
        """start() calls camera.start() on the CameraManager."""
        # Arrange
        service = CameraService()
        config = {'mjpeg_port': 8081}
        mock_camera = MagicMock()
        MockCameraManager.return_value = mock_camera

        # Act
        service.start(config)

        # Assert
        mock_camera.start.assert_called_once()

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_start_initializes_processor_pipeline(self, MockCameraManager, mock_start_server):
        """start() calls pipeline.discover_and_initialize with processor config."""
        # Arrange
        service = CameraService()
        processor_config = {'face_detector': {'enabled': True}}
        config = {'mjpeg_port': 8081, 'processors': processor_config}
        mock_camera = MagicMock()
        MockCameraManager.return_value = mock_camera

        # Act
        service.start(config)

        # Assert
        mock_camera.pipeline.discover_and_initialize.assert_called_once_with(processor_config)

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_start_creates_http_server(self, MockCameraManager, mock_start_server):
        """start() creates an HTTP server on the configured port."""
        # Arrange
        service = CameraService()
        config = {'mjpeg_port': 9090}
        mock_camera = MagicMock()
        MockCameraManager.return_value = mock_camera

        # Act
        service.start(config)

        # Assert
        mock_start_server.assert_called_once_with(mock_camera, service, port=9090)

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_start_uses_default_port(self, MockCameraManager, mock_start_server):
        """start() defaults to port 8081 when mjpeg_port not in config."""
        # Arrange
        service = CameraService()
        config = {}  # No mjpeg_port
        mock_camera = MagicMock()
        MockCameraManager.return_value = mock_camera

        # Act
        service.start(config)

        # Assert
        mock_start_server.assert_called_once_with(mock_camera, service, port=8081)

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_start_stores_config(self, MockCameraManager, mock_start_server):
        """start() stores the config on the service instance."""
        # Arrange
        service = CameraService()
        config = {'device': 1, 'fps': 30}

        # Act
        service.start(config)

        # Assert
        assert service._config == config


# ===========================================================================
# CameraService.shutdown() tests
# ===========================================================================

class TestCameraServiceShutdown:
    """Test CameraService.shutdown() cleans up resources."""

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_shutdown_stops_camera_and_server(self, MockCameraManager, mock_start_server):
        """shutdown() stops the camera and shuts down the HTTP server."""
        # Arrange
        service = CameraService()
        mock_camera = MagicMock()
        mock_server = MagicMock()
        MockCameraManager.return_value = mock_camera
        mock_start_server.return_value = mock_server
        service.start({'mjpeg_port': 8081})

        # Act
        service.shutdown()

        # Assert
        mock_server.shutdown.assert_called_once()
        mock_camera.stop.assert_called_once()
        assert service._server is None
        assert service._camera is None

    def test_shutdown_handles_none_server_and_camera(self):
        """shutdown() handles case when server and camera are both None."""
        # Arrange
        service = CameraService()

        # Act — should not raise
        service.shutdown()

        # Assert
        assert service._server is None
        assert service._camera is None

    @patch('camera-service.start_camera_server')
    @patch('camera-service.CameraManager')
    def test_shutdown_is_idempotent(self, MockCameraManager, mock_start_server):
        """shutdown() can be called multiple times safely."""
        # Arrange
        service = CameraService()
        mock_camera = MagicMock()
        mock_server = MagicMock()
        MockCameraManager.return_value = mock_camera
        mock_start_server.return_value = mock_server
        service.start({'mjpeg_port': 8081})

        # Act
        service.shutdown()
        service.shutdown()  # Second call

        # Assert
        mock_server.shutdown.assert_called_once()
        mock_camera.stop.assert_called_once()
        assert service._server is None
        assert service._camera is None


# ===========================================================================
# load_config() tests
# ===========================================================================

class TestLoadConfig:
    """Test load_config reads and merges configuration."""

    @patch.dict('os.environ', {}, clear=True)
    @patch('builtins.open', side_effect=FileNotFoundError)
    def test_returns_defaults_when_file_missing(self, mock_file):
        """load_config() returns default config when config file is missing."""
        # Act
        config = load_config()

        # Assert
        assert config['device'] == 0
        assert config['resolution'] == [640, 480]
        assert config['fps'] == 15
        assert config['jpeg_quality'] == 80
        assert config['mjpeg_port'] == 8081

    @patch.dict('os.environ', {}, clear=True)
    @patch('builtins.open', mock_open(read_data='not valid json {{{'))
    def test_returns_defaults_on_json_error(self):
        """load_config() returns default config when JSON is invalid."""
        # Act
        config = load_config()

        # Assert
        assert config['device'] == 0
        assert config['fps'] == 15
        assert config['mjpeg_port'] == 8081

    @patch.dict('os.environ', {}, clear=True)
    def test_merges_config_from_file(self):
        """load_config() merges camera config from components.json."""
        # Arrange
        file_config = {
            'camera': {
                'enabled': True,
                'device': 2,
                'resolution': [1280, 720],
                'fps': 30,
                'jpeg_quality': 90,
                'mjpeg_port': 9090,
                'processors': {'face_detector': {'enabled': True}}
            }
        }

        with patch('builtins.open', mock_open(read_data=json.dumps(file_config))):
            # Act
            config = load_config()

        # Assert
        assert config['device'] == 2
        assert config['resolution'] == [1280, 720]
        assert config['fps'] == 30
        assert config['jpeg_quality'] == 90
        assert config['mjpeg_port'] == 9090
        assert config['processors'] == {'face_detector': {'enabled': True}}

    @patch.dict('os.environ', {}, clear=True)
    def test_exits_when_camera_disabled(self):
        """load_config() calls sys.exit(0) when camera is disabled in config."""
        # Arrange
        file_config = {
            'camera': {
                'enabled': False
            }
        }

        with patch('builtins.open', mock_open(read_data=json.dumps(file_config))):
            # Act & Assert
            with pytest.raises(SystemExit) as exc_info:
                load_config()
            assert exc_info.value.code == 0

    @patch.dict('os.environ', {'CAMERA_CONFIG': '/custom/path/config.json'})
    @patch('builtins.open', side_effect=FileNotFoundError)
    def test_reads_from_camera_config_env(self, mock_file):
        """load_config() reads config path from CAMERA_CONFIG env var."""
        # Act
        load_config()

        # Assert
        mock_file.assert_called_once_with('/custom/path/config.json', 'r')
