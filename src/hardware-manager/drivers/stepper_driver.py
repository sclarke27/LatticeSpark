#!/usr/bin/env python3
"""
Stepper Motor Driver

GPIO-based 28BYJ-48 stepper motor using gpiozero OutputDevice.
Uses 8-step half-stepping sequence via ULN2003 driver board.

A background thread executes step commands from a queue so
read()/write() never block the JSON-RPC pipeline.

Hardware:
- 28BYJ-48 stepper motor with ULN2003 driver on LatticeSpark
- Pin A: GPIO 5
- Pin B: GPIO 6
- Pin C: GPIO 13
- Pin D: GPIO 25

Specifications:
- 8-step half-stepping sequence
- 4096 half-steps per revolution (512 full cycles × 8 steps)
- ~1.1ms per half-step (~4.5s per revolution)
"""

from typing import Dict, Any, Optional, List
import queue
import time
import threading

try:
    from gpiozero import OutputDevice
except ImportError:
    OutputDevice = None

from .base_driver import BaseDriver


class StepperDriver(BaseDriver):
    """28BYJ-48 stepper motor driver with background stepping thread."""

    # 8-step half-stepping sequence [pin_a, pin_b, pin_c, pin_d]
    # Matches LatticeSpark example: D → D+C → C → B+C → B → A+B → A → A+D
    HALF_STEP_SEQ = [
        [0, 0, 0, 1],
        [0, 0, 1, 1],
        [0, 0, 1, 0],
        [0, 1, 1, 0],
        [0, 1, 0, 0],
        [1, 1, 0, 0],
        [1, 0, 0, 0],
        [1, 0, 0, 1],
    ]

    STEP_INTERVAL = 0.0011   # 1.1ms per half-step
    STEPS_PER_REV = 4096     # 512 full cycles × 8 half-steps = 4096 per revolution
    MIN_READ_INTERVAL = 0.05

    def __init__(self, component_id: str, config: Dict[str, Any]) -> None:
        super().__init__(component_id, config)

        if OutputDevice is None:
            raise ImportError(
                "gpiozero library not installed. "
                "Install with: pip3 install gpiozero"
            )

        self.validate_config(['pins'])
        for pin_name in ('pin_a', 'pin_b', 'pin_c', 'pin_d'):
            if pin_name not in self.config['pins']:
                raise ValueError(
                    f"Missing required config: pins.{pin_name} "
                    f"for {component_id}"
                )

        self._pin_nums: List[int] = [
            int(self.config['pins']['pin_a']),
            int(self.config['pins']['pin_b']),
            int(self.config['pins']['pin_c']),
            int(self.config['pins']['pin_d']),
        ]

        self._motors: List[Optional[OutputDevice]] = [None, None, None, None]
        self._position: int = 0
        self._stepping: int = 0
        self._direction: int = 0
        self._seq_index: int = 0
        self._state_lock = threading.Lock()  # protects _position, _stepping, _direction
        # Background thread
        self._running: bool = False
        self._step_thread: Optional[threading.Thread] = None
        self._command_queue: queue.Queue = queue.Queue(maxsize=100)
        self._stop_requested: bool = False
        self._thread_last_heartbeat: float = 0.0

    def initialize(self) -> None:
        if self._initialized:
            return

        try:
            # Create OutputDevice for each pin
            for i, pin in enumerate(self._pin_nums):
                self._motors[i] = OutputDevice(pin)

            # All pins off
            self._all_pins_off()

            # Test: 1 step forward, 1 step back
            self._do_single_step(1)
            self._do_single_step(-1)
            self._all_pins_off()

            # Start background stepping thread
            self._running = True
            self._step_thread = threading.Thread(
                target=self._step_loop,
                name=f"stepper-{self.component_id}",
                daemon=True
            )
            self._step_thread.start()

            self._initialized = True
            self.logger.info(
                f"Stepper motor initialized on GPIO "
                f"{self._pin_nums}"
            )

        except Exception as e:
            self._running = False
            self._cleanup_motors()
            raise RuntimeError(
                f"Failed to initialize stepper motor: {e}"
            ) from e

    def _do_single_step(self, direction: int) -> None:
        """Execute one half-step in the given direction (+1 or -1)."""
        if direction > 0:
            self._seq_index = (self._seq_index + 1) % 8
        else:
            self._seq_index = (self._seq_index - 1) % 8

        seq = self.HALF_STEP_SEQ[self._seq_index]
        for i, val in enumerate(seq):
            if val:
                self._motors[i].on()
            else:
                self._motors[i].off()

        time.sleep(self.STEP_INTERVAL)

    def _step_loop(self) -> None:
        """Background thread: process step commands from queue."""
        while self._running:
            try:
                cmd = self._command_queue.get(timeout=0.01)
            except queue.Empty:
                self._thread_last_heartbeat = time.time()
                continue

            steps = cmd.get('steps', 0)
            if steps == 0:
                continue

            direction = 1 if steps > 0 else -1
            self._stop_requested = False
            with self._state_lock:
                self._stepping = 1
                self._direction = direction

            step_count = 0
            for _ in range(abs(steps)):
                if not self._running or self._stop_requested:
                    self._stop_requested = False
                    break

                self._do_single_step(direction)
                with self._state_lock:
                    self._position += direction

                # Update heartbeat periodically during long moves
                step_count += 1
                if step_count % 500 == 0:
                    self._thread_last_heartbeat = time.time()

            self._all_pins_off()
            with self._state_lock:
                self._stepping = 0
                self._direction = 0
            self._thread_last_heartbeat = time.time()

    def read(self) -> Dict[str, Any]:
        self._assert_initialized()

        # Check background thread health
        if self._running and self._thread_last_heartbeat > 0:
            stale = time.time() - self._thread_last_heartbeat
            if stale > 5.0:
                self.logger.error(
                    f"Stepper step thread stale ({stale:.1f}s since last heartbeat)"
                )
                raise RuntimeError(
                    f"Stepper background thread appears dead "
                    f"(no heartbeat for {stale:.1f}s)"
                )

        current_time = self._throttle_read()

        with self._state_lock:
            position = self._position
            stepping = self._stepping
            direction = self._direction

        # Degrees wraps 0-360
        raw_pos = position % self.STEPS_PER_REV
        if raw_pos < 0:
            raw_pos += self.STEPS_PER_REV
        degrees = round(raw_pos / self.STEPS_PER_REV * 360.0, 1)

        return {
            'position': position,
            'degrees': degrees,
            'stepping': stepping,
            'direction': direction,
            'timestamp': current_time
        }

    def write(self, data: Dict[str, Any]) -> None:
        self._assert_initialized()

        if not isinstance(data, dict):
            raise ValueError("Write data must be a dict")

        if 'stop' in data:
            # Signal current move to stop and drain pending commands
            self._stop_requested = True
            self._drain_queue()
            return

        if 'home' in data:
            # Move back to position 0
            with self._state_lock:
                steps = -self._position
            if steps != 0:
                self._enqueue_steps(steps)
            return

        if 'degrees' in data:
            deg = float(data['degrees'])
            steps = int(round(deg / 360.0 * self.STEPS_PER_REV))
            if steps != 0:
                self._enqueue_steps(steps)
            return

        if 'steps' in data:
            steps = int(data['steps'])
            if steps != 0:
                self._enqueue_steps(steps)
            return

        if 'position' in data:
            # Reset position counter without moving
            with self._state_lock:
                self._position = int(data['position'])
            return

        raise ValueError(
            f"Unsupported write data for {self.component_id}. "
            "Supported keys: 'steps', 'degrees', 'home', 'stop', 'position'"
        )

    def _enqueue_steps(self, steps: int) -> None:
        """Enqueue a step command. Raises RuntimeError if queue is full."""
        try:
            self._command_queue.put_nowait({'steps': steps})
        except queue.Full:
            raise RuntimeError(
                f"Stepper command queue full (max {self._command_queue.maxsize}). "
                "Wait for current move to finish or send 'stop'."
            )

    def _drain_queue(self) -> None:
        """Remove all pending commands from the queue."""
        while not self._command_queue.empty():
            try:
                self._command_queue.get_nowait()
            except queue.Empty:
                break

    def _all_pins_off(self) -> None:
        for motor in self._motors:
            if motor is not None:
                motor.off()

    def _cleanup_motors(self) -> None:
        for i, motor in enumerate(self._motors):
            if motor is not None:
                try:
                    motor.off()
                except Exception:
                    pass
                try:
                    motor.close()
                except Exception:
                    pass
                self._motors[i] = None

    def cleanup(self) -> None:
        if not self._initialized:
            return

        # Stop background thread
        self._running = False
        if self._step_thread:
            self._step_thread.join(timeout=1.0)
            self._step_thread = None

        self._stop_requested = True
        self._drain_queue()
        self._all_pins_off()
        self._cleanup_motors()

        self._position = 0
        self._stepping = 0
        self._direction = 0
        self._seq_index = 0
        self._initialized = False
        self.logger.info(f"Stepper motor {self.component_id} cleaned up")
