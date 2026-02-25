#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "${SCRIPT_DIR}/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  HEX_PATH=<path> BUNDLE_ID=<id> VERSION=<ver> BOARD_PROFILE=<uno|nano|mega> \
    [MCU=<mcu>] [PROGRAMMER=<programmer>] [BAUD=<baud>] [SIGNATURE=<sig>] \
    [OUT_DIR=<dir>] [ZIP_PATH=<path>] [MANIFEST_PATH=<path>] \
    bash scripts/firmware-package.sh
EOF
}

require_cmd zip
require_cmd python3

HEX_PATH="${HEX_PATH:-${1:-}}"
BUNDLE_ID="${BUNDLE_ID:-${2:-}}"
VERSION="${VERSION:-${3:-}}"
BOARD_PROFILE="${BOARD_PROFILE:-${4:-}}"

[[ -n "$HEX_PATH" ]] || {
  usage
  die "HEX_PATH is required"
}
[[ -n "$BUNDLE_ID" ]] || {
  usage
  die "BUNDLE_ID is required"
}
[[ -n "$VERSION" ]] || {
  usage
  die "VERSION is required"
}
[[ -n "$BOARD_PROFILE" ]] || {
  usage
  die "BOARD_PROFILE is required"
}
[[ -f "$HEX_PATH" ]] || die "HEX_PATH not found: $HEX_PATH"

case "$BOARD_PROFILE" in
  uno|nano)
    DEFAULT_MCU="atmega328p"
    DEFAULT_PROGRAMMER="arduino"
    DEFAULT_BAUD="115200"
    ;;
  mega)
    DEFAULT_MCU="atmega2560"
    DEFAULT_PROGRAMMER="arduino"
    DEFAULT_BAUD="115200"
    ;;
  *)
    die "Unsupported BOARD_PROFILE: $BOARD_PROFILE (supported: uno, nano, mega)"
    ;;
esac

MCU="${MCU:-$DEFAULT_MCU}"
PROGRAMMER="${PROGRAMMER:-$DEFAULT_PROGRAMMER}"
BAUD="${BAUD:-$DEFAULT_BAUD}"
SIGNATURE="${SIGNATURE:-unsigned}"

OUT_DIR="${OUT_DIR:-data/firmware-work/${BUNDLE_ID}-${VERSION}}"
MANIFEST_PATH="${MANIFEST_PATH:-${OUT_DIR}/manifest.json}"
ZIP_PATH="${ZIP_PATH:-${OUT_DIR}/firmware-bundle.zip}"
INFO_PATH="${INFO_PATH:-${OUT_DIR}/artifact-info.env}"

mkdir -p "$OUT_DIR"
BUNDLE_HEX_PATH="${OUT_DIR}/firmware.hex"
cp "$HEX_PATH" "$BUNDLE_HEX_PATH"

HEX_CHECKSUM="$(sha256_file "$BUNDLE_HEX_PATH")"

python3 - "$MANIFEST_PATH" "$BUNDLE_ID" "$VERSION" "$BOARD_PROFILE" "$MCU" "$PROGRAMMER" "$BAUD" "$HEX_CHECKSUM" "$SIGNATURE" <<'PY'
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
manifest = {
    "bundleId": sys.argv[2],
    "version": sys.argv[3],
    "boardProfile": sys.argv[4],
    "mcu": sys.argv[5],
    "programmer": sys.argv[6],
    "baud": int(sys.argv[7]),
    "checksum": sys.argv[8],
    "signature": sys.argv[9],
}
manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
PY

rm -f "$ZIP_PATH"
zip -j -q "$ZIP_PATH" "$MANIFEST_PATH" "$BUNDLE_HEX_PATH"
ARCHIVE_CHECKSUM="$(sha256_file "$ZIP_PATH")"

cat > "$INFO_PATH" <<EOF
BUNDLE_ID=${BUNDLE_ID}
VERSION=${VERSION}
BOARD_PROFILE=${BOARD_PROFILE}
MCU=${MCU}
PROGRAMMER=${PROGRAMMER}
BAUD=${BAUD}
SIGNATURE=${SIGNATURE}
HEX_PATH=${BUNDLE_HEX_PATH}
HEX_CHECKSUM=${HEX_CHECKSUM}
MANIFEST_PATH=${MANIFEST_PATH}
ZIP_PATH=${ZIP_PATH}
ARCHIVE_CHECKSUM=${ARCHIVE_CHECKSUM}
EOF

log "Firmware bundle packaged"
printf 'BUNDLE_ID=%s\n' "$BUNDLE_ID"
printf 'VERSION=%s\n' "$VERSION"
printf 'MANIFEST_PATH=%s\n' "$MANIFEST_PATH"
printf 'ZIP_PATH=%s\n' "$ZIP_PATH"
printf 'ARCHIVE_CHECKSUM=%s\n' "$ARCHIVE_CHECKSUM"
