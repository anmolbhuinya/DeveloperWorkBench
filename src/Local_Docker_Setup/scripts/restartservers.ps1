# restartservers.ps1 - Delete all containers then recreate and start them.
#
# Equivalent to running:  deleteservers  followed by  startservers
#
# Step 1: docker compose stop   (graceful stop)
# Step 2: docker compose down   (remove containers + networks)
# Step 3: docker compose up -d  (recreate and start all containers)
#
# Run via:  restartservers            (CMD wrapper in .local\bin)
#           restartservers -volumes   (also remove named volumes before recreating)
#           restartservers -weblogic  (use WebLogic compose file)
#
# If no -Weblogic flag is given, the script auto-detects which stack is running
# (weblogic or tomcat) from the active compose_with_tomcat/weblogic.yaml file.

param(
    [switch]$volumes,  # -volumes  : also remove named volumes before recreating
    [switch]$weblogic  # -weblogic : use compose_with_weblogic.yaml
)

$ErrorActionPreference = 'Stop'

$TOMCAT_FILE   = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_tomcat.yaml"
$WEBLOGIC_FILE = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_weblogic.yaml"

# Auto-detect: if -weblogic not specified, check which file exists / is active
$COMPOSE_FILE = if ($weblogic) {
    $WEBLOGIC_FILE
} elseif (-not (Test-Path $TOMCAT_FILE) -and (Test-Path $WEBLOGIC_FILE)) {
    $WEBLOGIC_FILE
} else {
    $TOMCAT_FILE
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
Write-Log "Containers removed."
Write-Log ""

# Step 3: Recreate and start
Write-Log "Step 3 - Recreating and starting containers (docker compose up -d)..."
& docker compose -f $COMPOSE_FILE up -d
if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose up exited with code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Log ""
Write-Log "All containers recreated and running."
if ($volumes) { Write-Log "Note: Named volumes were removed and recreated fresh." }
