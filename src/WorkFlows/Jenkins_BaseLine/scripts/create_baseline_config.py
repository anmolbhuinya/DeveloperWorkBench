#!/usr/bin/env python3
"""Create baseline_job_config.xlsx skeleton with pre-filled job rows."""

from pathlib import Path
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

TOOL_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH  = TOOL_ROOT / "baseline_job_config.xlsx"

JOBS = [
    ("payor_core_commit",        "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Payor/job/{version}/job/payor-core-commit",        ""),
    ("payor_utils_certification", "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Payor/job/{version}/job/payor-utils-certification", ""),
    ("billing",                  "", ""),
    ("claims",                   "", ""),
    ("enrollment",               "", ""),
    ("he-integrations",          "", ""),
    ("platform",                 "", ""),
    ("provider",                 "", ""),
]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
A_ALIGN     = Alignment(horizontal="left", vertical="center")


def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "payor"

    headers = ["job_name", "job_url", "version_param_name"]
    ws.append(headers)
    for i, _ in enumerate(headers, 1):
        c = ws.cell(1, i)
        c.font      = HEADER_FONT
        c.fill      = HEADER_FILL
        c.alignment = A_ALIGN

    for row in JOBS:
        ws.append(list(row))

    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 100
    ws.column_dimensions["C"].width = 30

    wb.save(str(OUT_PATH))
    print(f"  [create] {OUT_PATH.name}")
    print(f"           URLs containing {{version}} will have the literal '{{version}}' replaced")
    print(f"           with the release version at runtime (e.g. 26.1.1.1).")
    print(f"           Fill in blank job_url values for billing, claims, etc.")


if __name__ == "__main__":
    main()
