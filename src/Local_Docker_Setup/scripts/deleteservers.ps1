# deleteservers.ps1 - Stop then remove all containers in the Tomcat Docker Compose stack.
#
# Step 1: docker compose stop   (graceful stop)
# Step 2: docker compose down   (remove containers + networks)
#
# Run via:  deleteservers          (CMD wrapper in .local\bin)
#           deleteservers -volumes (also remove named volumes)

param(
    [switch]$volumes    # -volumes : also remove named volumes (--volumes)
)

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
    Write-Log "ERROR: Docker daemon is not running. Run  startdocker  first, then retry."
    exit 1
}

Write-Log "Compose file : $COMPOSE_FILE"
Write-Log ""

# Step 1: Stop
Write-Log "Step 1 - Stopping containers (docker compose stop)..."
& docker compose -f $COMPOSE_FILE stop
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose stop exited with code $LASTEXITCODE."
    exit $LASTEXITCODE
}
Write-Log "Containers stopped."
Write-Log ""

# Step 2: Down (remove)
$downArgs = @('compose', '-f', $COMPOSE_FILE, 'down')
if ($volumes) { $downArgs += '--volumes' }

Write-Log "Step 2 - Removing containers (docker $($downArgs -join ' '))..."
& docker @downArgs
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose down exited with code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Log ""
Write-Log "Containers stopped and removed."
if ($volumes) { Write-Log "Named volumes also removed." }
