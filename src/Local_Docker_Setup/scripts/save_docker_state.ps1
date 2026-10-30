# save_docker_state.ps1 -- Snapshot the current Docker state.
#
# Saves:
#   - docker compose file currently in use
#   - docker inspect JSON for each running container
#   - exported tar of each named volume
#   - metadata.json  (images, container names, volume map, timestamp)
#
# Usage:  savedockerstate <state_name>
#         saveds          <state_name>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$StateName
)

$ErrorActionPreference = 'Continue'

$STATE_ROOT     = "$(Split-Path $PSScriptRoot -Parent)\docker_state"
$COMPOSE_SRC    = "$(Split-Path $PSScriptRoot -Parent)\dockercompose"
$COMPOSE_ACTIVE = "$env:USERPROFILE\dockerVM\dockerPOCArtifacts\dockerCompose\compose_with_tomcat.yaml"

$STATE_DIR   = Join-Path $STATE_ROOT $StateName
$VOLUMES_DIR = Join-Path $STATE_DIR "volumes"

function Write-Log {
    param([string]$Msg)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] $Msg"
}

# -- Validate --------------------------------------------------
if (Test-Path $STATE_DIR) {
    Write-Log "ERROR: State '$StateName' already exists at:"
    Write-Log "       $STATE_DIR"
    Write-Log "       Delete it first or choose a different name."
    exit 1
}

try {
    $null = & docker version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "docker not running" }
} catch {
    Write-Log "ERROR: Docker daemon is not running. Run  startdocker  first."
    exit 1
}

# -- Create state directories ----------------------------------
New-Item -ItemType Directory -Path $STATE_DIR   | Out-Null
New-Item -ItemType Directory -Path $VOLUMES_DIR | Out-Null

Write-Log "Saving Docker state '$StateName' to:"
Write-Log "  $STATE_DIR"

# -- Save compose file -----------------------------------------
Write-Log "Saving compose file..."
$composeSource = $null
$composeLabel  = ''
if (Test-Path $COMPOSE_ACTIVE) {
    $composeSource = $COMPOSE_ACTIVE
    $composeLabel  = 'active location'
} elseif (Test-Path $COMPOSE_SRC) {
    $cf = Get-ChildItem $COMPOSE_SRC -Filter "*.yaml" | Sort-Object LastWriteTime -Descending
    if ($cf) {
        $composeSource = $cf[0].FullName
        $composeLabel  = $cf[0].Name
    }
}

if ($composeSource) {
    Copy-Item $composeSource (Join-Path $STATE_DIR "docker-compose.yaml")
    Write-Log "  Saved: docker-compose.yaml  (from $composeLabel)"
} else {
    Write-Log "  WARNING: Compose file not found - skipping."
}

# -- Discover running containers -------------------------------
$containers = & docker ps --format '{{.Names}}' 2>&1
if ($LASTEXITCODE -ne 0 -or -not $containers) {
    Write-Log "No running containers found. Saving compose file only."
    $containers = @()
} else {
    $containers = $containers -split "`n" | Where-Object { $_.Trim() -ne '' }
}

Write-Log "Running containers: $($containers -join ', ')"

$metadata = @{
    stateName  = $StateName
    savedAt    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    containers = @()
    volumes    = @()
}

# -- Save each container's inspect + named volumes -------------
foreach ($cname in $containers) {
    Write-Log "Processing container: $cname"

    $inspect = & docker inspect $cname 2>&1
    $inspect | Out-File -FilePath (Join-Path $STATE_DIR "inspect_$cname.json") -Encoding utf8
    Write-Log "  Saved inspect JSON"

    $image = (& docker inspect $cname --format '{{.Config.Image}}' 2>&1).Trim()

    $mounts     = & docker inspect $cname --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}:{{.Destination}}{{"\n"}}{{end}}{{end}}'
    $mountLines = $mounts -split "`n" | Where-Object { $_.Trim() -ne '' }

    $containerVolumes = @()
    foreach ($line in $mountLines) {
        $parts      = $line.Split(':', 2)
        $volName    = $parts[0].Trim()
        $mountPoint = if ($parts.Length -gt 1) { $parts[1].Trim() } else { '' }
        $tarFile    = "${cname}__${volName}.tar"

        Write-Log "  Exporting named volume: $volName  ($mountPoint)"

        & docker run --rm `
            -v "${volName}:/data" `
            -v "${VOLUMES_DIR}:/backup" `
            alpine `
            tar -czf "/backup/$tarFile" -C /data . 2>&1 | ForEach-Object { Write-Log "    $_" }

        if ($LASTEXITCODE -eq 0) {
            Write-Log "  Exported: $tarFile"
        } else {
            Write-Log "  WARNING: Volume export failed for $volName (exit $LASTEXITCODE)"
        }

        $containerVolumes += @{ volumeName = $volName; mountPoint = $mountPoint; tarFile = $tarFile }
        $metadata.volumes += @{ volumeName = $volName; mountPoint = $mountPoint; container = $cname; tarFile = $tarFile }
    }

    $metadata.containers += @{
        name    = $cname
        image   = $image
        volumes = $containerVolumes
    }
}

# -- Write metadata.json ---------------------------------------
$metadata | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $STATE_DIR "metadata.json") -Encoding utf8
Write-Log "Saved metadata.json"

Write-Log ""
Write-Log "State '$StateName' saved successfully."
Write-Log "  Containers : $($metadata.containers.Count)"
Write-Log "  Volumes    : $($metadata.volumes.Count)"
Write-Log "  Location   : $STATE_DIR"
Write-Log ""
Write-Log "To restore:  loaddockerstate $StateName   (or  loadds $StateName)"
