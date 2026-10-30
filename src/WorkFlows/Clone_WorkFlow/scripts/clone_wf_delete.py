#!/usr/bin/env python3
"""
clone_wf_delete.py — clonewfdelete command

Delete a Clone Workflow project and its stages status file.

Usage:
  clonewfdelete -pid <project_id>
"""

import sys
import io
from pathlib import Path
import openpyxl

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"
STATUS_DIR    = TOOL_ROOT / "project_status"

RESET  = "\x1b[0m"
def bold(s):  return f"\x1b[1m{s}{RESET}"
def green(s): return f"\x1b[32m{s}{RESET}"
def red(s):   return f"\x1b[31m{s}{RESET}"
def grey(s):  return f"\x1b[90m{s}{RESET}"


def _delete_from_projects(pid) -> bool:
    if not PROJECTS_PATH.exists():
        print(f"  {red('projects.xlsx not found.')}"); return False
    wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws  = wb.active
    del_row = None
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value or "").strip() == str(pid).strip():
            del_row = row[0].row; break
    if del_row is None:
        print(f"  {red(f'Project {pid} not found.')}"); return False
    ws.delete_rows(del_row)
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  Warning: Could not save projects.xlsx (file may be open).")
        return False
    print(f"  {green('Deleted')} project {bold(str(pid))} from projects.xlsx")
    return True


def _delete_stages_file(pid):
    path = STATUS_DIR / f"{pid}_stages_status.xlsx"
    if path.exists():
        try:
            path.unlink()
            print(f"  {green('Deleted')} project_status/{path.name}")
        except Exception as e:
            print(f"  {red('Could not delete')} {path.name}: {e}")
    else:
        print(f"  {grey(f'project_status/{pid}_stages_status.xlsx not found (already deleted?)')}")


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    pid = None
    i = 0
    while i < len(args):
        if args[i] in ("-pid", "--pid") and i + 1 < len(args):
            pid = args[i + 1]; i += 2
        else:
            i += 1

    if not pid:
        try:
            pid = input("  Project ID to delete: ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
    if not pid:
        print("  ERROR: project ID is required."); sys.exit(1)

    print(f"\n  Delete clone workflow project {bold(str(pid))}\n")

    try:
        confirm = input("  This will delete the project entry and its stages file. Continue? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); sys.exit(0)
    if confirm not in ("y", "yes"):
        print("  Aborted."); sys.exit(0)

    print()
    _delete_from_projects(pid)
    _delete_stages_file(pid)
    print()


if __name__ == "__main__":
    main()
