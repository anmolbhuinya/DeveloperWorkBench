#!/usr/bin/env python3
"""
Generates the full project configuration structure:
  project_types/project_types.xlsx        — project type registry with JIRA prefix
  project_type_config/<type>_config.xlsx        — repo paths + branch per project
  projects/<type>_projects.xlsx            — clone tracking log per project
"""

import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

TOOL_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)

# project_type → default JIRA prefix
PROJECT_TYPES = {
    "payor":     "PAYOR",
    "connector": "CONNECTOR",
    "classic":   "CLASSIC",
    "pik":       "PIK",
}


def set_header(cell, val):
    cell.value     = val
    cell.font      = HEADER_FONT
    cell.fill      = HEADER_FILL
    cell.alignment = Alignment(horizontal="center")


# ── project_types/project_types.xlsx ────────────────────────────────────────

def create_master():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ProjectTypes"
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 52

    for col, title in enumerate(("project_type", "jira_prefix", "Notes"), start=1):
        set_header(ws.cell(1, col), title)

    for ptype, prefix in PROJECT_TYPES.items():
        row = ws.max_row + 1
        ws.cell(row, 1, ptype).font   = Font(bold=True)
        ws.cell(row, 2, prefix).font  = Font(bold=True)
        ws.cell(row, 3,
                f"Config: project_type_config/{ptype}_config.xlsx  |  Log: projects/{ptype}_projects.xlsx"
               ).font = NOTE_FONT

    out = os.path.join(TOOL_ROOT, "project_types", "project_types.xlsx")
    wb.save(out)
    print(f"  project_types.xlsx -> {out}")


# ── project_type_config/<type>_config.xlsx ───────────────────────────────────────

CONFIG_ROWS = [
    ("repo_url",              "",         "GitHub repo URL for version resolution, e.g. https://github.com/HE-Core/hrp.payer.core/"),
    ("source_repo_branch",    "master",   "Branch where original PRs are merged (usually master)"),
    ("release_branch_prefix", "release-", "Prefix for release branches, e.g. release-"),
    ("jira_prefix",           "",         "JIRA project prefix, e.g. PAYOR"),
]

def create_project_type_config(ptype):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Config"
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 42
    ws.column_dimensions["C"].width = 58

    for col, title in enumerate(("Key", "Value", "Notes"), start=1):
        set_header(ws.cell(1, col), title)

    for key, value, note in CONFIG_ROWS:
        row = ws.max_row + 1
        ws.cell(row, 1, key).font = Font(bold=True)
        ws.cell(row, 2, value)
        ws.cell(row, 3, note).font = NOTE_FONT

    out = os.path.join(TOOL_ROOT, "project_type_config", f"{ptype}_config.xlsx")
    wb.save(out)
    print(f"  {ptype}_config.xlsx -> {out}")


# ── projects/<type>_projects.xlsx ────────────────────────────────────────────

PROJ_HEADERS = [
    ("project_id",    12),
    ("ticket_id",     20),
    ("parent_ticket", 20),
    ("payor_version", 14),
    ("created_at",    22),
    ("status",        16),
]

PR_HEADERS = [
    ("project_id",      12),
    ("pr_index",        10),
    ("original_pr_url", 52),
    ("original_branch", 36),
    ("clone_branch",    36),
    ("clone_pr_url",    52),
    ("pr_status",       16),
]

def create_project_log(ptype):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    ws_proj = wb.create_sheet("Projects")
    for col, (header, width) in enumerate(PROJ_HEADERS, start=1):
        ws_proj.column_dimensions[ws_proj.cell(1, col).column_letter].width = width
        set_header(ws_proj.cell(1, col), header)

    ws_prs = wb.create_sheet("PRs")
    for col, (header, width) in enumerate(PR_HEADERS, start=1):
        ws_prs.column_dimensions[ws_prs.cell(1, col).column_letter].width = width
        set_header(ws_prs.cell(1, col), header)

    out = os.path.join(TOOL_ROOT, "projects", f"{ptype}_projects.xlsx")
    wb.save(out)
    print(f"  {ptype}_projects.xlsx -> {out}  (Projects + PRs sheets)")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print("Creating project_types/project_types.xlsx...")
    create_master()

    print("\nCreating project_type_config files...")
    for ptype in PROJECT_TYPES:
        create_project_type_config(ptype)

    print("\nCreating projects log files...")
    for ptype in PROJECT_TYPES:
        create_project_log(ptype)

    print("\nDone.")
    print("  - Fill in repo_url and other settings in each project_type_config file.")
    print("  - Repo paths are auto-discovered via setbranch + tosrc and saved per-project.")
    print("  - projects/<type>_projects.xlsx files are auto-populated by lclone runs.")


if __name__ == "__main__":
    main()
