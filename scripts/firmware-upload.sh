#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "${SCRIPT_DIR}/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  HUB_URL=<url> API_KEY=<key> [ADMIN_TOKEN=<token>] MANIFEST_PATH=<path> ZIP_PATH=<path> \
    bash scripts/firmware-upload.sh

Defaults:
  HUB_URL defaults to http://localhost:3010
EOF
}

require_cmd curl
require_cmd python3

HUB_URL="${HUB_URL:-http://localhost:3010}"
MANIFEST_PATH="${MANIFEST_PATH:-${1:-}}"
ZIP_PATH="${ZIP_PATH:-${2:-}}"

[[ -n "$MANIFEST_PATH" ]] || {
  usage
  die "MANIFEST_PATH is required"
}
[[ -n "$ZIP_PATH" ]] || {
  usage
  die "ZIP_PATH is required"
}
[[ -f "$MANIFEST_PATH" ]] || die "manifest not found: $MANIFEST_PATH"
[[ -f "$ZIP_PATH" ]] || die "zip not found: $ZIP_PATH"

PAYLOAD_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$PAYLOAD_FILE" "$RESPONSE_FILE"' EXIT

python3 - "$MANIFEST_PATH" "$ZIP_PATH" "$PAYLOAD_FILE" <<'PY'
import base64
import hashlib
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
zip_path = pathlib.Path(sys.argv[2])
payload_path = pathlib.Path(sys.argv[3])

manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
zip_bytes = zip_path.read_bytes()

payload = {
    "manifest": manifest,
    "archiveChecksum": hashlib.sha256(zip_bytes).hexdigest(),
    "zipBase64": base64.b64encode(zip_bytes).decode("ascii"),
}
payload_path.write_text(json.dumps(payload), encoding="utf-8")
PY

URL="${HUB_URL%/}/api/firmware/bundles"
HTTP_CODE="$(curl_json "POST" "$URL" "$PAYLOAD_FILE" "$RESPONSE_FILE")"
api_expect_ok "$HTTP_CODE" "$RESPONSE_FILE"

BUNDLE_ID="$(json_extract "$MANIFEST_PATH" "bundleId")"
VERSION="$(json_extract "$MANIFEST_PATH" "version")"
log "Uploaded firmware bundle ${BUNDLE_ID}@${VERSION}"
cat "$RESPONSE_FILE"
