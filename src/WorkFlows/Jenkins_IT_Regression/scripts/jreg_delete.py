#!/usr/bin/env python3
"""
jregdelete — Delete a Jenkins IT Regression project entry.

Usage:
  jregdelete -pid <project_id>
  jregdelete --help
"""

import sys
import openpyxl
from pathlib import Path

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"
PROJECTS_DIR  = TOOL_ROOT / "projects"

R     = "\x1b[0m"
BOLD  = lambda s: f"\x1b[1m{s}{R}"
RED   = lambda s: f"\x1b[31m{s}{R}"
GREEN = lambda s: f"\x1b[32m{s}{R}"
GREY  = lambda s: f"\x1b[90m{s}{R}"
CYAN  = lambda s: f"\x1b[36m{s}{R}"


def _find_run_xlsx(project_id: int, app_name: str = "Payor") -> Path | None:
    app_dir = PROJECTS_DIR / app_name
    if not app_dir.exists():
        return None
    matches = list(app_dir.glob(f"{project_id}_*.xlsx"))
    return matches[0] if matches else None


def load_project_rows(project_id: int, app_name: str = "Payor"):
    """
    Returns (wb, ws, row_indices, summary) where row_indices is a list of
    1-based row numbers in ws that belong to project_id.
    summary = {version, runs, status, triggered_at}
    """
    if not PROJECTS_PATH.exists():
        print(f"\n  projects.xlsx not found. Run  setupjenkinsregtool  to initialise.\n")
        sys.exit(1)

    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb[app_name] if app_name in wb.sheetnames else wb.active
    headers = [str(c.value or "").strip().lower() for c in ws[1]]
    col     = {h: i for i, h in enumerate(headers)}

    row_indices = []
    summary     = {"version": "", "runs": "", "status": "", "triggered_at": ""}

    for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        try:
            pid = int(row[col.get("project_id", 0)].value)
        except (TypeError, ValueError):
            continue
        if pid != project_id:
            continue
        row_indices.append(row_idx)
        summary["version"]      = str(row[col.get("payor_release_version", 1)].value or "")
        summary["runs"]         = str(row[col.get("runs",         2)].value or "")
        summary["status"]       = str(row[col.get("status",       3)].value or "")
        summary["triggered_at"] = str(row[col.get("triggered_at", 4)].value or "")

    return wb, ws, row_indices, summary


def main():
    argv = sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        print("""
  jregdelete -pid <project_id> [--app <app>]
                                 Delete a project from projects.xlsx and its
                                 per-run xlsx file in projects/<app>/.
  jregdelete --help              Show this help.
""")
        sys.exit(0)

    project_id = None
    app_name   = "Payor"
    i = 0
    while i < len(argv):
        if argv[i] in ("-pid", "--pid") and i + 1 < len(argv):
            try:
                project_id = int(argv[i + 1])
            except ValueError:
                print(f"  ERROR: -pid must be an integer, got '{argv[i + 1]}'")
                sys.exit(1)
            i += 2
        elif argv[i] in ("-app", "--app") and i + 1 < len(argv):
            app_name = argv[i + 1].strip()
            i += 2
        else:
            i += 1

    if project_id is None:
        print("  ERROR: -pid <project_id> is required.")
        print("  Usage: jregdelete -pid <project_id> [--app Payor]")
        sys.exit(1)

    wb, ws, row_indices, summary = load_project_rows(project_id, app_name)

    if not row_indices:
        print(f"\n  ERROR: Project {project_id} not found in projects.xlsx.\n")
        sys.exit(1)

    run_xlsx = _find_run_xlsx(project_id, app_name)

    # ── Preview ───────────────────────────────────────────────
    print(f"\n  Project to delete:\n")
    print(f"    {GREY('project_id:'): <30}  {project_id}")
    print(f"    {GREY('release_version:'): <30}  {summary['version']}")
    print(f"    {GREY('status:'): <30}  {summary['status']}")
    print(f"    {GREY('runs:'): <30}  {summary['runs']}")
    print(f"    {GREY('triggered_at:'): <30}  {summary['triggered_at'][:19]}")
    if run_xlsx:
        print(f"    {GREY('run file:'): <30}  projects/{app_name}/{run_xlsx.name}  [{GREEN('will be deleted')}]")
    else:
        print(f"    {GREY('run file:'): <30}  projects/{app_name}/{project_id}_*.xlsx  [{GREY('not found')}]")
    print()

    # ── Confirm ───────────────────────────────────────────────
    try:
        confirm = input(f"  Delete project {BOLD(str(project_id))}? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)

    if confirm != "y":
        print("  Cancelled.\n")
        sys.exit(0)

    # ── Delete rows (highest index first to preserve offsets) ──
    for row_idx in sorted(row_indices, reverse=True):
        ws.delete_rows(row_idx)
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  ERROR: Could not save projects.xlsx (file may be open).\n")
        sys.exit(1)
    print(f"  Removed {len(row_indices)} row(s) for project {project_id} from projects.xlsx.")

    # ── Delete per-run xlsx ────────────────────────────────────
    if run_xlsx and run_xlsx.exists():
        try:
            run_xlsx.unlink()
            print(f"  Deleted run file: {run_xlsx.name}")
        except Exception as e:
            print(f"  Warning: Could not delete run file: {e}")

    print()


if __name__ == "__main__":
    main()
