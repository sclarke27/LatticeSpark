"""
Camera Manager - OpenCV capture with threaded frame buffer.

Manages USB camera lifecycle:
- Background capture thread reads frames continuously
- Thread-safe frame buffer provides latest JPEG on demand
- Configurable resolution, FPS, JPEG quality
- Graceful start/stop with camera reconnection
"""

import time
import queue
import logging
import threading

import cv2

from processor_pipeline import ProcessorPipeline

logger = logging.getLogger('camera-manager')


class CameraManager:
    """Manages OpenCV VideoCapture with a background capture thread."""

    def __init__(self, config):
        self.device = config.get('device', 0)
        self.resolution = config.get('resolution', [640, 480])
        self.target_fps = config.get('fps', 15)
        self.jpeg_quality = config.get('jpeg_quality', 80)

        self._cap = None
        self._frame = None           # Latest raw frame (numpy array)
        self._jpeg_bytes = None      # Latest JPEG-encoded frame
        self._lock = threading.Lock()
        self._running = False
        self._capture_thread = None
        self._actual_fps = 0.0
        self._camera_available = False

        # ML processor pipeline
        self._pipeline = ProcessorPipeline()
        self._on_detection = None    # Legacy callback (unused in standalone mode)
        self._detection_subscribers = []  # list of queue.Queue for SSE subscribers
        self._subscribers_lock = threading.Lock()

    @property
    def pipeline(self):
        return self._pipeline

    @property
    def is_running(self):
        return self._running

    @property
    def camera_available(self):
        return self._camera_available

    @property
    def actual_fps(self):
        return self._actual_fps

    def start(self):
        """Open camera and start capture thread."""
        if self._running:
            return

        self._cap = cv2.VideoCapture(self.device)
        if not self._cap.isOpened():
            logger.error(f'Failed to open camera device {self.device}')
            self._camera_available = False
            return

        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.resolution[0])
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.resolution[1])

        # Read actual resolution (camera may not support requested)
        actual_w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.resolution = [actual_w, actual_h]
        logger.info(f'Camera opened: {actual_w}x{actual_h} @ target {self.target_fps}fps')

        self._camera_available = True
        self._running = True
        self._capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._capture_thread.start()

    def _capture_loop(self):
        """Continuous capture → JPEG encode → buffer."""
        frame_interval = 1.0 / self.target_fps
        fps_counter = 0
        fps_start = time.monotonic()
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality]

        while self._running:
            loop_start = time.monotonic()

            ret, frame = self._cap.read()
            if not ret:
                logger.warning('Camera read failed, retrying...')
                time.sleep(0.5)
                # Try to reopen
                self._cap.release()
                self._cap = cv2.VideoCapture(self.device)
                if not self._cap.isOpened():
                    self._camera_available = False
                    time.sleep(1.0)
                else:
                    # Re-apply resolution after camera reopen
                    self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.resolution[0])
                    self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.resolution[1])
                continue

            self._camera_available = True

            # Run ML processors (produces annotated frame + detections)
            annotated, detections = self._pipeline.process(frame)

            # JPEG encode the annotated frame
            ok, jpeg = cv2.imencode('.jpg', annotated, encode_params)
            if ok:
                jpeg_bytes = jpeg.tobytes()
                with self._lock:
                    self._frame = frame
                    self._jpeg_bytes = jpeg_bytes

            # Emit detection events to all subscribers
            if detections:
                event = {
                    'detections': detections,
                    'count': len(detections),
                    'timestamp': time.time()
                }
                with self._subscribers_lock:
                    for sub_queue in self._detection_subscribers:
                        try:
                            sub_queue.put_nowait(event)
                        except queue.Full:
                            pass  # Drop if subscriber can't keep up

            # FPS tracking
            fps_counter += 1
            elapsed = time.monotonic() - fps_start
            if elapsed >= 1.0:
                self._actual_fps = round(fps_counter / elapsed, 1)
                fps_counter = 0
                fps_start = time.monotonic()

            # Throttle to target FPS
            loop_elapsed = time.monotonic() - loop_start
            sleep_time = frame_interval - loop_elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    def get_jpeg(self):
        """Get latest frame as JPEG bytes. Returns None if no frame."""
        with self._lock:
            return self._jpeg_bytes

    def get_frame(self):
        """Get latest raw frame (numpy array). Returns None if no frame."""
        with self._lock:
            return self._frame.copy() if self._frame is not None else None

    def get_status(self):
        """Return current camera status dict."""
        return {
            'streaming': self._running,
            'camera_available': self._camera_available,
            'fps': self._actual_fps,
            'resolution': self.resolution,
            'device': self.device
        }

    def subscribe_detections(self, maxsize=100):
        """Create a detection queue for an SSE subscriber. Returns the queue."""
        q = queue.Queue(maxsize=maxsize)
        with self._subscribers_lock:
            self._detection_subscribers.append(q)
        return q

    def unsubscribe_detections(self, q):
        """Remove a detection subscriber queue."""
        with self._subscribers_lock:
            try:
                self._detection_subscribers.remove(q)
            except ValueError:
                pass

    def stop(self):
        """Stop capture thread and release camera."""
        self._running = False
        if self._capture_thread:
            self._capture_thread.join(timeout=3)
            self._capture_thread = None
        if self._cap:
            self._cap.release()
            self._cap = None
        self._pipeline.cleanup()
        self._camera_available = False
        logger.info('Camera stopped')
