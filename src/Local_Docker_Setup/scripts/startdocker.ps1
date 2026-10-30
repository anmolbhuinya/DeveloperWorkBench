# startdocker.ps1 - Start Docker Desktop on Windows.
#
# Steps:
#   1. Restart vmcompute (Windows Container compute service) as Administrator
#   2. Launch Docker Desktop elevated
#   3. Wait until Docker daemon is responsive
#
# Run via:  startdocker          (CMD wrapper in .local\bin)
#           powershell startdocker.ps1 (directly)

param()

$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Msg)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] $Msg"
}

function Is-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = [System.Security.Principal.WindowsPrincipal]$id
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Step 1: Restart vmcompute
Write-Log "Step 1 - Restarting vmcompute service..."

if (-not (Is-Admin)) {
    Write-Log "  Not running as Administrator - relaunching elevated for vmcompute restart..."
    $scriptPath = $MyInvocation.MyCommand.Path
    if (-not $scriptPath) { $scriptPath = $PSCommandPath }
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs
    Write-Log "  Elevated window opened - Docker startup continues there."
    exit 0
}

try {
    Restart-Service vmcompute -Force
    Write-Log "  vmcompute restarted successfully."
} catch {
    Write-Log "  WARNING: Could not restart vmcompute: $_"
    Write-Log "  Continuing anyway..."
}

# Step 2: Start Docker Desktop
$dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

Write-Log "Step 2 - Starting Docker Desktop..."

if (-not (Test-Path $dockerExe)) {
    Write-Log "ERROR: Docker Desktop not found at: $dockerExe"
    Write-Log "       Update the path in startdocker.ps1 if Docker is installed elsewhere."
    exit 1
}

$running = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
if ($running) {
    Write-Log "  Docker Desktop is already running (PID $($running.Id))."
} else {
    Start-Process $dockerExe -Verb RunAs
    Write-Log "  Docker Desktop launched."
}

# Step 3: Wait for Docker daemon
Write-Log "Step 3 - Waiting for Docker daemon to become available..."

$maxWait   = 300
$interval  = 5
$elapsed   = 0
$dockerReady = $false

while ($elapsed -lt $maxWait) {
    try {
        # docker version exits 0 when the daemon is reachable (no cgroup warning noise).
        $null = & docker version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerReady = $true
            break
        }
    } catch {}

    Write-Log "  Docker not ready yet - waiting ${interval}s... (${elapsed}s elapsed)"
    Start-Sleep -Seconds $interval
    $elapsed += $interval
}

if ($dockerReady) {
    Write-Log "Docker daemon is ready after ${elapsed}s."
    Write-Log ""
    Write-Log "You can now run containers. Use 'docker ps' to check running containers."
} else {
    Write-Log "WARNING: Docker daemon did not respond within ${maxWait}s."
    Write-Log "         Try running 'docker info' once Docker Desktop finishes loading, then run startservers."
    exit 1
}
