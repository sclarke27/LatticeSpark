"""
Base Processor - Abstract interface for ML frame processors.

All processors must subclass BaseProcessor and implement process().
Processors are auto-discovered from this directory by ProcessorPipeline.

Naming convention:
- File: face_detector.py, motion_detector.py, etc.
- Class: FaceDetector, MotionDetector, etc. (must subclass BaseProcessor)
"""

import logging


class BaseProcessor:
    """Abstract base class for frame processors."""

    # Subclasses MUST override these
    name = None          # Unique identifier (e.g., 'face_detector')
    description = ''     # Human-readable description

    def __init__(self):
        self.enabled = False
        self.logger = logging.getLogger(f'processor.{self.name}')

    def initialize(self, config):
        """
        Load models/resources. Called once at startup.

        Args:
            config: Dict from components.json processors section.
                    May contain 'enabled' key for default state.
        """
        self.enabled = config.get('enabled', False)

    def process(self, frame):
        """
        Process a frame. Return annotated frame + detection list.

        Args:
            frame: numpy array (BGR, from OpenCV)

        Returns:
            (annotated_frame, detections) where:
            - annotated_frame: numpy array with visual overlays drawn
            - detections: list of dicts, each with at minimum:
              {'type': str, 'bbox': [x, y, w, h]}
              Optional keys: 'confidence', 'label', etc.
        """
        raise NotImplementedError

    def cleanup(self):
        """Release resources. Called on shutdown."""
        pass
