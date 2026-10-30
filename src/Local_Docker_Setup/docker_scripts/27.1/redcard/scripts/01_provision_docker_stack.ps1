$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$parentDir = Split-Path -Parent $scriptDir
$artifactsDir = Join-Path $parentDir "artifacts"
$composeFile = Join-Path $artifactsDir "docker-compose.yml"

Write-Host "================================================================="
Write-Host "Provisioning Docker Stack"
Write-Host "================================================================="

Write-Host "Shutting down any existing docker stack..."
docker compose -p "payor-25-1-4" -f $composeFile down --remove-orphans

Write-Host "Starting up new docker stack..."
docker compose -p "payor-25-1-4" -f $composeFile up -d

Write-Host "Waiting for database to be ready (max 3 minutes)..."
$dbReady = $false
for ($i = 0; $i -lt 36; $i++) {
    $logs = docker logs payer-db-25-1-4 2>&1
    if ($logs -match "DATABASE IS READY TO USE!") {
        $dbReady = $true
        Write-Host "Database is ready!"
        break
    }
    Write-Host "Still waiting for database... ($($i * 5) seconds)"
    Start-Sleep -Seconds 5
}

if (-not $dbReady) {
    Write-Warning "Database readiness not detected in logs, proceeding anyway but there may be issues."
}

Write-Host "Ensuring WebLogic container is running..."
$payerRunning = docker ps --format '{{.Names}}' | Select-String -Pattern "^payer-25-1-4$"
if (-not $payerRunning) {
    docker start payer-25-1-4
}
