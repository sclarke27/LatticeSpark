"""
Motion Detector - Frame differencing motion detection.

Compares consecutive frames to detect movement regions.
Lightweight, no model files needed.
"""

import cv2
import numpy as np

from processors.base_processor import BaseProcessor


class MotionDetector(BaseProcessor):
    name = 'motion_detector'
    description = 'Frame differencing motion detection'

    def __init__(self):
        super().__init__()
        self._prev_gray = None
        self._threshold = 25
        self._min_area = 500
        self._color = (0, 0, 255)  # Red bounding boxes
        self._thickness = 2

    def initialize(self, config):
        super().initialize(config)
        self._threshold = config.get('threshold', 25)
        self._min_area = config.get('min_area', 500)
        self._prev_gray = None

    def process(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        # First frame — nothing to compare
        if self._prev_gray is None:
            self._prev_gray = gray
            return frame, []

        # Frame difference
        delta = cv2.absdiff(self._prev_gray, gray)
        self._prev_gray = gray

        thresh = cv2.threshold(delta, self._threshold, 255, cv2.THRESH_BINARY)[1]
        thresh = cv2.dilate(thresh, None, iterations=2)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detections = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < self._min_area:
                continue

            (x, y, w, h) = cv2.boundingRect(contour)
            cv2.rectangle(frame, (x, y), (x + w, y + h), self._color, self._thickness)
            cv2.putText(frame, 'Motion', (x, y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, self._color, 1)
            detections.append({
                'type': 'motion',
                'bbox': [int(x), int(y), int(w), int(h)],
                'area': int(area)
            })

        return frame, detections
