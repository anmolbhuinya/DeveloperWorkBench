#!/usr/bin/env python3
"""Create reg_job_config.xlsx skeleton with pre-filled payor job URLs."""

from pathlib import Path
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

TOOL_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH  = TOOL_ROOT / "reg_job_config.xlsx"

PAYOR_JOBS = [
    ("billing",         "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-billing-ora-container/"),
    ("claims",          "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-claims-ora-container/"),
    ("enrollment",      "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-enrollment-ora-container/"),
    ("he-integrations", "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-he-integrations-ora-container/"),
    ("platform",        "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-platform-ora-container/"),
    ("provider",        "http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-provider-ora-container/"),
]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
A_ALIGN     = Alignment(horizontal="left", vertical="center")


def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "payor"

    headers = ["job_name", "job_url"]
    ws.append(headers)
    for i, h in enumerate(headers, 1):
        c = ws.cell(1, i)
        c.font      = HEADER_FONT
        c.fill      = HEADER_FILL
        c.alignment = A_ALIGN

    for job_name, job_url in PAYOR_JOBS:
        ws.append([job_name, job_url])

    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 100

    wb.save(str(OUT_PATH))
    print(f"  [create] {OUT_PATH.name}")


if __name__ == "__main__":
    main()
