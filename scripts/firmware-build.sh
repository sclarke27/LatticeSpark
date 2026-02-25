#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "${SCRIPT_DIR}/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  SKETCH_PATH=<path> FQBN=<fqbn> [BUILD_DIR=<dir>] [OUT_HEX=<path>] bash scripts/firmware-build.sh

Examples:
  SKETCH_PATH=~/arduino/my-sensor FQBN=arduino:avr:uno bash scripts/firmware-build.sh
  SKETCH_PATH=~/arduino/my-sensor FQBN=arduino:avr:mega OUT_HEX=./data/fw/mega.hex bash scripts/firmware-build.sh
EOF
}

require_cmd arduino-cli
require_cmd find

SKETCH_PATH="${SKETCH_PATH:-${1:-}}"
FQBN="${FQBN:-${2:-}}"
BUILD_DIR="${BUILD_DIR:-data/firmware-build}"
OUT_HEX="${OUT_HEX:-${BUILD_DIR}/firmware.hex}"
HEX_PATH_OVERRIDE="${HEX_PATH:-}"

[[ -n "$SKETCH_PATH" ]] || {
  usage
  die "SKETCH_PATH is required"
}
[[ -n "$FQBN" ]] || {
  usage
  die "FQBN is required"
}
[[ -d "$SKETCH_PATH" ]] || die "SKETCH_PATH not found: $SKETCH_PATH"

mkdir -p "$BUILD_DIR"
OUT_HEX_DIR="$(dirname "$OUT_HEX")"
mkdir -p "$OUT_HEX_DIR"

log "Compiling sketch: ${SKETCH_PATH}"
log "FQBN: ${FQBN}"
arduino-cli compile --fqbn "$FQBN" "$SKETCH_PATH" --output-dir "$BUILD_DIR"

select_hex() {
  local candidate

  if [[ -n "$HEX_PATH_OVERRIDE" ]]; then
    [[ -f "$HEX_PATH_OVERRIDE" ]] || die "HEX_PATH override not found: $HEX_PATH_OVERRIDE"
    printf '%s\n' "$HEX_PATH_OVERRIDE"
    return
  fi

  while IFS= read -r candidate; do
    if [[ "$candidate" != *"with_bootloader.hex" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done < <(find "$BUILD_DIR" -maxdepth 3 -type f -name '*.hex' | sort)

  candidate="$(find "$BUILD_DIR" -maxdepth 3 -type f -name '*.hex' | sort | head -n1 || true)"
  [[ -n "$candidate" ]] || die "No .hex file produced in $BUILD_DIR"
  printf '%s\n' "$candidate"
}

SOURCE_HEX="$(select_hex)"
if [[ "$SOURCE_HEX" != "$OUT_HEX" ]]; then
  cp "$SOURCE_HEX" "$OUT_HEX"
fi

log "Build complete"
printf 'HEX_PATH=%s\n' "$OUT_HEX"
