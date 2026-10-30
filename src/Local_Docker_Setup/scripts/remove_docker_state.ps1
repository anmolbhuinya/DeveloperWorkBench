# remove_docker_state.ps1 -- Delete a saved Docker state snapshot.
#
# Removes the entire state folder (images, volumes, compose, metadata).
#
# Usage:  removedockerstate <state_name>
#         removeds          <state_name>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$StateName
)

$ErrorActionPreference = 'Continue'

$STATE_ROOT = "$(Split-Path $PSScriptRoot -Parent)\docker_state"
$STATE_DIR  = Join-Path $STATE_ROOT $StateName

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

# -- Show what will be deleted ---------------------------------
$sizeMB = [math]::Round((Get-ChildItem $STATE_DIR -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum / 1MB, 1)

Write-Host ""
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Red
Write-Host "  |  About to permanently delete state '$StateName'             |" -ForegroundColor Red
Write-Host ("  |    Path : {0,-54}|" -f $STATE_DIR) -ForegroundColor Red
Write-Host ("  |    Size : {0,-54}|" -f "$sizeMB MB") -ForegroundColor Red
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Red
Write-Host ""
$answer = Read-Host "  Delete? [y/N]"
if ($answer -notmatch '^[Yy]$') {
    Write-Log "Aborted. Nothing deleted."
    exit 0
}

# -- Remove ----------------------------------------------------
Write-Log "Removing state '$StateName'..."
Remove-Item -Recurse -Force $STATE_DIR
if ($LASTEXITCODE -eq 0 -or -not (Test-Path $STATE_DIR)) {
    Write-Log "Removed: $STATE_DIR"
    Write-Log "State '$StateName' deleted successfully."
} else {
    Write-Log "ERROR: Failed to remove $STATE_DIR"
    exit 1
}
