#!/usr/bin/env python3
"""Create git_config.xlsx with GitHub repository URLs for each product."""

from pathlib import Path
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

TOOL_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH  = TOOL_ROOT / "git_config.xlsx"

REPOS = [
    ("payor", "https://github.com/HE-Core/hrp.payer.core/"),
]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
A_ALIGN     = Alignment(horizontal="left", vertical="center")


def main():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "repos"

    headers = ["name", "repo_url"]
    ws.append(headers)
    for i, h in enumerate(headers, 1):
        c           = ws.cell(1, i)
        c.font      = HEADER_FONT
        c.fill      = HEADER_FILL
        c.alignment = A_ALIGN

    for name, url in REPOS:
        ws.append([name, url])

    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 80

    wb.save(str(OUT_PATH))
    print(f"  [create] {OUT_PATH.name}")
    print(f"           Verify 'payor' repo URL in git_config.xlsx → repos sheet")


if __name__ == "__main__":
    main()
