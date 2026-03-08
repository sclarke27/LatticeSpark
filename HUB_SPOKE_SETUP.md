# Hub/Spoke Setup Guide

This guide shows how to run LatticeSpark as:
- one `hub` node (for example, your CrowPi3), and
- one or more `spoke` nodes (for example, Raspberry Pis with Arduino devices attached).

It covers relay/replay, spoke module control/deploy, and Arduino firmware deploy prerequisites.

If you want the fastest path for one CrowPi3 hub and one Arduino spoke, start with [Hub/Spoke Quick Start](HUB_SPOKE_QUICKSTART.md).

## 1. Prerequisites (Hub and Spokes)

- Node.js 18+
- Python 3.7+
- `pnpm` installed globally
- same LatticeSpark code version on all nodes
- network reachability from each spoke to hub on port `3010`

Install dependencies on each node:

```bash
cd ~/latticespark
pnpm install
pip3 install -r requirements.txt --break-system-packages
```

## 2. Pick Shared Secrets

Use one shared API key across the cluster.

- `LATTICESPARK_API_KEY`: required for hub/spoke auth
- `LATTICESPARK_ADMIN_TOKEN`: required for admin actions (recommended to set on hub)

If `LATTICESPARK_ADMIN_TOKEN` is not set, fleet admin endpoints fall back to `LATTICESPARK_API_KEY`.

## 3. Configure the Hub

Copy the hub template and edit:

```bash
cp config/cluster.json.example-hub config/cluster.json
cp config/components.json.example-hub config/components.json
```

Edit `config/cluster.json` — set `apiKey` to your shared secret:

```json
{
  "role": "hub",
  "nodeId": "hub-main",
  "hubUrl": "http://127.0.0.1:3010",
  "apiKey": "replace-with-shared-key",
  "spokeMode": "full",
  "replay": {
    "retentionHours": 72,
    "maxDiskMb": 1024
  }
}
```

Notes:
- `role` must be `hub`.
- `hubUrl` is not used by hub services directly; keep it local.
- Config files are gitignored — `git pull` will not overwrite your local configs.
- `config/cluster.json` is the default source of role/node/API key; env vars override only when explicitly set.
- For temporary no-auth mode during bring-up, set `"disableAuth": true` on hub and spokes.

## 4. Configure Each Spoke

Copy the spoke templates and edit:

```bash
cp config/cluster.json.example-spoke config/cluster.json
cp config/components.json.example-spoke config/components.json
cp config/arduino-sources.json.example config/arduino-sources.json
```

Edit `config/cluster.json` on each spoke with a unique `nodeId`:

```json
{
  "role": "spoke",
  "nodeId": "spoke-lab-1",
  "hubUrl": "http://<hub-ip>:3010",
  "apiKey": "replace-with-shared-key",
  "spokeMode": "full",
  "replay": {
    "retentionHours": 72,
    "maxDiskMb": 1024
  }
}
```

Notes:
- `nodeId` must be unique across all spokes.
- Hub will namespace spoke component IDs as `<nodeId>.<componentId>`.

## 5. Configure Arduino Sources on Spokes

Edit `config/arduino-sources.json` on each spoke (copied from `.example` in step 4).
This file is consumed by `sensor-service` (not `spoke-agent-service`).

- Enable one or more sources (`enabled: true`)
- Set correct serial `port` (example: `/dev/ttyACM0`)
- Define `channelMap` so Arduino fields map to local LatticeSpark `componentId`s

Example source skeleton:

```json
{
  "sources": [
    {
      "sourceId": "uno-main",
      "enabled": true,
      "port": "/dev/ttyACM0",
      "baud": 115200,
      "boardProfile": "uno",
      "mcu": "atmega328p",
      "programmer": "arduino",
      "channelMap": {
        "temperature": {
          "componentId": "arduino_temperature"
        }
      }
    }
  ]
}
```

Arduino line protocol expected by sensor-service:
- JSON line with `values` object, optional `ts`
- non-finite values are dropped

Example:

```json
{"ts":1739558400,"values":{"temperature":23.4,"humidity":55.1}}
```

## 6. Firmware Deploy Prereqs on Spokes

For phase-1 AVR flashing (`uno`, `nano`, `mega`):

- `avrdude` must be installed and in `PATH`
- `unzip` must be available
- spoke user must have permission to access Arduino serial device (`/dev/tty*`)

Quick checks:

```bash
avrdude -?
ls -l /dev/ttyACM0
```

## 7. Start Services

### Hub

From hub root:

```bash
export LATTICESPARK_ROLE=hub
export LATTICESPARK_API_KEY="replace-with-shared-key"
export LATTICESPARK_ADMIN_TOKEN="replace-with-admin-token"
pnpm run services
```

### Spoke

From each spoke root:

```bash
export LATTICESPARK_ROLE=spoke
export LATTICESPARK_NODE_ID="spoke-lab-1"
export LATTICESPARK_HUB_URL="http://<hub-ip>:3010"
export LATTICESPARK_API_KEY="replace-with-shared-key"
pnpm run services
```

Why `pnpm run services` on both:
- it starts the same PM2 ecosystem
- services self-disable by role when not applicable (`fleet-service` on spoke, `spoke-agent-service` on non-spoke)

## 8. Verify Cluster Health

On hub:

```bash
curl -H "X-API-Key: <shared-key>" http://localhost:3010/api/spokes
```

Expect connected spoke entries with:
- `nodeId`
- `connected: true`
- `queueDepth` and `replayAckSeq`

Check hub sensor list includes canonical spoke IDs:

```bash
curl -H "X-API-Key: <shared-key>" http://localhost:3000/api/sensors
```

Look for IDs like `spoke-lab-1.arduino_temperature`.

## 9. Spoke Module and Firmware Operations (from Hub)

Through fleet API (or web UI proxy via hub web server), you can:
- list spoke modules
- enable/disable/restart spoke modules
- upload/deploy module bundles
- upload/deploy firmware bundles
- poll firmware job status
- trigger rollback to previous known-good bundle on spoke

Firmware deploy is admin-only and serialized per spoke (one active firmware job per spoke).
For scripted flows, use `scripts/firmware-release.sh` and `scripts/firmware-rollback.sh`.

## 10. Multi-Spoke Scaling Notes

- Repeat spoke config with unique `nodeId` per device.
- Keep `hubUrl` and API key consistent across spokes.
- Increase replay disk cap if spokes can be offline for long periods with high sensor throughput.

## 11. Troubleshooting

- Spoke not appearing on hub:
  - verify `LATTICESPARK_ROLE=spoke`
  - verify `LATTICESPARK_HUB_URL` is reachable from spoke
  - verify shared API key matches hub
- No Arduino data from spoke:
  - check `enabled: true` in `config/arduino-sources.json`
  - verify serial `port` exists and permissions are correct
  - confirm Arduino emits JSON lines with `values`
  - check `sensor-service` logs on the spoke for serial parse/port errors
- Firmware deploy fails:
  - verify `avrdude` installed on spoke
  - verify manifest checksum matches `.hex`
  - verify target serial port and board parameters
