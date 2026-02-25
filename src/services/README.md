# LatticeSpark Services Architecture

Core services are managed by PM2 in production, with optional federation services (`fleet-service`, `spoke-agent-service`) for hub/spoke mode.

## Architecture

```text
Web Browser (8080)
  -> Web Server (8080) [proxy + static]
    -> Sensor Service (3000)
    -> Storage Service (3001)
    -> Module Service (3002)
    -> Fleet Service (3010, hub only)
    -> Camera Service (8081)
```

## Services

### Sensor Service (Port 3000)

Real-time sensor management and the main hardware data hub.

Responsibilities:
- Polls configured components from `config/components.json`
- Reads Arduino serial JSON-lines from `config/arduino-sources.json`
- Broadcasts data via WebSocket (`sensor:data`, `sensor:batch`)
- Exposes REST reads
- Pushes readings to storage-service
- On hub role, merges relayed spoke data into canonical IDs

Endpoints:
- `GET /api/sensors`
- `GET /api/sensors/:id/read`
- `POST /api/components`
- `POST /api/arduino/sources/:sourceId/pause`
- `POST /api/arduino/sources/:sourceId/resume`
- `POST /api/relay/spokes/:nodeId/components` (hub)
- `POST /api/relay/spokes/:nodeId/batch` (hub)
- `POST /api/relay/spokes/:nodeId/offline` (hub)
- `GET /health`

WebSocket events (server -> client):
- `components`
- `sensor:data`
- `sensor:error`
- `sensor:batch`

WebSocket events (client -> server):
- `component:write`

Polling defaults:
- `distance`, `motion`, `proximity`: 100ms
- All others: 5000ms
- Storage pushes throttled to every 2s per component

Feature toggles:
- `LATTICESPARK_ENABLE_ARDUINO_INGEST` (default `true`)

### Storage Service (Port 3001)

SQLite time-series storage with automatic cleanup.

Endpoints:
- `POST /api/data`
- `GET /api/history/:sensorId`
- `GET /api/sensors`
- `GET /api/sensors/:sensorId/metrics`
- `GET /health`

Configuration:
- `STORAGE_SERVICE_PORT` (default: 3001)
- `DB_PATH` (default: `data/sensors.db`)
- `RETENTION_HOURS` (default: 24)

### Module Service (Port 3002)

Manages module lifecycle. Connects to sensor-service via Socket.IO to receive sensor data and relay writes.

REST endpoints:
- `GET /api/modules`
- `POST /api/modules/:id/enable`
- `POST /api/modules/:id/disable`
- `POST /api/modules/:id/restart`
- `POST /api/modules/rescan`

Socket.IO namespace (`/modules-io`):
- `module:state`
- `module:command`

### Camera Service (Port 8081)

Standalone Python service for USB camera capture, MJPEG stream, and optional ML processors.

Endpoints:
- `GET /stream`
- `GET /snapshot`
- `GET /health`
- `GET /events`
- `POST /processors/:name/enable`
- `POST /processors/:name/disable`

Camera POST endpoints require `X-API-Key` when `LATTICESPARK_API_KEY` is set.

### Web Server (Port 8080)

Serves built web assets and proxies API/WebSocket requests to backend services.

Proxy rules:
- `/api/sensors/*` -> sensor-service (3000)
- `/api/history/*`, `/api/data` -> storage-service (3001)
- `/api/modules/*` -> module-service (3002)
- `/api/camera/*` -> camera-service (8081)
- `/api/spokes/*`, `/api/module-bundles*`, `/api/firmware/*` -> fleet-service (3010)
- WebSocket -> sensor-service (3000)
- `/modules-io` -> module-service (3002)

Special endpoint:
- `GET /api/config`

## Federation Services

For full install/config steps, see [Hub/Spoke Setup Guide](../../HUB_SPOKE_SETUP.md).
For a minimal single-hub/single-spoke runbook, see [Hub/Spoke Quick Start](../../HUB_SPOKE_QUICKSTART.md).
For scripted firmware helpers, see `scripts/firmware-*.sh`.

### Fleet Service (Port 3010)

Hub-only control plane for connected spokes.

Endpoints:
- `GET /api/spokes`
- `GET /api/spokes/:nodeId/components`
- `GET /api/spokes/:nodeId/modules`
- `POST /api/spokes/:nodeId/modules/:moduleId/:action` (`enable|disable|restart`)
- `POST /api/module-bundles`
- `POST /api/spokes/:nodeId/modules/deploy`
- `POST /api/firmware/bundles`
- `GET /api/firmware/bundles`
- `POST /api/spokes/:nodeId/firmware/deploy`
- `GET /api/spokes/:nodeId/firmware/jobs/:jobId`
- `POST /api/spokes/:nodeId/firmware/rollback`

### Spoke Agent Service

Spoke-side process that:
- Relays local `sensor:batch` updates from sensor-service to fleet-service
- Maintains disk-backed replay queue
- Executes hub commands for remote writes
- Handles module bundle deploy and firmware deploy/rollback orchestration
- Does not ingest Arduino serial data directly

## Data Flow

### Real-time updates

1. Sensor-service polls local components and ingests local Arduino sources.
2. Sensor-service emits `sensor:data` and `sensor:batch` over WebSocket.
3. Sensor-service pushes readings to storage-service.
4. Storage-service persists readings in SQLite.
5. Web UI and module-service consume live updates.

### Module interaction

1. Module-service connects to sensor-service WebSocket.
2. Sensor data is forwarded to running modules via `ModuleContext`.
3. Modules call `this.ctx.write()`, which emits `component:write` to sensor-service.
4. Sensor coordinator routes write commands to hardware-manager.
5. Modules push UI state through `/modules-io`.

### Hub/spoke relay

1. Spoke sensor-service produces batches from both native components and Arduino mappings.
2. Spoke-agent relays those batches to fleet-service with sequence numbers.
3. Hub ACKs, spoke replays on reconnect.
4. Hub sensor-service stores relayed data under canonical IDs: `<nodeId>.<componentId>`.

### Firmware deploy coordination

1. Hub triggers firmware deploy through fleet-service.
2. Spoke-agent pauses target Arduino source in sensor-service.
3. Spoke-agent executes `avrdude` flash/verify.
4. Spoke-agent resumes sensor-service ingest and reports job status/logs.

## Running

```bash
# Production (PM2)
pnpm run services
pnpm run services:stop
pnpm run services:restart
pnpm run services:logs
pnpm run services:status

# Development
pnpm run services:dev
pnpm run services:dev:all

# Individual services
pnpm run sensor-service
pnpm run storage-service
pnpm run module-service
pnpm run fleet-service
pnpm run spoke-agent-service
pnpm run camera-service
pnpm run web:server
```

### PM2 Service Toggles

`ecosystem.config.cjs` supports env toggles (default `true`) to include/exclude services on startup:

- `LATTICESPARK_ENABLE_SENSOR_SERVICE`
- `LATTICESPARK_ENABLE_STORAGE_SERVICE`
- `LATTICESPARK_ENABLE_MODULE_SERVICE`
- `LATTICESPARK_ENABLE_CAMERA_SERVICE`
- `LATTICESPARK_ENABLE_WEB_SERVER`
- `LATTICESPARK_ENABLE_FLEET_SERVICE`
- `LATTICESPARK_ENABLE_SPOKE_AGENT_SERVICE`

Set any toggle to `false`/`0`/`off` to disable that process.

## Configuration Files

- [config/components.json](../../config/components.json) - Sensor and actuator configuration
- [config/cluster.json](../../config/cluster.json) - Hub/spoke role, node identity, replay limits
- [config/arduino-sources.json](../../config/arduino-sources.json) - Arduino source mapping consumed by sensor-service
- [ecosystem.config.cjs](../../ecosystem.config.cjs) - PM2 process configuration

## Troubleshooting

Services will not start:
- Check ports 3000, 3001, 3002, 3010, 8080, 8081.

WebSocket not connecting:
- Ensure sensor-service is running on port 3000.

No historical data:
- Check storage-service logs.
- Verify `data/` is writable.

No Arduino data:
- Check `config/arduino-sources.json` and `enabled: true`.
- Verify serial port exists and permissions are correct.
- Confirm Arduino emits JSON lines with `values`.
- Check sensor-service logs for parse/port warnings.

Modules not loading:
- Check module-service logs.
- Ensure `module.json` is valid and module ID is kebab-case with a hyphen.

Camera not working:
- camera-service can take 10-15 seconds after startup.
- Check `pm2 logs camera-service`.
