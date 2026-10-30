#!/usr/bin/env python3
"""
remote_vm_delete.py — rvmdelete command

Delete a project entry from projects.xlsx and remove its run record from the
corresponding configured_servers/ file.

Usage:
  rvmdelete -pid <project_id>
  rvmdelete --help
"""

import sys
from pathlib import Path
import openpyxl

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "Remote_Setup"        # project data: <DWB>\Projects\Remote_Setup
DATA_ROOT.mkdir(parents=True, exist_ok=True)
SERVERS_DIR   = DATA_ROOT / "configured_servers"
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"


def _load_project(pid):
    if not PROJECTS_PATH.exists():
        return None, None
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if str(row[0] or "").strip() == str(pid).strip():
            return dict(zip(headers, row)), headers
    return None, headers


def _delete_project_row(pid):
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if str(row[0].value or "").strip() == str(pid).strip():
            ws.delete_rows(i)
            break
    try:
        wb.save(str(PROJECTS_PATH))
        return True
    except PermissionError:
        print(f"  {red('ERROR')}: projects.xlsx is open — close it and retry.")
        return False


def _delete_server_conf_row(pid, config_file):
    path = SERVERS_DIR / config_file
    if not path.exists():
        return

    wb = openpyxl.load_workbook(str(path))
    if "Setups" not in wb.sheetnames:
        return
    ws = wb["Setups"]

    deleted = False
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if str(row[0].value or "").strip() == str(pid).strip():
            ws.delete_rows(i)
            deleted = True
            break

    if not deleted:
        return

    # If the sheet has no data rows left, delete the file entirely
    has_data = any(
        any(c is not None for c in row)
        for row in ws.iter_rows(min_row=2, values_only=True)
    )

    try:
        if has_data:
            wb.save(str(path))
            print(f"  Run record removed from  {config_file}")
        else:
            path.unlink()
            print(f"  {config_file}  deleted  {grey('(no remaining runs)')}")
    except PermissionError:
        print(f"  {yellow('Warning')}: {config_file} is open — close it and retry.")


def main():
    args = sys.argv[1:]
    pid  = None
    i    = 0
    while i < len(args):
        if args[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif args[i] in ("-pid", "--pid") and i + 1 < len(args):
            pid = args[i + 1]; i += 2
        else:
            i += 1

    if not pid:
        print("\n  Usage:  rvmdelete -pid <project_id>\n")
        sys.exit(1)

    project, _ = _load_project(pid)
    if not project:
        print(f"\n  {red('ERROR')}: Project #{pid} not found in projects.xlsx.\n")
        sys.exit(1)

    vm_name     = str(project.get("vm_name",     "") or "")
    vm_ip       = str(project.get("vm_ip",       "") or "")
    ts          = str(project.get("timestamp",   "") or "")
    status      = str(project.get("status",      "") or "")
    config_file = str(project.get("config_file", "") or "")

    print()
    print(bold(f"  Delete Project #{pid}"))
    print(grey(f"  {'─' * 46}"))
    print(f"  VM          : {bold(vm_name)}  {grey(vm_ip)}")
    print(f"  Time        : {grey(ts)}")
    print(f"  Status      : {status}")
    if config_file:
        print(f"  Config file : {config_file}  {grey('(run record will be removed)')}")
    print()

    try:
        confirm = input("  Delete this project? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); sys.exit(0)

    if confirm != "y":
        print("  Cancelled.\n")
        return

    print()
    if _delete_project_row(pid):
        print(f"  Project #{pid} removed from  projects.xlsx")
        if config_file:
            _delete_server_conf_row(pid, config_file)
    print()


if __name__ == "__main__":
    main()
