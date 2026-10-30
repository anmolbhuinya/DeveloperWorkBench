#!/usr/bin/env python3
"""Generates a template config.xlsx for local_clone_tool.py."""

import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)


def set_header_cell(cell, val):
    cell.value     = val
    cell.font      = HEADER_FONT
    cell.fill      = HEADER_FILL
    cell.alignment = Alignment(horizontal="center")


def add_row(ws, key, value, note=""):
    row = ws.max_row + 1
    ws.cell(row, 1, key)
    ws.cell(row, 2, value)
    if note:
        c = ws.cell(row, 3, note)
        c.font = NOTE_FONT


def build_settings(wb):
    ws = wb.create_sheet("Settings")
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 52
    for col, title in enumerate(("Key", "Value", "Notes"), start=1):
        set_header_cell(ws.cell(1, col), title)

    rows = [
        # key                  value       note
        ("scm_type",        "github",      "Options: github | bitbucket | azuredevops"),
        ("clone_link_type", "is cloned by","JIRA link type that connects the clone to the original ticket"),
    ]
    # Credentials (jira_base_url, jira_email, jira_api_token, github_token)
    # are stored in the shared secrets.xlsx at claude_code_workflows/secrets.xlsx
    for k, v, n in rows:
        add_row(ws, k, v, n)


def build_branch_types(wb):
    ws = wb.create_sheet("BranchTypes")
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 40
    for col, title in enumerate(("issue_type", "branch_prefix", "Notes"), start=1):
        set_header_cell(ws.cell(1, col), title)

    rows = [
        ("Bug",   "bug",     "Branch created as  bug-<TICKET_ID>-<summary>"),
        ("Story", "feature", "Branch created as  feature-<TICKET_ID>-<summary>"),
        ("Task",  "task",    "Branch created as  task-<TICKET_ID>-<summary>"),
        ("Epic",  "epic",    "Branch created as  epic-<TICKET_ID>-<summary>"),
    ]
    for issue, prefix, note in rows:
        add_row(ws, issue, prefix, note)


def main():
    # Save config.xlsx to the Local_Clone_Tool root (parent of scripts/)
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config.xlsx")
    out_path = os.path.normpath(out_path)

    wb = openpyxl.Workbook()
    wb.remove(wb.active)   # remove default Sheet
    build_settings(wb)
    build_branch_types(wb)
    wb.save(out_path)
    print(f"config.xlsx created at:\n  {out_path}")
    print("Fill in your credentials and paths, then run:")
    print("  python scripts/local_clone_tool.py <JIRA_CLONE_TICKET_URL>")


if __name__ == "__main__":
    main()
