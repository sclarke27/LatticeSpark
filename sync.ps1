# Simple sync script - Desktop → Pi (PowerShell)
#
# Usage:
#   .\sync.ps1                    # Use default Pi
#   .\sync.ps1 pi@192.168.1.100  # Specify Pi

param(
    [string]$PiHost = "pi@10.0.0.160",
    [string]$PiDir = "~/latticespark"
)

Write-Host "Syncing to $PiHost`:$PiDir..." -ForegroundColor Blue

# Create directory on Pi
ssh $PiHost "mkdir -p $PiDir"

# Sync files using scp
Write-Host "Copying files..." -ForegroundColor Cyan

scp -r src "$PiHost`:$PiDir/"
scp -r config "$PiHost`:$PiDir/"
scp -r web "$PiHost`:$PiDir/"
scp -r examples "$PiHost`:$PiDir/"
scp -r test "$PiHost`:$PiDir/"
scp package.json "$PiHost`:$PiDir/"
scp requirements.txt "$PiHost`:$PiDir/"
scp requirements-dev.txt "$PiHost`:$PiDir/"

Write-Host ""
Write-Host "✓ Synced!" -ForegroundColor Green
Write-Host ""
Write-Host "Next: ssh $PiHost 'cd $PiDir && pnpm run example:env'" -ForegroundColor Yellow
