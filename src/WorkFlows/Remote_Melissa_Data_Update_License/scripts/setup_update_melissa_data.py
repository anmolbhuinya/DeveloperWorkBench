#!/usr/bin/env python3
"""
setup_update_melissa_data.py — setupupdatemelissadatalicensetool command

Sets up the Melissa Data License Update Tool skeleton.

Usage:
  setupupdatemelissadatalicensetool
"""

import sys
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "Remote_Melissa_Data_Update_License"        # project data: <DWB>\Projects\WorkFlows\Remote_Melissa_Data_Update_License
DATA_ROOT.mkdir(parents=True, exist_ok=True)
CMD_DIR    = Path.home() / ".local" / "bin"

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")

PROJECTS_HEADERS = ["pid", "timestamp", "ticket", "release_branch", "vm_name", "vm_ip", "status",
                    "payor_melissa_updated", "classic_melissa_updated", "changes", "notes"]
PROJECTS_WIDTHS  = [6, 22, 18, 16, 24, 18, 12, 22, 24, 8, 80]


def _set_header(ws, col, val, width=None):
    c = ws.cell(1, col, val)
    c.font      = HEADER_FONT
    c.fill      = HEADER_FILL
    c.alignment = Alignment(horizontal="left")
    if width:
        ws.column_dimensions[c.column_letter].width = width


def _ensure_projects():
    path = DATA_ROOT / "projects.xlsx"
    if path.exists():
        print(f"  [ok]     projects.xlsx")
        return
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Projects"
    for col, (title, width) in enumerate(zip(PROJECTS_HEADERS, PROJECTS_WIDTHS), start=1):
        _set_header(ws, col, title, width)
    wb.save(str(path))
    print(f"  [create] projects.xlsx")


def _ensure_cmd_wrappers():
    wrappers = {
        "updatemelissadatalicense.cmd":       f'python "{SCRIPT_DIR / "update_melissa_data.py"}" %*\n',
        "updatemdl.cmd":                      f'python "{SCRIPT_DIR / "update_melissa_data.py"}" %*\n',
        "mdlstatus.cmd":                      f'python "{SCRIPT_DIR / "update_md_status.py"}" %*\n',
        "mdldelete.cmd":                      f'python "{SCRIPT_DIR / "delete_md_project.py"}" %*\n',
        "setupupdatemelissadatalicensetool.cmd": f'python "{SCRIPT_DIR / "setup_update_melissa_data.py"}" %*\n',
        "setupmdltool.cmd":                     f'python "{SCRIPT_DIR / "setup_update_melissa_data.py"}" %*\n',
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

    print("\n  Melissa Data Update Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Config files ─────────────────────────────────────────────────")
    _ensure_projects()

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Ensure vms.xlsx has VM entries (shared at claude_code_workflows/vms.xlsx)")
    print("    2. Run:  updatemelissadatalicense  (or  updatemdl)  to trigger an update")
    print("    3. Run:  mdlstatus  to view update history")
    print()


if __name__ == "__main__":
    main()
