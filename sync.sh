#!/bin/bash
#
# Simple core sync script - Desktop -> Pi
#
# Syncs the core project and excludes module directories.
# Use ./sync-modules.sh to sync specific modules.
#
# Usage:
#   ./sync.sh                          # Use default target
#   ./sync.sh 192.168.1.100            # Specify IP (defaults to user "pi")
#   ./sync.sh pi@192.168.1.100         # Specify full user@host
#   ./sync.sh --with-config            # Also sync config/*.json files
#   ./sync.sh -h | --help              # Show help
#
# First time:
#   chmod +x sync.sh

set -euo pipefail

# Configuration defaults
DEFAULT_PI_USER="${PI_USER:-pi}"
DEFAULT_PI_HOST="${PI_HOST:-10.0.0.160}"
PI_DIR="${PI_DIR:-~/latticespark}"

show_help() {
  cat <<EOF
Usage:
  ./sync.sh [--with-config] [ip-or-user@host]

Examples:
  ./sync.sh
  ./sync.sh 192.168.1.100
  ./sync.sh pi@192.168.1.100
  ./sync.sh --with-config 192.168.1.100

Environment overrides:
  PI_USER   Default SSH user (default: pi)
  PI_HOST   Default host/IP (default: 10.0.0.160)
  PI_DIR    Remote project directory (default: ~/latticespark)
EOF
}

WITH_CONFIG=false
TARGET_RAW="$DEFAULT_PI_HOST"
POSITIONAL_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    --with-config)
      WITH_CONFIG=true
      shift
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        POSITIONAL_ARGS+=("$1")
        shift
      done
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL_ARGS[@]} -gt 1 ]]; then
  echo "Error: too many positional arguments." >&2
  show_help
  exit 1
fi

if [[ ${#POSITIONAL_ARGS[@]} -eq 1 ]]; then
  TARGET_RAW="${POSITIONAL_ARGS[0]}"
fi

if [[ "$TARGET_RAW" == *"@"* ]]; then
  PI_TARGET="$TARGET_RAW"
else
  PI_TARGET="${DEFAULT_PI_USER}@${TARGET_RAW}"
fi

echo "Syncing to ${PI_TARGET}:${PI_DIR}..."
if [[ "$WITH_CONFIG" == "false" ]]; then
  echo "Preserving remote config JSON files (use --with-config to sync them)."
fi

# Sync files (rsync for speed, scp fallback)
if command -v rsync &> /dev/null; then
  RSYNC_ARGS=(
    -avz
    --delete
    --exclude 'node_modules'
    --exclude 'modules'
    --exclude 'pnpm-lock.yaml'
    --exclude '.git'
    --exclude 'data/*.db'
    --exclude 'data/*.db-*'
    --exclude '__pycache__'
    --exclude '*.pyc'
    --exclude 'htmlcov'
    --exclude '.pytest_cache'
  )
  if [[ "$WITH_CONFIG" == "false" ]]; then
    RSYNC_ARGS+=(--exclude 'config/*.json' --exclude 'config/*.jsonc')
  fi

  rsync "${RSYNC_ARGS[@]}" ./ "${PI_TARGET}:${PI_DIR}/"
else
  # Fallback to scp (slower but works everywhere)
  if [[ "$WITH_CONFIG" == "true" ]]; then
    scp -r src config examples test package.json requirements*.txt "${PI_TARGET}:${PI_DIR}/"
  else
    scp -r src examples test package.json requirements*.txt "${PI_TARGET}:${PI_DIR}/"
  fi
fi

echo "Synced."
echo ""
echo "Next: ssh ${PI_TARGET} 'cd ${PI_DIR} && pnpm run example:env'"
