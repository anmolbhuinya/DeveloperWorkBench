#!/usr/bin/env python3
"""
setup_puc.py — setuppayorutilscertificationtool / setuppuc command

Sets up the Payor Utils Certification Tool skeleton.

Usage:
  setuppayorutilscertificationtool
  setuppuctool
"""

import sys
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
CMD_DIR    = Path.home() / ".local" / "bin"

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")
A_ALIGN     = Alignment(horizontal="left")

DEFAULT_JOB_URL = (
    "http://engsvc-engjen1.headquarters.healthedge.com:8080"
    "/job/Payor/job/{version}/job/payor-utils-certification"
)

STATUS_CONFIG = [
    ("pending",     "yellow", "Project created, not yet triggered"),
    ("triggered",   "orange", "Run triggered, waiting for Jenkins to pick up"),
    ("queued",      "orange", "Queued in Jenkins"),
    ("building",    "orange", "Build is in progress"),
    ("running",     "orange", "Run is in progress"),
    ("in progress", "orange", "Run is in progress"),
    ("SUCCESS",     "green",  "Jenkins build succeeded"),
    ("Passed",      "green",  "Run passed"),
    ("passed",      "green",  "Run passed"),
    ("done",        "green",  "Run completed successfully"),
    ("completed",   "green",  "Run completed successfully"),
    ("UNSTABLE",    "yellow", "Jenkins build unstable"),
    ("FAILURE",     "red",    "Jenkins build failed"),
    ("Failed",      "red",    "Run failed"),
    ("failed",      "red",    "Run failed"),
    ("error",       "red",    "Run encountered an error"),
    ("ABORTED",     "gray",   "Jenkins build aborted"),
    ("aborted",     "gray",   "Run was aborted"),
    ("cancelled",   "gray",   "Run was cancelled"),
    ("NOT_BUILT",   "gray",   "Jenkins build was not executed"),
]

PROJ_HEADERS = ["pid", "payor_version", "baseline_url", "job_name", "status",
                "triggered_at", "build_url", "queue_url", "notes",
                "certification_status", "jenkins_it_failures", "baseline_it_failures"]
PROJ_WIDTHS  = [6, 14, 100, 28, 14, 22, 100, 100, 60, 20, 20, 20]


def _hdr(ws, col, val, width=None):
    c = ws.cell(1, col, val)
    c.font = HEADER_FONT
    c.fill = HEADER_FILL
    c.alignment = A_ALIGN
    if width:
        ws.column_dimensions[c.column_letter].width = width


def _ensure_config():
    path = TOOL_ROOT / "puc_config.xlsx"
    if path.exists():
        print(f"  [ok]     puc_config.xlsx")
        return
    wb = openpyxl.Workbook()

    ws = wb.active
    ws.title = "config"
    for i, h in enumerate(["job_name", "job_url", "github_repo_url", "release_prefix"], 1):
        c = ws.cell(1, i, h)
        c.font = HEADER_FONT; c.fill = HEADER_FILL; c.alignment = A_ALIGN
    ws.append(["payor_utils_certification", DEFAULT_JOB_URL, "", "release-"])
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 110
    ws.column_dimensions["C"].width = 60
    ws.column_dimensions["D"].width = 16

    ws2 = wb.create_sheet("status_config")
    for i, h in enumerate(["status", "color", "description"], 1):
        c = ws2.cell(1, i, h)
        c.font = HEADER_FONT; c.fill = HEADER_FILL; c.alignment = A_ALIGN
    ws2.column_dimensions["A"].width = 20
    ws2.column_dimensions["B"].width = 10
    ws2.column_dimensions["C"].width = 50
    for row in STATUS_CONFIG:
        ws2.append(row)

    wb.save(str(path))
    print(f"  [create] puc_config.xlsx  (config + status_config sheets)")
    print(f"           job_url contains {{version}} — replaced at runtime (e.g. 26.1.1.1)")


def _ensure_projects():
    path = TOOL_ROOT / "projects.xlsx"
    if path.exists():
        print(f"  [ok]     projects.xlsx")
        return
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Projects"
    for col, (h, w) in enumerate(zip(PROJ_HEADERS, PROJ_WIDTHS), 1):
        _hdr(ws, col, h, w)
    wb.save(str(path))
    print(f"  [create] projects.xlsx")


def _ensure_cmd_wrappers():
    wrappers = {
        "setuppayorutilscertificationtool.cmd": f'python "{SCRIPT_DIR / "setup_puc.py"}" %*\n',
        "setuppuctool.cmd":                      f'python "{SCRIPT_DIR / "setup_puc.py"}" %*\n',
        "payorutilscertification.cmd":          f'python "{SCRIPT_DIR / "puc_tool.py"}" %*\n',
        "puc.cmd":                              f'python "{SCRIPT_DIR / "puc_tool.py"}" %*\n',
        "pucstatus.cmd":                        f'python "{SCRIPT_DIR / "puc_status.py"}" %*\n',
        "pucdelete.cmd":                        f'python "{SCRIPT_DIR / "puc_delete.py"}" %*\n',
        "puccertify.cmd":                       f'python "{SCRIPT_DIR / "puc_certify.py"}" %*\n',
    }
    CMD_DIR.mkdir(parents=True, exist_ok=True)
    for name, body in wrappers.items():
        p = CMD_DIR / name
        if p.exists():
            print(f"  [ok]     {p}")
        else:
            p.write_text(f"@echo off\n{body}")
            print(f"  [create] {p}")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print("\n  Payor Utils Certification Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Config files ─────────────────────────────────────────────────")
    _ensure_config()
    _ensure_projects()

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Verify jenkins_username, jenkins_password in secrets.xlsx → Jenkins sheet")
    print("    2. Review puc_config.xlsx — update job_url if needed")
    print("    3. Run:  puc -payor 26.1.1.1 -baseline <baseline_build_url>  to trigger")
    print("    4. Run:  pucstatus  to view project history")
    print("    5. Run:  puccertify -pid <id>  to certify a completed run")
    print()


if __name__ == "__main__":
    main()
