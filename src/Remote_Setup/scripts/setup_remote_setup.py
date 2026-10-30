#!/usr/bin/env python3
"""
setup_remote_setup.py — setupremotevmsetuptool command

Sets up the Remote VM Setup Tool skeleton and optionally fetches Jenkins parameter
definitions.

Usage:
  setupremotevmsetuptool
  setupremotevmsetuptool -fetchparams
"""

import sys
import requests
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR   = Path(__file__).resolve().parent
TOOL_ROOT    = SCRIPT_DIR.parent
CMD_DIR      = Path.home() / ".local" / "bin"
SECRETS_PATH = TOOL_ROOT.parent / "secrets.xlsx"


def _load_secrets():
    if not SECRETS_PATH.exists():
        return {}
    wb   = openpyxl.load_workbook(str(SECRETS_PATH))
    data = {}
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                data[str(row[0]).strip()] = str(row[1]).strip()
    return data

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")
NOTE_FONT   = Font(color="595959", italic=True, size=9)

JENKINS_BUILD_URL = (
    "http://engsvc-engjen1.headquarters.healthedge.com:8080"
    "/job/katalon-automations/job/hrp-api-automation/job/hrp-vm-setup"
    "/buildWithParameters"
)
JENKINS_PARAMS_URL = (
    "http://engsvc-engjen1.headquarters.healthedge.com:8080"
    "/job/katalon-automations/job/hrp-api-automation/job/hrp-vm-setup"
    "/api/json?tree=property[parameterDefinitions[name,type,choices,"
    "defaultParameterValue[value],description]]"
)
JENKINS_CRUMB_URL = (
    "http://engsvc-engjen1.headquarters.healthedge.com:8080/crumbIssuer/api/json"
)

CONFIG_ROWS = [
    ("jenkins_build_url", JENKINS_BUILD_URL, "Jenkins buildWithParameters URL"),
]

JENKINS_STATUS_ROWS = [
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

PARAM_COLS   = ["key", "type", "choices", "default", "description"]
PARAM_WIDTHS = [26, 20, 60, 22, 52]

VM_COLS      = ["name", "ip", "description", "password", "assigned_to"]
VM_WIDTHS    = [22, 18, 40, 20, 20]


def _set_header(ws, col, val, width=None):
    c = ws.cell(1, col, val)
    c.font      = HEADER_FONT
    c.fill      = HEADER_FILL
    c.alignment = Alignment(horizontal="left")
    if width:
        ws.column_dimensions[c.column_letter].width = width


def _ensure_config():
    # config.xlsx — holds the Config sheet (jenkins_build_url etc.)
    cfg_path = TOOL_ROOT / "config.xlsx"
    if cfg_path.exists():
        _maybe_add_config_keys(cfg_path)
        _ensure_jenkins_status_sheet(cfg_path)
        print(f"  [ok]     config.xlsx")
    else:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Config"
        for col, (title, width) in enumerate(
            [("Key", 26), ("Value", 80), ("Notes", 54)], start=1
        ):
            _set_header(ws, col, title, width)
        for key, default, note in CONFIG_ROWS:
            r = ws.max_row + 1
            ws.cell(r, 1, key).font  = Font(bold=True)
            ws.cell(r, 2, default)
            ws.cell(r, 3, note).font = NOTE_FONT
        wb.save(str(cfg_path))
        print(f"  [create] config.xlsx")
        _ensure_jenkins_status_sheet(cfg_path)

    # katalon_params.xlsx — holds only the Parameters sheet (fetched from Jenkins)
    params_path = TOOL_ROOT / "katalon_params.xlsx"
    if params_path.exists():
        _maybe_add_params_sheet(params_path)
        print(f"  [ok]     katalon_params.xlsx")
    else:
        wb2 = openpyxl.Workbook()
        ws2 = wb2.active
        ws2.title = "Parameters"
        for col, (title, width) in enumerate(zip(PARAM_COLS, PARAM_WIDTHS), start=1):
            _set_header(ws2, col, title, width)
        wb2.save(str(params_path))
        print(f"  [create] katalon_params.xlsx")


def _maybe_add_config_keys(path):
    wb = openpyxl.load_workbook(str(path))
    if "Config" not in wb.sheetnames:
        ws = wb.create_sheet("Config", 0)
        for col, (title, width) in enumerate(
            [("Key", 26), ("Value", 80), ("Notes", 54)], start=1
        ):
            _set_header(ws, col, title, width)
    ws      = wb["Config"]
    existing = {str(r[0]).strip() for r in ws.iter_rows(min_row=2, values_only=True) if r[0]}
    changed  = False
    for key, default, note in CONFIG_ROWS:
        if key not in existing:
            r = ws.max_row + 1
            ws.cell(r, 1, key).font  = Font(bold=True)
            ws.cell(r, 2, default)
            ws.cell(r, 3, note).font = NOTE_FONT
            changed = True
    if changed:
        try:
            wb.save(str(path))
        except PermissionError:
            print(f"  Warning: Could not update config.xlsx (file may be open).")


def _ensure_jenkins_status_sheet(path):
    wb = openpyxl.load_workbook(str(path))
    if "Jenkins_Status" not in wb.sheetnames:
        ws = wb.create_sheet("Jenkins_Status")
        for col, (title, width) in enumerate(
            [("status", 16), ("color", 10), ("description", 44)], start=1
        ):
            _set_header(ws, col, title, width)
        for row in JENKINS_STATUS_ROWS:
            ws.append(list(row))
        try:
            wb.save(str(path))
            print(f"  [create] config.xlsx → Jenkins_Status sheet")
        except PermissionError:
            print(f"  Warning: Could not update config.xlsx (file may be open).")
        return

    # Sheet exists — add any missing status rows
    ws       = wb["Jenkins_Status"]
    existing = {str(r[0]).strip().lower() for r in ws.iter_rows(min_row=2, values_only=True) if r[0]}
    added    = False
    for status, color, desc in JENKINS_STATUS_ROWS:
        if status.lower() not in existing:
            ws.append([status, color, desc])
            added = True
    if added:
        try:
            wb.save(str(path))
            print(f"  [update] config.xlsx → Jenkins_Status sheet (new rows added)")
        except PermissionError:
            print(f"  Warning: Could not update config.xlsx (file may be open).")


def _maybe_add_params_sheet(path):
    wb = openpyxl.load_workbook(str(path))
    if "Parameters" not in wb.sheetnames:
        ws2 = wb.create_sheet("Parameters")
        for col, (title, width) in enumerate(zip(PARAM_COLS, PARAM_WIDTHS), start=1):
            _set_header(ws2, col, title, width)
        try:
            wb.save(str(path))
        except PermissionError:
            print(f"  Warning: Could not update katalon_params.xlsx (file may be open).")


def _ensure_vms():
    path = TOOL_ROOT.parent / "vms.xlsx"
    if path.exists():
        _maybe_add_vm_columns(path)
        print(f"  [ok]     vms.xlsx")
        return
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "VMList"
    for col, (title, width) in enumerate(zip(VM_COLS, VM_WIDTHS), start=1):
        _set_header(ws, col, title, width)
    wb.save(str(path))
    print(f"  [create] vms.xlsx  (fill in VM names, IPs, descriptions, and assigned_to)")


def _maybe_add_vm_columns(path):
    wb = openpyxl.load_workbook(str(path))
    ws = wb[wb.sheetnames[0]]
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    changed = False
    for i, (col_name, width) in enumerate(zip(VM_COLS, VM_WIDTHS), start=1):
        if col_name not in headers:
            _set_header(ws, i, col_name, width)
            changed = True
    if changed:
        try:
            wb.save(str(path))
        except PermissionError:
            print(f"  Warning: Could not update vms.xlsx (file may be open).")


def _load_config():
    path = TOOL_ROOT / "config.xlsx"
    if not path.exists():
        return {}
    wb   = openpyxl.load_workbook(str(path))
    data = {}
    if "Config" in wb.sheetnames:
        for row in wb["Config"].iter_rows(min_row=2, values_only=True):
            if row[0]:
                data[str(row[0]).strip()] = str(row[1] or "").strip()
    return data


def _fetch_params(config):
    secrets   = _load_secrets()
    username  = secrets.get("jenkins_username", "")
    api_token = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth      = (username, api_token) if username and api_token else None

    print(f"  Fetching parameters from Jenkins...")
    try:
        resp = requests.get(JENKINS_PARAMS_URL, auth=auth, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"  ERROR: Could not fetch Jenkins parameters: {e}")
        return []

    param_defs = []
    for prop in data.get("property", []):
        for pd in prop.get("parameterDefinitions", []):
            choices  = ",".join(str(c) for c in pd.get("choices", []))
            raw_val  = (pd.get("defaultParameterValue") or {}).get("value", "")
            default  = "" if raw_val is None else str(raw_val)
            param_defs.append({
                "key":         str(pd.get("name",        "") or ""),
                "type":        str(pd.get("type",        "") or ""),
                "choices":     choices,
                "default":     default,
                "description": str(pd.get("description", "") or ""),
            })
    return param_defs


def _write_params(param_defs):
    path = TOOL_ROOT / "katalon_params.xlsx"
    wb   = openpyxl.load_workbook(str(path)) if path.exists() else openpyxl.Workbook()
    if "Parameters" in wb.sheetnames:
        del wb["Parameters"]
    ws = wb.create_sheet("Parameters")
    if wb.sheetnames[0] == "Sheet":   # remove default blank sheet if present
        del wb["Sheet"]
    ws = wb["Parameters"]
    for col, (title, width) in enumerate(zip(PARAM_COLS, PARAM_WIDTHS), start=1):
        _set_header(ws, col, title, width)
    for pd in param_defs:
        ws.append([pd["key"], pd["type"], pd["choices"], pd["default"], pd["description"]])
    try:
        wb.save(str(path))
        print(f"  [update] katalon_params.xlsx — {len(param_defs)} parameter(s) in Parameters sheet")
    except PermissionError:
        print(f"  Warning: Could not save katalon_params.xlsx (file may be open).")


def _ensure_cmd_wrappers():
    wrappers = {
        "remotevmsetup.cmd":             f'python "{SCRIPT_DIR / "remote_setup.py"}" %*\n',
        "rvmsetup.cmd":                  f'python "{SCRIPT_DIR / "remote_setup.py"}" %*\n',
        "rvmsetupstatus.cmd":            f'python "{SCRIPT_DIR / "rvmsetupstatus.py"}" %*\n',
        "remotevmconfig.cmd":            f'python "{SCRIPT_DIR / "remote_vm_config.py"}" %*\n',
        "rvmconfig.cmd":                 f'python "{SCRIPT_DIR / "remote_vm_config.py"}" %*\n',
        "rvmdelete.cmd":                 f'python "{SCRIPT_DIR / "remote_vm_delete.py"}" %*\n',
        "setupremotevmsetuptool.cmd":    f'python "{SCRIPT_DIR / "setup_remote_setup.py"}" %*\n',
        "remotevmstatus.cmd":            f'python "{SCRIPT_DIR / "rvmstatus_tool.py"}" %*\n',
        "rvmstatus.cmd":                 f'python "{SCRIPT_DIR / "rvmstatus_tool.py"}" %*\n',
        "vmsearch.cmd":                  f'python "{SCRIPT_DIR / "vmsearch_tool.py"}" %*\n',
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
    args        = sys.argv[1:]
    fetch_params = "-fetchparams" in args or "--fetchparams" in args

    if args and args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    print("\n  Remote VM Setup Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Config files ─────────────────────────────────────────────────")
    _ensure_config()
    _ensure_vms()

    servers_dir = TOOL_ROOT / "configured_servers"
    if not servers_dir.exists():
        servers_dir.mkdir(parents=True)
        print(f"  [create] configured_servers/")
    else:
        print(f"  [ok]     configured_servers/")

    if fetch_params:
        print()
        print("  ── Fetching Jenkins parameters ──────────────────────────────────")
        config     = _load_config()
        param_defs = _fetch_params(config)
        if param_defs:
            _write_params(param_defs)
            print(f"  Parameters:")
            for pd in param_defs:
                choices_preview = pd["choices"][:50] + "..." if len(pd["choices"]) > 50 else pd["choices"]
                print(f"    {pd['key']:30} type={pd['type']}  choices={choices_preview}")

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Fill in vms.xlsx with VM names and IPs")
    print("    2. Ensure jenkins_username + jenkins_api_token are in secrets.xlsx (Jenkins sheet)")
    print("    3. Run:  setupremotevmsetuptool -fetchparams  to load Jenkins parameter definitions")
    print("    4. Run:  remotevmsetup  (or  rvmsetup)  to trigger a server setup")
    print("    5. Run:  rvmsetupstatus  to view setup history per server")
    print("    6. Run:  rvmconfig  to see the latest parameter config per server")
    print()


if __name__ == "__main__":
    main()
