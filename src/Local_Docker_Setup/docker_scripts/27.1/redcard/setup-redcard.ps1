param([switch]$NoLog)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $NoLog) {
    $logDir = Join-Path $scriptDir "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir | Out-Null
    }
    $logFile = Join-Path $logDir ("setup-redcard_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    Write-Host "Logging to: $logFile"
    cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$MyInvocation.MyCommand.Path`" -NoLog 2>&1" |
        Tee-Object -FilePath $logFile
    exit $LASTEXITCODE
}

function Write-StepBanner {
    param([string]$Message)
    Write-Host "================================================================="
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
    Write-Host "================================================================="
}

function Invoke-SetupStep {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FATAL: $Name failed (exit $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
}

Write-StepBanner "RedCard-only setup (assumes Payor + base Connector already installed)"

$payerRunning = docker ps --filter "name=payer-25-1-4" --format "{{.Names}}"
$connectorRunning = docker ps --filter "name=connector-25-1-4" --format "{{.Names}}"
if (-not $payerRunning -or -not $connectorRunning) {
    throw "Containers payer-25-1-4 and/or connector-25-1-4 are not running. Run setup-all.ps1 first."
}

Write-StepBanner "Ensuring RedCard artifacts are present"
& (Join-Path $scriptDir "scripts\Ensure-Artifacts.ps1") -SetupRoot $scriptDir

Write-StepBanner "Copying RedCard artifacts to connector"
$artifactsDir = Join-Path $scriptDir "artifacts"
Get-ChildItem $artifactsDir -Filter "*.kar" | ForEach-Object {
    Write-Host "  Copying $($_.Name)..."
    docker cp $_.FullName connector-25-1-4:/home/cprime/staging/cprime/
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to copy $($_.Name)"
    }
}

Write-StepBanner "Copying deployment scripts to containers"
docker cp (Join-Path $scriptDir "scripts\01_deploy_connector_wls.sh") payer-25-1-4:/home/weblogic/01_deploy_connector_wls.sh
docker cp (Join-Path $scriptDir "scripts\02_configure_karaf.sh") connector-25-1-4:/home/cprime/02_configure_karaf.sh
docker exec -u root payer-25-1-4 bash -c "chmod +x /home/weblogic/01_deploy_connector_wls.sh && dos2unix /home/weblogic/01_deploy_connector_wls.sh 2>/dev/null || true"
docker exec -u root connector-25-1-4 bash -c "chmod +x /home/cprime/02_configure_karaf.sh && dos2unix /home/cprime/02_configure_karaf.sh 2>/dev/null || true"

Invoke-SetupStep "Connector Classic deploy" {
    docker exec -u weblogic payer-25-1-4 bash -c "/home/weblogic/01_deploy_connector_wls.sh"
}

Invoke-SetupStep "Karaf RedCard config" {
    docker exec -u cprime connector-25-1-4 bash -c "/home/cprime/02_configure_karaf.sh"
}

Invoke-SetupStep "Host properties" {
    & (Join-Path $scriptDir "scripts\03_update_properties.ps1") -SetupRoot $scriptDir
}

Invoke-SetupStep "WebLogic" {
    & (Join-Path $scriptDir "scripts\04_ensure_wls_running.ps1")
}

Write-StepBanner "RedCard setup completed successfully"
