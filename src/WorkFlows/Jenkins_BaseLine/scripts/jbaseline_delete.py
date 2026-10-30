#!/usr/bin/env python3
"""
jbaseline_delete.py — Delete a Jenkins IT BaseLine project entry.

Usage:
  jbaselinedelete -pid <project_id>
  jbaselinedelete --help
"""

import sys
import time as _time
import openpyxl
from pathlib import Path
import filelock as _filelock

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"
PROJECTS_DIR  = TOOL_ROOT / "projects"

_JB_LEASE_SECONDS = 15 * 60

def _projects_filelock():
    """Cross-process FileLock for projects.xlsx with 15-min lease eviction."""
    _lp = TOOL_ROOT / "projects.xlsx.lock"
    if _lp.exists():
        try:
            if _time.time() - _lp.stat().st_mtime > _JB_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30)

R     = "\x1b[0m"
BOLD  = lambda s: f"\x1b[1m{s}{R}"
RED   = lambda s: f"\x1b[31m{s}{R}"
GREEN = lambda s: f"\x1b[32m{s}{R}"
GREY  = lambda s: f"\x1b[90m{s}{R}"


def _find_run_xlsx(project_id: int) -> Path | None:
    if not PROJECTS_DIR.exists():
        return None
    matches = list(PROJECTS_DIR.glob(f"{project_id}_*.xlsx"))
    return matches[0] if matches else None


def load_project_rows(project_id: int):
    if not PROJECTS_PATH.exists():
        print(f"\n  projects.xlsx not found. Run  setupjbaselinetool  to initialise.\n")
        sys.exit(1)

    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb.active
    headers = [str(c.value or "").strip() for c in ws[1]]
    col     = {h: i for i, h in enumerate(headers)}

    row_indices = []
    summary     = {"version": "", "jobs": [], "triggered_at": ""}

    for row_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        try:
            pid = int(row[col.get("project_id", 0)].value)
        except (TypeError, ValueError):
            continue
        if pid != project_id:
            continue
        row_indices.append(row_idx)
        version = str(row[col.get("payor_release_version", 1)].value or "")
        jname   = str(row[col.get("job_name",              2)].value or "")
        phase   = str(row[col.get("phase",                 3)].value or "")
        status  = str(row[col.get("completed",             4)].value or "")
        ts      = str(row[col.get("triggered_at",          6)].value or "")
        if not summary["version"]:
            summary["version"]      = version
            summary["triggered_at"] = ts
        summary["jobs"].append({"job_name": jname, "phase": phase, "status": status})

    return wb, ws, row_indices, summary


def main():
    argv = sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        print("""
  jbaselinedelete -pid <project_id>   Delete a project from projects.xlsx and its
                                      per-run xlsx file in projects/.
  jbaselinedelete --help              Show this help.
""")
        sys.exit(0)

    project_id = None
    i = 0
    while i < len(argv):
        if argv[i] in ("-pid", "--pid") and i + 1 < len(argv):
            try:
                project_id = int(argv[i + 1])
            except ValueError:
                print(f"  ERROR: -pid must be an integer, got '{argv[i + 1]}'")
                sys.exit(1)
            i += 2
        else:
            i += 1

    if project_id is None:
        print("  ERROR: -pid <project_id> is required.")
        print("  Usage: jbaselinedelete -pid <project_id>")
        sys.exit(1)

    wb, ws, row_indices, summary = load_project_rows(project_id)

    if not row_indices:
        print(f"\n  ERROR: Project {project_id} not found in projects.xlsx.\n")
        sys.exit(1)

    run_xlsx = _find_run_xlsx(project_id)

    print(f"\n  Project to delete:\n")
    print(f"    {GREY('project_id:'): <30}  {project_id}")
    print(f"    {GREY('release_version:'): <30}  {summary['version']}")
    print(f"    {GREY('triggered_at:'): <30}  {summary['triggered_at'][:19]}")
    print(f"    {GREY('jobs:'): <30}  {len(summary['jobs'])}")
    for jd in summary["jobs"]:
        print(f"      {GREY('·')}  [{jd['phase']:<14}]  {jd['job_name']:<28}  {jd['status']}")
    if run_xlsx:
        print(f"    {GREY('run file:'): <30}  {run_xlsx.name}  [{GREEN('exists')}]")
    else:
        print(f"    {GREY('run file:'): <30}  {project_id}_*.xlsx  [{GREY('not found')}]")
    print()

    try:
        confirm = input(f"  Delete project {BOLD(str(project_id))}? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)

    if confirm != "y":
        print("  Cancelled.\n")
        sys.exit(0)

    for row_idx in sorted(row_indices, reverse=True):
        ws.delete_rows(row_idx)
    try:
        with _projects_filelock():
            wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  ERROR: Could not save projects.xlsx (file may be open).\n")
        sys.exit(1)
    print(f"  Removed {len(row_indices)} row(s) for project {project_id} from projects.xlsx.")

    if run_xlsx and run_xlsx.exists():
        try:
            run_xlsx.unlink()
            print(f"  Deleted run file: {run_xlsx.name}")
        except Exception as e:
            print(f"  Warning: Could not delete run file: {e}")

    print()


if __name__ == "__main__":
    main()
