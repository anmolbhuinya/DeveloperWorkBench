# load_docker_state.ps1 -- Restore a previously saved Docker state.
#
# Restores:
#   - Copies the saved compose file to the active compose location
#   - Tears down any currently running containers (docker compose down)
#   - Restores each named volume from its saved tar
#   - Starts containers via docker compose up -d
#   - Starts Artemis + Tomcat inside payer-tc-261
#
# Usage:  loaddockerstate <state_name>
#         loadds          <state_name>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$StateName
)

$ErrorActionPreference = 'Continue'

$STATE_ROOT     = "$(Split-Path $PSScriptRoot -Parent)\docker_state"
$COMPOSE_DEST   = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_tomcat.yaml"
$COMPOSE_BACKUP = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_tomcat_bkp.yaml"
$COMPOSE_DIR    = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose"

$STATE_DIR   = Join-Path $STATE_ROOT $StateName
$VOLUMES_DIR = Join-Path $STATE_DIR "volumes"

function Write-Log {
    param([string]$Msg)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] $Msg"
}

# -- Validate --------------------------------------------------
if (-not (Test-Path $STATE_DIR)) {
    Write-Log "ERROR: State '$StateName' not found at:"
    Write-Log "       $STATE_DIR"
    Write-Log ""
    $available = Get-ChildItem $STATE_ROOT -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
    if ($available) {
        Write-Log "Available states:"
        $available | ForEach-Object { Write-Log "  $_" }
    } else {
        Write-Log "No saved states found in $STATE_ROOT"
    }
    exit 1
}

$metadataPath = Join-Path $STATE_DIR "metadata.json"
if (-not (Test-Path $metadataPath)) {
    Write-Log "ERROR: metadata.json not found in state '$StateName'. The save may be incomplete."
    exit 1
}

try {
    $null = & docker version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "docker not running" }
} catch {
    Write-Log "ERROR: Docker daemon is not running. Run  startdocker  first."
    exit 1
}

$metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
Write-Log "Loading Docker state '$StateName'  (saved: $($metadata.savedAt))"

# -- Check for running containers and warn ---------------------
$runningContainers = & docker ps --format '{{.Names}}' 2>&1
$runningContainers = $runningContainers -split "`n" | Where-Object { $_.Trim() -ne '' }

if ($runningContainers.Count -gt 0) {
    Write-Host ""
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |  WARNING: The following containers are currently running:    |" -ForegroundColor Yellow
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Yellow
    foreach ($c in $runningContainers) {
        $status = & docker inspect $c --format '{{.State.Status}}' 2>&1
        Write-Host ("  |    {0,-58}|" -f "$c  [$status]") -ForegroundColor Yellow
    }
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |  Loading state will:                                         |" -ForegroundColor Yellow
    Write-Host "  |    1. Stop and remove all running containers                 |" -ForegroundColor Yellow
    Write-Host "  |    2. Restore named volumes from saved state                 |" -ForegroundColor Yellow
    Write-Host "  |    3. Start containers from the saved compose file           |" -ForegroundColor Yellow
    Write-Host "  |    4. Start Artemis + Tomcat inside payer-tc-261             |" -ForegroundColor Yellow
    Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host ""
    $answer = Read-Host "  Proceed? [y/N]"
    if ($answer -notmatch '^[Yy]$') {
        Write-Log "Aborted. No changes made."
        exit 0
    }
    Write-Host ""
}

# -- Stop and remove running containers ------------------------
if ($runningContainers.Count -gt 0) {
    Write-Log "Stopping and removing running containers..."
    if (Test-Path $COMPOSE_DEST) {
        & docker compose -f $COMPOSE_DEST down --remove-orphans 2>&1 | ForEach-Object { Write-Log "  $_" }
    } else {
        foreach ($c in $runningContainers) {
            Write-Log "  Stopping $c..."
            & docker stop $c 2>&1 | Out-Null
            & docker rm   $c 2>&1 | Out-Null
        }
    }
    Write-Log "Containers stopped and removed."
}

# -- Restore compose file --------------------------------------
$savedCompose = Join-Path $STATE_DIR "docker-compose.yaml"
if (Test-Path $savedCompose) {
    Write-Log "Restoring compose file..."
    if (Test-Path $COMPOSE_DEST) {
        Copy-Item $COMPOSE_DEST $COMPOSE_BACKUP -Force
        Write-Log "  Backed up current compose to: $COMPOSE_BACKUP"
    }
    if (-not (Test-Path $COMPOSE_DIR)) {
        New-Item -ItemType Directory -Path $COMPOSE_DIR | Out-Null
    }
    Copy-Item $savedCompose $COMPOSE_DEST -Force
    Write-Log "  Restored: $COMPOSE_DEST"
} else {
    Write-Log "WARNING: No docker-compose.yaml in state '$StateName' - using existing compose file."
}

# -- Restore named volumes -------------------------------------
if ($metadata.volumes -and $metadata.volumes.Count -gt 0) {
    Write-Log "Restoring $($metadata.volumes.Count) volume(s)..."
    foreach ($vol in $metadata.volumes) {
        $tarFile = Join-Path $VOLUMES_DIR $vol.tarFile
        if (-not (Test-Path $tarFile)) {
            Write-Log "  WARNING: tar not found for volume $($vol.volumeName) - skipping."
            continue
        }
        Write-Log "  Restoring volume: $($vol.volumeName)  (for container $($vol.container))"

        $volExists = & docker volume ls -q -f "name=^$($vol.volumeName)$" 2>&1
        if ($volExists) {
            & docker volume rm $vol.volumeName 2>&1 | Out-Null
        }
        & docker volume create $vol.volumeName 2>&1 | Out-Null

        & docker run --rm `
            -v "$($vol.volumeName):/data" `
            -v "${VOLUMES_DIR}:/backup" `
            alpine `
            sh -c "rm -rf /data/* /data/..?* /data/.[!.]* 2>/dev/null; tar -xzf /backup/$($vol.tarFile) -C /data" `
            2>&1 | ForEach-Object { Write-Log "    $_" }

        if ($LASTEXITCODE -eq 0) {
            Write-Log "  Restored: $($vol.volumeName)"
        } else {
            Write-Log "  WARNING: Volume restore failed for $($vol.volumeName) (exit $LASTEXITCODE)"
        }
    }
} else {
    Write-Log "No named volumes to restore."
}

# -- Start containers ------------------------------------------
Write-Log "Starting containers via docker compose..."
& docker compose -f $COMPOSE_DEST up -d 2>&1 | ForEach-Object { Write-Log "  $_" }

if ($LASTEXITCODE -ne 0) {
    Write-Log "ERROR: docker compose up failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# -- Start Artemis + Tomcat inside payer-tc-261 ----------------
Write-Log ""
Write-Log "Waiting 5 seconds for containers to initialise..."
Start-Sleep -Seconds 5

$PAYOR_CONTAINER    = "payer-tc-261"
$ARTEMIS_CANDIDATES = @(
    "/home/weblogic/environments/healthedge/claimserver/install/tools/bin/startArtemis",
    "/home/weblogic/payor_distribution/target/core-distribution/claimserver/install/tools/bin/startArtemis"
)
$SERVER_CANDIDATES  = @(
    "/home/weblogic/environments/healthedge/claimserver/install/tools/bin/startServer",
    "/home/weblogic/payor_distribution/target/core-distribution/claimserver/install/tools/bin/startServer"
)

$payorRunning = & docker inspect $PAYOR_CONTAINER --format '{{.State.Running}}' 2>&1
if ($payorRunning -eq 'true') {

    $artemisScript = $null
    foreach ($c in $ARTEMIS_CANDIDATES) {
        $exists = & docker exec $PAYOR_CONTAINER sh -c "[ -f '$c' ] && echo yes || echo no" 2>&1
        if ($exists -eq 'yes') { $artemisScript = $c; break }
    }

    if ($artemisScript) {
        Write-Log "Starting Artemis inside $PAYOR_CONTAINER ..."
        Write-Log "  Script: $artemisScript"
        & docker exec -u weblogic $PAYOR_CONTAINER sh -c "chmod +x '$artemisScript' && '$artemisScript'" `
            2>&1 | ForEach-Object { Write-Log "  [artemis] $_" }
        Write-Log "Artemis start complete."
    } else {
        Write-Log "WARNING: startArtemis not found in $PAYOR_CONTAINER - skipping."
        Write-Log "         Run  refresh-payor  to deploy, then  refresh-payor --only-start  to start."
    }

    $serverScript = $null
    foreach ($c in $SERVER_CANDIDATES) {
        $exists = & docker exec $PAYOR_CONTAINER sh -c "[ -f '$c' ] && echo yes || echo no" 2>&1
        if ($exists -eq 'yes') { $serverScript = $c; break }
    }

    if ($serverScript) {
        Write-Log "Starting Tomcat inside $PAYOR_CONTAINER ..."
        Write-Log "  Script: $serverScript"
        & docker exec -u weblogic $PAYOR_CONTAINER sh -c "chmod +x '$serverScript' && '$serverScript'" `
            2>&1 | ForEach-Object { Write-Log "  [tomcat]  $_" }
        Write-Log "Tomcat start complete."
    } else {
        Write-Log "WARNING: startServer not found in $PAYOR_CONTAINER - skipping."
        Write-Log "         Run  refresh-payor  to deploy, then  refresh-payor --only-start  to start."
    }

} else {
    Write-Log "WARNING: Container $PAYOR_CONTAINER is not running - skipping Artemis + Tomcat start."
    Write-Log "         Run  refresh-payor --only-start  manually once containers are healthy."
}

Write-Log ""
Write-Log "State '$StateName' loaded successfully."
Write-Log "  Containers restored : $($metadata.containers.Count)"
Write-Log "  Volumes restored    : $($metadata.volumes.Count)"
Write-Log ""
Write-Log "Run  docker ps  to verify containers are up."
