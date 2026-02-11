"""
Face Detector - Haar cascade face detection.

Lightweight, no external model files needed — uses OpenCV's bundled
Haar cascade XML. Good for real-time on Pi hardware.
"""

import cv2

from processors.base_processor import BaseProcessor


class FaceDetector(BaseProcessor):
    name = 'face_detector'
    description = 'Haar cascade face detection'

    def __init__(self):
        super().__init__()
        self._cascade = None
        self._scale_factor = 1.3
        self._min_neighbors = 5
        self._min_size = (30, 30)
        self._color = (0, 255, 0)  # Green bounding boxes
        self._thickness = 2

    def initialize(self, config):
        super().initialize(config)
        self._scale_factor = config.get('scale_factor', 1.3)
        self._min_neighbors = config.get('min_neighbors', 5)
        min_size = config.get('min_size', 30)
        self._min_size = (min_size, min_size)

        self._cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        )
        if self._cascade.empty():
            self.logger.error('Failed to load Haar cascade')
            self.enabled = False
        else:
            self.logger.info('Haar cascade loaded')

    def process(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self._cascade.detectMultiScale(
            gray,
            scaleFactor=self._scale_factor,
            minNeighbors=self._min_neighbors,
            minSize=self._min_size
        )

        detections = []
        for (x, y, w, h) in faces:
            cv2.rectangle(frame, (x, y), (x + w, y + h), self._color, self._thickness)
            cv2.putText(frame, 'Face', (x, y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, self._color, 1)
            detections.append({
                'type': 'face',
                'bbox': [int(x), int(y), int(w), int(h)]
            })

        return frame, detections
