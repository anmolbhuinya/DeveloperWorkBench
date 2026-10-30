param(
    [string]$SetupRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
    [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"

$artifactsDir = Join-Path $SetupRoot "artifacts"
$manifestPath = Join-Path $artifactsDir "artifacts.manifest.json"

if (-not (Test-Path $artifactsDir)) {
    New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null
}

function Get-NexusCredential {
    if ($env:NEXUS_USERNAME -and $env:NEXUS_PASSWORD) {
        $secure = ConvertTo-SecureString $env:NEXUS_PASSWORD -AsPlainText -Force
        return [PSCredential]::new($env:NEXUS_USERNAME, $secure)
    }
    return $null
}

function Test-ArtifactGlobPresent {
    param([string]$GlobPattern)
    return [bool](Get-ChildItem -Path $artifactsDir -Filter $GlobPattern -ErrorAction SilentlyContinue)
}

function Save-ArtifactFromUrl {
    param(
        [string]$Url,
        [string]$DestPath
    )
    $credential = Get-NexusCredential
    $params = @{
        Uri             = $Url
        OutFile         = $DestPath
        UseBasicParsing = $true
    }
    if ($credential) {
        $params.Credential = $credential
    }
    Invoke-WebRequest @params
}

if ($SkipDownload) {
    Write-Host "Skipping artifact download (-SkipDownload)."
    return
}

if (-not (Test-Path $manifestPath)) {
    throw "Missing artifact manifest: $manifestPath"
}

$entries = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "Ensuring setup artifacts are present under $artifactsDir ..."

foreach ($entry in $entries) {
    if (Test-ArtifactGlobPresent $entry.glob) {
        $existing = (Get-ChildItem -Path $artifactsDir -Filter $entry.glob | Select-Object -First 1).Name
        Write-Host "  OK (present): $existing"
        continue
    }

    $fileName = [System.IO.Path]::GetFileName($entry.url)
    $destPath = Join-Path $artifactsDir $fileName
    $tmpPath = "$destPath.download"

    Write-Host "  Downloading $fileName ..."
    Write-Host "    from $($entry.url)"

    if (Test-Path $tmpPath) { Remove-Item $tmpPath -Force }
    try {
        Save-ArtifactFromUrl $entry.url $tmpPath
    } catch {
        if (Test-Path $tmpPath) { Remove-Item $tmpPath -Force -ErrorAction SilentlyContinue }
        throw @"
Failed to download $($entry.id) from Nexus. Connect to VPN and retry.
Optional: set NEXUS_USERNAME / NEXUS_PASSWORD if the repo requires auth.
$($_.Exception.Message)
"@
    }

    if (-not (Test-Path $tmpPath) -or (Get-Item $tmpPath).Length -lt 1024) {
        if (Test-Path $tmpPath) { Remove-Item $tmpPath -Force }
        throw "Download of $fileName looks invalid (missing or too small). Check Nexus access."
    }

    Move-Item -Force $tmpPath $destPath
    Write-Host "  Saved: $destPath"
}

Write-Host "Artifact download check complete."
