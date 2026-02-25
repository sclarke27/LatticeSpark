# Hub/Spoke Quick Start (CrowPi3 Hub + 1 Arduino Spoke)

This is the shortest path to a working cluster:
- Hub: CrowPi3
- Spoke: Raspberry Pi with Arduino on USB

## 1. Pick values

Use these example values and replace as needed:

- `HUB_IP=192.168.1.50`
- `API_KEY=change-me-shared-key`
- `ADMIN_TOKEN=change-me-admin-token`
- `SPOKE_NODE_ID=spoke-arduino-1`
- `ARDUINO_PORT=/dev/ttyACM0`

## 2. Install on both machines

On hub and spoke:

```bash
cd ~/latticespark
pnpm install
pip3 install -r requirements.txt --break-system-packages
```

## 3. Configure the hub (CrowPi3)

Create/update `config/cluster.json` on hub:

```json
{
  "role": "hub",
  "nodeId": "hub-crowpi3",
  "hubUrl": "http://127.0.0.1:3010",
  "apiKey": "change-me-shared-key",
  "spokeMode": "full",
  "replay": {
    "retentionHours": 72,
    "maxDiskMb": 1024
  }
}
```

Start hub services:

```bash
export LATTICESPARK_ROLE=hub
export LATTICESPARK_API_KEY="change-me-shared-key"
export LATTICESPARK_ADMIN_TOKEN="change-me-admin-token"
pnpm run services
```

## 4. Configure the spoke (Pi + Arduino)

Create/update `config/cluster.json` on spoke:

```json
{
  "role": "spoke",
  "nodeId": "spoke-arduino-1",
  "hubUrl": "http://192.168.1.50:3010",
  "apiKey": "change-me-shared-key",
  "spokeMode": "full",
  "replay": {
    "retentionHours": 72,
    "maxDiskMb": 1024
  }
}
```

Create/update `config/arduino-sources.json` on spoke:

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
          "componentId": "arduino_temperature",
          "label": "Arduino Temperature",
          "type": "ArduinoFloat",
          "category": "arduino"
        },
        "humidity": {
          "componentId": "arduino_humidity",
          "label": "Arduino Humidity",
          "type": "ArduinoFloat",
          "category": "arduino"
        }
      }
    }
  ]
}
```

`sensor-service` on the spoke ingests this serial data locally; `spoke-agent-service` relays the resulting sensor batches to the hub.

Optional firmware prereq check on spoke:

```bash
avrdude -?
ls -l /dev/ttyACM0
```

Start spoke services:

```bash
export LATTICESPARK_ROLE=spoke
export LATTICESPARK_NODE_ID="spoke-arduino-1"
export LATTICESPARK_HUB_URL="http://192.168.1.50:3010"
export LATTICESPARK_API_KEY="change-me-shared-key"
pnpm run services
```

## 5. Verify from hub

Check spoke connection:

```bash
curl -H "X-API-Key: change-me-shared-key" http://localhost:3010/api/spokes
```

Expected:
- one spoke with `"nodeId":"spoke-arduino-1"`
- `"connected":true`

Check canonical sensor IDs on hub:

```bash
curl -H "X-API-Key: change-me-shared-key" http://localhost:3000/api/sensors
```

Expected IDs include:
- `spoke-arduino-1.arduino_temperature`
- `spoke-arduino-1.arduino_humidity`

Open hub UI:

```text
http://<hub-ip>:8080
```

## 6. Update Arduino Firmware from the Hub (scripted path)

Run these on the hub machine.

### 6.1 One-time CLI prep (if not already installed)

```bash
arduino-cli core update-index
arduino-cli core install arduino:avr
```

### 6.2 One-command release (compile + package + upload + deploy)

```bash
cd ~/latticespark
HUB_URL="http://192.168.1.50:3010" \
API_KEY="change-me-shared-key" \
ADMIN_TOKEN="change-me-admin-token" \
NODE_ID="spoke-arduino-1" \
SOURCE_ID="uno-main" \
SKETCH_PATH="$HOME/arduino/my-sensor-sketch" \
FQBN="arduino:avr:uno" \
BOARD_PROFILE="uno" \
BUNDLE_ID="uno-main-firmware" \
VERSION="1.0.0" \
SIGNATURE="dev-signature-1.0.0" \
bash scripts/firmware-release.sh

# Same flow via package script alias:
# ...same env vars... pnpm run firmware:release
```

What this runs:
- `scripts/firmware-build.sh`
- `scripts/firmware-package.sh`
- `scripts/firmware-upload.sh`
- `scripts/firmware-deploy.sh` (waits for success/failure by default)

### 6.3 Roll back (if needed)

```bash
HUB_URL="http://192.168.1.50:3010" \
API_KEY="change-me-shared-key" \
ADMIN_TOKEN="change-me-admin-token" \
NODE_ID="spoke-arduino-1" \
SOURCE_ID="uno-main" \
bash scripts/firmware-rollback.sh
```

### 6.4 Optional: run step-by-step scripts manually

```bash
# 1) Build .hex
SKETCH_PATH="$HOME/arduino/my-sensor-sketch" FQBN="arduino:avr:uno" bash scripts/firmware-build.sh

# 2) Package bundle
HEX_PATH="data/firmware-build/firmware.hex" \
BUNDLE_ID="uno-main-firmware" VERSION="1.0.0" BOARD_PROFILE="uno" \
bash scripts/firmware-package.sh

# 3) Upload bundle
HUB_URL="http://192.168.1.50:3010" API_KEY="change-me-shared-key" ADMIN_TOKEN="change-me-admin-token" \
MANIFEST_PATH="data/firmware-work/uno-main-firmware-1.0.0/manifest.json" \
ZIP_PATH="data/firmware-work/uno-main-firmware-1.0.0/firmware-bundle.zip" \
bash scripts/firmware-upload.sh

# 4) Deploy to spoke (and wait)
HUB_URL="http://192.168.1.50:3010" API_KEY="change-me-shared-key" ADMIN_TOKEN="change-me-admin-token" \
NODE_ID="spoke-arduino-1" BUNDLE_ID="uno-main-firmware" VERSION="1.0.0" SOURCE_ID="uno-main" \
bash scripts/firmware-deploy.sh
```

## 7. Next operations from hub

- Module control/deploy per spoke: use hub UI Modules manager or Fleet API
- Firmware upload/deploy/rollback: use hub UI firmware panel or Fleet API

For full API and multi-spoke setup details, use `HUB_SPOKE_SETUP.md`.
