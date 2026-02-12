#!/usr/bin/env python3
"""
Unit Tests for ProcessorPipeline

Tests the ProcessorPipeline class WITHOUT requiring actual ML models or
camera hardware. Uses mock processor classes to simulate the pipeline.

Run:
    pytest test/camera-service/test_processor_pipeline.py -v
"""

import pytest
import sys
import numpy as np
from pathlib import Path
from unittest.mock import MagicMock, patch

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'src' / 'camera-service'))

from processor_pipeline import ProcessorPipeline


# ---------------------------------------------------------------------------
# Mock processor classes
# ---------------------------------------------------------------------------

class MockProcessor:
    """A mock processor that returns a detection."""
    name = 'test_processor'
    description = 'A test processor'
    enabled = True

    def initialize(self, config):
        pass

    def process(self, frame):
        return frame, [{'type': 'test', 'confidence': 0.9}]

    def cleanup(self):
        pass


class MockDisabledProcessor:
    """A mock processor that starts disabled."""
    name = 'disabled_processor'
    description = 'A disabled processor'
    enabled = False

    def initialize(self, config):
        pass

    def process(self, frame):
        return frame, [{'type': 'disabled', 'confidence': 0.5}]

    def cleanup(self):
        pass


class MockFailingProcessor:
    """A mock processor that raises during process()."""
    name = 'failing_processor'
    description = 'A processor that fails'
    enabled = True

    def initialize(self, config):
        pass

    def process(self, frame):
        raise RuntimeError("Model inference failed")

    def cleanup(self):
        pass


class MockFailingCleanupProcessor:
    """A mock processor that raises during cleanup()."""
    name = 'failing_cleanup'
    description = 'Fails on cleanup'
    enabled = True

    def initialize(self, config):
        pass

    def process(self, frame):
        return frame, []

    def cleanup(self):
        raise RuntimeError("Cleanup error")


# ===========================================================================
# Constructor tests
# ===========================================================================

class TestProcessorPipelineConstructor:
    """Test ProcessorPipeline.__init__ sets up fields correctly."""

    def test_initializes_empty_processors(self):
        """Constructor initializes an empty processors dict."""
        # Arrange & Act
        pipeline = ProcessorPipeline()

        # Assert
        assert pipeline.processors == {}

    def test_initializes_lock(self):
        """Constructor creates a threading lock."""
        # Arrange & Act
        pipeline = ProcessorPipeline()

        # Assert
        assert pipeline._lock is not None


# ===========================================================================
# enable() tests
# ===========================================================================

class TestEnable:
    """Test ProcessorPipeline.enable() enables processors."""

    def test_enable_returns_true_for_existing_processor(self):
        """enable() returns True when the processor exists."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockDisabledProcessor()
        pipeline.processors['disabled_processor'] = proc

        # Act
        result = pipeline.enable('disabled_processor')

        # Assert
        assert result is True

    def test_enable_returns_false_for_unknown_processor(self):
        """enable() returns False when the processor does not exist."""
        # Arrange
        pipeline = ProcessorPipeline()

        # Act
        result = pipeline.enable('nonexistent')

        # Assert
        assert result is False

    def test_enable_sets_processor_enabled_true(self):
        """enable() sets processor.enabled to True."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockDisabledProcessor()
        assert proc.enabled is False
        pipeline.processors['disabled_processor'] = proc

        # Act
        pipeline.enable('disabled_processor')

        # Assert
        assert proc.enabled is True


# ===========================================================================
# disable() tests
# ===========================================================================

class TestDisable:
    """Test ProcessorPipeline.disable() disables processors."""

    def test_disable_returns_true_for_existing_processor(self):
        """disable() returns True when the processor exists."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockProcessor()
        pipeline.processors['test_processor'] = proc

        # Act
        result = pipeline.disable('test_processor')

        # Assert
        assert result is True

    def test_disable_returns_false_for_unknown_processor(self):
        """disable() returns False when the processor does not exist."""
        # Arrange
        pipeline = ProcessorPipeline()

        # Act
        result = pipeline.disable('nonexistent')

        # Assert
        assert result is False

    def test_disable_sets_processor_enabled_false(self):
        """disable() sets processor.enabled to False."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockProcessor()
        assert proc.enabled is True
        pipeline.processors['test_processor'] = proc

        # Act
        pipeline.disable('test_processor')

        # Assert
        assert proc.enabled is False


# ===========================================================================
# process() tests
# ===========================================================================

class TestProcess:
    """Test ProcessorPipeline.process() runs processors on frames."""

    def test_process_returns_original_frame_when_no_processors(self):
        """process() returns the original frame and empty detections when no processors exist."""
        # Arrange
        pipeline = ProcessorPipeline()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Act
        result_frame, detections = pipeline.process(frame)

        # Assert
        np.testing.assert_array_equal(result_frame, frame)
        assert detections == []

    def test_process_runs_enabled_processors(self):
        """process() runs all enabled processors and collects detections."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockProcessor()
        pipeline.processors['test_processor'] = proc
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Act
        result_frame, detections = pipeline.process(frame)

        # Assert
        assert len(detections) == 1
        assert detections[0]['type'] == 'test'
        assert detections[0]['confidence'] == 0.9

    def test_process_skips_disabled_processors(self):
        """process() skips processors where enabled is False."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockDisabledProcessor()
        pipeline.processors['disabled_processor'] = proc
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Act
        result_frame, detections = pipeline.process(frame)

        # Assert
        assert detections == []

    def test_process_handles_processor_errors_gracefully(self):
        """process() catches exceptions from failing processors and continues."""
        # Arrange
        pipeline = ProcessorPipeline()
        pipeline.processors['failing_processor'] = MockFailingProcessor()
        pipeline.processors['test_processor'] = MockProcessor()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Act — should not raise
        result_frame, detections = pipeline.process(frame)

        # Assert — only the working processor's detections should be present
        assert len(detections) == 1
        assert detections[0]['type'] == 'test'

    def test_process_tags_detections_with_processor_name(self):
        """process() adds 'processor' key to each detection dict."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc = MockProcessor()
        pipeline.processors['test_processor'] = proc
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

        # Act
        result_frame, detections = pipeline.process(frame)

        # Assert
        assert detections[0]['processor'] == 'test_processor'

    def test_process_copies_frame_before_processing(self):
        """process() works on a copy of the frame, not the original."""
        # Arrange
        pipeline = ProcessorPipeline()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        original_id = id(frame)

        # Act
        result_frame, _ = pipeline.process(frame)

        # Assert — result should be a different object from the input
        assert id(result_frame) != original_id


# ===========================================================================
# get_status() tests
# ===========================================================================

class TestGetStatus:
    """Test ProcessorPipeline.get_status() returns processor states."""

    def test_get_status_returns_enabled_states(self):
        """get_status() returns a dict mapping processor names to enabled booleans."""
        # Arrange
        pipeline = ProcessorPipeline()
        pipeline.processors['test_processor'] = MockProcessor()
        pipeline.processors['disabled_processor'] = MockDisabledProcessor()

        # Act
        status = pipeline.get_status()

        # Assert
        assert status == {
            'test_processor': True,
            'disabled_processor': False
        }

    def test_get_status_empty_when_no_processors(self):
        """get_status() returns empty dict when no processors are loaded."""
        # Arrange
        pipeline = ProcessorPipeline()

        # Act
        status = pipeline.get_status()

        # Assert
        assert status == {}


# ===========================================================================
# get_info() tests
# ===========================================================================

class TestGetInfo:
    """Test ProcessorPipeline.get_info() returns processor details."""

    def test_get_info_returns_processor_details(self):
        """get_info() returns list of dicts with name, description, and enabled."""
        # Arrange
        pipeline = ProcessorPipeline()
        pipeline.processors['test_processor'] = MockProcessor()
        pipeline.processors['disabled_processor'] = MockDisabledProcessor()

        # Act
        info = pipeline.get_info()

        # Assert
        assert len(info) == 2
        assert info[0] == {
            'name': 'test_processor',
            'description': 'A test processor',
            'enabled': True
        }
        assert info[1] == {
            'name': 'disabled_processor',
            'description': 'A disabled processor',
            'enabled': False
        }

    def test_get_info_empty_when_no_processors(self):
        """get_info() returns empty list when no processors are loaded."""
        # Arrange
        pipeline = ProcessorPipeline()

        # Act
        info = pipeline.get_info()

        # Assert
        assert info == []


# ===========================================================================
# cleanup() tests
# ===========================================================================

class TestCleanup:
    """Test ProcessorPipeline.cleanup() releases all processor resources."""

    def test_cleanup_cleans_up_all_processors_and_clears_dict(self):
        """cleanup() calls cleanup on each processor and clears the dict."""
        # Arrange
        pipeline = ProcessorPipeline()
        proc1 = MagicMock()
        proc1.name = 'proc1'
        proc1.enabled = True
        proc2 = MagicMock()
        proc2.name = 'proc2'
        proc2.enabled = True
        pipeline.processors['proc1'] = proc1
        pipeline.processors['proc2'] = proc2

        # Act
        pipeline.cleanup()

        # Assert
        proc1.cleanup.assert_called_once()
        proc2.cleanup.assert_called_once()
        assert pipeline.processors == {}

    def test_cleanup_handles_cleanup_errors_gracefully(self):
        """cleanup() continues even if a processor's cleanup raises."""
        # Arrange
        pipeline = ProcessorPipeline()
        pipeline.processors['failing_cleanup'] = MockFailingCleanupProcessor()
        good_proc = MagicMock()
        good_proc.name = 'good'
        good_proc.enabled = True
        pipeline.processors['good'] = good_proc

        # Act — should not raise
        pipeline.cleanup()

        # Assert — dict should still be cleared
        good_proc.cleanup.assert_called_once()
        assert pipeline.processors == {}

    def test_cleanup_noop_when_empty(self):
        """cleanup() does nothing when no processors are loaded."""
        # Arrange
        pipeline = ProcessorPipeline()

        # Act — should not raise
        pipeline.cleanup()

        # Assert
        assert pipeline.processors == {}
