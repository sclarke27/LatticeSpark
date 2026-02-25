#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[firmware] %s\n' "$*"
}

die() {
  printf '[firmware] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi
  require_cmd python3
  python3 - "$file" <<'PY'
import hashlib
import pathlib
import sys

p = pathlib.Path(sys.argv[1])
print(hashlib.sha256(p.read_bytes()).hexdigest())
PY
}

json_extract() {
  local json_file="$1"
  local json_path="$2"
  python3 - "$json_file" "$json_path" <<'PY'
import json
import sys

path = sys.argv[2].split(".")
data = json.load(open(sys.argv[1], "r", encoding="utf-8"))
cur = data
for key in path:
    if not key:
        continue
    if not isinstance(cur, dict) or key not in cur:
        print("")
        sys.exit(0)
    cur = cur[key]
if isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

curl_json() {
  local method="$1"
  local url="$2"
  local body_file="${3:-}"
  local response_file="${4:-}"

  local curl_args=(
    -sS
    -X "$method"
    -w "%{http_code}"
    -H "Content-Type: application/json"
  )

  if [[ -n "${API_KEY:-}" ]]; then
    curl_args+=(-H "X-API-Key: ${API_KEY}")
  fi
  if [[ -n "${ADMIN_TOKEN:-}" ]]; then
    curl_args+=(-H "X-Admin-Token: ${ADMIN_TOKEN}")
  fi
  if [[ -n "$body_file" ]]; then
    curl_args+=(--data-binary "@${body_file}")
  fi
  if [[ -n "$response_file" ]]; then
    curl_args+=(-o "$response_file")
  fi

  curl "${curl_args[@]}" "$url"
}

api_expect_ok() {
  local http_code="$1"
  local response_file="$2"
  if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    return 0
  fi
  if [[ -f "$response_file" ]]; then
    cat "$response_file" >&2
  fi
  die "HTTP request failed with status ${http_code}"
}
