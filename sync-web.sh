#!/bin/bash
#
# Sync web UI only - Desktop → Pi
#
# Syncs web source files and rebuilds the Vite bundle on the Pi.
# Does NOT restart services or touch the database.
#
# Usage:
#   ./sync-web.sh                    # Use default Pi
#   ./sync-web.sh pi@192.168.1.100  # Specify Pi
#
# First time:
#   chmod +x sync-web.sh

# Configuration
PI_HOST="${1:-pi@10.0.0.160}"
PI_DIR="~/crowpi3"
SOCKET="/tmp/ssh-sync-$$"

# Open a shared SSH connection (single login)
ssh -fNM -S "$SOCKET" "$PI_HOST"
trap 'ssh -S "$SOCKET" -O exit "$PI_HOST" 2>/dev/null' EXIT

SSH_OPTS="-S $SOCKET"

echo "Syncing web UI to $PI_HOST:$PI_DIR..."

rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '__pycache__' \
    -e "ssh $SSH_OPTS" \
    web/ "$PI_HOST:$PI_DIR/web/"

# Also sync shared config (vite.config, main styles)
rsync -avz -e "ssh $SSH_OPTS" vite.config.js "$PI_HOST:$PI_DIR/"

echo ""
echo "Building on Pi..."
ssh $SSH_OPTS "$PI_HOST" "cd $PI_DIR && npx vite build web"

echo ""
echo "✓ Web UI updated! Refresh your browser."
