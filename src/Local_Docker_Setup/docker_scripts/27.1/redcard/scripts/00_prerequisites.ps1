param(
    [string]$SetupRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param([string[]]$DockerArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & docker @DockerArgs
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return $code
}

function Test-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found on PATH: $Name"
    }
}

Write-Host "Checking prerequisites..."

Test-Command "docker"
Test-Command "java"
Test-Command "mvn"

if ((Invoke-Docker -DockerArgs @("info")) -ne 0) {
    throw "Docker is not running. Start Docker Desktop and retry."
}

$artifactsDir = Join-Path $SetupRoot "artifacts"
if (-not (Test-Path $artifactsDir)) {
    New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null
}

& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "Ensure-Artifacts.ps1") `
    -SetupRoot $SetupRoot -SkipDownload:$SkipDownload

$requiredPatterns = @(
    "core-distribution-*.tar.gz",
    "connector-distribution-*.tar.gz",
    "connector-classic-distribution-*.tar.gz",
    "he-redcard-*-repos*.kar",
    "he-batch-transaction-custom-datasource-repos*.kar",
    "he-batch-transaction-schema-repos*.kar",
    "he-batch-transaction-repos*.kar",
    "wl.properties",
    "docker-compose.yml"
)

$missing = @()
foreach ($pattern in $requiredPatterns) {
    if (-not (Get-ChildItem -Path $artifactsDir -Filter $pattern -ErrorAction SilentlyContinue)) {
        $missing += $pattern
    }
}
if ($missing.Count -gt 0) {
    throw ("Missing required artifacts under '$artifactsDir':`n  - " + ($missing -join "`n  - "))
}

$userHome = [Environment]::GetFolderPath("UserProfile")
$sharedDirs = @(
    (Join-Path $userHome "shared\payor_env"),
    (Join-Path $userHome "shared\connector_env"),
    (Join-Path $userHome "shared\connector_env\redcardOutBound\output"),
    (Join-Path $userHome "shared\connector_env\redcardOutBoundTemp\output"),
    (Join-Path $userHome "shared\connector_env\onDemandTriggerDir")
)
foreach ($dir in $sharedDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Host "Created $dir"
    }
}

Write-Host "Checking Docker images (pull if missing; requires Nexus login)..."
$images = @(
    "nexus.headquarters.healthedge.com:8124/payor-wls-14.1.1.0.0-rhel8.10.2024-07-06-mvn-3.3.9-jdk-11.0.12:poc-1",
    "nexus.headquarters.healthedge.com:8124/connector-enrollment-25.1:latest",
    "nexus.headquarters.healthedge.com:8124/oracle-db:25.1"
)
foreach ($image in $images) {
    if ((Invoke-Docker -DockerArgs @("image", "inspect", $image)) -ne 0) {
        Write-Host "  Pulling $image ..."
        if ((Invoke-Docker -DockerArgs @("pull", $image)) -ne 0) {
            throw "Failed to pull $image. Run: docker login nexus.headquarters.healthedge.com:8124"
        }
    }
}

Write-Host "Prerequisites OK."
