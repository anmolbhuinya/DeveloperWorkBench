# stopservers.ps1 - Stop all containers in the Tomcat Docker Compose stack.
#
# Runs: docker compose stop
#       (use -Down to also remove containers)
#
# Run via:  stopservers       (CMD wrapper in .local\bin)
#           stopservers -Down (stop + remove containers)

param(
    [switch]$Down,      # -Down    : docker compose down (stop + remove containers)
    [switch]$volumes    # -Volumes : with -Down, also remove named volumes
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

# Build docker compose args
if ($Down) {
    $composeArgs = @('compose', '-f', $COMPOSE_FILE, 'down')
    if ($volumes) { $composeArgs += '--volumes' }
} else {
    $composeArgs = @('compose', '-f', $COMPOSE_FILE, 'stop')
}

# Run
Write-Log "Stopping servers via Docker Compose..."
Write-Log "Compose file : $COMPOSE_FILE"
Write-Log "Command      : docker $($composeArgs -join ' ')"
Write-Log ""

& docker @composeArgs

if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose exited with code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Log "Servers stopped."
