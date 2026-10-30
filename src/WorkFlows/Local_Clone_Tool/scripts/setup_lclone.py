#!/usr/bin/env python3
"""
setup_lclone.py — setuplclonetool command

Creates or migrates the full Local Clone Tool project structure:
  project_types/project_types.xlsx     — project type registry
  project_type_config/<type>_config.xlsx    — repo paths + branch per project
  projects/<type>_projects.xlsx        — two-sheet clone tracking log
  config.xlsx                          — settings (clone_link_type, scm_type)

Usage:
  setuplclonetool           Create / verify skeleton files
  setuplclonetool --help    Show this help
"""

import sys
import os
import subprocess
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "Local_Clone_Tool"        # project data: <DWB>\Projects\WorkFlows\Local_Clone_Tool
DATA_ROOT.mkdir(parents=True, exist_ok=True)

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")
NOTE_FONT   = Font(color="595959", italic=True, size=9)
A_CENTER    = Alignment(horizontal="center")
A_LEFT      = Alignment(horizontal="left")


PROJECT_TYPES = {
    "payor":     "PAYOR",
    "connector": "CONNECTOR",
    "classic":   "CLASSIC",
    "pik":       "PIK",
}

CONFIG_ROWS = [
    ("repo_url",              "",         "GitHub repo URL, e.g. https://github.com/HE-Core/hrp.payer.core/"),
    ("source_repo_branch",    "master",   "Branch where original PRs are merged (usually master)"),
    ("release_branch_prefix", "release-", "Prefix for release branches, e.g. release-"),
    ("jira_prefix",           "",         "JIRA project prefix, e.g. PAYOR"),
]

PROJ_COLS   = ["project_id", "ticket_id", "parent_ticket", "payor_version", "created_at", "status"]
PROJ_WIDTHS = [12, 20, 20, 14, 22, 16]
PR_COLS     = ["project_id", "pr_index", "original_pr_url", "original_branch",
               "clone_branch", "clone_pr_url", "pr_status"]
PR_WIDTHS   = [12, 10, 52, 36, 36, 52, 16]


def _set_header(cell, val, center=False):
    cell.value     = val
    cell.font      = HEADER_FONT
    cell.fill      = HEADER_FILL
    cell.alignment = A_CENTER if center else A_LEFT


def _hdr_row(ws, cols, widths):
    ws.append(cols)
    for i, (col, w) in enumerate(zip(cols, widths), 1):
        c = ws.cell(1, i)
        c.font      = HEADER_FONT
        c.fill      = HEADER_FILL
        c.alignment = A_LEFT
        ws.column_dimensions[c.column_letter].width = w


# ── config.xlsx ──────────────────────────────────────────────────────────────

def _ensure_config():
    path = TOOL_ROOT / "config.xlsx"
    if path.exists():
        _maybe_add_config_keys(path)
        print(f"  [ok]     config.xlsx")
        return
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Settings"
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 42
    ws.column_dimensions["C"].width = 52
    for col, title in enumerate(("Key", "Value", "Notes"), start=1):
        _set_header(ws.cell(1, col), title)
    rows = [
        ("clone_link_type", "is cloned by", "JIRA link type that points to the original ticket"),
        ("scm_type",        "github",        "SCM provider: github | bitbucket | azuredevops"),
    ]
    for key, val, note in rows:
        r = ws.max_row + 1
        ws.cell(r, 1, key).font = Font(bold=True)
        ws.cell(r, 2, val)
        ws.cell(r, 3, note).font = NOTE_FONT

    # BranchTypes sheet (required by load_config)
    wb.create_sheet("BranchTypes")
    ws2 = wb["BranchTypes"]
    ws2.column_dimensions["A"].width = 20
    ws2.column_dimensions["B"].width = 12
    ws2.column_dimensions["C"].width = 40
    for col, title in enumerate(("issue_type", "prefix", "Notes"), start=1):
        _set_header(ws2.cell(1, col), title)
    ws2.append(["Bug",     "bug",     "JIRA Bug issue type"])
    ws2.append(["Feature", "feature", "JIRA Feature / Story issue type"])

    wb.save(str(path))
    print(f"  [create] config.xlsx")


def _maybe_add_config_keys(path):
    """Add any missing keys to an existing config.xlsx."""
    wb = openpyxl.load_workbook(str(path))
    if "Settings" not in wb.sheetnames:
        return
    ws = wb["Settings"]
    existing = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0]:
            existing.add(str(row[0]).strip())
    required_keys = [("clone_link_type", "is cloned by"), ("scm_type", "github")]
    changed = False
    for key, default in required_keys:
        if key not in existing:
            ws.append([key, default, ""])
            changed = True
    if "BranchTypes" not in wb.sheetnames:
        ws2 = wb.create_sheet("BranchTypes")
        ws2.append(["issue_type", "prefix", "Notes"])
        ws2.append(["Bug", "bug", ""])
        ws2.append(["Feature", "feature", ""])
        changed = True
    if changed:
        wb.save(str(path))


# ── project_types/project_types.xlsx ─────────────────────────────────────────

# ── project_type_config/<type>_config.xlsx ─────────────────────────────────────────

# Types that should never prompt for input during setup — created with defaults only
_NO_PROMPT_TYPES = {"connector", "classic", "pik"}


def _prompt_config_values(ptype, jira_prefix, existing=None):
    """Interactively prompt the user for config values. Returns dict of key→value."""
    existing = existing or {}
    print(f"\n  Configure project_type_config/{ptype}_config.xlsx")
    print(f"  {'─' * 54}")
    values = {}
    for key, default_val, note in CONFIG_ROWS:
        if key == "jira_prefix":
            values[key] = existing.get(key) or jira_prefix
            continue
        current = existing.get(key, "")
        if current:
            prompt = f"  {key} [{current}]: "
        elif default_val:
            prompt = f"  {key} [{default_val}]: "
        else:
            prompt = f"  {key} (required): "
        try:
            entered = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            entered = ""
        if entered:
            values[key] = entered
        elif current:
            values[key] = current
        else:
            values[key] = default_val
    return values


def _build_default_values(jira_prefix, existing=None):
    """Build a values dict from defaults + existing without prompting."""
    existing = existing or {}
    values = {}
    for key, default_val, _ in CONFIG_ROWS:
        if key == "jira_prefix":
            values[key] = existing.get(key) or jira_prefix
        else:
            values[key] = existing.get(key) or default_val
    return values


def _ensure_project_type_config(ptype, jira_prefix):
    dir_  = TOOL_ROOT / "project_type_config"
    dir_.mkdir(parents=True, exist_ok=True)
    path  = dir_ / f"{ptype}_config.xlsx"
    no_prompt = ptype in _NO_PROMPT_TYPES

    if path.exists():
        _maybe_add_config_row_keys(path, jira_prefix)
        wb_ex = openpyxl.load_workbook(str(path))
        ws_ex = wb_ex["Config"] if "Config" in wb_ex.sheetnames else None
        existing = {}
        if ws_ex:
            for row in ws_ex.iter_rows(min_row=2, values_only=True):
                if row[0]:
                    existing[str(row[0]).strip()] = str(row[1] or "").strip()
        if not existing.get("repo_url") and not no_prompt:
            print(f"\n  [update] project_type_config/{ptype}_config.xlsx — repo_url is empty")
            values = _prompt_config_values(ptype, jira_prefix, existing)
            _write_config_values(path, values)
        print(f"  [ok]     project_type_config/{ptype}_config.xlsx")
        return

    if no_prompt:
        values = _build_default_values(jira_prefix)
    else:
        values = _prompt_config_values(ptype, jira_prefix)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Config"
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 60
    ws.column_dimensions["C"].width = 58
    for col, title in enumerate(("Key", "Value", "Notes"), start=1):
        _set_header(ws.cell(1, col), title)
    for key, default_val, note in CONFIG_ROWS:
        value = values.get(key, jira_prefix if key == "jira_prefix" else default_val)
        r = ws.max_row + 1
        ws.cell(r, 1, key).font = Font(bold=True)
        ws.cell(r, 2, value)
        ws.cell(r, 3, note).font = NOTE_FONT
    wb.save(str(path))
    print(f"  [create] project_type_config/{ptype}_config.xlsx")


def _write_config_values(path, values):
    """Update value cells in an existing config xlsx from a key→value dict."""
    wb = openpyxl.load_workbook(str(path))
    if "Config" not in wb.sheetnames:
        return
    ws = wb["Config"]
    for row in ws.iter_rows(min_row=2):
        if row[0].value and str(row[0].value).strip() in values:
            row[1].value = values[str(row[0].value).strip()]
    try:
        wb.save(str(path))
    except PermissionError:
        print(f"  Warning: Could not save {path} (file may be open).")


def _maybe_add_config_row_keys(path, jira_prefix=""):
    """Ensure all required config keys exist in an existing config file.
    Also renames legacy keys: from_branch→source_repo_branch, branch_prefix→release_branch_prefix.
    """
    wb = openpyxl.load_workbook(str(path))
    if "Config" not in wb.sheetnames:
        return
    ws = wb["Config"]
    existing = {}  # key -> row index (1-based)
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if row[0].value:
            existing[str(row[0].value).strip()] = i
    changed = False

    # Rename legacy keys in-place
    RENAMES = {
        "from_branch":   "source_repo_branch",
        "branch_prefix": "release_branch_prefix",
    }
    for old_key, new_key in RENAMES.items():
        if old_key in existing and new_key not in existing:
            row_idx = existing[old_key]
            ws.cell(row_idx, 1, new_key).font = Font(bold=True)
            existing[new_key] = row_idx
            del existing[old_key]
            changed = True

    # Add any keys still missing
    for key, default_val, note in CONFIG_ROWS:
        if key not in existing:
            value = jira_prefix if key == "jira_prefix" else default_val
            r = ws.max_row + 1
            ws.cell(r, 1, key).font = Font(bold=True)
            ws.cell(r, 2, value)
            ws.cell(r, 3, note).font = NOTE_FONT
            changed = True

    if changed:
        try:
            wb.save(str(path))
        except PermissionError:
            print(f"  Warning: Could not update {path} (file may be open).")


# ── projects/<type>_projects.xlsx ─────────────────────────────────────────────

def _ensure_project_log(ptype):
    dir_  = DATA_ROOT / "projects"
    dir_.mkdir(parents=True, exist_ok=True)
    path  = dir_ / f"{ptype}_projects.xlsx"

    if path.exists():
        _maybe_migrate_project_log(path, ptype)
        print(f"  [ok]     projects/{ptype}_projects.xlsx")
        return

    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    ws_proj = wb.create_sheet("Projects")
    _hdr_row(ws_proj, PROJ_COLS, PROJ_WIDTHS)

    ws_prs = wb.create_sheet("PRs")
    _hdr_row(ws_prs, PR_COLS, PR_WIDTHS)

    wb.save(str(path))
    print(f"  [create] projects/{ptype}_projects.xlsx  (Projects + PRs sheets)")


def _maybe_migrate_project_log(path, ptype):
    """Migrate old CloneLog-only format to two-sheet format."""
    wb = openpyxl.load_workbook(str(path))
    if "Projects" in wb.sheetnames and "PRs" in wb.sheetnames:
        return  # already new format
    if "CloneLog" not in wb.sheetnames:
        # Add missing sheets
        if "Projects" not in wb.sheetnames:
            ws_proj = wb.create_sheet("Projects")
            _hdr_row(ws_proj, PROJ_COLS, PROJ_WIDTHS)
        if "PRs" not in wb.sheetnames:
            ws_prs = wb.create_sheet("PRs")
            _hdr_row(ws_prs, PR_COLS, PR_WIDTHS)
        try:
            wb.save(str(path))
        except PermissionError:
            pass
        return

    # Migrate CloneLog rows
    old_ws   = wb["CloneLog"]
    ws_proj  = wb.create_sheet("Projects")
    _hdr_row(ws_proj, PROJ_COLS, PROJ_WIDTHS)
    ws_prs   = wb.create_sheet("PRs")
    _hdr_row(ws_prs, PR_COLS, PR_WIDTHS)

    for row in old_ws.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        ws_proj.append([
            row[0],               # project_id
            row[1] or "",         # ticket_id (cloned_ticket)
            row[3] or "",         # parent_ticket
            "",                   # payor_version
            "",                   # created_at
            row[5] or "In Progress",
        ])
        ws_prs.append([
            row[0],               # project_id
            1,                    # pr_index
            row[4] or "",         # original_pr_url (parent_pr)
            "",                   # original_branch
            "",                   # clone_branch
            row[2] or "",         # clone_pr_url (cloned_pr)
            "Cloned",
        ])

    del wb["CloneLog"]
    try:
        wb.save(str(path))
        print(f"  [migrate] projects/{ptype}_projects.xlsx (CloneLog → Projects + PRs)")
    except PermissionError:
        print(f"  Warning: Could not migrate {path} (file may be open).")


# ── cmd wrappers ─────────────────────────────────────────────────────────────

_CMD_DIR = Path.home() / ".local" / "bin"

_CMD_WRAPPERS = {
    "lclonestatus.cmd": (
        "@echo off\n"
        f'python "{SCRIPT_DIR / "lclone_client.py"}" %*\n'
    ),
    "lclonedelete.cmd": (
        "@echo off\n"
        f'python "{SCRIPT_DIR / "lclonedelete.py"}" %*\n'
    ),
    "setuplclonetool.cmd": (
        "@echo off\n"
        f'python "{SCRIPT_DIR / "setup_lclone.py"}" %*\n'
    ),
}


def _ensure_cmd_wrappers():
    for name, content in _CMD_WRAPPERS.items():
        path = _CMD_DIR / name
        if path.exists():
            print(f"  [ok]     {path}")
        else:
            try:
                _CMD_DIR.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                print(f"  [create] {path}")
            except OSError as e:
                print(f"  [skip]   {name} — could not write: {e}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    print("\n  Local Clone Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Config file ──────────────────────────────────────────────────")
    _ensure_config()

    print()
    print("  ── Project type config files ────────────────────────────────────")
    for ptype, jira_prefix in PROJECT_TYPES.items():
        _ensure_project_type_config(ptype, jira_prefix)

    print()
    print("  ── Project log files ────────────────────────────────────────────")
    for ptype in PROJECT_TYPES:
        _ensure_project_log(ptype)

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Fill in credentials in the shared secrets.xlsx:")
    print("       - Atlassian sheet: jira_base_url, jira_email, jira_api_token")
    print("       - GitHub sheet   : github_token")
    print("    2. Fill in project_type_config/<type>_config.xlsx for each project type:")
    print("       - repo_url              : GitHub repo URL (required for version resolution)")
    print("       - source_repo_branch    : branch where original PRs are merged (usually master)")
    print("       - release_branch_prefix : release branch prefix, e.g. release-")
    print("       (repo paths are auto-discovered via setbranch + tosrc and saved per-project)")
    print("    3. Run:  lclone -ticket PAYOR-208264")
    print("    4. Run:  lclonestatus  to view project status")
    print()


if __name__ == "__main__":
    main()
