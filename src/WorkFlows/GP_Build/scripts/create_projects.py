#!/usr/bin/env python3
"""Generates projects.xlsx tracking log for GP Build runs."""

import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

TOOL_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "GP_Build"        # project data: <DWB>\Projects\WorkFlows\GP_Build
DATA_ROOT.mkdir(parents=True, exist_ok=True)

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)

COLUMNS = [
    ("project_id",     12),
    ("ticket_id",      20),
    ("feature_branch", 48),
    ("dest_branch",    30),
    ("auto_merge",     14),
    ("config_file",    60),
    ("status",         18),
    ("pr_url",         60),
    ("pr_status",      14),
    ("job_id",         10),
]


def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Payor"

    for col, (header, width) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[ws.cell(1, col).column_letter].width = width
        cell = ws.cell(1, col, header)
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")

    out = os.path.join(DATA_ROOT, "projects.xlsx")
    wb.save(out)
    print(f"projects.xlsx created at:\n  {out}")
    print("Rows are populated automatically by gprun.")


if __name__ == "__main__":
    main()
