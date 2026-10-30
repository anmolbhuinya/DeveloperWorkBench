# list_docker_states.ps1 -- List all saved Docker state snapshots.
#
# Usage:  listdockerstate
#         listds

param()

$ErrorActionPreference = 'Continue'

$STATE_ROOT = "$(Split-Path $PSScriptRoot -Parent)\docker_state"
$RULER = '-' * 72

function Write-Log {
    param([string]$Msg)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] $Msg"
}

if (-not (Test-Path $STATE_ROOT)) {
    Write-Log "No docker_state directory found at:"
    Write-Log "  $STATE_ROOT"
    exit 0
}

$states = Get-ChildItem $STATE_ROOT -Directory -ErrorAction SilentlyContinue
if (-not $states -or $states.Count -eq 0) {
    Write-Log "No saved states found in:"
    Write-Log "  $STATE_ROOT"
    exit 0
}

Write-Host ""
Write-Host "  Saved Docker states  ($STATE_ROOT)" -ForegroundColor Cyan
Write-Host "  $RULER" -ForegroundColor Cyan
Write-Host ("  {0,-20}  {1,-22}  {2,-8}  {3}" -f "NAME", "SAVED AT", "SIZE", "CONTAINERS") -ForegroundColor White
Write-Host "  $RULER" -ForegroundColor Cyan

foreach ($dir in ($states | Sort-Object Name)) {
    $name         = $dir.Name
    $savedAt      = '--'
    $containers   = '--'
    $sizeMB       = '--'
    $metadataPath = Join-Path $dir.FullName "metadata.json"

    if (Test-Path $metadataPath) {
        try {
            $meta       = Get-Content $metadataPath -Raw | ConvertFrom-Json
            $savedAt    = $meta.savedAt
            $containers = ($meta.containers | ForEach-Object { $_.name }) -join ', '
            if (-not $containers) { $containers = '(none)' }
        } catch {
            $savedAt = '(metadata unreadable)'
        }
    }

    $totalBytes = (Get-ChildItem $dir.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($totalBytes) {
        $sizeMB = [string]([math]::Round($totalBytes / 1MB, 1)) + ' MB'
    }

    Write-Host ("  {0,-20}  {1,-22}  {2,-8}  {3}" -f $name, $savedAt, $sizeMB, $containers)
}

Write-Host "  $RULER" -ForegroundColor Cyan
Write-Host ("  {0} state(s) total" -f $states.Count) -ForegroundColor Cyan
Write-Host ""
