#!/usr/bin/env python3
"""
remotereg_tool.py -- remoteregression / remotereg command

Guided orchestrator for the Remote Regression workflow.

Usage:
  remoteregression -payor <release_version>
  remotereg -payor <release_version>
  remoteregression --help

Steps:
  1. Creates a project entry in projects.xlsx
  2. Validates / populates Baseline Jenkins URLs in config.xlsx
  3. Runs rpb (remotepopulatepayorbaseline)
  4. Runs rprt (remotepayorregression)
  5. Optionally runs gpr (gpregressionresult)
"""

import os
import sys
import time
import subprocess
from pathlib import Path
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill
try:
    import filelock as _filelock
    _FILELOCK_AVAILABLE = True
except ImportError:
    _FILELOCK_AVAILABLE = False

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
PROJECTS_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Remote_Regression_Jenkins_IT_Failure"        # project data: <DWB>\DWB_Projects\WorkFlows\Remote_Regression_Jenkins_IT_Failure
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
PROJECTS_PATH  = PROJECTS_ROOT / "projects.xlsx"
CONFIG_PATH    = TOOL_ROOT / "config.xlsx"
PROJ_DETAIL_DIR = PROJECTS_ROOT / TOOL_ROOT.name / "projects"

_PROJ_LEASE_SECONDS = 15 * 60

def _projects_filelock():
    _lp = PROJECTS_PATH.with_suffix(".xlsx.lock")
    if _lp.exists():
        try:
            if time.time() - _lp.stat().st_mtime > _PROJ_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30) if _FILELOCK_AVAILABLE else open(os.devnull)

HEADERS = ["pid", "payor_version", "application", "status", "created_at",
           "baseline_url", "regression_url",
           "rpb_status", "regression_status", "gp_status", "notes"]
COL     = {c: i + 1 for i, c in enumerate(HEADERS)}

VALUE_STREAMS = ["billing", "claims", "enrollment", "integrations", "platform", "provider"]

RESET = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"


# -- projects.xlsx helpers ---------------------------------------------------

def _ensure_projects():
    if not PROJECTS_PATH.exists():
        subprocess.run([sys.executable,
                        str(SCRIPT_DIR / "create_remotereg_projects.py")],
                       capture_output=False)


def _next_pid() -> int:
    if not PROJECTS_PATH.exists():
        return 1
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb.active
        pids = [row[0] for row in ws.iter_rows(min_row=2, values_only=True)
                if row[0] is not None]
    return (max(int(p) for p in pids) + 1) if pids else 1


def _create_project(payor_version: str, application: str = "",
                    baseline_url: str = "", regression_url: str = "") -> int:
    _ensure_projects()
    pid = _next_pid()
    with _projects_filelock():
        wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws  = wb.active
        ws.append([pid, payor_version, application, "In Progress",
                   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                   baseline_url, regression_url,
                   "Pending", "Pending", "Pending", ""])
        wb.save(str(PROJECTS_PATH))
    return pid


def _update_project(pid: int, **fields):
    if not PROJECTS_PATH.exists():
        return
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb.active
        for row in ws.iter_rows(min_row=2):
            if str(row[0].value or "").strip() == str(pid):
                for key, val in fields.items():
                    if key in COL:
                        row[COL[key] - 1].value = val
                break
        wb.save(str(PROJECTS_PATH))


# -- per-project xlsx baseline helpers ----------------------------------------

def _read_baseline_urls(pid: int, payor_version: str) -> dict:
    """Read baseline_urls sheet from per-project xlsx. Returns {valuestream: url}."""
    path = _find_proj_xlsx(pid)
    if not path:
        return {}
    try:
        wb = openpyxl.load_workbook(str(path))
        if "baseline_urls" not in wb.sheetnames:
            return {}
        result = {}
        for row in wb["baseline_urls"].iter_rows(min_row=2, values_only=True):
            if row[0]:
                result[str(row[0]).strip().lower()] = str(row[1] or "").strip()
        return result
    except Exception:
        return {}


def _save_baseline_url(vs: str, url: str, pid: int, payor_version: str):
    """Save a baseline URL for a value stream in the per-project xlsx."""
    path = _find_proj_xlsx(pid)
    if not path:
        print(f"  {yellow('WARNING')}: per-project xlsx not found for pid {pid} -- cannot save URL.")
        return
    try:
        wb = openpyxl.load_workbook(str(path))
        if "baseline_urls" not in wb.sheetnames:
            return
        ws = wb["baseline_urls"]
        for row in ws.iter_rows(min_row=2):
            if row[0] and str(row[0].value).strip().lower() == vs.lower():
                row[1].value = url
                break
        wb.save(str(path))
    except Exception as e:
        print(f"  {yellow('WARNING')}: could not save baseline URL -- {e}")


# -- Per-project xlsx (GP URLs) ----------------------------------------------

_HDR_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
_HDR_FILL = PatternFill("solid", fgColor="1F3864")


def _find_proj_xlsx(pid: int) -> Path | None:
    if not PROJ_DETAIL_DIR.exists():
        return None
    matches = list(PROJ_DETAIL_DIR.glob(f"{pid}_*.xlsx"))
    return matches[0] if matches else None


def _read_gp_enabled(pid: int, payor_version: str) -> bool:
    """Return the gp_enabled flag from the per-project xlsx (default True if not set)."""
    safe = payor_version.replace("/", "_").replace("\\", "_")
    path = PROJ_DETAIL_DIR / f"{pid}_{safe}.xlsx"
    if not path.exists():
        return True
    try:
        wb = openpyxl.load_workbook(str(path))
        if "gp_urls" in wb.sheetnames:
            for row in wb["gp_urls"].iter_rows(min_row=2, values_only=True):
                if row and str(row[0] or "").strip() == "enabled":
                    return str(row[1] or "").strip().lower() == "true"
    except Exception:
        pass
    return True


def _write_gp_urls(pid: int, payor_version: str, gp_urls: dict):
    """Write {valuestream: [url, ...]} to the gp_urls sheet of the per-project xlsx."""
    PROJ_DETAIL_DIR.mkdir(parents=True, exist_ok=True)
    safe = payor_version.replace("/", "_").replace("\\", "_")
    path = PROJ_DETAIL_DIR / f"{pid}_{safe}.xlsx"

    wb = openpyxl.load_workbook(str(path)) if path.exists() else openpyxl.Workbook()
    if "Sheet" in wb.sheetnames:
        del wb["Sheet"]

    if "gp_urls" in wb.sheetnames:
        del wb["gp_urls"]
    ws = wb.create_sheet("gp_urls")
    ws.append(["category", "url"])
    for i in range(1, 3):
        c = ws.cell(1, i)
        c.font = _HDR_FONT
        c.fill = _HDR_FILL
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 80

    for vs in VALUE_STREAMS:
        urls = gp_urls.get(vs, [])
        if urls:
            for u in urls:
                ws.append([vs, u])
        else:
            ws.append([vs, ""])

    wb.save(str(path))


# -- Step helpers ------------------------------------------------------------

def _run_cmd(cmd_name: str, args: list = None) -> bool:
    """Run a CMD wrapper. Returns True on success."""
    cmd = [cmd_name] + (args or [])
    try:
        result = subprocess.run(cmd, capture_output=False)
        return result.returncode == 0
    except FileNotFoundError:
        print(f"  {red('ERROR')}: Command not found: {cmd_name}")
        print(f"           Make sure the tool is set up (run setup{cmd_name}tool).")
        return False


def _prompt(msg: str, default: str = "") -> str:
    try:
        val = input(msg).strip()
        return val if val else default
    except (EOFError, KeyboardInterrupt):
        print()
        return default


def step_populate_baseline(payor_version: str, pid: int) -> bool:
    print(f"\n  {bold('Step 1/3')} -- Populate Baseline Jenkins URLs")
    print(f"  {grey('-' * 60)}")

    existing = _read_baseline_urls(pid, payor_version)

    missing = [vs for vs in VALUE_STREAMS if not existing.get(vs)]
    filled  = [vs for vs in VALUE_STREAMS if existing.get(vs)]

    if filled:
        print(f"\n  Existing baseline URLs ({len(filled)}/{len(VALUE_STREAMS)}):")
        for vs in filled:
            print(f"    {cyan(vs):20s}  {grey(existing[vs][:80])}")

    if missing:
        print(f"\n  Missing baseline URLs -- please enter Jenkins build URLs for:")
        print(f"  {grey('(Press Enter to skip a value stream)')}\n")
        for vs in missing:
            url = _prompt(f"    {cyan(vs):18s}: ")
            if url:
                _save_baseline_url(vs, url, pid, payor_version)
                print(f"    {green('[saved]')} {vs}")

    print(f"\n  Running {bold('rpb')} (remotepopulatepayorbaseline -payor {payor_version})...")
    ok = _run_cmd("rpb", ["-payor", payor_version])
    if ok:
        print(f"  {green('OK')} Baseline populated successfully.")
    else:
        print(f"  {red('FAIL')} rpb exited with errors. Check output above.")
    return ok


def step_remote_regression(payor_version: str) -> bool:
    print(f"\n  {bold('Step 2/3')} -- Remote Regression")
    print(f"  {grey('-' * 60)}")
    print(f"  This runs the full 4-step remote regression (rprt).")
    ans = _prompt("  Run remotepayorregression now? [Y/n]: ", "y").lower()
    if ans not in ("", "y", "yes"):
        print(f"  {yellow('[skipped]')} Remote regression.")
        return False

    print(f"\n  Running {bold('rprt')} (remotepayorregression)...")
    ok = _run_cmd("rprt")
    if ok:
        print(f"  {green('OK')} Remote regression completed.")
    else:
        print(f"  {red('FAIL')} rprt exited with errors. Check output above.")
    return ok


def step_collect_gp_urls(pid: int, payor_version: str, gpurl_arg: str = "") -> dict:
    """Prompt for GP Jenkins URLs per value stream. Returns {vs: [url]}."""
    print(f"\n  {bold('GP URLs')} -- Jenkins GP build URLs  {grey('(optional, press Enter to skip each)')}")
    print(f"  {grey('-' * 60)}")

    if gpurl_arg:
        # Single URL provided via -gpurl: apply to all value streams
        gp_urls = {vs: [gpurl_arg] for vs in VALUE_STREAMS}
        print(f"  {green('[applied]')} -gpurl to all value streams: {grey(gpurl_arg[:80])}")
    else:
        # Prompt per value stream
        gp_urls = {}
        for vs in VALUE_STREAMS:
            url = _prompt(f"    {cyan(vs):18s}: ")
            gp_urls[vs] = [url] if url else []

    _write_gp_urls(pid, payor_version, gp_urls)
    filled = sum(1 for v in gp_urls.values() if v and v[0])
    if filled:
        print(f"  {green('[saved]')} GP URLs for {filled}/{len(VALUE_STREAMS)} value streams.")
    return gp_urls


def step_gp_results() -> bool:
    print(f"\n  {bold('Step 3/3')} -- GP Regression Results  {grey('(optional)')}")
    print(f"  {grey('-' * 60)}")
    ans = _prompt("  Run gpregressionresult now? [y/N]: ", "n").lower()
    if ans not in ("y", "yes"):
        print(f"  {yellow('[skipped]')} GP regression results.")
        return False

    print(f"\n  Running {bold('gpr')} (gpregressionresult)...")
    ok = _run_cmd("gpr")
    if ok:
        print(f"  {green('OK')} GP results fetched.")
    else:
        print(f"  {red('FAIL')} gpr exited with errors. Check output above.")
    return ok


# -- Main --------------------------------------------------------------------

def print_help():
    print("""
  remoteregression -- Remote Regression Test orchestrator

  Usage:
    remoteregression -payor <release_version> [-gpurl <url>]
    remotereg -payor <release_version> [-gpurl <url>]   (alias)

  Options:
    -payor <version>   PAYOR release version (e.g. 26.1.1.1)  [required]
    -gpurl <url>       GP Jenkins build URL (applies to all value streams).
                       If omitted, prompted per value stream during the run.

  What it does:
    1. Creates a project entry in projects.xlsx
    2. Validates / populates Baseline Jenkins URLs in the per-project xlsx
    3. Runs rpb  (remotepopulatepayorbaseline)
    4. Runs rprt (remotepayorregression)       -- prompted, optional
    5. Collects GP Jenkins URLs (per value stream or via -gpurl)
    6. Runs gpr  (gpregressionresult)          -- prompted, optional

  Prerequisites:
    - Run  setupremoteregressiontool  once to create config.xlsx and projects.xlsx
    - Select VM and fill repo path when creating project (stored in per-project xlsx)
    - Optionally fill GP URL in per-project xlsx or pass via -gpurl flag

  Examples:
    remoteregression -payor 26.1.1.1
    remoteregression -payor 26.1.1.1 -gpurl http://jenkins/job/GP-Run/42/
""")


def main():
    args = sys.argv[1:]

    if not args or args[0] in ("--help", "-h"):
        print_help()
        sys.exit(0)

    if args[0] != "-payor" or len(args) < 2:
        print("  Usage: remoteregression -payor <release_version>")
        sys.exit(1)

    payor_version = args[1].strip()
    if not payor_version:
        print("  ERROR: payor version cannot be empty.")
        sys.exit(1)

    # Parse optional -gpurl flag
    gpurl_arg = ""
    for i, a in enumerate(args):
        if a in ("-gpurl", "--gpurl") and i + 1 < len(args):
            gpurl_arg = args[i + 1].strip()
            break

    print()
    print(f"  {bold('remotereg')} -- Remote Regression Orchestrator")
    print(f"  Payor version: {cyan(payor_version)}")
    if gpurl_arg:
        print(f"  GP URL:        {grey(gpurl_arg[:80])}")
    print()

    _ensure_projects()

    print("  Application types:")
    print("    1. Payor")
    print("    2. Connector")
    app_choice  = _prompt("  Select application [1]: ", "1")
    application = "Connector" if app_choice.strip() == "2" else "Payor"

    print()
    baseline_url   = _prompt("  Baseline Jenkins URL (previous stable build, or Enter to skip): ")
    regression_url = _prompt("  Regression Jenkins URL (current run URL, or Enter to skip): ")

    pid = _create_project(payor_version, application, baseline_url, regression_url)
    print(f"  {green('[created]')} Project #{pid} in projects.xlsx")

    rpb_ok = step_populate_baseline(payor_version, pid)
    _update_project(pid, rpb_status="Completed" if rpb_ok else "Failed")

    reg_ok = step_remote_regression(payor_version)
    _update_project(pid, regression_status="Completed" if reg_ok else "Failed")

    gp_enabled = _read_gp_enabled(pid, payor_version)
    if not gp_enabled and not gpurl_arg:
        print(f"\n  {yellow('[skipped]')} GP regression is disabled for this project.")
        print(f"  Enable it via the IDP UI → GP Jenkins URLs tab to run GP results.")
        _update_project(pid, gp_status="Skipped")
        gp_ok = False
    else:
        step_collect_gp_urls(pid, payor_version, gpurl_arg)
        gp_ok = step_gp_results()
        _update_project(pid, gp_status="Completed" if gp_ok else "Skipped")

    final_status = "Completed" if (rpb_ok and reg_ok) else "Partial"
    _update_project(pid, status=final_status)

    print()
    print(f"  {bold('Project #' + str(pid))} -- "
          f"{green(final_status) if final_status == 'Completed' else yellow(final_status)}")
    print(f"    rpb:        {'OK' if rpb_ok else 'FAIL'}")
    print(f"    regression: {'OK' if reg_ok else 'FAIL'}")
    print(f"    gp:         {'OK' if gp_ok else 'skipped'}")
    print()


if __name__ == "__main__":
    main()
