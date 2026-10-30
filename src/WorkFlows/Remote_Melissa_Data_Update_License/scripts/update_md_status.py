#!/usr/bin/env python3
"""
update_md_status.py — mdlstatus command

Show Melissa Data License update project history.

Usage:
  mdlstatus                     List latest 10 projects (newest first)
  mdlstatus -pid <project_id>   Show detail for one project
  mdlstatus --help
"""

import sys
import re
from pathlib import Path
import openpyxl

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"

PAGE_SIZE = 10

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"
def dim(s):    return f"\x1b[2m{s}{RESET}"


def _status_color(status):
    s = str(status or "").lower()
    if s == "passed":   return green(status)
    if s == "running":  return cyan(status)
    if s == "failed":   return yellow(status)
    if s == "aborted":  return grey(status)
    return white(status)


def _changes_color(val):
    v = str(val or "").lower()
    if v == "yes": return yellow("Yes")
    if v == "no":  return green("No")
    return grey("—")


def _visible_len(s):
    s = re.sub(r'\x1b\[[0-9;]*[mK]', '', s)
    s = re.sub(r'\x1b\][^\x07]*\x07', '', s)
    return len(s)


def _pad(s, w):
    return s + " " * max(0, w - _visible_len(s))


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _load_projects():
    if not PROJECTS_PATH.exists():
        return []
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
    rows    = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            rows.append(dict(zip(headers, row)))
    return list(reversed(rows))   # newest first


def _find_project(pid):
    for r in _load_projects():
        if str(r.get("pid", "")).strip() == str(pid).strip():
            return r
    return None


# ---------------------------------------------------------------------------
# Table
# ---------------------------------------------------------------------------

_COL = {"pid": 4, "vm": 22, "ip": 16, "time": 20, "status": 10, "changes": 8}


def _print_table(projects, page, total_pages):
    print()
    print(bold(white("  Melissa Data Update Projects")))
    print()

    header = (
        "  " +
        _pad(dim("PID"),     _COL["pid"])     + "  " +
        _pad(dim("VM"),      _COL["vm"])      + "  " +
        _pad(dim("IP"),      _COL["ip"])      + "  " +
        _pad(dim("TIME"),    _COL["time"])    + "  " +
        _pad(dim("STATUS"),  _COL["status"])  + "  " +
        dim("CHANGES")
    )
    print(header)
    print("  " + grey("-" * (_visible_len(header) - 2)))

    for p in projects:
        pid     = str(p.get("pid",       "") or "")
        vm      = str(p.get("vm_name",   "") or "")
        ip      = str(p.get("vm_ip",     "") or "")
        ts      = str(p.get("timestamp", "") or "")
        status  = str(p.get("status",    "") or "")
        changes = str(p.get("changes",   "") or "")

        vm_disp = vm[:_COL["vm"] - 1] + "…" if len(vm) > _COL["vm"] else vm

        print(
            "  " +
            _pad(cyan(pid),              _COL["pid"])     + "  " +
            _pad(vm_disp,                _COL["vm"])      + "  " +
            _pad(grey(ip),               _COL["ip"])      + "  " +
            _pad(grey(ts),               _COL["time"])    + "  " +
            _pad(_status_color(status),  _COL["status"])  + "  " +
            _changes_color(changes)
        )

    print()
    if total_pages > 1:
        print(grey(f"  Page {page}/{total_pages}  —  n next  p prev  q quit"))
    print(grey("  updatemdstatus -pid <id>  for project detail\n"))


# ---------------------------------------------------------------------------
# Project list with pagination
# ---------------------------------------------------------------------------

def print_project_list():
    projects = _load_projects()
    if not projects:
        print()
        print(bold(white("  Melissa Data Update Projects")))
        print()
        print(grey("  No projects found."))
        print(grey("  Run  updatemelissadata  to start an update.\n"))
        return

    total       = len(projects)
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page        = 1

    while True:
        start = (page - 1) * PAGE_SIZE
        _print_table(projects[start:start + PAGE_SIZE], page, total_pages)

        if total_pages == 1:
            break

        try:
            key = input("  > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print(); break

        if key == "q" or key == "":
            break
        elif key == "n" and page < total_pages:
            page += 1
        elif key == "p" and page > 1:
            page -= 1


# ---------------------------------------------------------------------------
# Project detail
# ---------------------------------------------------------------------------

def print_project_detail(pid):
    project = _find_project(pid)
    if not project:
        print(f"\n  ERROR: Project #{pid} not found in projects.xlsx.\n")
        sys.exit(1)

    vm_name   = str(project.get("vm_name",   "") or "")
    vm_ip     = str(project.get("vm_ip",     "") or "")
    ts        = str(project.get("timestamp", "") or "")
    status    = str(project.get("status",    "") or "")
    changes   = str(project.get("changes",   "") or "")
    notes     = str(project.get("notes",     "") or "")

    print()
    print(bold(white(f"  Project #{pid}")))
    print(grey(f"  {'─' * 52}"))
    print(f"  {'VM':<18} : {bold(vm_name)}  {grey(vm_ip)}")
    print(f"  {'Time':<18} : {grey(ts)}")
    print(f"  {'Status':<18} : {_status_color(status)}")
    print(f"  {'Changes':<18} : {_changes_color(changes)}")
    if notes:
        print()
        print(grey(f"  {'─' * 52}"))
        print(f"  Changed files:")
        for line in notes.split("\n"):
            if line.strip():
                print(f"    {line}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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

    if pid:
        print_project_detail(pid)
    else:
        print_project_list()


if __name__ == "__main__":
    main()
