param(
    [switch]$NoLog,
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $NoLog) {
    $logDir = Join-Path $scriptDir "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir | Out-Null
    }
    $logFile = Join-Path $logDir ("setup-all_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    Write-Host "Logging all output to: $logFile"

    $skipArg = if ($SkipDownload) { "-SkipDownload" } else { "" }
    cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File `"$MyInvocation.MyCommand.Path`" -NoLog $skipArg 2>&1" |
        Tee-Object -FilePath $logFile

    $exitCode = $LASTEXITCODE
    Write-Host "Setup finished with exit code $exitCode. Full log: $logFile"
    exit $exitCode
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
        Write-Host "FATAL: $Name failed (exit code $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
}

function Copy-ScriptToContainer {
    param(
        [string]$ScriptName,
        [ValidateSet("payer", "connector")]
        [string]$Target
    )

    $scriptPath = Join-Path $scriptDir "scripts\$ScriptName"

    if ($Target -eq "payer") {
        docker cp $scriptPath "payer-25-1-4:/home/weblogic/$ScriptName"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FATAL: docker cp $ScriptName to payer failed"
            exit 1
        }
        docker exec -u root payer-25-1-4 bash -c "chmod +x /home/weblogic/$ScriptName && dos2unix /home/weblogic/$ScriptName 2>/dev/null || true && chown weblogic:weblogic /home/weblogic/$ScriptName"
    } else {
        docker cp $scriptPath "connector-25-1-4:/home/cprime/$ScriptName"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FATAL: docker cp $ScriptName to connector failed"
            exit 1
        }
        docker exec -u root connector-25-1-4 bash -c "chmod +x /home/cprime/$ScriptName && dos2unix /home/cprime/$ScriptName 2>/dev/null || true && chown cprime:cprime /home/cprime/$ScriptName"
    }
}

Write-StepBanner "End-to-End Payor and RedCard Setup"

Write-StepBanner "Step 0: Prerequisites"
& (Join-Path $scriptDir "scripts\00_prerequisites.ps1") -SetupRoot $scriptDir -SkipDownload:$SkipDownload

Write-StepBanner "Step 1: Provisioning Docker Stack"
Invoke-SetupStep "Step 1 (Docker stack)" {
    & (Join-Path $scriptDir "scripts\01_provision_docker_stack.ps1")
}

Write-StepBanner "Step 2: Preparing staging directories"
Invoke-SetupStep "Step 2 (staging dirs)" {
    docker exec payer-25-1-4 bash -c "mkdir -p /home/cprime/staging/cprime"
    docker exec -u root connector-25-1-4 bash -c "mkdir -p /home/cprime/staging/cprime && chown cprime:cprime /home/cprime/staging/cprime"
}

Write-StepBanner "Step 3: Copying artifacts to Docker containers (several minutes)"
$artifactsDir = Join-Path $scriptDir "artifacts"
foreach ($artifact in Get-ChildItem -Path $artifactsDir) {
    $name = $artifact.Name
    if ($name -match "connector-classic-distribution|core-distribution|wl\.properties") {
        Write-Host "  Copying $name to payer-25-1-4..."
        docker cp $artifact.FullName payer-25-1-4:/home/cprime/staging/cprime/
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FATAL: Failed to copy $name to payer-25-1-4"
            exit 1
        }
    } elseif ($name -match "connector-distribution|\.kar$") {
        Write-Host "  Copying $name to connector-25-1-4..."
        docker cp $artifact.FullName connector-25-1-4:/home/cprime/staging/cprime/
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FATAL: Failed to copy $name to connector-25-1-4"
            exit 1
        }
    }
}

Write-StepBanner "Step 4: Copying scripts to Docker containers"
@(
    @{ Name = "02_install_payor_and_db.sh";  Target = "payer" },
    @{ Name = "01_deploy_connector_wls.sh";  Target = "payer" },
    @{ Name = "03_install_base_connector.sh"; Target = "connector" },
    @{ Name = "02_configure_karaf.sh";       Target = "connector" }
) | ForEach-Object {
    Copy-ScriptToContainer -ScriptName $_.Name -Target $_.Target
}

Write-StepBanner "Step 5: Installing Payor 25.1.4 and upgrading databases"
Invoke-SetupStep "Step 5 (Payor install)" {
    docker exec -u weblogic payer-25-1-4 bash -c "/home/weblogic/02_install_payor_and_db.sh"
}

Write-StepBanner "Step 6: Installing base Connector server"
Invoke-SetupStep "Step 6 (Base Connector)" {
    docker exec -u cprime connector-25-1-4 bash -c "cd /home/cprime && ./03_install_base_connector.sh --payer-container payer-25-1-4"
}

Write-StepBanner "Step 7: Deploying Connector Classic to WebLogic"
Invoke-SetupStep "Step 7 (Connector Classic)" {
    docker exec -u weblogic payer-25-1-4 bash -c "/home/weblogic/01_deploy_connector_wls.sh"
}

Write-StepBanner "Step 8: Configuring Karaf with RedCard KARs"
Invoke-SetupStep "Step 8 (Karaf / RedCard)" {
    docker exec -u cprime connector-25-1-4 bash -c "/home/cprime/02_configure_karaf.sh"
}

Write-StepBanner "Step 9: Syncing host properties and test configuration"
Invoke-SetupStep "Step 9 (host properties)" {
    & (Join-Path $scriptDir "scripts\03_update_properties.ps1") -SetupRoot $scriptDir
}

Write-StepBanner "Step 10: Ensuring WebLogic is RUNNING for host-side tests"
Invoke-SetupStep "Step 10 (WebLogic)" {
    & (Join-Path $scriptDir "scripts\04_ensure_wls_running.ps1")
}

Write-StepBanner "Setup completed successfully"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Copy templates\settings.xml.template to %USERPROFILE%\.m2\settings.xml (Nexus credentials)"
Write-Host "  2. Clone hrp.he.redcard and run integration tests from that repo if needed"
Write-Host ""
