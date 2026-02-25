#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./firmware-common.sh
source "${SCRIPT_DIR}/firmware-common.sh"

usage() {
  cat <<'EOF'
Usage:
  HUB_URL=<url> API_KEY=<key> [ADMIN_TOKEN=<token>] NODE_ID=<node> BUNDLE_ID=<id> VERSION=<ver> \
    [SOURCE_ID=<source>] [SERIAL_PORT=<port>] [WAIT_FOR_JOB=1] [JOB_TIMEOUT_SEC=300] [POLL_INTERVAL_SEC=3] \
    bash scripts/firmware-deploy.sh
EOF
}

require_cmd curl
require_cmd python3

HUB_URL="${HUB_URL:-http://localhost:3010}"
NODE_ID="${NODE_ID:-${1:-}}"
BUNDLE_ID="${BUNDLE_ID:-${2:-}}"
VERSION="${VERSION:-${3:-}}"
SOURCE_ID="${SOURCE_ID:-}"
SERIAL_PORT="${SERIAL_PORT:-}"
WAIT_FOR_JOB="${WAIT_FOR_JOB:-1}"
JOB_TIMEOUT_SEC="${JOB_TIMEOUT_SEC:-300}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-3}"

[[ -n "$NODE_ID" ]] || {
  usage
  die "NODE_ID is required"
}
[[ -n "$BUNDLE_ID" ]] || {
  usage
  die "BUNDLE_ID is required"
}
[[ -n "$VERSION" ]] || {
  usage
  die "VERSION is required"
}

REQ_FILE="$(mktemp)"
RESP_FILE="$(mktemp)"
STATUS_FILE="$(mktemp)"
trap 'rm -f "$REQ_FILE" "$RESP_FILE" "$STATUS_FILE"' EXIT

python3 - "$REQ_FILE" "$BUNDLE_ID" "$VERSION" "$SOURCE_ID" "$SERIAL_PORT" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
bundle_id = sys.argv[2]
version = sys.argv[3]
source_id = sys.argv[4]
serial_port = sys.argv[5]

payload = {"bundleId": bundle_id, "version": version}
if source_id:
    payload["sourceId"] = source_id
if serial_port:
    payload["port"] = serial_port

path.write_text(json.dumps(payload), encoding="utf-8")
PY

URL="${HUB_URL%/}/api/spokes/${NODE_ID}/firmware/deploy"
HTTP_CODE="$(curl_json "POST" "$URL" "$REQ_FILE" "$RESP_FILE")"
api_expect_ok "$HTTP_CODE" "$RESP_FILE"

JOB_ID="$(json_extract "$RESP_FILE" "job.jobId")"
if [[ -z "$JOB_ID" ]]; then
  cat "$RESP_FILE"
  die "Deploy response did not include job.jobId"
fi

log "Deploy started for ${NODE_ID}: jobId=${JOB_ID}"
cat "$RESP_FILE"

if [[ "$WAIT_FOR_JOB" != "1" ]]; then
  exit 0
fi

STATUS_URL="${HUB_URL%/}/api/spokes/${NODE_ID}/firmware/jobs/${JOB_ID}"
DEADLINE=$(( $(date +%s) + JOB_TIMEOUT_SEC ))

while true; do
  NOW="$(date +%s)"
  if (( NOW > DEADLINE )); then
    die "Timed out waiting for firmware job ${JOB_ID}"
  fi

  HTTP_CODE="$(curl_json "GET" "$STATUS_URL" "" "$STATUS_FILE")"
  api_expect_ok "$HTTP_CODE" "$STATUS_FILE"
  STATUS="$(json_extract "$STATUS_FILE" "status")"
  DETAIL="$(json_extract "$STATUS_FILE" "detail")"

  if [[ -z "$STATUS" ]]; then
    log "Job ${JOB_ID}: unknown status"
  else
    log "Job ${JOB_ID}: ${STATUS}${DETAIL:+ - $DETAIL}"
  fi

  if [[ "$STATUS" == "success" ]]; then
    cat "$STATUS_FILE"
    exit 0
  fi
  if [[ "$STATUS" == "failed" ]]; then
    cat "$STATUS_FILE"
    exit 1
  fi

  sleep "$POLL_INTERVAL_SEC"
done
