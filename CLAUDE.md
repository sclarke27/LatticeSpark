# LatticeSpark Framework - AI Coding Rules

> Before writing any code, read the relevant rules and patterns listed below.

---

## Rules (MUST follow)

* Be concise. Don't over-analyze. Don't take cheap shortcuts but also don't spend a ton of time going off on tangents instead of solving the core problem.
* Don't make assumptions. Ask clarifying questions, one at a time in order to find the best solution.
* Be sure to discuss code changes with the user before making edits.
* No drive-by coding. Do not make unrelated edits in the code when making changes.
* Always keep the project's overall architecture in mind when planning code changes.

Read these before writing code:

| Topic | File | Key Points |
|-------|------|------------|
| **Async/Await** | [rules/javascript/async-await.md](rules/javascript/async-await.md) | Always async/await, never callbacks. Promise.all() for parallel. Timeouts on all I/O. |
| **Component Structure** | [rules/javascript/component-structure.md](rules/javascript/component-structure.md) | Extend EventEmitter. Private fields with #. Idempotent initialize()/destroy(). |
| **Python Drivers** | [rules/python/bridge-patterns.md](rules/python/bridge-patterns.md) | 100% type hints. Log to stderr, data to stdout. flush() after every print. |
| **Testing** | [rules/common/testing.md](rules/common/testing.md) | 80% coverage minimum. AAA pattern. Mock external deps. No shared state. |
| **Error Handling** | [rules/common/error-handling.md](rules/common/error-handling.md) | Circuit breaker for hardware. Retry with backoff. Never silent failures. |

## Anti-Patterns (NEVER do)

| Topic | File |
|-------|------|
| **Async Mistakes** | [anti-patterns/async-mistakes.md](anti-patterns/async-mistakes.md) |
| **Memory Leaks** | [anti-patterns/memory-leaks.md](anti-patterns/memory-leaks.md) |
| **Security Issues** | [anti-patterns/security-issues.md](anti-patterns/security-issues.md) |

## Patterns (copy from these)

| What | File | When to use |
|------|------|-------------|
| **Python driver** | [patterns/hardware-drivers/dht11-driver.py](patterns/hardware-drivers/dht11-driver.py) | Creating a new hardware driver |

---

## Working Architecture

```
examples/*.js          (user-facing scripts)
    |
sensor-service.js      (polling, WebSocket, REST API, port 3000)
    |
sensor-coordinator.js  (config loading, component lifecycle, events)
    |
hardware-manager-client.js  (spawns Python, JSON-RPC over stdin/stdout)
    |
hardware-manager.py    (auto-discovers drivers, command routing)
    |
drivers/*_driver.py    (auto-discovered via naming convention)

Parallel services:
  storage-service.js    (SQLite, port 3001)
  module-service.js     (module lifecycle, port 3002)
  camera-service.py     (MJPEG streaming, port 8081)
  web/server-simple.js  (static files + proxy, port 8080)
```

## All Components

| Component ID | Driver | Type | Address/Pins | Category |
|-------------|--------|------|-------------|----------|
| temperature_sensor | AHT10Driver | AHT10 | I2C 0x38 | environmental |
| distance_sensor | UltrasonicDriver | Ultrasonic | GPIO 16/26 | distance |
| light_sensor | BH1750Driver | BH1750 | I2C 0x5c | environmental |
| hall_sensor | HallDriver | Hall | GPIO 12 | proximity |
| tilt_sensor | TiltDriver | Tilt | GPIO 22 | proximity |
| motion_sensor | PIRDriver | PIR | GPIO 23 | motion |
| ir_receiver | IRDriver | IR | GPIO 20 | input |
| encoder | EncoderDriver | Encoder | I2C 0x3c (TCA9534) | input |
| touch_sensor | TouchDriver | Touch | GPIO 17 | proximity |
| rfid_reader | RFIDDriver | RFID | SPI 0/0 | input |
| imu_sensor | LSM6DSLDriver | LSM6DSL | I2C 0x6b | motion |
| pixelstrip | PixelStripDriver | PixelStrip | GPIO 10 (SPI) | output |
| lcd_display | LCD1602Driver | LCD1602 | I2C 0x21 | output |
| vibration_motor | VibrationDriver | Vibration | GPIO 27 | output |
| flame_detector | FlameDriver | Flame | GPIO 4 | environmental |
| sound_sensor | SoundDriver | Sound | GPIO 24 | environmental |
| segment_display | SevenSegmentDriver | SevenSegment | I2C 0x70 | output |
| buzzer | BuzzerDriver | Buzzer | GPIO 18 | output |
| led_matrix | LEDMatrixDriver | LEDMatrix | GPIO 10 (SPI) | output |
| servo | ServoDriver | Servo | GPIO 19 (PWM) | output |
| stepper_motor | StepperDriver | Stepper | GPIO 5/6/13/25 | output |
| relay | RelayDriver | Relay | GPIO 21 | output |
| camera | — | Camera | USB (port 8081) | vision |

Disabled: `button_panel` (SPI ADC, Pi 5 CE1 incompatible), `voltage_sensor` (same).

Config: [config/components.json](config/components.json)

## Adding a New Component

Drivers are **auto-discovered** from `src/hardware-manager/drivers/` using naming convention:
- Type `BH1750` -> file `bh1750_driver.py` -> class `BH1750Driver`

Steps:
1. Read [rules/python/bridge-patterns.md](rules/python/bridge-patterns.md)
2. Copy [patterns/hardware-drivers/dht11-driver.py](patterns/hardware-drivers/dht11-driver.py) as template
3. Create `src/hardware-manager/drivers/<name>_driver.py` (follow naming convention above)
4. Add entry to `config/components.json`
5. Create `examples/<name>.js`
6. If needed, create `web/src/components/<name>-card/` with `.js`, `.view.js`, `.scss`

No changes to `hardware-manager.py` are needed — it auto-loads drivers via `importlib`.

## Driver Base Classes

**BaseDriver** — subclass for I2C/custom sensors. Implement `initialize()`, `read()`, `cleanup()`.

**GPIOInputDriver** (`gpio_input.py`) — binary input sensors in ~5 lines:
```python
class HallDriver(GPIOInputDriver):
    OUTPUT_KEY = 'detected'  # key in read() dict
    ACTIVE_LOW = True        # raw 0 = active
```
Used by: hall, flame, tilt, pir, sound, touch.

**GPIOOutputDriver** (`gpio_output.py`) — binary output actuators in ~5 lines:
```python
class VibrationDriver(GPIOOutputDriver):
    STATE_KEY = 'vibrating'  # key in read()/write() dict
    ACTIVE_HIGH = True       # default; buzzer uses False
```
Used by: vibration, relay, buzzer.

## Web UI

| File | Purpose |
|------|---------|
| [web/src/components/latticespark-dashboard/](web/src/components/latticespark-dashboard/) | Main dashboard, theme chrome, card routing |
| [web/src/components/sensor-card/](web/src/components/sensor-card/) | Generic card (temperature, distance, etc.) |
| [web/src/components/shared/_card-base.scss](web/src/components/shared/_card-base.scss) | Shared card styles (token-driven) |
| [web/src/components/shared/_card-mixins.scss](web/src/components/shared/_card-mixins.scss) | SCSS mixin library for all cards |

## Theme System (Token-Driven)

**Architecture**: CSS custom properties (~130 tokens) defined per theme, consumed by SCSS mixins. Cards have zero theme-specific CSS — all visual differences come from token values.

**Current themes**: Default, Commodore, Game Boy

### Adding a New Theme

3 new files + 2 one-line edits. Zero card files touched.

1. Copy `web/src/styles/themes/_commodore.scss` to `_mytheme.scss`, change selector to `[data-theme="mytheme"]`, adjust token values
2. Create `web/src/components/latticespark-dashboard/_chrome-mytheme.scss` for dashboard shell styling
3. Add `@use 'themes/mytheme';` to `web/src/styles/main.scss`
4. Add entry to `web/src/components/latticespark-dashboard/theme-registry.js`
5. Add `@use 'chrome-mytheme';` to `web/src/components/latticespark-dashboard/latticespark-dashboard.scss`

## Module System

Modules auto-discovered from `modules/<id>/module.json` + `<id>.module.js`.

- **BaseModule** lifecycle: `initialize()`, `execute()`, `onSensorChange()`, `handleCommand()`, `cleanup()`
- **ModuleContext** (`this.ctx`): `read()`, `write()`, `onData()`, `getState()`, `setState()`, `emitState()`, `log()`
- **UI pages**: `modules/<id>/ui/<id>-page.js` (extends `BaseModulePage`)
- Module ID must be kebab-case with at least one hyphen

See [MODULE_GUIDE.md](MODULE_GUIDE.md) for a full walkthrough.

## Authentication

Shared API key via `LATTICESPARK_API_KEY` env var. No key = dev mode (no auth).

| Where | How |
|-------|-----|
| Socket.IO (sensor + module) | `io.use()` middleware checks `socket.handshake.auth.apiKey` |
| Camera POST endpoints | `X-API-Key` header |
| Web proxy | `proxyAuthHeaders()` injects `X-API-Key` on proxied REST |
| Dashboard | Fetches key from `GET /api/config`, passes in Socket.IO `auth` |

## Polling Rates

Configured in [src/services/sensor-service.js](src/services/sensor-service.js):
- `distance`, `motion`, `proximity` categories: 100ms (10Hz)
- All others: 5000ms (5s)
- Storage writes throttled to every 2s per sensor

## Testing

```bash
pnpm test                 # All tests (Python + Node.js)
pnpm run test:py          # Python driver tests
pnpm run test:js          # Node.js coordinator tests
pnpm run test:watch       # Watch mode (JS)
pnpm run test:coverage    # Coverage report
```

No hardware required — all tests use mocked drivers.
