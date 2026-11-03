#!/usr/bin/env python3
"""Creates the initial projects.xlsx for the rregtest tool."""
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
PROJECTS_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Remote_Regression_Jenkins_IT_Failure"        # project data: <DWB>\DWB_Projects\WorkFlows\Remote_Regression_Jenkins_IT_Failure
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
OUT           = PROJECTS_ROOT / "projects.xlsx"

HDR_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
HDR_FILL = PatternFill("solid", fgColor="1F3864")
A_ALIGN  = Alignment(horizontal="left", vertical="center")

HEADERS = ["pid", "payor_version", "status", "created_at",
           "rpb_status", "regression_status", "gp_status", "payor_urls", "notes"]
WIDTHS  = [8, 16, 14, 20, 14, 18, 14, 120, 50]

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Payor"
ws.append(HEADERS)
for i, (h, w) in enumerate(zip(HEADERS, WIDTHS), start=1):
    c = ws.cell(1, i)
    c.font = HDR_FONT; c.fill = HDR_FILL; c.alignment = A_ALIGN
    ws.column_dimensions[ws.cell(1, i).column_letter].width = w
wb.save(str(OUT))
print(f"  [create] projects.xlsx")
