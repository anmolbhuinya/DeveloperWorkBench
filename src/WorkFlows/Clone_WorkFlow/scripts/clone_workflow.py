#!/usr/bin/env python3
"""
clone_workflow.py — cloneworkflow / clonewf command

Guided clone/release workflow orchestrator. Tracks all opted-in stages and
their individual tool project IDs in a per-project stages status file.

Usage:
  clonewf
  cloneworkflow
"""

import sys
import io
import subprocess
from pathlib import Path
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Clone_WorkFlow"        # project data: <DWB>\DWB_Projects\WorkFlows\Clone_WorkFlow
DATA_ROOT.mkdir(parents=True, exist_ok=True)
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"
STATUS_DIR    = TOOL_ROOT / "project_status"

PROJ_HEADERS = ["pid", "ticket", "payor_version", "stages",
                "total_stages", "completed_stages", "status",
                "created_at", "completed_at", "notes"]
PROJ_WIDTHS  = [6, 16, 14, 90, 13, 16, 14, 22, 22, 60]

STAGE_HEADERS = ["stage_id", "stage_key", "stage_name", "tool_command",
                 "tool_pid", "status", "started_at", "completed_at", "notes"]
STAGE_WIDTHS  = [8, 22, 40, 22, 10, 14, 22, 22, 60]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"

ALL_STAGES = [
    {
        "id":          "baseline",
        "name":        "Baseline Creation",
        "label":       "1.  Baseline Creation",
        "tool":        "jbaseline",
        "cmd_hint":    "jbaseline -payor {payor_version}",
        "needs_payor": True,
        "needs_ticket": False,
    },
    {
        "id":          "remote_setup",
        "name":        "Remote VM Setup",
        "label":       "2.  Remote VM Setup",
        "tool":        "rvmsetup",
        "cmd_hint":    "rvmsetup",
        "needs_payor": False,
        "needs_ticket": False,
    },
    {
        "id":          "melissa_update",
        "name":        "Melissa Data License Update",
        "label":       "3a. Melissa Data License Update",
        "tool":        "updatemdl",
        "cmd_hint":    "updatemdl",
        "needs_payor": False,
        "needs_ticket": False,
    },
    {
        "id":          "melissa_gp_payor",
        "name":        "GP - Melissa Data PR (Payor)",
        "label":       "3b. GP - Melissa Data PR (Payor)",
        "tool":        "gprun",
        "cmd_hint":    "gprun  (Melissa Data Payor PR)",
        "needs_payor": False,
        "needs_ticket": False,
    },
    {
        "id":          "melissa_gp_classic",
        "name":        "GP - Melissa Data PR (Classic)",
        "label":       "3c. GP - Melissa Data PR (Classic)",
        "tool":        "gprun",
        "cmd_hint":    "gprun  (Melissa Data Classic PR)",
        "needs_payor": False,
        "needs_ticket": False,
    },
    {
        "id":          "clone",
        "name":        "Clone",
        "label":       "4a. Clone",
        "tool":        "lclone",
        "cmd_hint":    "lclone -ticket {ticket}",
        "needs_payor": False,
        "needs_ticket": True,
    },
    {
        "id":          "clone_pr_gp",
        "name":        "GP – Clone PR",
        "label":       "4b. GP – Clone PR",
        "tool":        "gprun",
        "cmd_hint":    "gprun  (Clone PR)",
        "needs_payor": False,
        "needs_ticket": False,
    },
    {
        "id":          "jreg",
        "name":        "Jenkins Regression",
        "label":       "5.  Jenkins Regression",
        "tool":        "jenkinsregression",
        "cmd_hint":    "jenkinsregression -payor {payor_version}",
        "needs_payor": True,
        "needs_ticket": False,
    },
    {
        "id":          "rpb",
        "name":        "Remote Regression Baseline",
        "label":       "6.  Remote Regression Baseline",
        "tool":        "rpb",
        "cmd_hint":    "rpb",
        "needs_payor": False,
        "needs_ticket": False,
    },
]


# ── XLSX helpers ───────────────────────────────────────────────────────────────

def _make_sheet(wb, title, headers, widths):
    ws = wb.active if len(wb.worksheets) == 1 and wb.active.title == "Sheet" else wb.create_sheet(title)
    ws.title = title
    for col, (h, w) in enumerate(zip(headers, widths), 1):
        c = ws.cell(1, col, h)
        c.font = HEADER_FONT; c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="left")
        ws.column_dimensions[c.column_letter].width = w
    return ws


def _ensure_projects():
    if PROJECTS_PATH.exists():
        return
    wb = openpyxl.Workbook()
    _make_sheet(wb, "Payor", PROJ_HEADERS, PROJ_WIDTHS)
    wb.save(str(PROJECTS_PATH))


def _next_pid() -> int:
    if not PROJECTS_PATH.exists():
        return 1
    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb.active
    return max((ws.cell(r, 1).value or 0 for r in range(2, ws.max_row + 1)), default=0) + 1


def _create_project(pid, ticket, payor_version, selected_ids):
    _ensure_projects()
    wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws  = wb.active
    ts  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ws.append([pid, ticket, payor_version, ",".join(selected_ids),
               len(selected_ids), 0, "In Progress", ts, "", ""])
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  Warning: Could not save projects.xlsx (file may be open).")


def _update_project(pid, status, completed=None):
    if not PROJECTS_PATH.exists():
        return
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i for i, h in enumerate(headers, 1)}
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value or "").strip() == str(pid).strip():
            if "status" in col_map:
                row[col_map["status"] - 1].value = status
            if completed is not None and "completed_stages" in col_map:
                row[col_map["completed_stages"] - 1].value = completed
            if status in ("Completed", "Failed", "Paused") and "completed_at" in col_map:
                row[col_map["completed_at"] - 1].value = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            break
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        pass


def _create_stages_xlsx(pid, selected_stages):
    STATUS_DIR.mkdir(parents=True, exist_ok=True)
    path = STATUS_DIR / f"{pid}_stages_status.xlsx"
    wb   = openpyxl.Workbook()
    ws   = _make_sheet(wb, "Stages", STAGE_HEADERS, STAGE_WIDTHS)
    for i, stage in enumerate(selected_stages, 1):
        ws.append([i, stage["id"], stage["name"], stage["tool"],
                   "", "Pending", "", "", ""])
    wb.save(str(path))


def _update_stage(pid, stage_id, **kwargs):
    path = STATUS_DIR / f"{pid}_stages_status.xlsx"
    if not path.exists():
        return
    wb      = openpyxl.load_workbook(str(path))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i for i, h in enumerate(headers, 1)}
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value or "").strip() == str(stage_id).strip():
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            for k, v in kwargs.items():
                if k == "mark_started":
                    if "started_at" in col_map:
                        row[col_map["started_at"] - 1].value = ts
                elif k == "mark_completed":
                    if "completed_at" in col_map:
                        row[col_map["completed_at"] - 1].value = ts
                elif k in col_map:
                    row[col_map[k] - 1].value = v
            break
    try:
        wb.save(str(path))
    except PermissionError:
        pass


# ── Stage execution ────────────────────────────────────────────────────────────

def _build_cmd(stage, params):
    hint = stage["cmd_hint"]
    hint = hint.replace("{payor_version}", params.get("payor_version", "<payor_version>"))
    hint = hint.replace("{ticket}",        params.get("ticket", "<ticket>"))
    return hint


def _run_stage(pid, stage_id, stage, params):
    cmd_hint = _build_cmd(stage, params)

    print(f"\n  {'─' * 62}")
    print(f"  Stage {stage_id}  —  {bold(stage['label'])}")
    print(f"  {'─' * 62}")
    print(f"  Command:  {cyan(bold(cmd_hint))}")
    print()

    _update_stage(pid, stage_id, status="In Progress", mark_started=True)

    # Offer to auto-launch
    try:
        choice = input("  Launch automatically in this terminal? [Y/n/s(skip)]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        _update_stage(pid, stage_id, status="Skipped")
        return None

    if choice in ("s", "skip"):
        _update_stage(pid, stage_id, status="Skipped", mark_completed=True)
        print(f"  {grey('Stage skipped.')}")
        return None

    if choice in ("", "y", "yes"):
        cmd_parts = cmd_hint.split()
        print()
        try:
            subprocess.call(cmd_parts, shell=True)
        except Exception as e:
            print(f"  {yellow('Launch error:')} {e}")
        print()
    else:
        print(f"\n  {grey('Run the command above in another terminal, then return here.')}\n")

    # Capture tool project ID
    try:
        raw = input(f"  Enter project ID assigned by {bold(stage['tool'])} (or Enter to skip): ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        raw = ""

    if raw:
        _update_stage(pid, stage_id, status="Completed", tool_pid=raw, mark_completed=True)
        print(f"  {green('Recorded')} — tool PID: {bold(raw)}")
    else:
        _update_stage(pid, stage_id, status="Completed", mark_completed=True)
        print(f"  {grey('Stage complete (no tool PID recorded).')}")

    return raw or None


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print("\n  Clone Workflow Tool")
    print(f"  {'═' * 62}\n")

    # ── Stages overview (box table) ──
    t_rows = [(str(i), s["id"], s["label"], s["tool"])
              for i, s in enumerate(ALL_STAGES, 1)]
    t_hdrs = ("#", "ID", "Label", "Tool")
    t_w    = [max(len(t_hdrs[c]), max(len(r[c]) for r in t_rows)) + 2
              for c in range(4)]

    def _tborder(l, m, r):
        return "  " + l + m.join("─" * w for w in t_w) + r

    def _thdr(cells):
        return "  │" + "│".join(f" {c:^{t_w[i]-2}} " for i, c in enumerate(cells)) + "│"

    def _tdata(cells):
        return "  │" + "│".join(f" {c:<{t_w[i]-2}} " for i, c in enumerate(cells)) + "│"

    print("  Stages:\n")
    print(_tborder("┌", "┬", "┐"))
    print(_thdr(t_hdrs))
    print(_tborder("├", "┼", "┤"))
    for j, row in enumerate(t_rows):
        print(_tdata(row))
        if j < len(t_rows) - 1:
            print(_tborder("├", "┼", "┤"))
    print(_tborder("└", "┴", "┘"))
    print()

    # ── Proceed? ──
    try:
        proceed = input("  Proceed? [y/n]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); sys.exit(0)
    if proceed not in ("y", "yes"):
        print("  Aborted."); sys.exit(0)

    # ── Common params ──
    print()
    try:
        ticket = input("  JIRA Ticket (e.g. PAYOR-12345): ").strip()
    except (EOFError, KeyboardInterrupt):
        print(); sys.exit(0)
    if not ticket:
        print("  ERROR: ticket is required."); sys.exit(1)

    # ── Stage opt-in ──
    print(f"\n  Select stages to include:\n")
    selected = []
    need_payor = False

    for stage in ALL_STAGES:
        try:
            ans = input(f"    {stage['label']:<38} [y/n]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
        if ans in ("y", "yes"):
            selected.append(stage)
            if stage["needs_payor"]:
                need_payor = True

    if not selected:
        print("\n  No stages selected — exiting."); sys.exit(0)

    # ── Payor version (if needed) ──
    payor_version = ""
    if need_payor:
        try:
            payor_version = input("\n  Payor version (e.g. 26.1.1.1): ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
        if not payor_version:
            print("  ERROR: payor version required by selected stages."); sys.exit(1)

    params = {"ticket": ticket, "payor_version": payor_version}

    # ── Create project ──
    pid = _next_pid()
    _create_project(pid, ticket, payor_version, [s["id"] for s in selected])
    _create_stages_xlsx(pid, selected)

    print(f"\n  {green('Project created')}  —  ID: {bold(str(pid))}")
    print(f"  Stages : {len(selected)}")
    print(f"  Tracker: project_status/{pid}_stages_status.xlsx\n")

    # ── Execute stages ──
    done = 0
    for i, stage in enumerate(selected, 1):
        _run_stage(pid, i, stage, params)
        done += 1
        _update_project(pid, "In Progress", completed=done)

    # ── Summary ──
    _update_project(pid, "Completed", completed=done)

    print(f"\n  {'═' * 62}")
    print(f"  {green(bold('Workflow complete'))}  —  Project ID: {bold(str(pid))}")
    print()
    print(f"  {'SID':<5}  {'STAGE':<36}  {'TOOL PID'}")
    print(f"  {'─'*5}  {'─'*36}  {'─'*10}")

    path = STATUS_DIR / f"{pid}_stages_status.xlsx"
    if path.exists():
        wb = openpyxl.load_workbook(str(path))
        ws = wb.active
        headers = [str(ws.cell(1, c).value or "").strip().lower()
                   for c in range(1, ws.max_column + 1)]
        col_map = {h: i for i, h in enumerate(headers, 1)}
        for row in ws.iter_rows(min_row=2, values_only=True):
            d = dict(zip(headers, row))
            sid  = str(d.get("stage_id", ""))
            name = str(d.get("stage_name", ""))[:36]
            tpid = str(d.get("tool_pid", "") or grey("—"))
            print(f"  {sid:<5}  {name:<36}  {tpid}")

    print()
    print(f"  Run  {bold(f'clonewfstatus -pid {pid}')}  for full detail.")
    print()


if __name__ == "__main__":
    main()
