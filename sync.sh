#!/bin/bash
#
# Simple sync script - Desktop → Pi
#
# Usage:
#   ./sync.sh                    # Use default Pi
#   ./sync.sh pi@192.168.1.100  # Specify Pi
#
# First time:
#   chmod +x sync.sh

# Configuration
PI_HOST="${1:-pi@10.0.0.160}"  # Change this to your Pi's IP
PI_DIR="~/latticespark"

echo "Syncing to $PI_HOST:$PI_DIR..."

# Sync files (rsync for speed, scp fallback)
if command -v rsync &> /dev/null; then
    rsync -avz --delete \
        --exclude 'node_modules' \
        --exclude 'pnpm-lock.yaml' \
        --exclude '.git' \
        --exclude '__pycache__' \
        --exclude '*.pyc' \
        --exclude 'htmlcov' \
        --exclude '.pytest_cache' \
        ./ "$PI_HOST:$PI_DIR/"
else
    # Fallback to scp (slower but works everywhere)
    scp -r src config examples test package.json requirements*.txt "$PI_HOST:$PI_DIR/"
fi

echo "✓ Synced!"
echo ""
echo "Next: ssh $PI_HOST 'cd $PI_DIR && pnpm run example:env'"
