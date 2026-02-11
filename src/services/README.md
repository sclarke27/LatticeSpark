# CrowPi3 Services Architecture

Five microservices managed by PM2 in production. All services auto-restart with exponential backoff.

## Architecture

```
┌─────────────────┐
│  Web Browser    │
│  (Port 8080)    │
└────────┬────────┘
         │ HTTP / WebSocket
         v
┌─────────────────┐
│  Web Server     │  ← Proxy + static files (no business logic)
│  (Port 8080)    │
└──┬──────┬───┬───┘
   │      │   │
   │      │   └─────────────────────┐
   │      │                         │
   │ /api/sensors/*      /api/history/*    /api/modules/*
   v                     v                 v
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│Sensor Service│─▶│Storage       │  │Module Service │
│ (Port 3000)  │  │Service       │  │ (Port 3002)  │
│              │  │ (Port 3001)  │  │              │
│ Coordinator  │  │ SQLite DB    │  │ Module loader │
│ Polling      │  │ Retention    │  │ REST + WS    │
│ WebSocket    │  │ Historical   │  │ State mgmt   │
│ Camera proxy │  │ Aggregation  │  │              │
└──────┬───────┘  └──────────────┘  └──────────────┘
       │
       v
┌──────────────┐   ┌──────────────┐
│Hardware Mgr  │   │Camera Service│
│  (Python)    │   │ (Port 8081)  │
│  JSON-RPC    │   │ Python       │
│  Drivers     │   │ MJPEG + ML   │
└──────────────┘   └──────────────┘
```

## Services

### Sensor Service (Port 3000)

Real-time sensor management and the main hub for hardware access.

**Endpoints:**
- `GET /api/sensors` — List all registered sensors
- `GET /api/sensors/:id/read` — Read current value
- `GET /health` — Service health check

**WebSocket events (server to client):**
- `sensors` — List of available sensors
- `sensor:data` — Real-time sensor reading
- `sensor:error` — Sensor error
- `sensor:batch` — Batch of readings (used by module-service)

**WebSocket events (client to server):**
- `component:write` — Write data to an output component

**Polling rates:**
- `distance`, `motion`, `proximity`: 100ms
- All others: 5000ms
- Storage pushes throttled to every 2s per sensor

### Storage Service (Port 3001)

SQLite time-series storage with automatic cleanup.

**Endpoints:**
- `POST /api/data` — Store sensor reading (from sensor-service)
- `GET /api/history/:sensorId` — Query historical data (`?metric=&start=&end=&limit=`)
- `GET /api/sensors` — List sensors with stored data
- `GET /api/sensors/:sensorId/metrics` — Available metrics for a sensor
- `GET /health` — Service health and stats

**Configuration:**
- `STORAGE_SERVICE_PORT` (default: 3001)
- `DB_PATH` (default: `data/sensors.db`)
- `RETENTION_HOURS` (default: 24)

### Module Service (Port 3002)

Manages the lifecycle of user modules. Connects to sensor-service via Socket.IO to receive sensor data and relay write commands.

**REST endpoints:**
- `GET /api/modules` — List all modules and their status
- `POST /api/modules/:id/enable` — Enable and start a module
- `POST /api/modules/:id/disable` — Stop and disable a module
- `POST /api/modules/:id/restart` — Restart a module

**Socket.IO namespace (`/modules-io`):**
- `module:state` — Module pushes state to UI pages
- `module:command` — UI page sends command to module

### Camera Service (Port 8081)

Standalone Python service for USB camera capture, MJPEG streaming, and ML-based detection (face, motion).

**Endpoints:**
- `GET /stream` — MJPEG video stream
- `GET /snapshot` — Single JPEG frame
- `GET /health` — Service health
- `GET /events` — SSE stream of detection events
- `POST /processors/:name/enable` — Enable an ML processor
- `POST /processors/:name/disable` — Disable an ML processor

Camera POST endpoints require `X-API-Key` header when `CROWPI_API_KEY` is set.

### Web Server (Port 8080)

Serves Vite-built static files and proxies API/WebSocket requests to backend services.

**Proxy rules:**
- `/api/sensors/*` → Sensor Service (3000)
- `/api/history/*`, `/api/data` → Storage Service (3001)
- `/api/modules/*` → Module Service (3002)
- `/api/camera/*` → Camera Service (8081)
- WebSocket → Sensor Service (3000)
- `/modules-io` → Module Service (3002)

**Special endpoints:**
- `GET /api/config` — Returns API key for dashboard authentication

## Data Flow

### Real-Time Updates

1. Sensor Service polls sensor at configured interval
2. Sensor Service broadcasts `sensor:data` via WebSocket
3. Sensor Service POSTs reading to Storage Service
4. Storage Service stores in SQLite
5. Web UI receives real-time update via WebSocket

### Module Interaction

1. Module Service connects to Sensor Service WebSocket
2. Sensor data forwarded to running modules via `ModuleContext`
3. Modules call `this.ctx.write()` which emits `component:write` to sensor-service
4. Sensor Coordinator routes write to Hardware Manager via JSON-RPC
5. Module pushes state to UI via `emitState()` over Socket.IO

### Historical Queries

1. Web UI requests `/api/history/:sensorId?metric=&start=&end=`
2. Web Server proxies to Storage Service
3. Storage Service queries SQLite
4. Returns time-series data for chart rendering

## Running

```bash
# Production (PM2)
pnpm run services          # Build web + start all
pnpm run services:stop     # Stop all
pnpm run services:restart  # Restart all
pnpm run services:logs     # Tail logs
pnpm run services:status   # Process status

# Development
pnpm run services:dev      # Services + Vite HMR
pnpm run services:dev:all  # Services + pre-built web

# Individual services
pnpm run sensor-service
pnpm run storage-service
pnpm run module-service
pnpm run camera-service
pnpm run web:server
```

## Configuration Files

- [config/components.json](../../config/components.json) — Sensor and actuator configuration
- [ecosystem.config.cjs](../../ecosystem.config.cjs) — PM2 process configuration

## Troubleshooting

**Services won't start**: Check ports 3000, 3001, 3002, 8080, 8081 are available.

**WebSocket not connecting**: Ensure sensor-service is running on port 3000.

**No historical data**: Check storage-service logs. Verify `data/` directory is writable.

**Modules not loading**: Check module-service logs. Ensure `module.json` is valid JSON and module ID is kebab-case with a hyphen.

**Camera not working**: Camera-service is a slow-starting Python process. Give it 10-15 seconds after PM2 start. Check `pm2 logs camera-service`.
