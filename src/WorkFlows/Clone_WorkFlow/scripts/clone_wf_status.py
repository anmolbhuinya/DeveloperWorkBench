#!/usr/bin/env python3
"""
clone_wf_status.py — clonewfstatus command

Show Clone Workflow project status.

Usage:
  clonewfstatus                             List recent projects (latest 10)
  clonewfstatus -pid <id>                   All stages for a project
  clonewfstatus -pid <id> -stage <stage_id> Detail for one stage
  clonewfstatus -p <n>                      Page n (10 per page)
  clonewfstatus -r                          Oldest first
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
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"

_STATUS_COLOR = {
    "Completed":   green,
    "In Progress": yellow,
    "Paused":      yellow,
    "Failed":      red,
    "Pending":     grey,
    "Skipped":     grey,
}

def _cs(s):
    return _STATUS_COLOR.get(str(s), lambda x: x)(str(s))


def _load_projects():
    if not PROJECTS_PATH.exists():
        return []
    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            rows.append(dict(zip(headers, row)))
    return rows


def _load_stages(pid):
    path = STATUS_DIR / f"{pid}_stages_status.xlsx"
    if not path.exists():
        return []
    wb = openpyxl.load_workbook(str(path))
    ws = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            rows.append(dict(zip(headers, row)))
    return rows


def _print_list(rows, page, reverse):
    PER_PAGE = 10
    ordered  = list(rows) if reverse else list(reversed(rows))
    total    = len(ordered)
    start    = (page - 1) * PER_PAGE
    chunk    = ordered[start:start + PER_PAGE]

    print(f"\n  Clone Workflow Projects  {grey(f'(page {page}, {total} total)')}\n")
    print(f"  {'PID':<6}  {'TICKET':<16}  {'PAYOR':<12}  {'STAGES':<8}  {'STATUS':<25}  {'CREATED'}")
    print(f"  {'─'*6}  {'─'*16}  {'─'*12}  {'─'*8}  {'─'*14}  {'─'*19}")

    for r in chunk:
        pid     = str(r.get("pid", ""))
        ticket  = str(r.get("ticket", ""))[:16]
        payor   = str(r.get("payor_version", "") or "—")[:12]
        total_s = str(r.get("total_stages", ""))
        done_s  = str(r.get("completed_stages", "") or "0")
        stages  = f"{done_s}/{total_s}"
        status  = _cs(r.get("status", ""))
        created = str(r.get("created_at", ""))[:19]
        print(f"  {pid:<6}  {ticket:<16}  {payor:<12}  {stages:<8}  {status:<33}  {grey(created)}")

    print()
    if start + PER_PAGE < total:
        print(f"  {grey(f'Next page:  clonewfstatus -p {page + 1}')}")
    if start > 0:
        print(f"  {grey(f'Prev page:  clonewfstatus -p {page - 1}')}")
    print(f"\n  {grey('clonewfstatus -pid <id>  for stage detail')}")
    print()


def _print_detail(pid, stage_filter=None):
    rows    = _load_projects()
    project = next((r for r in rows if str(r.get("pid", "")) == str(pid)), None)
    if not project:
        print(f"\n  {red(f'Project {pid} not found.')}\n"); return

    print(f"\n  Clone Workflow — Project {bold(str(pid))}")
    print(f"  {'─' * 62}")
    print(f"  Ticket         : {bold(str(project.get('ticket', '')))}")
    print(f"  Payor version  : {str(project.get('payor_version', '') or '—')}")
    print(f"  Status         : {_cs(project.get('status', ''))}")
    print(f"  Stages done    : {project.get('completed_stages', 0)}/{project.get('total_stages', 0)}")
    print(f"  Created        : {grey(str(project.get('created_at', ''))[:19])}")
    if project.get("completed_at"):
        print(f"  Completed      : {grey(str(project.get('completed_at', ''))[:19])}")

    stage_rows = _load_stages(pid)
    if not stage_rows:
        print(f"\n  {grey(f'No stages file found: project_status/{pid}_stages_status.xlsx')}\n")
        return

    if stage_filter is not None:
        stage_rows = [r for r in stage_rows if str(r.get("stage_id", "")) == str(stage_filter)]
        if not stage_rows:
            print(f"\n  {yellow(f'Stage {stage_filter} not found in project {pid}.')}\n")
            return

    print(f"\n  {'SID':<5}  {'STAGE':<32}  {'TOOL':<18}  {'TOOL PID':<10}  STATUS")
    print(f"  {'─'*5}  {'─'*32}  {'─'*18}  {'─'*10}  {'─'*14}")

    for r in stage_rows:
        sid      = str(r.get("stage_id", ""))
        name     = str(r.get("stage_name", ""))[:32]
        tool     = str(r.get("tool_command", ""))[:18]
        tool_pid = str(r.get("tool_pid", "") or grey("—"))
        status   = _cs(r.get("status", ""))
        print(f"  {sid:<5}  {name:<32}  {tool:<18}  {tool_pid:<18}  {status}")
        if r.get("started_at"):
            print(f"         {grey('Started:   ' + str(r.get('started_at', ''))[:19])}")
        if r.get("completed_at"):
            print(f"         {grey('Completed: ' + str(r.get('completed_at', ''))[:19])}")
        if r.get("notes"):
            print(f"         {grey('Notes: ' + str(r.get('notes', '')))}")

    print()


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    pid          = None
    stage_filter = None
    page         = 1
    reverse      = False
    i = 0
    while i < len(args):
        if args[i] in ("-pid", "--pid") and i + 1 < len(args):
            pid = args[i + 1]; i += 2
        elif args[i] in ("-stage", "--stage") and i + 1 < len(args):
            stage_filter = args[i + 1]; i += 2
        elif args[i] in ("-p", "--page") and i + 1 < len(args):
            try: page = int(args[i + 1])
            except ValueError: pass
            i += 2
        elif args[i] in ("-r", "--reverse"):
            reverse = True; i += 1
        else:
            i += 1

    if pid:
        _print_detail(pid, stage_filter)
    else:
        rows = _load_projects()
        if not rows:
            print(f"\n  {grey('No projects found. Run  clonewf  to start a workflow.')}\n")
            return
        _print_list(rows, page, reverse)


if __name__ == "__main__":
    main()
