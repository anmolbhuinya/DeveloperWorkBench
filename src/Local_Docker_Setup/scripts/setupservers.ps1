# setupservers.ps1 - Start all servers via Docker Compose.
#
# Runs: docker compose -f compose_with_tomcat.yaml up   (default)
#       docker compose -f compose_with_weblogic.yaml up  (with -Weblogic)
#
# Run via:  setupservers           (CMD wrapper in .local\bin)
#           setupservers -weblogic (use WebLogic compose file)

param(
    [switch]$Detach,        # -Detach      : run containers in background
    [switch]$Build,         # -Build       : force rebuild images before starting
    [switch]$ForceRecreate, # -ForceRecreate : recreate containers even if config unchanged
    [switch]$weblogic       # -weblogic    : use compose_with_weblogic.yaml instead of tomcat
)

$ErrorActionPreference = 'Stop'

$COMPOSE_FILE = if ($weblogic) {
    "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_weblogic.yaml"
} else {
    "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_tomcat.yaml"
}

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

# Build docker compose args
$composeArgs = @('compose', '-f', $COMPOSE_FILE, 'up')

if ($Detach)        { $composeArgs += '-d' }
if ($Build)         { $composeArgs += '--build' }
if ($ForceRecreate) { $composeArgs += '--force-recreate' }

# Run
Write-Log "Starting servers via Docker Compose..."
Write-Log "Compose file : $COMPOSE_FILE"
Write-Log "Command      : docker $($composeArgs -join ' ')"
Write-Log ""

& docker @composeArgs

if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose up exited with code $LASTEXITCODE."
    exit $LASTEXITCODE
}
