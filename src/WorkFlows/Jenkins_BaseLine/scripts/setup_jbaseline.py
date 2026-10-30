#!/usr/bin/env python3
"""
setup_jbaseline.py — Jenkins IT BaseLine Tool setup

Usage:
  setupjbaselinetool              Create skeleton files
  setupjbaselinetool -fetchparams Fetch Jenkins build parameters from regression job URLs
  setupjbaselinetool --help       Show this help
"""

import sys
import os
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "Jenkins_BaseLine"        # project data: <DWB>\Projects\WorkFlows\Jenkins_BaseLine
DATA_ROOT.mkdir(parents=True, exist_ok=True)

_SYSTEM_CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def _system_browser():
    return next((p for p in _SYSTEM_CHROME_PATHS if os.path.exists(p)), None)


def _playwright_installed():
    try:
        import playwright  # noqa
        return True
    except ImportError:
        return False


def install_playwright():
    print()
    print("  Installing playwright package...")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "playwright"],
                       capture_output=False)
    if r.returncode != 0:
        print("  ERROR: Failed to install playwright. Try manually: pip install playwright")
        return False
    browser = _system_browser()
    if browser:
        print(f"  System browser found — Chromium download skipped.")
        print(f"    Using: {browser}")
    else:
        print()
        print("  Downloading Chromium browser for Playwright (~170 MB)...")
        r2 = subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
                            capture_output=False)
        if r2.returncode != 0:
            print("  WARNING: Chromium download failed.")
            print("           Install Chrome or Edge, or try: playwright install chromium")
            return False
    print("  Playwright ready.")
    return True


def prompt_install_playwright():
    if _playwright_installed():
        browser = _system_browser()
        if browser:
            print(f"  [skip] Playwright already installed (using system browser: "
                  f"{os.path.basename(browser)}).")
        else:
            print("  [skip] Playwright already installed.")
        return True
    browser = _system_browser()
    print()
    print("  Playwright (headless browser) is required for Jenkins build triggering.")
    if browser:
        print(f"  System browser detected ({os.path.basename(browser)}) — no Chromium download needed.")
    else:
        print("  No system browser found — Chromium (~170 MB) will be downloaded.")
    print()
    try:
        ans = input("  Install Playwright now? [Y/n]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        ans = ""
    if ans in ("", "y", "yes"):
        return install_playwright()
    else:
        print("  Skipped. You can install later with:")
        print("    pip install playwright")
        if not browser:
            print("    playwright install chromium")
        return False


def run_script(path):
    result = subprocess.run([sys.executable, str(path)], capture_output=False)
    return result.returncode == 0


def _create_git_config():
    """Create git_config.xlsx with default payor repo URL."""
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill
    HDR_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
    HDR_FILL = PatternFill("solid", fgColor="1F3864")
    A_ALIGN  = Alignment(horizontal="left", vertical="center")
    git_cfg  = TOOL_ROOT / "git_config.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "repos"
    ws.append(["name", "repo_url"])
    for i in range(1, 3):
        c = ws.cell(1, i)
        c.font = HDR_FONT; c.fill = HDR_FILL; c.alignment = A_ALIGN
    ws.append(["payor", "https://github.com/HE-Core/hrp.payer.core/"])
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 80
    wb.save(str(git_cfg))
    print(f"  [create] git_config.xlsx (default payor repo URL)")


def _gen_readme():
    """Generate ReadMe.docx via gen_readme.js."""
    import shutil
    node = shutil.which("node")
    if not node:
        print("  [skip] node not found — ReadMe.docx not generated.")
        print("         Run  node scripts/gen_readme.js  manually to create it.")
        return
    gen = SCRIPT_DIR / "gen_readme.js"
    if not gen.exists():
        print("  [skip] gen_readme.js not found.")
        return
    result = subprocess.run([node, str(gen)], capture_output=False)
    if result.returncode != 0:
        print("  WARNING: ReadMe.docx generation failed. Run  node scripts/gen_readme.js  manually.")


def setup_skeleton():
    print("\n  Jenkins IT BaseLine Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    baseline_config = TOOL_ROOT / "baseline_job_config.xlsx"
    if baseline_config.exists():
        print("  [skip] baseline_job_config.xlsx already exists")
    else:
        run_script(SCRIPT_DIR / "create_baseline_config.py")

    projects = DATA_ROOT / "projects.xlsx"
    if projects.exists():
        print("  [skip] projects.xlsx already exists")
    else:
        run_script(SCRIPT_DIR / "create_baseline_projects.py")

    params_dir = TOOL_ROOT / "jenkins_params"
    if params_dir.is_dir():
        print("  [skip] jenkins_params/ folder already exists")
    else:
        params_dir.mkdir(parents=True, exist_ok=True)
        print("  [create] jenkins_params/")

    git_cfg = TOOL_ROOT / "git_config.xlsx"
    if git_cfg.exists():
        print("  [skip] git_config.xlsx already exists")
    else:
        _create_git_config()

    projects_dir = DATA_ROOT / "projects"
    if projects_dir.is_dir():
        print("  [skip] projects/ folder already exists")
    else:
        projects_dir.mkdir(parents=True, exist_ok=True)
        print("  [create] projects/")

    print()
    print("  ── Optional dependency: Playwright ──────────────────────────────")
    prompt_install_playwright()

    print()
    print("  ── Generating ReadMe.docx ────────────────────────────────────────")
    _gen_readme()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Verify jenkins_username, jenkins_password are set in secrets.xlsx → Jenkins sheet")
    print("    2. Fill in regression job URLs in baseline_job_config.xlsx → payor sheet")
    print("       (payor_core_commit and payor_utils_certification URLs are pre-filled with {version} template)")
    print("    3. Run:  setupjbaselinetool -fetchparams")
    print("       (fetches build parameters from each regression job)")
    print("    4. Run:  jbaseline -payor 26.1.1.1  to run a baseline")
    print("    5. Run:  jbaselinestatus  to view project status")
    print()


def setup_fetch_params():
    print("\n  Jenkins IT BaseLine Tool — Fetching build parameters\n")

    baseline_config = TOOL_ROOT / "baseline_job_config.xlsx"
    if not baseline_config.exists():
        print("  ERROR: baseline_job_config.xlsx not found. Run  setupjbaselinetool  first.")
        sys.exit(1)

    ok = run_script(SCRIPT_DIR / "fetch_baseline_params.py")
    if not ok:
        print("  ERROR: Parameter fetch failed. Check credentials and VPN access.")
        sys.exit(1)
    print("  Done. Review jenkins_params/ files.")
    print()


def print_help():
    print("""
  setupjbaselinetool — Jenkins IT BaseLine Tool setup

  Usage:
    setupjbaselinetool                Create skeleton files
    setupjbaselinetool -fetchparams   Fetch Jenkins build parameters for regression jobs
    setupjbaselinetool --help         Show this help

  Typical workflow:
    1. setupjbaselinetool
    2. Fill in credentials in secrets.xlsx → Jenkins sheet
    3. Fill in regression job URLs in baseline_job_config.xlsx → payor sheet
    4. setupjbaselinetool -fetchparams
    5. jbaseline -payor 26.1.1.1

  Files:
    baseline_job_config.xlsx   Job URLs (payor sheet)
    projects.xlsx              Run history log
    jenkins_params/            Per-job build parameter files (filled by -fetchparams)
    git_config.xlsx            GitHub repo URL for pom.xml version fetching
    secrets.xlsx               Shared credentials (Jenkins sheet)
""")


def main():
    args = sys.argv[1:]
    if not args:
        setup_skeleton()
    elif args[0] in ("-fetchparams", "--fetchparams"):
        setup_fetch_params()
    elif args[0] in ("--help", "-h"):
        print_help()
    else:
        print(f"  Unknown option: {args[0]}")
        print("  Usage: setupjbaselinetool [-fetchparams] [--help]")
        sys.exit(1)


if __name__ == "__main__":
    main()
