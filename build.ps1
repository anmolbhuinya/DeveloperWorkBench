<#
  build.ps1 - builds everything that is NOT in git, from a fresh clone, on Windows.

    powershell -ExecutionPolicy Bypass -File build.ps1            # UI + Deploy.exe
    powershell -ExecutionPolicy Bypass -File build.ps1 -SkipUI    # only Deploy.exe

  1. portable Node.js  -> tools\node          (downloaded once from nodejs.org, version pinned below)
  2. UI dependencies   -> src\Internal_Developer_Tool\ui\node_modules   (npm ci: exactly what package-lock.json says)
  3. React UI          -> src\Internal_Developer_Tool\static             (vite build)
  4. Deploy.exe        -> Deploy.exe          (C# compiler that ships with Windows - nothing to install)
  5. CreateInstaller.exe -> CreateInstaller.exe  (the installer sources are embedded in it; Deploy.exe publishes it to the DWB folder)

  6. ExportProjects.exe / ImportProjects.exe -> same folder (export / restore all project data as one zip)

  Needs internet only for steps 1-2. Then use Deploy.exe to publish to an installed DeveloperWorkBench.
#>
param([switch]$SkipUI)
$ErrorActionPreference = 'Stop'
$NodeVersion = '24.13.0'
$ws   = $PSScriptRoot
$node = Join-Path $ws 'tools\node'
$ui   = Join-Path $ws 'src\Internal_Developer_Tool\ui'

if (-not $SkipUI) {
    # 1. portable Node.js
    if (-not (Test-Path (Join-Path $node 'node.exe'))) {
        Write-Host "Downloading Node.js $NodeVersion ..."
        $zip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
        Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip -UseBasicParsing
        $sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
        $want = ($sums -split "`n" | Where-Object { $_ -match "node-v$NodeVersion-win-x64.zip" } | Select-Object -First 1).Split(' ')[0]
        if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $want.ToLower()) { throw 'Node.js download failed its checksum' }
        $tmp = Join-Path $env:TEMP "node_unzip_$([guid]::NewGuid().ToString('N').Substring(0,8))"
        Expand-Archive $zip $tmp
        New-Item -ItemType Directory (Split-Path $node) -Force | Out-Null
        Move-Item (Join-Path $tmp "node-v$NodeVersion-win-x64") $node
        Remove-Item $tmp, $zip -Recurse -Force
    }
    $env:PATH = "$node;$env:PATH"
    Write-Host "Node $(& "$node\node.exe" -v)"

    # 2. dependencies exactly as locked
    if (-not (Test-Path (Join-Path $ui 'node_modules'))) {
        Write-Host 'Installing UI dependencies (npm ci) ...'
        Push-Location $ui
        & "$node\node.exe" "$node\node_modules\npm\bin\npm-cli.js" ci
        if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci failed' }
        Pop-Location
    }

    # 3. build the UI
    Write-Host 'Building the UI ...'
    Push-Location $ui
    & "$node\node.exe" "$ui\node_modules\vite\bin\vite.js" build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'UI build failed' }
    Pop-Location
}


function Build-Exe([string]$name, [string[]]$cscArgs) {
    $tmp = Join-Path $env:TEMP ("dwb_build_" + $name)
    & $csc /nologo /target:winexe /optimize+ "/out:$tmp" @cscArgs
    if ($LASTEXITCODE -ne 0) { throw "$name compile failed" }
    try { Copy-Item $tmp (Join-Path $ws $name) -Force -ErrorAction Stop }
    catch { Write-Warning "$name is running - close it and run build.ps1 again to update it." }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

# 4. Deploy.exe
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$src = Join-Path $ws 'tools\deploy_src'
Write-Host 'Compiling Deploy.exe ...'
Build-Exe 'Deploy.exe' @("/win32icon:$src\deploy.ico", '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', "$src\Deploy.cs")
# 5. CreateInstaller.exe: builds DeveloperWorkbenchSetup.exe from an installed DWB; the sources it needs travel inside it
$isrc = Join-Path $ws 'src\installer_src'
Write-Host 'Compiling CreateInstaller.exe ...'
Build-Exe 'CreateInstaller.exe' @("/win32icon:$isrc\dwb.ico",
    "/resource:$isrc\build_installer.py,build_installer.py", "/resource:$isrc\Installer.cs,Installer.cs",
    "/resource:$isrc\Launcher.cs,Launcher.cs", "/resource:$isrc\dwb.ico,dwb.ico",
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', "$isrc\CreateInstaller.cs")

# 6. ExportProjects.exe / ImportProjects.exe
$esrc = Join-Path $ws 'tools\export_src'
foreach ($n in 'ExportProjects', 'ImportProjects') {
    Write-Host "Compiling $n.exe ..."
    $ico = if ($n -eq 'ExportProjects') { 'export.ico' } else { 'import.ico' }
    Build-Exe "$n.exe" @("/win32icon:$esrc\$ico", '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
        '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll', "$esrc\$n.cs")
}

Write-Host "`nDone: Deploy.exe  CreateInstaller.exe  ExportProjects.exe  ImportProjects.exe  (in $ws)" -ForegroundColor Green
