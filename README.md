# CrowPi3 Framework

A general-purpose framework for interfacing with all CrowPi3 sensors and components using Node.js and Python on Raspberry Pi 5.

**23 on-board components + USB camera** implemented with a real-time web dashboard, extensible module system, and 24/7 production reliability via PM2.

---

## Quick Start

### Prerequisites

- Raspberry Pi 5 with CrowPi3
- Node.js 18+
- Python 3.7+
- pnpm (`npm install -g pnpm`)

### Install

```bash
# Clone and install
cd ~/crowpi3
pnpm install
pip3 install -r requirements.txt --break-system-packages
```

### Run

```bash
# Production (PM2 — recommended for 24/7 operation)
pnpm run services

# Development (with Vite HMR for web UI changes)
pnpm run services:dev

# Quick hardware test
pnpm run example:env
```

Open `http://<pi-ip>:8080` in a browser to see the dashboard.

---

## Services

Five services run together, managed by PM2 in production:

| Service | Port | What it does |
|---------|------|--------------|
| sensor-service | 3000 | Polls all sensors, broadcasts via WebSocket, REST API |
| storage-service | 3001 | SQLite time-series storage with 24-hour retention |
| module-service | 3002 | Runs user modules, REST + Socket.IO (`/modules-io`) |
| camera-service | 8081 | Python MJPEG streaming + ML detection (standalone) |
| web-server | 8080 | Serves the dashboard, proxies API requests to services |

### Production Commands

```bash
pnpm run services          # Build web + start all via PM2
pnpm run services:stop     # Stop all
pnpm run services:restart  # Restart all
pnpm run services:logs     # Tail logs
pnpm run services:status   # Process status
```

### First-Time PM2 Setup

PM2 is a project dependency (installed via `pnpm install`). Set up log rotation once:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Architecture

```
Web Browser (port 8080)
    |
    | HTTP / WebSocket
    v
Web Server ──proxy──> Storage Service (port 3001, SQLite)
    |
    v
Sensor Service (port 3000)
    |
    v
Sensor Coordinator (component lifecycle, polling, events)
    |
    | JSON-RPC over stdin/stdout
    v
Hardware Manager (single Python process)
    |
    v
Auto-discovered Drivers (GPIO / I2C / SPI)
    |
    v
Hardware

Parallel services:
  Module Service (port 3002) ── auto-discovered from modules/
  Camera Service (port 8081) ── standalone Python, MJPEG + ML
```

**Key design decisions:**
- **Single Python process** for all hardware — efficient I2C bus sharing
- **Configuration-driven** — add components via `config/components.json`
- **Auto-discovery** for drivers and modules — zero registration edits needed
- **Testable without hardware** — mocked drivers, 80%+ coverage target
- **24/7 reliable** — PM2, circuit breakers, exponential backoff, health checks

---

## Components

### Implemented (23 + Camera)

| Component | Type | Interface |
|-----------|------|-----------|
| Temperature & Humidity | AHT10 | I2C 0x38 |
| Distance Sensor | Ultrasonic | GPIO 16/26 |
| Light Sensor | BH1750 | I2C 0x5c |
| Hall Effect Sensor | Hall | GPIO 12 |
| Tilt Sensor | Tilt | GPIO 22 |
| Motion Sensor | PIR | GPIO 23 |
| IR Receiver | IR | GPIO 20 |
| Rotary Encoder | Encoder | I2C 0x3c (TCA9534) |
| Touch Sensor | Touch | GPIO 17 |
| RFID Reader | RFID | SPI |
| IMU (Accel + Gyro) | LSM6DSL | I2C 0x6b |
| RGB LED Strip (6x) | WS2812B | GPIO 10 (SPI) |
| LCD Display | LCD1602 | I2C 0x21 |
| Vibration Motor | Vibration | GPIO 27 |
| Flame Detector | Flame | GPIO 4 |
| Sound Sensor | Sound | GPIO 24 |
| 7-Segment Display | SevenSegment | I2C 0x70 (HT16K33) |
| Active Buzzer | Buzzer | GPIO 18 |
| 8x8 RGB LED Matrix | LEDMatrix | GPIO 10 (SPI) |
| Servo Motor | SG90 | GPIO 19 (PWM) |
| Relay | Relay | GPIO 21 |
| Stepper Motor | 28BYJ-48 | GPIO 5/6/13/25 |
| USB Camera | Camera | USB (port 8081) |

### Blocked (2)

| Component | Notes |
|-----------|-------|
| 4-Button Panel | SPI ADC — Pi 5 CE1 incompatible |
| Joystick | SPI ADC — Pi 5 CE1 incompatible |

---

## Module System

Modules add custom automation and UI pages without modifying the core framework. They are auto-discovered from the `modules/` directory.

### Installed Modules

| Module | Description | UI Page |
|--------|-------------|---------|
| hello-world | Example — logs temperature, writes to LCD | Yes |
| segment-clock | 12-hour clock on 7-segment display | No |
| camera-view | Live camera feed with ML processor controls | Yes |

### Creating a Module

A module needs at minimum two files in `modules/<module-id>/`:

1. **`module.json`** — config (name, components, triggers, UI flag)
2. **`<module-id>.module.js`** — logic (extends `BaseModule`)
3. *(optional)* **`ui/<module-id>-page.js`** — UI page (extends `BaseModulePage`)

After creating your files:
```bash
pnpm run generate:modules && pnpm run web:build
pnpm run services:restart   # or restart module-service
```

Module ID must be kebab-case with at least one hyphen (e.g., `my-module`).

See `modules/hello-world/` for a complete working example, or the [Module Guide](MODULE_GUIDE.md) for a full walkthrough.

### Module API

Modules extend `BaseModule` and access hardware through `this.ctx`:

| Method | Purpose |
|--------|---------|
| `read(componentId)` | Get latest cached sensor data |
| `await write(componentId, data)` | Write to actuator (3 retries with backoff) |
| `onData(componentId, callback)` | Subscribe to real-time sensor updates |
| `await getState()` / `await setState(obj)` | Persist state across restarts |
| `emitState(obj)` | Push state to UI page via Socket.IO |
| `log(msg)` / `warn(msg)` / `error(msg)` | Prefixed logging |

### Module REST API (port 3002)

```
GET  /api/modules              # List all modules + status
POST /api/modules/<id>/enable  # Enable and start
POST /api/modules/<id>/disable # Stop and disable
POST /api/modules/<id>/restart # Stop then start
```

---

## Web Dashboard

The dashboard shows all sensor and output component cards in a responsive grid. Output components (LCD, LED strip, buzzer, servo, stepper, etc.) have interactive controls. Module pages appear as tabs alongside the dashboard.

### Themes

Three themes with a token-driven architecture (~130 CSS custom properties per theme). Adding a new theme requires 3 new files and 2 one-line edits — zero card files touched.

| Theme | Style |
|-------|-------|
| Default | Dark modern |
| Commodore | Retro C64 inspired |
| Game Boy | Classic handheld green |

---

## Authentication

Optional shared API key via `CROWPI_API_KEY` environment variable. No key = dev mode (auth skipped).

```bash
export CROWPI_API_KEY="your-secret-key-here"
pnpm run services
```

Protects: Socket.IO connections, camera POST endpoints, web proxy to internal services. The dashboard auto-fetches the key from the web server's `/api/config` endpoint.

---

## Remote Development

Edit on your desktop, sync to Pi:

```bash
# Linux/macOS
./sync.sh                     # Uses default Pi IP
./sync.sh pi@192.168.1.100    # Specify Pi

# Windows PowerShell
.\sync.ps1
.\sync.ps1 pi@192.168.1.100
```

Edit `PI_HOST` in the sync script to set your default Pi address.

---

## Project Structure

```
crowpi3/
├── src/
│   ├── services/                 # sensor-service, storage-service, module-service
│   ├── coordinator/              # Component lifecycle + event routing
│   ├── hardware-manager/         # Python hardware layer
│   │   └── drivers/              # Auto-discovered Python drivers
│   ├── hardware-manager-client/  # Node.js <-> Python JSON-RPC bridge
│   ├── camera-service/           # Standalone Python camera server
│   │   └── processors/           # ML processors (face, motion)
│   └── modules/                  # BaseModule, ModuleContext, module loader
├── modules/
│   ├── hello-world/              # Example module (template)
│   ├── segment-clock/            # 7-segment clock module
│   └── camera-view/              # Camera feed module
├── web/
│   └── src/
│       ├── styles/themes/        # Theme token files (SCSS)
│       └── components/           # LitElement cards + dashboard
├── config/
│   └── components.json           # Component configuration
├── examples/                     # Standalone example scripts (23 scripts)
├── test/                         # Unit tests (no hardware needed)
├── rules/                        # Coding rules (for contributors)
├── patterns/                     # Golden code examples
├── anti-patterns/                # Common mistakes to avoid
├── data/                         # SQLite DB + module state (runtime)
├── logs/                         # PM2 log files (runtime)
├── ecosystem.config.cjs          # PM2 process configuration
├── package.json                  # Node.js project config
└── requirements.txt              # Python dependencies
```

---

## Testing

Tests run without CrowPi3 hardware — all hardware interactions are mocked.

```bash
pnpm test                 # Run all tests (Python + Node.js)
pnpm run test:py          # Python driver tests only
pnpm run test:js          # Node.js tests only
pnpm run test:watch       # Watch mode (JS)
pnpm run test:coverage    # Coverage report
```

To test with real hardware on the Pi:
```bash
pnpm run example:env      # Temperature/humidity example
pnpm run example:distance # Ultrasonic distance example
```

---

## Adding a New Component

Drivers are auto-discovered from `src/hardware-manager/drivers/` using a naming convention:

- Type `BH1750` &rarr; file `bh1750_driver.py` &rarr; class `BH1750Driver`

Steps:
1. Create `src/hardware-manager/drivers/<type>_driver.py` (extend `BaseDriver`)
2. Add entry to `config/components.json`
3. Create `examples/<name>.js` for standalone testing
4. Optionally create a web card in `web/src/components/`

No changes to `hardware-manager.py` needed — it auto-loads drivers via `importlib`.

---

## License

MIT
