#!/usr/bin/env python3
"""
gpdelete — Delete a GP Build project entry.

Usage:
  gpdelete -pid <project_id> [--app <app_name>]
  gpdelete --help
"""

import sys
import openpyxl
from pathlib import Path

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "GP_Build"        # project data: <DWB>\DWB_Projects\WorkFlows\GP_Build
DATA_ROOT.mkdir(parents=True, exist_ok=True)
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"

R = "\x1b[0m"
def _ansi(c, s): return f"\x1b[{c}m{s}{R}"
BOLD  = lambda s: _ansi("1",  s)
RED   = lambda s: _ansi("31", s)
GREY  = lambda s: _ansi("90", s)
CYAN  = lambda s: _ansi("36", s)
GREEN = lambda s: _ansi("32", s)


def load_row(project_id, app_name="Payor"):
    if not PROJECTS_PATH.exists():
        print(f"\n  projects.xlsx not found at:\n    {PROJECTS_PATH}")
        print("  Run  setupgptool  to initialise the GP Build Tool.\n")
        sys.exit(1)

    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    if app_name in wb.sheetnames:
        ws = wb[app_name]
    else:
        ws = wb.active
    headers = [str(c.value or "").strip() for c in ws[1]]

    for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        pid = str(row[0].value or "").strip()
        if pid == str(project_id).strip():
            data = dict(zip(headers, [c.value for c in row]))
            config_path = None
            # Try to get the hyperlink target for the config file
            config_cell = row[5]   # col 6 = config_file
            if config_cell.hyperlink:
                config_path = Path(config_cell.hyperlink.target)
            elif config_cell.value:
                config_path = DATA_ROOT / "projects" / app_name / str(config_cell.value)
            return wb, ws, row_idx, data, config_path

    return None, None, None, None, None


def delete_row(ws, row_idx):
    ws.delete_rows(row_idx)


def print_row_preview(data):
    fields = ["project_id", "ticket_id", "feature_branch", "dest_branch", "status", "pr_status"]
    for f in fields:
        v = data.get(f) or ""
        print(f"    {GREY(f + ':'): <30}  {v}")


def main():
    argv = sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        print("""
  gpdelete -pid <project_id> [--app <app_name>]
                               Delete a project entry from projects.xlsx.
                               Also removes the per-ticket config file.
  gpdelete --help              Show this help.
""")
        sys.exit(0)

    project_id = None
    app_name   = "Payor"
    i = 0
    while i < len(argv):
        if argv[i] in ("-pid", "--pid") and i + 1 < len(argv):
            project_id = argv[i + 1].strip()
            i += 2
        elif argv[i] in ("--app", "-app") and i + 1 < len(argv):
            app_name = argv[i + 1].strip()
            i += 2
        else:
            i += 1

    if not project_id:
        print("  ERROR: -pid <project_id> is required.")
        print("  Usage: gpdelete -pid <project_id> [--app <app_name>]")
        sys.exit(1)

    wb, ws, row_idx, data, config_path = load_row(project_id, app_name)

    if data is None:
        print(f"\n  ERROR: Project '{project_id}' not found in projects.xlsx.\n")
        sys.exit(1)

    print(f"\n  Project to delete:\n")
    print_row_preview(data)
    if config_path:
        exists_label = GREEN("exists") if config_path.exists() else GREY("not found")
        print(f"    {GREY('config_file:'): <30}  {config_path.name}  [{exists_label}]")
    print()

    try:
        confirm = input(f"  Delete project {BOLD(str(project_id))}? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)

    if confirm != "y":
        print("  Cancelled.\n")
        sys.exit(0)

    # Delete config file FIRST (before removing the row so path is still available)
    if config_path and config_path.exists():
        try:
            config_path.unlink()
            print(f"  Deleted config file: {config_path.name}")
        except Exception as e:
            print(f"  Warning: Could not delete config file: {e}")

    # Remove row from projects.xlsx
    delete_row(ws, row_idx)
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  ERROR: Could not save projects.xlsx (file may be open).")
        sys.exit(1)

    print(f"  Removed project {project_id} from projects.xlsx.")
    print()


if __name__ == "__main__":
    main()
