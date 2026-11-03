#!/usr/bin/env python3
"""Create projects.xlsx skeleton for Jenkins IT BaseLine run tracking."""

from pathlib import Path
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

TOOL_ROOT = Path(__file__).resolve().parent.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Jenkins_BaseLine"        # project data: <DWB>\DWB_Projects\WorkFlows\Jenkins_BaseLine
DATA_ROOT.mkdir(parents=True, exist_ok=True)
OUT_PATH  = DATA_ROOT / "projects.xlsx"

COLUMNS = ["project_id", "payor_release_version", "job_name", "phase", "completed", "job_id", "triggered_at"]
WIDTHS  = [12,           22,                      20,          14,      14,          10,        22]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
A_ALIGN     = Alignment(horizontal="left", vertical="center")


def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "runs"
    ws.append(COLUMNS)
    for i, (_, width) in enumerate(zip(COLUMNS, WIDTHS), 1):
        c = ws.cell(1, i)
        c.font      = HEADER_FONT
        c.fill      = HEADER_FILL
        c.alignment = A_ALIGN
        ws.column_dimensions[ws.cell(1, i).column_letter].width = width
    wb.save(str(OUT_PATH))
    print(f"  [create] {OUT_PATH.name}")


if __name__ == "__main__":
    main()
