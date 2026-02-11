# Module Guide

This guide walks through creating a new CrowPi3 module from scratch. Modules add custom automation and optional UI pages without modifying the core framework.

---

## Overview

A module is a directory inside `modules/` with at minimum two files:

```
modules/my-module/
├── module.json              # Configuration (required)
├── my-module.module.js      # Logic (required)
└── ui/                      # UI page (optional)
    ├── my-module-page.js
    ├── my-module-page.view.js
    └── my-module-page.scss
```

Modules are auto-discovered — no code edits needed to register one.

**Module ID rules:** kebab-case with at least one hyphen (e.g., `my-module`, `led-alerts`).

---

## Step 1: module.json

This file declares what your module needs.

```json
{
  "name": "My Module",
  "description": "What this module does",
  "version": "1.0.0",
  "enabled": true,
  "components": {
    "read": ["temperature_sensor"],
    "write": ["lcd_display"]
  },
  "triggers": {
    "interval": 5000,
    "onChange": ["temperature_sensor"]
  },
  "ui": {
    "page": true,
    "label": "My Module"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `description` | Yes | Short description |
| `version` | Yes | Semver string |
| `enabled` | Yes | `true` to start on service launch |
| `components.read` | No | Component IDs to read from |
| `components.write` | No | Component IDs to write to |
| `triggers.interval` | No | Call `execute()` every N milliseconds |
| `triggers.onChange` | No | Call `onSensorChange()` when these components update |
| `ui.page` | No | `true` to show a tab in the dashboard |
| `ui.label` | No | Tab label text |

Component IDs come from `config/components.json` (e.g., `temperature_sensor`, `lcd_display`, `pixelstrip`, `buzzer`).

---

## Step 2: Module Logic

Create `my-module.module.js` — this file must `export default` a class extending `BaseModule`.

```javascript
import { BaseModule } from '../../src/modules/base-module.js';

export default class MyModule extends BaseModule {
  async initialize() {
    this.ctx.log('Module started');
  }

  async execute() {
    // Called on interval trigger
    const data = this.ctx.read('temperature_sensor');
    if (data) {
      this.ctx.log(`Temp: ${data.temperature}°C`);
    }
  }

  async onSensorChange(componentId, newData, prevData) {
    // Called when a watched sensor value changes
    if (componentId === 'temperature_sensor' && prevData) {
      const diff = newData.temperature - prevData.temperature;
      if (Math.abs(diff) >= 1.0) {
        this.ctx.log(`Temperature changed by ${diff.toFixed(1)}°C`);
      }
    }
  }

  async handleCommand(command, params) {
    // Called from UI page via sendCommand()
    if (command === 'set-threshold') {
      this.ctx.log(`Threshold set to ${params.value}`);
      await this.ctx.setState({ threshold: params.value });
      this.ctx.emitState({ threshold: params.value });
      return { success: true };
    }
    return { error: 'Unknown command' };
  }

  async cleanup() {
    this.ctx.log('Module stopped');
  }
}
```

### Lifecycle Methods

| Method | When called | Use for |
|--------|-------------|---------|
| `initialize()` | Once after construction | Setup, restore state, initial reads |
| `execute()` | On each interval tick | Periodic logic (polling, checks) |
| `onSensorChange(id, new, prev)` | When watched sensor updates | React to sensor changes |
| `handleCommand(cmd, params)` | From UI page | Handle user actions from the dashboard |
| `cleanup()` | On shutdown or disable | Turn off actuators, save state |

### ModuleContext API (`this.ctx`)

| Method | Returns | Description |
|--------|---------|-------------|
| `read(componentId)` | `Object \| null` | Latest cached sensor data (no I/O) |
| `await write(componentId, data)` | `{ success }` | Write to actuator (3 retries, backoff) |
| `onData(componentId, callback)` | `unsubscribe()` | Subscribe to real-time sensor updates |
| `await getState()` | `Object` | Load persisted state from disk |
| `await setState(obj)` | — | Save state to disk (survives restarts) |
| `emitState(obj)` | — | Push state to connected UI page |
| `log(msg)` | — | Log with `[module:id]` prefix |
| `warn(msg)` | — | Warning log |
| `error(msg)` | — | Error log |

**Writing to actuators:** The `data` object depends on the component. Examples:

```javascript
// LCD: two lines of 16 characters
await this.ctx.write('lcd_display', { line1: 'Hello', line2: 'World' });

// Buzzer: on/off
await this.ctx.write('buzzer', { active: 1 });

// Servo: angle in degrees
await this.ctx.write('servo', { angle: 90 });

// Vibration motor: on/off
await this.ctx.write('vibration_motor', { vibrating: 1 });

// RGB LED strip: set all LEDs
await this.ctx.write('pixelstrip', { r: 255, g: 0, b: 0 });

// Stepper motor: rotate
await this.ctx.write('stepper_motor', { degrees: 90 });

// 7-segment display
await this.ctx.write('segment_display', { value: '12:30', colon: true });
```

---

## Step 3: UI Page (Optional)

If `ui.page` is `true` in module.json, the dashboard shows a tab for your module. Create three files in `ui/`:

### my-module-page.js

```javascript
import { unsafeCSS } from 'lit';
import { BaseModulePage } from '../../../web/src/components/shared/base-module-page.js';
import { render } from './my-module-page.view.js';
import styles from './my-module-page.scss?inline';

export class MyModulePage extends BaseModulePage {
  static styles = unsafeCSS(styles);

  static properties = {
    ...BaseModulePage.properties,
    // Add custom reactive properties here
    inputValue: { type: String }
  };

  constructor() {
    super();
    this.inputValue = '';
  }

  doSomething() {
    this.sendCommand('set-threshold', { value: this.inputValue });
  }

  render() {
    return render(this);
  }
}

customElements.define('my-module-page', MyModulePage);
```

### my-module-page.view.js

```javascript
import { html } from 'lit';

export function render(el) {
  const temp = el.sensorData?.temperature_sensor;
  const threshold = el.moduleState?.threshold ?? '—';

  return html`
    <div class="page">
      <h2>My Module</h2>

      <div class="info-grid">
        <div class="info-card">
          <span class="label">Temperature</span>
          <span class="value">${temp?.temperature != null ? `${temp.temperature}°C` : '—'}</span>
        </div>
        <div class="info-card">
          <span class="label">Threshold</span>
          <span class="value">${threshold}</span>
        </div>
      </div>

      <div class="actions">
        <input type="text"
               .value=${el.inputValue}
               @input=${(e) => { el.inputValue = e.target.value; }}>
        <button @click=${() => el.doSomething()}>Set Threshold</button>
      </div>
    </div>
  `;
}
```

### my-module-page.scss

```scss
:host {
  display: block;
  padding: 1.5rem;
  color: var(--text-primary);
}

.page {
  max-width: 600px;
  margin: 0 auto;
}

h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 1.5rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.info-card {
  background: var(--bg-secondary, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.label {
  font-size: 0.75rem;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
}

.value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--accent, #4af);
}
```

### What BaseModulePage Provides

Your page class extends `BaseModulePage`, which gives you these properties (set automatically by the dashboard):

| Property | Type | Description |
|----------|------|-------------|
| `moduleId` | String | Your module's ID |
| `moduleState` | Object | Latest state from `ctx.emitState()` |
| `sensorData` | Object | All sensor readings (keyed by component ID) |
| `theme` | String | Current theme name |

And this method:

| Method | Description |
|--------|-------------|
| `sendCommand(command, params)` | Send a command to your module's `handleCommand()`. Returns a Promise. |

---

## Step 4: Build and Deploy

```bash
# Regenerate module manifest and rebuild web assets
pnpm run generate:modules && pnpm run web:build

# Restart services
pnpm run services:restart
```

Or in development:
```bash
pnpm run services:dev
```

Vite HMR will pick up UI changes automatically in dev mode. For module logic changes, restart the module-service.

### Module REST API

Control modules at runtime:

```bash
# List all modules
curl http://localhost:3002/api/modules

# Enable/disable
curl -X POST http://localhost:3002/api/modules/my-module/enable
curl -X POST http://localhost:3002/api/modules/my-module/disable

# Restart
curl -X POST http://localhost:3002/api/modules/my-module/restart
```

---

## Complete Example

The `modules/hello-world/` directory is a complete working module with:
- Interval-based temperature logging
- Sensor change detection
- LCD display writing via `handleCommand`
- UI page with sensor data display and interactive controls
- State management with `emitState()`

Use it as your starting template.

---

## Tips

- **Start simple.** A module with just `module.json` and a `.module.js` file that logs sensor data is a perfectly valid module.
- **Use `emitState()` to sync UI.** Call it whenever your module's state changes — the UI page re-renders automatically.
- **Persist important state.** Use `getState()`/`setState()` for anything that should survive a restart.
- **Clean up in `cleanup()`.** Turn off actuators and save state. The framework calls this on shutdown and when a module is disabled.
- **Check component IDs.** Use the IDs from `config/components.json`, not display labels.
