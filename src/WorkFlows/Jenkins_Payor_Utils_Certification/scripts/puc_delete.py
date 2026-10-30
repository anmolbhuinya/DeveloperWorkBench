#!/usr/bin/env python3
"""
puc_delete.py — pucdelete command

Delete a Payor Utils Certification project entry from projects.xlsx.

Usage:
  pucdelete -pid <project_id>
  pucdelete --help
"""

import sys
from pathlib import Path
import openpyxl

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"


def _load_project(pid):
    if not PROJECTS_PATH.exists():
        return None
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i - 1 for i, h in enumerate(headers, 1)}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if str(row[0] or "").strip() == str(pid).strip():
            return {h: str(row[i] or "").strip() for h, i in col_map.items()}
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
        print("\n  Usage:  pucdelete -pid <project_id>\n")
        sys.exit(1)

    project = _load_project(pid)
    if not project:
        print(f"\n  {red('ERROR')}: Project #{pid} not found in projects.xlsx.\n")
        sys.exit(1)

    print()
    print(bold(f"  Delete Project #{pid}"))
    print(grey(f"  {'─' * 44}"))
    print(f"  Version    : {bold(project.get('payor_version', ''))}")
    print(f"  Job        : {project.get('job_name', '')}")
    print(f"  Triggered  : {grey(project.get('triggered_at', ''))}")
    print(f"  Status     : {project.get('status', '')}")
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
