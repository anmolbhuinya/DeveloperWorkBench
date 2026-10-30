#!/usr/bin/env python3
"""
rregtest_delete.py -- remoteregdelete command

Delete a Remote Regression project entry from projects.xlsx.

Usage:
  remoteregdelete -pid <project_id>
"""
import sys
from pathlib import Path
import openpyxl

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
_PROJ_BASE = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "Remote_Regression_Jenkins_IT_Failure"        # project data: <DWB>\Projects\WorkFlows\Remote_Regression_Jenkins_IT_Failure
_PROJ_BASE.mkdir(parents=True, exist_ok=True)
PROJECTS_PATH = _PROJ_BASE / "projects.xlsx"

RESET = "\x1b[0m"
def bold(s): return f"\x1b[1m{s}{RESET}"
def red(s):  return f"\x1b[31m{s}{RESET}"
def green(s):return f"\x1b[32m{s}{RESET}"


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("--help", "-h"):
        print("\n  Usage: rregtestdelete -pid <project_id>\n")
        sys.exit(0)
    if args[0] != "-pid" or len(args) < 2:
        print("  Usage: rregtestdelete -pid <project_id>")
        sys.exit(1)

    pid = args[1].strip()
    if not PROJECTS_PATH.exists():
        print(f"  {red('ERROR')}: projects.xlsx not found.")
        sys.exit(1)

    wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws  = wb.active
    to_del = [row[0].row for row in ws.iter_rows(min_row=2)
              if str(row[0].value or "").strip() == pid]
    if not to_del:
        print(f"  {red('ERROR')}: Project #{pid} not found.")
        sys.exit(1)
    for r in sorted(to_del, reverse=True):
        ws.delete_rows(r)
    wb.save(str(PROJECTS_PATH))
    print(f"  {green('[deleted]')} Project #{pid}")


if __name__ == "__main__":
    main()
