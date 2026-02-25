#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "${SCRIPT_DIR}/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  SKETCH_PATH=<path> FQBN=<fqbn> BOARD_PROFILE=<uno|nano|mega> BUNDLE_ID=<id> VERSION=<ver> NODE_ID=<node> \
    [SOURCE_ID=<source>] [SIGNATURE=<sig>] [HUB_URL=<url>] [API_KEY=<key>] [ADMIN_TOKEN=<token>] \
    [WAIT_FOR_JOB=1] [JOB_TIMEOUT_SEC=300] [POLL_INTERVAL_SEC=3] \
    bash scripts/firmware-release.sh

This script runs:
  1) firmware-build.sh
  2) firmware-package.sh
  3) firmware-upload.sh
  4) firmware-deploy.sh
EOF
}

SKETCH_PATH="${SKETCH_PATH:-}"
FQBN="${FQBN:-}"
BOARD_PROFILE="${BOARD_PROFILE:-}"
BUNDLE_ID="${BUNDLE_ID:-}"
VERSION="${VERSION:-}"
NODE_ID="${NODE_ID:-}"

[[ -n "$SKETCH_PATH" ]] || {
  usage
  die "SKETCH_PATH is required"
}
[[ -n "$FQBN" ]] || {
  usage
  die "FQBN is required"
}
[[ -n "$BOARD_PROFILE" ]] || {
  usage
  die "BOARD_PROFILE is required"
}
[[ -n "$BUNDLE_ID" ]] || {
  usage
  die "BUNDLE_ID is required"
}
[[ -n "$VERSION" ]] || {
  usage
  die "VERSION is required"
}
[[ -n "$NODE_ID" ]] || {
  usage
  die "NODE_ID is required"
}

WORK_ROOT="${WORK_ROOT:-data/firmware-work/${BUNDLE_ID}-${VERSION}}"
BUILD_DIR="${BUILD_DIR:-${WORK_ROOT}/build}"
OUT_HEX="${OUT_HEX:-${WORK_ROOT}/firmware.hex}"
OUT_DIR="${OUT_DIR:-${WORK_ROOT}/package}"
MANIFEST_PATH="${MANIFEST_PATH:-${OUT_DIR}/manifest.json}"
ZIP_PATH="${ZIP_PATH:-${OUT_DIR}/firmware-bundle.zip}"
INFO_PATH="${INFO_PATH:-${OUT_DIR}/artifact-info.env}"

mkdir -p "$WORK_ROOT"

log "Step 1/4: build"
SKETCH_PATH="$SKETCH_PATH" \
FQBN="$FQBN" \
BUILD_DIR="$BUILD_DIR" \
OUT_HEX="$OUT_HEX" \
bash "${SCRIPT_DIR}/firmware-build.sh"

log "Step 2/4: package"
HEX_PATH="$OUT_HEX" \
BUNDLE_ID="$BUNDLE_ID" \
VERSION="$VERSION" \
BOARD_PROFILE="$BOARD_PROFILE" \
MCU="${MCU:-}" \
PROGRAMMER="${PROGRAMMER:-}" \
BAUD="${BAUD:-}" \
SIGNATURE="${SIGNATURE:-unsigned}" \
OUT_DIR="$OUT_DIR" \
MANIFEST_PATH="$MANIFEST_PATH" \
ZIP_PATH="$ZIP_PATH" \
INFO_PATH="$INFO_PATH" \
bash "${SCRIPT_DIR}/firmware-package.sh"

log "Step 3/4: upload"
HUB_URL="${HUB_URL:-http://localhost:3010}" \
API_KEY="${API_KEY:-}" \
ADMIN_TOKEN="${ADMIN_TOKEN:-}" \
MANIFEST_PATH="$MANIFEST_PATH" \
ZIP_PATH="$ZIP_PATH" \
bash "${SCRIPT_DIR}/firmware-upload.sh"

log "Step 4/4: deploy"
HUB_URL="${HUB_URL:-http://localhost:3010}" \
API_KEY="${API_KEY:-}" \
ADMIN_TOKEN="${ADMIN_TOKEN:-}" \
NODE_ID="$NODE_ID" \
BUNDLE_ID="$BUNDLE_ID" \
VERSION="$VERSION" \
SOURCE_ID="${SOURCE_ID:-}" \
SERIAL_PORT="${SERIAL_PORT:-}" \
WAIT_FOR_JOB="${WAIT_FOR_JOB:-1}" \
JOB_TIMEOUT_SEC="${JOB_TIMEOUT_SEC:-300}" \
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-3}" \
bash "${SCRIPT_DIR}/firmware-deploy.sh"

log "Release flow complete"
printf 'ARTIFACT_INFO=%s\n' "$INFO_PATH"
