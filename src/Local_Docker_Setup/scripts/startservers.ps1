# startservers.ps1 - Start all containers in the Tomcat Docker Compose stack.
#
# Uses docker compose start - starts stopped containers without recreating them.
# Already-running containers are skipped automatically.
# Handles mixed state (some running, some stopped) - all end up running.
# If no containers exist yet, automatically runs docker compose up -d to create them.
#
# Run via:  startservers   (CMD wrapper in .local\bin)

param()

$ErrorActionPreference = 'Stop'

$COMPOSE_FILE = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_tomcat.yaml"

function Write-Log {
    param([string]$Msg)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] $Msg"
}

# Verify compose file exists
if (-not (Test-Path $COMPOSE_FILE)) {
    Write-Log "ERROR: Compose file not found at:"
    Write-Log "       $COMPOSE_FILE"
    exit 1
}

# Verify docker is available
try {
    $null = & docker version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "docker version failed" }
} catch {
    Write-Log "ERROR: Docker daemon is not running. Run  startdocker  first."
    exit 1
}

# Check if containers exist in the compose stack
$existing = & docker compose -f $COMPOSE_FILE ps -q 2>&1
$containersExist = ($LASTEXITCODE -eq 0) -and ($existing -match '\S')

if (-not $containersExist) {
    Write-Log "No containers found - running setup first..."
    Write-Log "Command: docker compose up -d"
    Write-Log ""

    & docker compose -f $COMPOSE_FILE up -d

    if ($LASTEXITCODE -ne 0) {
        Write-Log ""
        Write-Log "ERROR: docker compose up exited with code $LASTEXITCODE."
        exit $LASTEXITCODE
    }

    Write-Log ""
    Write-Log "Containers created and started."
    exit 0
}

# Containers exist - start any that are stopped
Write-Log "Starting containers via Docker Compose..."
Write-Log "Compose file : $COMPOSE_FILE"
Write-Log "Command      : docker compose start"
Write-Log "(Already-running containers are skipped automatically)"
Write-Log ""

& docker compose -f $COMPOSE_FILE start

if ($LASTEXITCODE -ne 0) {
    Write-Log ""
    Write-Log "ERROR: docker compose start exited with code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Log ""
Write-Log "All containers are running."
