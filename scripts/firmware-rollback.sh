#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "${SCRIPT_DIR}/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  HUB_URL=<url> API_KEY=<key> [ADMIN_TOKEN=<token>] NODE_ID=<node> [SOURCE_ID=<source>] \
    bash scripts/firmware-rollback.sh
EOF
}

require_cmd curl
require_cmd python3

HUB_URL="${HUB_URL:-http://localhost:3010}"
NODE_ID="${NODE_ID:-${1:-}}"
SOURCE_ID="${SOURCE_ID:-}"

[[ -n "$NODE_ID" ]] || {
  usage
  die "NODE_ID is required"
}

REQ_FILE="$(mktemp)"
RESP_FILE="$(mktemp)"
trap 'rm -f "$REQ_FILE" "$RESP_FILE"' EXIT

python3 - "$REQ_FILE" "$SOURCE_ID" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
source_id = sys.argv[2]
payload = {}
if source_id:
    payload["sourceId"] = source_id
path.write_text(json.dumps(payload), encoding="utf-8")
PY

URL="${HUB_URL%/}/api/spokes/${NODE_ID}/firmware/rollback"
HTTP_CODE="$(curl_json "POST" "$URL" "$REQ_FILE" "$RESP_FILE")"
api_expect_ok "$HTTP_CODE" "$RESP_FILE"

log "Rollback requested for ${NODE_ID}${SOURCE_ID:+ (sourceId=${SOURCE_ID})}"
cat "$RESP_FILE"
