# LatticeSpark Web Dashboard

Real-time web dashboard for monitoring and controlling all LatticeSpark sensors and actuators. Built with LitElement web components and Vite.

## Features

- Real-time sensor data via WebSocket
- Interactive controls for output components (LCD, LED strip, buzzer, servo, stepper, etc.)
- Responsive card grid layout
- 3 switchable themes (Default, Commodore, Game Boy)
- Module pages as tabs alongside the dashboard
- Historical data charts (Chart.js)

## Development

```bash
# Start Vite dev server with HMR + backend services
pnpm run services:dev

# Or start just the web dev server (requires services running separately)
pnpm run web:dev
```

Open `http://localhost:5173` for Vite HMR, or `http://localhost:8080` for the proxied version.

## Production

```bash
# Build for production
pnpm run web:build

# Serve built assets (part of pnpm run services)
pnpm run web:server
```

Production dashboard runs on `http://<pi-ip>:8080`.

## Project Structure

```
web/
├── src/
│   ├── components/
│   │   ├── latticespark-dashboard/    # Main dashboard shell, theme switching, card routing
│   │   ├── sensor-card/         # Generic sensor card (temperature, distance, light, etc.)
│   │   ├── buttons-card/        # 4-button panel card
│   │   ├── buzzer-card/         # Buzzer on/off control
│   │   ├── camera-card/         # Camera feed + ML processor controls
│   │   ├── lcd-card/            # LCD text input + backlight control
│   │   ├── matrix-card/         # 8x8 RGB LED matrix control
│   │   ├── pixelstrip-card/     # 6-LED RGB strip control
│   │   ├── relay-card/          # Relay on/off control
│   │   ├── segment-card/        # 7-segment display control
│   │   ├── servo-card/          # Servo angle slider
│   │   ├── stepper-card/        # Stepper motor step/degree/home controls
│   │   ├── vibration-card/      # Vibration motor on/off control
│   │   ├── modules-manager/     # Module enable/disable + module page tabs
│   │   └── shared/              # Base classes and SCSS mixins
│   │       ├── base-card.js         # Base class for all cards
│   │       ├── base-chart-card.js   # Base class for cards with charts
│   │       ├── base-module-page.js  # Base class for module UI pages
│   │       ├── metrics-config.js    # Metric display configuration
│   │       ├── _card-base.scss      # Shared card styles
│   │       └── _card-mixins.scss    # SCSS mixin library (~130 CSS tokens)
│   ├── styles/
│   │   ├── main.scss            # Main stylesheet (imports all themes)
│   │   └── themes/
│   │       ├── _default.scss    # Default dark theme
│   │       ├── _commodore.scss  # Retro C64 theme
│   │       ├── _gameboy.scss    # Classic handheld green theme
│   │       └── _light.scss      # Light theme (partial)
│   ├── main.js                  # Entry point
│   └── module-manifest.js       # Auto-generated module UI registry
├── index.html                   # HTML template
├── server-simple.js             # Express server (static + API proxy)
└── dist/                        # Build output (git ignored)
```

## Component Architecture

Each card component follows a 3-file pattern:

```
<name>-card/
├── <name>-card.js        # LitElement class (properties, logic)
├── <name>-card.view.js   # render() template (html`...`)
└── <name>-card.scss      # Scoped styles (uses shared mixins)
```

Cards extend `BaseCard` (or `BaseChartCard` for charts). The dashboard routes components to cards based on `component.type` for specific cards (e.g., LCD1602 -> lcd-card) and `component.category === 'output'` for generic output cards, falling back to `sensor-card` for everything else.

## Theme System

The theme system uses ~130 CSS custom properties (tokens) that pierce Shadow DOM:

```
[data-theme="commodore"] { --btn-primary-radius: 3px; }   <- global scope
    | pierces Shadow DOM
.toggle-btn { border-radius: var(--btn-primary-radius, 4px); }  <- inside card
```

The default theme uses mixin fallback values (no tokens needed). Retro themes override via `[data-theme]` selectors.

**Token categories:** Card structure, screen/display, buttons (primary/secondary/tertiary), tab bar, labels, display values, text inputs, range sliders, icons, chrome.

**Adding a new theme:** 3 new files + 2 one-line edits. See CLAUDE.md for steps.

## WebSocket Events

**Server -> Client:**
- `sensors` — List of registered sensors with config
- `sensor:data` — Single sensor reading `{ sensorId, data, timestamp }`
- `sensor:error` — Sensor read error

**Client -> Server:**
- `component:write` — Write to output component `{ componentId, data }`

**Module Socket.IO (`/modules-io`):**
- `module:state` — Module state pushed to UI pages
- `module:command` — UI page sends command to module

## Adding a New Card

1. Create directory `web/src/components/<name>-card/`
2. Create 3 files following the pattern above (see existing cards for examples)
3. Import and register in `latticespark-dashboard.js` card routing
4. Use shared mixins from `_card-mixins.scss` for consistent theming
