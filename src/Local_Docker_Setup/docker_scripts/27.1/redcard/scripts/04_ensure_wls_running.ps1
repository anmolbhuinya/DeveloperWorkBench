param(
    [int]$TimeoutMinutes = 25
)

$ErrorActionPreference = "Stop"

$logPath = "/opt/oracle/weblogic/user_projects/domains/healthedge/logs/startWebLogic.log"
$wlgo = "/opt/oracle/weblogic/user_projects/domains/healthedge/tools/bin/wlgo"

Write-Host "Ensuring WebLogic is RUNNING in payer-25-1-4..."

function Test-WlsRunningInContainer {
    docker exec payer-25-1-4 bash -c "pgrep -f weblogic.Server >/dev/null"
    if ($LASTEXITCODE -ne 0) { return $false }

    $state = docker exec payer-25-1-4 bash -c "grep 'Server state changed to' $logPath 2>/dev/null | tail -1"
    if ($state -notmatch 'RUNNING') { return $false }
    return $true
}

if (-not (Test-WlsRunningInContainer)) {
    Write-Host "WebLogic not running - starting via wlgo..."
    docker exec -u weblogic payer-25-1-4 bash -c "$wlgo start"
    if ($LASTEXITCODE -ne 0) {
        throw "wlgo start failed (exit $LASTEXITCODE)"
    }
}

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Date) -lt $deadline) {
    if (Test-WlsRunningInContainer) {
        $portOk = Test-NetConnection -ComputerName 127.0.0.1 -Port 7001 `
            -WarningAction SilentlyContinue -InformationLevel Quiet
        if ($portOk) {
            Write-Host "WebLogic is RUNNING and port 7001 is reachable."
            exit 0
        }
    }
    Start-Sleep -Seconds 15
    Write-Host "  Waiting for WebLogic RUNNING..."
}

docker exec payer-25-1-4 bash -c "tail -20 $logPath 2>/dev/null" 2>&1
throw "WebLogic did not reach RUNNING within $TimeoutMinutes minutes."
