param(
    [string]$SetupRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = "Stop"

$userHome = [Environment]::GetFolderPath('UserProfile')
$userProfileForward = ($userHome -replace '\\', '/')
$templatesDir = Join-Path $SetupRoot "templates"
$sharedConnectorEnv = Join-Path $userHome "shared\connector_env"
$redcardPropsPath = Join-Path $sharedConnectorEnv "redcard.properties"
$testPropsPath = Join-Path $userHome "test.properties"
$hostDomainHome = Join-Path $userHome "domains\healthedge_25.1.4"

Write-Host "================================================================="
Write-Host "Updating local test properties and runtime properties"
Write-Host "================================================================="

function Expand-UserProfilePlaceholders {
    param([string]$Text)
    return $Text -replace '__USERPROFILE__', $userProfileForward
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$sharedDirs = @(
    (Join-Path $sharedConnectorEnv "redcardOutBound\output"),
    (Join-Path $sharedConnectorEnv "redcardOutBoundTemp\output"),
    (Join-Path $sharedConnectorEnv "onDemandTriggerDir")
)
foreach ($dir in $sharedDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
}

$redcardTemplate = Join-Path $templatesDir "redcard.properties.template"
if (-not (Test-Path $redcardTemplate)) {
    throw "Missing template: $redcardTemplate"
}
Write-Utf8NoBom $redcardPropsPath (Expand-UserProfilePlaceholders (Get-Content $redcardTemplate -Raw))
Write-Host "Wrote $redcardPropsPath"

$testTemplate = Join-Path $templatesDir "test.properties.template"
if (-not (Test-Path $testTemplate)) {
    throw "Missing template: $testTemplate"
}

if (-not (Test-Path $testPropsPath)) {
    Write-Host "Creating $testPropsPath from template..."
    Write-Utf8NoBom $testPropsPath (Expand-UserProfilePlaceholders (Get-Content $testTemplate -Raw))
} else {
    Write-Host "Updating existing $testPropsPath ..."
    $content = Get-Content $testPropsPath -Raw
    $content = Expand-UserProfilePlaceholders $content
    $content = $content -replace '(?m)^DEFAULT_URL=.*', 'DEFAULT_URL=t3://127.0.0.1:7001'
    $content = $content -replace '(?m)^EXTERNAL_JNDI_URL=.*', 'EXTERNAL_JNDI_URL=t3://127.0.0.1:7001'
    $content = $content -replace '(?m)^HE_REDCARD_EXTRACT=.*', "HE_REDCARD_EXTRACT=$($userProfileForward)/shared/connector_env/redcard.properties"
    if ($content -notmatch '(?m)^HE_REDCARD_EXTRACT=') {
        $content += "`nHE_REDCARD_EXTRACT=$($userProfileForward)/shared/connector_env/redcard.properties`n"
    }
    if ($content -notmatch '(?m)^VALIDATE_DATA=') {
        $content += "`nVALIDATE_DATA=false`n"
    } else {
        $content = $content -replace '(?m)^VALIDATE_DATA=.*', 'VALIDATE_DATA=false'
    }
    Write-Utf8NoBom $testPropsPath $content
}

Write-Host "Syncing WebLogic domain configuration from container to host..."
if (-not (Test-Path $hostDomainHome)) {
    New-Item -ItemType Directory -Force -Path $hostDomainHome | Out-Null
}

$containerDomainHome = "/opt/oracle/weblogic/user_projects/domains/healthedge"
$folders = @("jars", "tools", "data", "lib", "encrypt-keystore.jks", "runtime.properties", "xml")

foreach ($folder in $folders) {
    Write-Host "  Copying $folder..."
    if ($folder -eq "encrypt-keystore.jks") {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker cp "payer-25-1-4:${containerDomainHome}/$folder" "$hostDomainHome/" 2>$null
        $ErrorActionPreference = $prev
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Skipped (not in container): $folder"
        }
    } else {
        docker cp "payer-25-1-4:${containerDomainHome}/$folder" "$hostDomainHome/"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to copy $folder from payer container (exit $LASTEXITCODE)"
        }
    }
}

Write-Host "Setting DOMAIN_HOME user environment variable..."
[Environment]::SetEnvironmentVariable("DOMAIN_HOME", "%USERPROFILE%\domains\healthedge_25.1.4", "User")
$env:DOMAIN_HOME = $hostDomainHome

Write-Host "Replacing payer-db-25-1-4 with localhost in host config files..."
$configFiles = @(
    (Join-Path $hostDomainHome "runtime.properties"),
    (Join-Path $hostDomainHome "xml\SchedulerConfig.xml"),
    (Join-Path $hostDomainHome "xml\SchedulerConfigForTest.xml"),
    (Join-Path $hostDomainHome "tools\ddl\dw.jocl"),
    (Join-Path $hostDomainHome "tools\ddl\oltp.jocl")
)
foreach ($cfg in $configFiles) {
    if (Test-Path $cfg) {
        (Get-Content $cfg) -replace 'payer-db-25-1-4', 'localhost' | Set-Content $cfg
        Write-Host "  Updated: $cfg"
    }
}

$runtimeProps = Join-Path $hostDomainHome "runtime.properties"
if (Test-Path $runtimeProps) {
    $lines = Get-Content $runtimeProps
    $found = $false
    $newLines = foreach ($line in $lines) {
        if ($line -match '^SDPF_HCC_UNIQUE_IDENTIFIER=') {
            $found = $true
            'SDPF_HCC_UNIQUE_IDENTIFIER=PHIC'
        } else {
            $line
        }
    }
    if (-not $found) { $newLines += 'SDPF_HCC_UNIQUE_IDENTIFIER=PHIC' }
    $newLines | Set-Content $runtimeProps
}

Write-Host "Local property updates completed."
