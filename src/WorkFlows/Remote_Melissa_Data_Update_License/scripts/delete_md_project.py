#!/usr/bin/env python3
"""
delete_md_project.py — mdldelete command

Delete a Melissa Data License update project entry from projects.xlsx.

Usage:
  mdldelete -pid <project_id>
  mdldelete --help
"""

import sys
from pathlib import Path
import openpyxl

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Remote_Melissa_Data_Update_License"        # project data: <DWB>\DWB_Projects\WorkFlows\Remote_Melissa_Data_Update_License
DATA_ROOT.mkdir(parents=True, exist_ok=True)
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"


def _load_project(pid):
    if not PROJECTS_PATH.exists():
        return None
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if str(row[0] or "").strip() == str(pid).strip():
            return dict(zip(headers, row))
    return None


def _delete_row(pid):
    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb.active
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
        print("\n  Usage:  mddelete -pid <project_id>\n")
        sys.exit(1)

    project = _load_project(pid)
    if not project:
        print(f"\n  {red('ERROR')}: Project #{pid} not found in projects.xlsx.\n")
        sys.exit(1)

    vm_name = str(project.get("vm_name",   "") or "")
    vm_ip   = str(project.get("vm_ip",     "") or "")
    ts      = str(project.get("timestamp", "") or "")
    status  = str(project.get("status",    "") or "")

    print()
    print(bold(f"  Delete Project #{pid}"))
    print(grey(f"  {'─' * 44}"))
    print(f"  VM     : {bold(vm_name)}  {grey(vm_ip)}")
    print(f"  Time   : {grey(ts)}")
    print(f"  Status : {status}")
    print()

    try:
        confirm = input("  Delete this project? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); sys.exit(0)

    if confirm != "y":
        print("  Cancelled.\n")
        return

    if _delete_row(pid):
        print(f"\n  Project #{pid} deleted.\n")


if __name__ == "__main__":
    main()
