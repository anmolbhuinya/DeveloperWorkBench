#!/usr/bin/env python3
"""
setupgptool — GP Build Tool setup command

Usage:
  setupgptool              Create skeleton gp_job_config.xlsx, projects.xlsx,
                           gp_params.xlsx and projects/Payor/ folder.
  setupgptool -fetchparams     Fetch Jenkins parameters and populate gp_params.xlsx.
                           Requires gp_job_config.xlsx to be filled in first.
  setupgptool --help       Show this help.
"""

import os
import sys
import textwrap
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOOL_ROOT  = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "GP_Build"        # project data: <DWB>\Projects\WorkFlows\GP_Build
DATA_ROOT.mkdir(parents=True, exist_ok=True)

FILES = {
    "gp_job_config.xlsx":    os.path.join(TOOL_ROOT, "gp_job_config.xlsx"),
    "projects.xlsx":  os.path.join(DATA_ROOT, "projects.xlsx"),
    "gp_params.xlsx": os.path.join(TOOL_ROOT, "gp_params", "payor_gp_params.xlsx"),
    "projects/":      os.path.join(DATA_ROOT, "projects"),
}

SCRIPTS = {
    "config":    os.path.join(SCRIPT_DIR, "create_config.py"),
    "projects":  os.path.join(SCRIPT_DIR, "create_projects.py"),
    "gp_params": os.path.join(SCRIPT_DIR, "create_gp_params.py"),
    "fetch_params": os.path.join(SCRIPT_DIR, "fetch_build_params.py"),
    "fetch_groups": os.path.join(SCRIPT_DIR, "fetch_test_groups.py"),
}


def run_script(path):
    result = subprocess.run([sys.executable, path], capture_output=False)
    return result.returncode == 0


_SYSTEM_CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def _system_browser():
    """Return path to an installed Chrome/Edge, or None."""
    return next((p for p in _SYSTEM_CHROME_PATHS if os.path.exists(p)), None)


def _playwright_package_installed():
    try:
        import playwright  # noqa
        return True
    except ImportError:
        return False


def install_playwright():
    """
    Install the playwright Python package.
    Skips Chromium download if Chrome or Edge is already present on the machine.
    """
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
    """
    Ask user whether to install Playwright (headless browser for Jenkins UI fallback).
    Default is yes. Returns True if installed / already present, False otherwise.
    """
    if _playwright_package_installed():
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


def _migrate_existing_files():
    """Migrate files from the old structure to the new one (idempotent)."""
    import shutil
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        return  # openpyxl not yet installed — skip migration

    # ── 0. tickets/ → projects/Payor/ ──
    old_tickets = os.path.join(TOOL_ROOT, "tickets")
    new_projects_payor = os.path.join(FILES["projects/"], "Payor")
    if os.path.isdir(old_tickets):
        os.makedirs(new_projects_payor, exist_ok=True)
        for f in os.listdir(old_tickets):
            src = os.path.join(old_tickets, f)
            dst = os.path.join(new_projects_payor, f)
            if not os.path.exists(dst):
                shutil.move(src, dst)
        try:
            os.rmdir(old_tickets)
        except OSError:
            pass
        print("  [migrate] tickets/  ->  projects/Payor/")

    # ── 1. gp_params.xlsx (old root location) → gp_params/payor_gp_params.xlsx ──
    old_gp = os.path.join(TOOL_ROOT, "gp_params.xlsx")
    new_gp = FILES["gp_params.xlsx"]
    if os.path.exists(old_gp) and not os.path.exists(new_gp):
        os.makedirs(os.path.dirname(new_gp), exist_ok=True)
        shutil.move(old_gp, new_gp)
        print("  [migrate] gp_params.xlsx  ->  gp_params/payor_gp_params.xlsx")

    # ── 2. projects.xlsx: rename sheet "Projects" → "Payor" ──
    proj_path = FILES["projects.xlsx"]
    if os.path.exists(proj_path):
        try:
            wb = openpyxl.load_workbook(proj_path)
            if "Projects" in wb.sheetnames and "Payor" not in wb.sheetnames:
                wb["Projects"].title = "Payor"
                wb.save(proj_path)
                print("  [migrate] projects.xlsx: sheet renamed 'Projects' -> 'Payor'")
        except Exception as e:
            print(f"  [warn] Could not migrate projects.xlsx sheet name: {e}")

    # ── 3. gp_job_config.xlsx: old key-value format → new application/url table format ──
    cfg_path = FILES["gp_job_config.xlsx"]
    if os.path.exists(cfg_path):
        try:
            wb = openpyxl.load_workbook(cfg_path)
            ws = wb["Settings"] if "Settings" in wb.sheetnames else None
            if ws:
                # Detect old format: first cell of row 1 is "key" or "gp_base_url"
                first_header = str(ws.cell(1, 1).value or "").strip().lower()
                if first_header in ("key", "gp_base_url"):
                    # Read old key-value rows
                    old = {}
                    for row in ws.iter_rows(min_row=2, values_only=True):
                        if row[0] and row[1] is not None:
                            old[str(row[0]).strip()] = str(row[1]).strip()
                    base = old.get("gp_base_url", "").rstrip("/")
                    team = old.get("scrum_team", "")
                    app  = old.get("application", "")
                    # Construct url from old parts if available
                    if base and team and app:
                        new_url = f"{base}/job/{team}/job/{app}/"
                    else:
                        new_url = "http://central-gp:6060/job/stormtroopers/job/payor-end-to-end/"
                    new_app = app or "Payor"
                    # Rewrite sheet with new format
                    ws.delete_rows(1, ws.max_row)
                    HEADER_FILL = PatternFill("solid", fgColor="4472C4")
                    HEADER_FONT = Font(color="FFFFFF", bold=True)
                    for col, title in enumerate(("application", "url"), start=1):
                        cell = ws.cell(1, col, title)
                        cell.font = HEADER_FONT
                        cell.fill = HEADER_FILL
                        cell.alignment = Alignment(horizontal="center")
                    ws.cell(2, 1, new_app).font = Font(bold=True)
                    ws.cell(2, 2, new_url)
                    ws.column_dimensions["A"].width = 22
                    ws.column_dimensions["B"].width = 80
                    wb.save(cfg_path)
                    print(f"  [migrate] gp_job_config.xlsx: updated to application/url format (url={new_url})")
        except Exception as e:
            print(f"  [warn] Could not migrate gp_job_config.xlsx format: {e}")


def setup_skeleton():
    print("\n  GP Build Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    # Migrate any files still in the old structure/format
    _migrate_existing_files()

    # gp_job_config.xlsx
    if os.path.exists(FILES["gp_job_config.xlsx"]):
        print("  [skip] gp_job_config.xlsx already exists")
    else:
        print("  [create] gp_job_config.xlsx ...")
        run_script(SCRIPTS["config"])

    # projects.xlsx
    if os.path.exists(FILES["projects.xlsx"]):
        print("  [skip] projects.xlsx already exists")
    else:
        print("  [create] projects.xlsx ...")
        run_script(SCRIPTS["projects"])

    # gp_params/payor_gp_params.xlsx
    if os.path.exists(FILES["gp_params.xlsx"]):
        print("  [skip] gp_params/payor_gp_params.xlsx already exists")
    else:
        print("  [create] gp_params/payor_gp_params.xlsx (skeleton) ...")
        run_script(SCRIPTS["gp_params"])

    # projects/<App>/ folders — one per application
    _ALL_APPS = ["Payor", "Classic", "Connector", "Enrollment", "PIK", "Custom Code"]
    projects_root = FILES["projects/"]
    for _app in _ALL_APPS:
        _app_dir = os.path.join(projects_root, _app)
        if os.path.isdir(_app_dir):
            print(f"  [skip] projects/{_app}/ folder already exists")
        else:
            os.makedirs(_app_dir, exist_ok=True)
            print(f"  [create] projects/{_app}/")

    # Playwright (headless browser for Jenkins UI fallback)
    print()
    print("  ── Optional dependency: Playwright ──────────────────────────────")
    prompt_install_playwright()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Open gp_job_config.xlsx and verify application name and url in the Settings sheet")
    print("    2. Fill in Jenkins credentials in secrets.xlsx (Jenkins sheet)")
    print("    3. Run:  setupgptool -fetchparams")
    print()


def setup_gparams():
    print("\n  GP Build Tool — Fetching Jenkins parameters\n")

    # Verify gp_job_config.xlsx exists and has required settings
    config_path = FILES["gp_job_config.xlsx"]
    if not os.path.exists(config_path):
        print("  ERROR: gp_job_config.xlsx not found. Run  setupgptool  first.")
        sys.exit(1)

    try:
        import openpyxl
        wb = openpyxl.load_workbook(config_path)
        ws = wb["Settings"]
        hdrs = [str(c.value or "").strip().lower() for c in ws[1]]
        settings = {}
        for row in ws.iter_rows(min_row=2, values_only=True):
            if any(v is not None for v in row):
                settings = {k: str(v or "").strip() for k, v in zip(hdrs, row)}
                break
    except Exception as e:
        print(f"  ERROR reading gp_job_config.xlsx: {e}")
        sys.exit(1)

    if not settings.get("url"):
        print("  ERROR: Fill in 'url' in gp_job_config.xlsx -> Settings first.")
        sys.exit(1)

    print("  Step 1/2 — Fetching build parameters from Jenkins...")
    ok = run_script(SCRIPTS["fetch_params"])
    if not ok:
        print("  ERROR: fetch_build_params.py failed. Check credentials and VPN.")
        sys.exit(1)

    print()
    print("  Step 2/2 — Fetching test groups from Jenkins...")
    ok = run_script(SCRIPTS["fetch_groups"])
    if not ok:
        print("  ERROR: fetch_test_groups.py failed. Check credentials and VPN.")
        sys.exit(1)

    print()
    print("  payor_gp_params.xlsx is ready. You can now run gprun.")
    print()


def print_help():
    print(textwrap.dedent("""
        setupgptool — GP Build Tool setup

        Usage:
          setupgptool            Create skeleton project files (gp_job_config.xlsx,
                                 projects.xlsx, gp_params.xlsx, projects/Payor/)
          setupgptool -fetchparams   Fetch Jenkins build parameters and test groups,
                                 populate gp_params.xlsx. Requires gp_job_config.xlsx
                                 to be filled in and VPN access.
          setupgptool --help     Show this help

        Typical workflow:
          1. setupgptool                  create skeleton files
          2. Fill in gp_job_config.xlsx          application name and url in Settings
          3. Fill in secrets.xlsx         jenkins_username + token/password
          4. setupgptool -fetchparams         fetch params from Jenkins
          5. gprun -t <ticket> ...        schedule a build

        Files:
          GP_Build/gp_job_config.xlsx                      Jenkins job settings (application + url)
          GP_Build/gp_params/payor_gp_params.xlsx   Build parameters + test group categories
          GP_Build/projects.xlsx                    Run tracking log (Payor sheet)
          GP_Build/projects/<App>/                   Per-project build config files (one folder per app)
          secrets.xlsx            Shared credentials (Jenkins sheet)

        Dependencies installed by setupgptool:
          openpyxl                Excel read/write
          requests                HTTP calls to Jenkins / JIRA / GitHub
          playwright              Headless browser (Jenkins UI fallback when API returns 403)
          chromium                Browser downloaded by `playwright install chromium` (~170 MB)
    """))


def main():
    args = sys.argv[1:]

    if not args:
        setup_skeleton()
    elif args[0] in ("-fetchparams", "--fetchparams"):
        setup_gparams()
    elif args[0] in ("--help", "-h"):
        print_help()
    else:
        print(f"  Unknown option: {args[0]}")
        print("  Usage: setupgptool [-fetchparams] [--help]")
        sys.exit(1)


if __name__ == "__main__":
    main()
