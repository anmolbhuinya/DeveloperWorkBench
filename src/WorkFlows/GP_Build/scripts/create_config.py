#!/usr/bin/env python3
"""Generates gp_job_config.xlsx for the GP Build Tool."""

import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

TOOL_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)

# Each row: (application_name, url)
SETTINGS_ROWS = [
    ("Payor", "http://central-gp:6060/job/stormtroopers/job/payor-end-to-end/"),
]


def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Settings"

    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 80

    # Header row
    for col, title in enumerate(("application", "url"), start=1):
        cell = ws.cell(1, col, title)
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")

    # Data rows
    for app_name, url in SETTINGS_ROWS:
        row = ws.max_row + 1
        ws.cell(row, 1, app_name).font = Font(bold=True)
        ws.cell(row, 2, url)

    out = os.path.join(TOOL_ROOT, "gp_job_config.xlsx")
    wb.save(out)
    print(f"gp_job_config.xlsx created at:\n  {out}")
    print("\nEdit the Settings sheet to update application name and Jenkins job URL.")


if __name__ == "__main__":
    main()
