#!/usr/bin/env python3
"""Generates the shared secrets.xlsx used by all tools in this workspace."""

import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "secrets.xlsx")

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)
BOLD        = Font(bold=True)

SHEETS = {
    "Atlassian": [
        ("jira_base_url",  "", "JIRA server URL, e.g. https://healthedge.atlassian.net"),
        ("jira_email",     "", "Atlassian login email"),
        ("jira_api_token", "", "API token from id.atlassian.com/manage-profile/security/api-tokens"),
    ],
    "GitHub": [
        ("github_token",   "", "Personal access token — repo read scope minimum"),
        ("github_token_for_web_ui", "", "Personal access token — read:packages scope minimum"),
    ],
    "Jenkins": [
        ("jenkins_username",   "", "Jenkins login username"),
        ("jenkins_api_token",  "", "API token from Jenkins user settings (preferred)"),
        ("jenkins_password",   "", "Login password — fallback when jenkins_api_token is blank"),
    ],
    "Sonar": [
        ("Base URL", "", "SonarQube server URL, e.g. https://sonar.example.com"),
        ("Login",    "", "SonarQube login (or user token when Password is blank)"),
        ("Password", "", "SonarQube password - leave blank when Login is a token"),
        ("Token",    "", "Optional: SonarQube user token (used instead of Login/Password when set)"),
        ("Proxy",    "", "Optional: HTTP(S) proxy URL, e.g. http://proxy:8080"),
    ],
    "VM": [
        ("vm_password", "", "SSH password for weblogic user on developer VMs"),
    ],
}


def make_sheet(wb, name, rows):
    ws = wb.create_sheet(name)
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 44
    ws.column_dimensions["C"].width = 60

    for col, title in enumerate(("key", "value", "notes"), start=1):
        cell = ws.cell(1, col, title)
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")

    for key, value, note in rows:
        row = ws.max_row + 1
        ws.cell(row, 1, key).font  = BOLD
        ws.cell(row, 2, value)
        ws.cell(row, 3, note).font = NOTE_FONT


def main():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    for sheet_name, rows in SHEETS.items():
        make_sheet(wb, sheet_name, rows)

    out = os.path.normpath(OUT_PATH)
    wb.save(out)
    print(f"secrets.xlsx created at:\n  {out}")
    print("\nFill in the value column for each key.")
    print("Migrate existing credentials from Local_Clone_Tool/config.xlsx and GP_Build/config.xlsx.")


if __name__ == "__main__":
    main()
