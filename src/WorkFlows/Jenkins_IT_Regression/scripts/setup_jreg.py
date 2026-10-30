#!/usr/bin/env python3
"""
setup_jreg.py — Jenkins IT Regression Tool setup

Usage:
  setupjenkinsregtool              Create skeleton files
  setupjenkinsregtool -fetchparams Fetch Jenkins build parameters from all job URLs
  setupjenkinsregtool --help       Show this help
"""

import sys
import os
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent

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
    print("  Playwright (headless browser) is used as a fallback for Jenkins")
    print("  build triggering when the REST API is blocked (403 error).")
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


SCRIPTS = {
    "reg_config":  SCRIPT_DIR / "create_reg_config.py",
    "projects":    SCRIPT_DIR / "create_projects.py",
    "git_config":  SCRIPT_DIR / "create_git_config.py",
    "fetch_params": SCRIPT_DIR / "fetch_job_params.py",
}
GEN_README = SCRIPT_DIR / "gen_readme.js"


def _generate_readme():
    node = shutil.which("node")
    if not node:
        print("  [skip] ReadMe.docx — node not found (install Node.js to generate docs)")
        return
    if not GEN_README.exists():
        print(f"  [skip] ReadMe.docx — gen_readme.js not found")
        return
    result = subprocess.run([node, str(GEN_README)], capture_output=False)
    if result.returncode != 0:
        print("  [warning] ReadMe.docx generation failed.")


def run_script(path):
    result = subprocess.run([sys.executable, str(path)], capture_output=False)
    return result.returncode == 0


def setup_skeleton():
    print("\n  Jenkins IT Regression Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    reg_config = TOOL_ROOT / "reg_job_config.xlsx"
    if reg_config.exists():
        print("  [skip] reg_job_config.xlsx already exists")
    else:
        run_script(SCRIPTS["reg_config"])

    projects = TOOL_ROOT / "projects.xlsx"
    if projects.exists():
        print("  [skip] projects.xlsx already exists")
    else:
        run_script(SCRIPTS["projects"])

    params_dir = TOOL_ROOT / "jenkins_params" / "Payor"
    if params_dir.is_dir():
        print("  [skip] jenkins_params/Payor/ folder already exists")
    else:
        params_dir.mkdir(parents=True, exist_ok=True)
        print("  [create] jenkins_params/Payor/")

    git_cfg = TOOL_ROOT / "git_config.xlsx"
    if git_cfg.exists():
        print("  [skip] git_config.xlsx already exists")
    else:
        run_script(SCRIPTS["git_config"])

    projects_dir = TOOL_ROOT / "projects"
    if projects_dir.is_dir():
        print("  [skip] projects/ folder already exists")
    else:
        projects_dir.mkdir(parents=True, exist_ok=True)
        print("  [create] projects/")

    print()
    print("  ── Optional dependency: Playwright ──────────────────────────────")
    prompt_install_playwright()

    # Generate ReadMe.docx
    print()
    _generate_readme()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Verify jenkins_username, jenkins_api_token are set in secrets.xlsx → Jenkins sheet")
    print("    2. Verify job URLs in reg_job_config.xlsx → payor sheet")
    print("    3. Run:  setupjenkinsregtool -fetchparams")
    print("       (fetches build parameters from each Jenkins job)")
    print("    4. For each job in reg_job_config.xlsx, fill in 'version_param_name'")
    print("       (the Jenkins param that controls the PAYOR release version)")
    print("    5. Run:  jreg -payor 26.1.1.1  to trigger regression runs")
    print("    6. Run:  jregstatus  to poll and view live job status from Jenkins")
    print()


def setup_fetch_params():
    print("\n  Jenkins IT Regression Tool — Fetching build parameters\n")

    reg_config = TOOL_ROOT / "reg_job_config.xlsx"
    if not reg_config.exists():
        print("  ERROR: reg_job_config.xlsx not found. Run  setupjenkinsregtool  first.")
        sys.exit(1)

    ok = run_script(SCRIPTS["fetch_params"])
    if not ok:
        print("  ERROR: Parameter fetch failed. Check credentials and VPN access.")
        sys.exit(1)
    print("  Done. Review jenkins_params/Payor/ files and fill in 'version_param_name' in reg_job_config.xlsx.")
    print()


def print_help():
    print("""
  setupjenkinsregtool — Jenkins IT Regression Tool setup

  Usage:
    setupjenkinsregtool                Create skeleton files
    setupjenkinsregtool -fetchparams   Fetch Jenkins build parameters
    setupjenkinsregtool --help         Show this help

  Typical workflow:
    1. setupjenkinsregtool
    2. Fill in credentials in secrets.xlsx → Jenkins sheet
    3. Verify job URLs in reg_job_config.xlsx → payor sheet
    4. setupjenkinsregtool -fetchparams
    5. Fill in version_param_name in reg_job_config.xlsx for each job
    6. jreg -payor 26.1.1.1

  Files:
    reg_job_config.xlsx    Job URLs + version param names (payor sheet)
    projects.xlsx          Run history log
    jenkins_params/Payor/  Per-job build parameter files (filled by -fetchparams)
    secrets.xlsx           Shared credentials (Eng Jenkins sheet)
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
        print("  Usage: setupjenkinsregtool [-fetchparams] [--help]")
        sys.exit(1)


if __name__ == "__main__":
    main()
