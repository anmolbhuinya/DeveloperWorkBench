#!/usr/bin/env python3
"""
Generates a skeleton gp_params.xlsx with empty BuildParameters and
INTEG_TEST_GROUP_CATEGORY sheets.

Run this once to create the file, then run:
  python scripts/fetch_build_params.py      — to populate BuildParameters
  python scripts/fetch_test_groups.py       — to populate INTEG_TEST_GROUP_CATEGORY
"""

import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

TOOL_ROOT      = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
GP_PARAMS_DIR  = os.path.join(TOOL_ROOT, "gp_params")
GP_PARAMS_PATH = os.path.join(GP_PARAMS_DIR, "payor_gp_params.xlsx")

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)


def set_header(ws, col, title):
    cell = ws.cell(1, col, title)
    cell.font      = HEADER_FONT
    cell.fill      = HEADER_FILL
    cell.alignment = Alignment(horizontal="center")


def build_parameters_sheet(wb):
    ws = wb.create_sheet("BuildParameters")
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 36
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 24
    ws.column_dimensions["E"].width = 50
    for col, title in enumerate(
            ("parameter", "value", "type", "default", "description"), start=1):
        set_header(ws, col, title)


def integ_category_sheet(wb):
    ws = wb.create_sheet("INTEG_TEST_GROUP_CATEGORY")
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 120
    for col, title in enumerate(
            ("category", "integ_test_groups (comma-separated)"), start=1):
        set_header(ws, col, title)


def main():
    os.makedirs(GP_PARAMS_DIR, exist_ok=True)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    build_parameters_sheet(wb)
    integ_category_sheet(wb)
    wb.save(GP_PARAMS_PATH)
    print(f"payor_gp_params.xlsx created at:\n  {GP_PARAMS_PATH}")
    print("\nNext steps:")
    print("  python scripts/fetch_build_params.py   — populate BuildParameters from Jenkins")
    print("  python scripts/fetch_test_groups.py    — populate INTEG_TEST_GROUP_CATEGORY from Jenkins")


if __name__ == "__main__":
    main()
