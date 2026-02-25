#!/bin/bash
#
# Sync web UI only - Desktop -> Pi
#
# Syncs web source files and rebuilds the Vite bundle on the Pi.
# Does NOT restart services or touch the database.
# Does NOT sync modules.
#
# Usage:
#   ./sync-web.sh                          # Use default target
#   ./sync-web.sh 192.168.1.100            # Specify IP (defaults to user "pi")
#   ./sync-web.sh pi@192.168.1.100         # Specify full user@host
#   ./sync-web.sh -h | --help              # Show help
#
# First time:
#   chmod +x sync-web.sh

set -euo pipefail

# Configuration defaults
DEFAULT_PI_USER="${PI_USER:-pi}"
DEFAULT_PI_HOST="${PI_HOST:-10.0.0.160}"
PI_DIR="${PI_DIR:-~/latticespark}"
SOCKET="/tmp/ssh-sync-web-$$"

show_help() {
  cat <<EOF
Usage:
  ./sync-web.sh [ip-or-user@host]

Examples:
  ./sync-web.sh
  ./sync-web.sh 192.168.1.100
  ./sync-web.sh pi@192.168.1.100

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

TARGET_RAW="${1:-$DEFAULT_PI_HOST}"
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

echo "Syncing web UI to ${PI_TARGET}:${PI_DIR}..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '__pycache__' \
  -e "$SSH_RSH" \
  web/ "${PI_TARGET}:${PI_DIR}/web/"

# Also sync shared config (vite.config, main styles)
rsync -avz \
  -e "$SSH_RSH" \
  vite.config.js "${PI_TARGET}:${PI_DIR}/"

echo ""
echo "Building on Pi..."
ssh -S "$SOCKET" "$PI_TARGET" "cd ${PI_DIR} && pnpm run web:build"

echo ""
echo "Web UI updated. Refresh your browser."
