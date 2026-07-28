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

RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

# Raw binary upload: the archive streams straight to disk on the hub instead
# of being buffered as a base64 JSON body. Manifest travels as a header.
ARCHIVE_CHECKSUM="$(sha256_file "$ZIP_PATH")"
MANIFEST_B64="$(python3 -c 'import base64,sys;print(base64.b64encode(open(sys.argv[1],"rb").read()).decode("ascii"))' "$MANIFEST_PATH")"

URL="${HUB_URL%/}/api/firmware/bundles"
CURL_ARGS=(
  -sS -X POST -w "%{http_code}" -o "$RESPONSE_FILE"
  -H "Content-Type: application/zip"
  -H "X-Archive-Checksum: ${ARCHIVE_CHECKSUM}"
  -H "X-Bundle-Manifest: ${MANIFEST_B64}"
  --data-binary "@${ZIP_PATH}"
)
if [[ -n "${API_KEY:-}" ]]; then
  CURL_ARGS+=(-H "X-API-Key: ${API_KEY}")
fi
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  CURL_ARGS+=(-H "X-Admin-Token: ${ADMIN_TOKEN}")
fi
HTTP_CODE="$(curl "${CURL_ARGS[@]}" "$URL")"
api_expect_ok "$HTTP_CODE" "$RESPONSE_FILE"

BUNDLE_ID="$(json_extract "$MANIFEST_PATH" "bundleId")"
VERSION="$(json_extract "$MANIFEST_PATH" "version")"
log "Uploaded firmware bundle ${BUNDLE_ID}@${VERSION}"
cat "$RESPONSE_FILE"
