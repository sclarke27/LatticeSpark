#!/bin/bash
#
# Sync one or more specific modules - Desktop -> Pi
#
# Usage:
#   ./sync-modules.sh <module-id> [module-id ...]
#   ./sync-modules.sh 192.168.1.100 <module-id> [module-id ...]
#   ./sync-modules.sh pi@192.168.1.100 <module-id> [module-id ...]
#   ./sync-modules.sh -h | --help
#
# First time:
#   chmod +x sync-modules.sh

set -euo pipefail

# Configuration defaults
DEFAULT_PI_USER="${PI_USER:-pi}"
DEFAULT_PI_HOST="${PI_HOST:-10.0.0.160}"
PI_DIR="${PI_DIR:-~/latticespark}"
SOCKET="/tmp/ssh-sync-modules-$$"

show_help() {
  cat <<EOF
Usage:
  ./sync-modules.sh [ip-or-user@host] <module-id> [module-id ...]

Examples:
  ./sync-modules.sh hello-world
  ./sync-modules.sh segment-clock camera-view
  ./sync-modules.sh 192.168.1.100 hello-world
  ./sync-modules.sh pi@192.168.1.100 segment-clock

Environment overrides:
  PI_USER   Default SSH user (default: pi)
  PI_HOST   Default host/IP (default: 10.0.0.160)
  PI_DIR    Remote project directory (default: ~/latticespark)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

if [[ $# -lt 1 ]]; then
  show_help
  echo "Error: at least one module ID is required." >&2
  exit 1
fi

TARGET_RAW="$DEFAULT_PI_HOST"

is_probable_host() {
  local value="$1"
  # user@host, IPv4, hostname.local, host:port, IPv6-style
  [[ "$value" == *"@"* || "$value" == *"."* || "$value" == *":"* ]]
}

if is_probable_host "${1}"; then
  TARGET_RAW="$1"
  shift
fi

if [[ $# -lt 1 ]]; then
  show_help
  echo "Error: no module IDs provided after host argument." >&2
  exit 1
fi

if [[ "$TARGET_RAW" == *"@"* ]]; then
  PI_TARGET="$TARGET_RAW"
else
  PI_TARGET="${DEFAULT_PI_USER}@${TARGET_RAW}"
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Error: ssh not found" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync not found" >&2
  exit 1
fi

echo "Opening SSH control connection to ${PI_TARGET}..."
ssh -fNM -S "$SOCKET" "$PI_TARGET"
trap 'ssh -S "$SOCKET" -O exit "$PI_TARGET" >/dev/null 2>&1 || true' EXIT

SSH_RSH="ssh -S $SOCKET"

# Ensure remote modules directory exists
ssh -S "$SOCKET" "$PI_TARGET" "mkdir -p ${PI_DIR}/modules"

for module_id in "$@"; do
  local_path="modules/${module_id}"
  if [[ ! -d "$local_path" ]]; then
    echo "Error: module not found: ${local_path}" >&2
    exit 1
  fi

  remote_path="${PI_TARGET}:${PI_DIR}/modules/${module_id}/"
  echo "Syncing module ${module_id} -> ${remote_path}"
  rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    -e "$SSH_RSH" \
    "${local_path}/" "$remote_path"
done

echo ""
echo "Module sync complete."
echo "Next: ssh ${PI_TARGET} 'cd ${PI_DIR} && pnpm run services:restart'"
