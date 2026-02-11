"""
Processor Pipeline - Auto-discovers and orchestrates ML frame processors.

Auto-discovery follows the same pattern as hardware-manager driver discovery:
- Scans processors/ directory for Python files
- Skips __init__.py and base_processor.py
- Imports each module and finds BaseProcessor subclasses
- Registers them by their 'name' attribute
"""

import logging
import threading
import importlib
from pathlib import Path

from processors.base_processor import BaseProcessor

logger = logging.getLogger('processor-pipeline')

PROCESSORS_DIR = Path(__file__).parent / 'processors'


class ProcessorPipeline:
    """Discovers, manages, and runs ML processors on camera frames."""

    def __init__(self):
        self.processors = {}  # name -> processor instance
        self._lock = threading.Lock()  # protects enable/disable vs process()

    def discover_and_initialize(self, config):
        """
        Auto-discover processors and initialize with config.

        Args:
            config: Dict from components.json camera.processors section.
                    e.g. {'face_detector': {'enabled': true}, ...}
        """
        processor_config = config or {}

        # Discover processor classes
        discovered = self._discover_processors()

        for name, cls in discovered.items():
            try:
                instance = cls()
                proc_conf = processor_config.get(name, {})
                instance.initialize(proc_conf)
                self.processors[name] = instance
                logger.info(f'Processor loaded: {name} (enabled={instance.enabled})')
            except Exception as e:
                logger.error(f'Failed to load processor {name}: {e}')

    def _discover_processors(self):
        """Scan processors/ directory, import modules, find BaseProcessor subclasses."""
        discovered = {}

        if not PROCESSORS_DIR.is_dir():
            logger.warning(f'Processors directory not found: {PROCESSORS_DIR}')
            return discovered

        for filepath in sorted(PROCESSORS_DIR.glob('*.py')):
            # Skip __init__.py and base_processor.py
            if filepath.name.startswith('__') or filepath.name == 'base_processor.py':
                continue

            module_name = f'processors.{filepath.stem}'
            try:
                module = importlib.import_module(module_name)

                # Find all BaseProcessor subclasses in the module
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (isinstance(attr, type)
                            and issubclass(attr, BaseProcessor)
                            and attr is not BaseProcessor
                            and attr.name is not None):
                        discovered[attr.name] = attr
                        logger.debug(f'Discovered processor: {attr.name} from {filepath.name}')

            except Exception as e:
                logger.error(f'Failed to import {module_name}: {e}')

        return discovered

    def process(self, frame):
        """
        Run all enabled processors on a frame.

        Args:
            frame: numpy array (BGR)

        Returns:
            (annotated_frame, all_detections) where annotated_frame has
            overlays from all processors, and all_detections is a flat
            list of detection dicts tagged with 'processor' key.
        """
        annotated = frame.copy()
        all_detections = []

        for name, proc in self.processors.items():
            with self._lock:
                enabled = proc.enabled
            if not enabled:
                continue
            try:
                annotated, detections = proc.process(annotated)
                # Tag each detection with its source processor
                for d in detections:
                    d['processor'] = name
                all_detections.extend(detections)
            except Exception as e:
                logger.error(f'Processor {name} failed: {e}')

        return annotated, all_detections

    def enable(self, name):
        """Enable a processor by name. Returns True if found."""
        proc = self.processors.get(name)
        if proc:
            with self._lock:
                proc.enabled = True
            logger.info(f'Processor enabled: {name}')
            return True
        return False

    def disable(self, name):
        """Disable a processor by name. Returns True if found."""
        proc = self.processors.get(name)
        if proc:
            with self._lock:
                proc.enabled = False
            logger.info(f'Processor disabled: {name}')
            return True
        return False

    def get_status(self):
        """Return dict of processor_name -> enabled status."""
        return {name: proc.enabled for name, proc in self.processors.items()}

    def get_info(self):
        """Return list of processor info dicts."""
        return [
            {
                'name': name,
                'description': proc.description,
                'enabled': proc.enabled
            }
            for name, proc in self.processors.items()
        ]

    def cleanup(self):
        """Cleanup all processors."""
        for name, proc in self.processors.items():
            try:
                proc.cleanup()
            except Exception as e:
                logger.error(f'Processor {name} cleanup failed: {e}')
        self.processors.clear()
