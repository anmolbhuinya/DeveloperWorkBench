r"""Build DeveloperWorkbenchSetup.exe from an installed Developer Workbench  (self-contained: bundled Python, wrappers, icon).

Used two ways:
  * by  CreateInstaller.exe  (this file is embedded in it):
        python build_installer.py --src <DWB>\DeveloperWorkBench --out <folder>\DeveloperWorkbenchSetup.exe --work <dir> --create-installer <exe>
  * by the developer, to (re)build CreateInstaller.exe and the first installer:
        python build_installer.py --dev

Steps: dwb.ico -> Launcher.cs -> DeveloperWorkbench.exe (hidden-Python launcher used by the shortcuts)
       -> payload.zip (the Workbench + bundled python + command-wrapper templates + CreateInstaller.exe)
       -> Installer.cs -> DeveloperWorkbenchSetup.exe
"""
import argparse
import fnmatch
import io
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOME = Path(os.environ.get("USERPROFILE") or Path.home())
CSC = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"

# directories (by name, anywhere) and files (glob) that are NOT shipped
SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".idea", "tests", "run_logs", "ai_jobs", "merge_jobs", "jobs",
             "Sonar_Report", "stats", "logs", "remote_deployed_info"}
SKIP_REL = {"installer_src/__build", "scripts/wrappers", "WorkFlows/GP_Build/projects", "Tools/AIAnalyzer/jobs", "WorkFlows/Remote_Regression_Jenkins_IT_Failure/projects/Payor/output"}
SKIP_FILES = ["*.zip", "CreateInstaller.exe", "secrets.xlsx", "vms.xlsx", "*.bak", "*.bak_*", "*.pathbak", "*.corrupt.bak", "*.pid", "*.log", "*.pyc",
              "sonar_cache.json", "eta_cache.json", "projects.xlsx", "idp_server.py.bak*", "install.txt",
              # regenerated below
              "start_developer_workbench.bat", "stop_developer_workbench.bat", "uninstall.bat", "README.txt", "DeveloperWorkbench.exe"]
# python runtime: parts that are not needed
PY_SKIP_REL = {"python/Doc", "python/include", "python/libs", "python/Scripts", "python/Lib/idlelib", "python/Lib/test",
               "python/Lib/turtledemo", "python/Lib/ensurepip", "python/Lib/lib2to3", "python/Lib/tkinter", "python/tcl",
               "python/Lib/site-packages/pip"}
# run history shipped as an empty template (header row only)
TEMPLATE_XLSX = {"WorkFlows/GP_Build/projects.xlsx"}

START_BAT = r"""@echo off
rem Starts the Developer Workbench with its bundled Python and opens the browser (the desktop shortcut does this without a terminal).
set "PATH=%~dp0python;%~dp0python\Scripts;%PATH%"
set "PYTHONHOME="
set "PYTHONUTF8=1"
"%~dp0python\python.exe" "%~dp0Internal_Developer_Tool\scripts\idp_server.py" %*
"""
STOP_BAT = r"""@echo off
set "PATH=%~dp0python;%PATH%"
"%~dp0python\python.exe" "%~dp0Internal_Developer_Tool\scripts\idp_server.py" --stop
"""
UNINSTALL_BAT = r"""@echo off
rem Removes the Developer Workbench program files. AI_Workspace, HE_UI_Clients, Projects and Workspace are left alone.
setlocal
if /I "%~1"=="/run" goto run
copy /y "%~f0" "%TEMP%\dwb_uninstall.bat" >nul
start "" "%TEMP%\dwb_uninstall.bat" /run "%~dp0"
exit /b
:run
set "APP=%~2"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
echo This removes the Developer Workbench program from:
echo   %APP%
echo Your AI_Workspace, HE_UI_Clients, Projects and Workspace folders are NOT touched.
echo (secrets.xlsx and other settings inside that folder are deleted with it.)
echo The command wrappers in %USERPROFILE%\.local\bin are left as they are.
echo.
choice /m "Continue"
if errorlevel 2 exit /b
call "%APP%\stop_developer_workbench.bat" >nul 2>nul
timeout /t 2 /nobreak >nul
rd /s /q "%APP%"
del /q "%APP%\..\CreateInstaller.exe" "%APP%\..\ExportProjects.exe" "%APP%\..\ImportProjects.exe" 2>nul
del /q "%USERPROFILE%\Desktop\Developer Workbench.lnk" 2>nul
rd /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Developer Workbench" 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DeveloperWorkbench" /f >nul 2>nul
echo Developer Workbench was removed.
pause
"""
README = """Developer Workbench
===================
Start:  the "Developer Workbench" shortcut (Desktop / Start Menu) - no terminal window opens.
        Command line: startidp  (or start_developer_workbench.bat)
Stop:   "Stop Developer Workbench" in the Start Menu, stopidp, or stop_developer_workbench.bat
Remove: Windows Settings > Installed apps > Developer Workbench (or uninstall.bat)

Python 3 and all required packages are bundled in the python folder - nothing else to install.

Commands (listwfc shows all of them) are wrappers in %USERPROFILE%\\.local\\bin. The installer ran setupalltools and
sync_wrappers.py, which point every wrapper (.cmd and Git Bash) at this folder. Run  python scripts\\sync_wrappers.py
again if you ever move this folder. Details of the setup run: setup_all_tools.log

Before first use, open  secrets.xlsx  in this folder (or use Secrets in the Workbench) and fill in the value column for
your Jira / Sonar / GitHub / Jenkins / VM credentials. The installer ships only the keys and notes - never the values - and
keeps your own secrets.xlsx when you re-install.

CreateInstaller.exe (in the folder above this one) builds a new DeveloperWorkbenchSetup.exe from the current contents of
this installation, by default into your Downloads folder.
ExportProjects.exe saves your projects, settings and run history as one zip (default: Downloads); ImportProjects.exe restores it.

The folders next to this one (AI_Workspace, HE_UI_Clients, Projects, Workspace) are where the Workbench keeps its work.
"""


def run(cmd):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.stdout.strip() or r.stderr.strip():
        print((r.stdout + r.stderr).strip(), flush=True)
    if r.returncode != 0:
        sys.exit(f"failed: {Path(str(cmd[0])).name}")


def skip(rel: str, is_dir: bool) -> bool:
    name = rel.rsplit("/", 1)[-1]
    if is_dir:
        return rel in PY_SKIP_REL or name in SKIP_DIRS or rel in SKIP_REL
    return any(fnmatch.fnmatch(name, p) for p in SKIP_FILES) and rel not in TEMPLATE_XLSX


def template_xlsx(path: Path) -> bytes:
    import openpyxl
    wb = openpyxl.load_workbook(path)
    for ws in wb:
        if ws.max_row > 1:
            ws.delete_rows(2, ws.max_row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def template_secrets(path: Path) -> bytes:
    """secrets.xlsx structure only: every sheet's header, keys and notes are kept, the value column is emptied."""
    import openpyxl
    wb = openpyxl.load_workbook(path)
    for ws in wb:
        hdr = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
        vcol = hdr.index("value") + 1 if "value" in hdr else 2
        for r in range(2, ws.max_row + 1):
            c = ws.cell(r, vcol)
            c.hyperlink = None            # a hyperlink would bring the cell text (URL / e-mail) back
            c.value = None
        ws._hyperlinks = [h for h in ws._hyperlinks if not (h.ref and h.ref.startswith(openpyxl.utils.get_column_letter(vcol)))]
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_zip(src: Path, zpath: Path, launcher: Path, create_installer: Path | None):
    n = size = 0
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, dirs, files in os.walk(src):
            rel_root = Path(root).relative_to(src).as_posix()
            rel_root = "" if rel_root == "." else rel_root
            dirs[:] = [d for d in dirs if not skip((rel_root + "/" + d).lstrip("/"), True)]
            for f in files:
                rel = (rel_root + "/" + f).lstrip("/")
                p = Path(root) / f
                if rel in TEMPLATE_XLSX:
                    z.writestr(rel, template_xlsx(p))
                    n += 1
                    continue
                if rel == "secrets.xlsx":                  # keys + notes only - the values are never packed
                    z.writestr(rel, template_secrets(p))
                    n += 1
                    continue
                if skip(rel, False):
                    continue
                z.write(p, rel)                       # forward slashes in entry names
                n += 1
                size += p.stat().st_size
        z.write(launcher, "DeveloperWorkbench.exe")
        if create_installer and create_installer.exists():
            z.write(create_installer, "_root/CreateInstaller.exe")      # extracted next to DeveloperWorkBench\ (the DWB folder)
        for tool in ("ExportProjects.exe", "ImportProjects.exe"):       # data export / import tools live next to CreateInstaller.exe
            tp = src.parent / tool
            if tp.exists():
                z.write(tp, "_root/" + tool)
        # command wrappers (listwfc, gprun, refresh-payor, startidp ... .cmd and bash) as templates: {ROOT} = install folder.
        # scripts/sync_wrappers.py writes them to ~/.local/bin during the install.
        bindir = Path(os.environ.get("DWB_WRAPPER_BIN") or (HOME / ".local" / "bin"))
        root_back, root_fwd = str(src), str(src).replace("\\", "/")
        nw = 0
        for f in sorted(bindir.iterdir()) if bindir.is_dir() else []:
            if not f.is_file() or f.name.lower().startswith("claude"):
                continue
            text = f.read_bytes().decode("utf-8", "replace")
            if root_back not in text and root_fwd not in text:
                continue                                           # not one of ours
            z.writestr("scripts/wrappers/" + f.name, text.replace(root_back, "{ROOT}").replace(root_fwd, "{ROOT}").encode("utf-8"))
            nw += 1
        print(f"wrapper templates: {nw}", flush=True)
        for name, text in (("start_developer_workbench.bat", START_BAT), ("stop_developer_workbench.bat", STOP_BAT),
                           ("uninstall.bat", UNINSTALL_BAT), ("README.txt", README)):
            z.writestr(name, text.replace("\r\n", "\n").replace("\n", "\r\n"))
    print(f"payload: {n} files, {size / 1e6:.1f} MB -> {zpath.stat().st_size / 1e6:.1f} MB zip", flush=True)


def build_installer(src: Path, out: Path, work: Path, create_installer: Path | None):
    if not CSC.exists():
        sys.exit(f"C# compiler not found: {CSC}")
    if not (src / "python" / "python.exe").exists():
        sys.exit(f"bundled python not found in {src}")
    ico = work / "dwb.ico"
    if not ico.exists():
        sys.exit("dwb.ico is missing")
    launcher = work / "DeveloperWorkbench.exe"
    print("compiling the launcher ...", flush=True)
    run([CSC, "/nologo", "/target:winexe", "/optimize+", f"/win32icon:{ico}", f"/out:{launcher}",
         "/reference:System.Windows.Forms.dll", work / "Launcher.cs"])
    zpath = work / "payload.zip"
    print("packing the Workbench ...", flush=True)
    build_zip(src, zpath, launcher, create_installer)
    print("compiling the installer ...", flush=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = work / "DeveloperWorkbenchSetup.exe"
    run([CSC, "/nologo", "/target:winexe", "/optimize+", f"/win32icon:{ico}", f"/out:{tmp_out}", f"/resource:{zpath},payload.zip",
         "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", "/reference:System.IO.Compression.dll",
         "/reference:System.IO.Compression.FileSystem.dll", work / "Installer.cs"])
    shutil.copyfile(tmp_out, out)
    print(f"built {out} ({out.stat().st_size / 1e6:.1f} MB)", flush=True)


def tempfile_dir() -> str:
    import tempfile
    return tempfile.mkdtemp(prefix="dwb_ci_")


def build_create_installer(dwb_root: Path) -> Path:
    """Developer step: compile CreateInstaller.exe (this script + sources embedded) and put it into the DWB folder."""
    ico = HERE / "dwb.ico"
    if not ico.exists():
        run([sys.executable, HERE / "make_icon.py"])
    exe = Path(tempfile_dir()) / "CreateInstaller.exe"
    res = []
    for name in ("build_installer.py", "Installer.cs", "Launcher.cs", "dwb.ico"):
        res.append(f"/resource:{HERE / name},{name}")
    run([CSC, "/nologo", "/target:winexe", "/optimize+", f"/win32icon:{ico}", f"/out:{exe}", *res,
         "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll", HERE / "CreateInstaller.cs"])
    dwb_root.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copyfile(exe, dwb_root / "CreateInstaller.exe")
    except PermissionError:
        sys.exit("CreateInstaller.exe in the DWB folder is running - close it and run again")
    print(f"CreateInstaller.exe -> {dwb_root / 'CreateInstaller.exe'}", flush=True)
    return dwb_root / "CreateInstaller.exe"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev", action="store_true", help="developer build: CreateInstaller.exe into the DWB folder + installer into Installers")
    ap.add_argument("--src", default=str(HOME / "DWB" / "DeveloperWorkBench"))
    ap.add_argument("--out", default=str(HOME / "Downloads" / "DeveloperWorkbenchSetup.exe"))
    ap.add_argument("--work", default="")
    ap.add_argument("--create-installer", default="")
    a = ap.parse_args()
    import tempfile
    src = Path(a.src)
    ci = Path(a.create_installer) if a.create_installer else None
    if a.dev:
        ci = build_create_installer(src.parent)
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="dwb_build_"))
    if not a.work:                                  # developer run: sources come from this folder
        for f in ("Installer.cs", "Launcher.cs", "dwb.ico"):
            shutil.copyfile(HERE / f, work / f)
    try:
        build_installer(src, Path(a.out), work, ci)
    finally:
        if not a.work:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
