#!/usr/bin/env python3
"""
rvmappstatus.py — rvmappstatus command

Check if applications are running on a remote VM.

Usage:
  rvmappstatus -vm <vm_name>              Check all apps on this VM
  rvmappstatus -vm <vm_name> -app payor   Check a specific app
  rvmappstatus --help
"""

import sys
from pathlib import Path

SCRIPT_DIR      = Path(__file__).resolve().parent
TOOL_ROOT       = SCRIPT_DIR.parent
VMS_PATH        = TOOL_ROOT.parent / "vms.xlsx"
APP_CONFIG_PATH = TOOL_ROOT / "app_config.xlsx"
SSH_USER        = "weblogic"
SSH_PORT        = 22
SSH_TIMEOUT     = 30

RESET = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"
def dim(s):    return f"\x1b[2m{s}{RESET}"


def _visible_len(s):
    import re
    return len(re.sub(r'\x1b\[[0-9;]*[mK]', '', s))


def _pad(s, w):
    return s + " " * max(0, w - _visible_len(s))


# ---------------------------------------------------------------------------
# Default app_config data
# ---------------------------------------------------------------------------

_DEFAULT_APPS = [
    {
        "app": "payor",
        "check_cmd":  "pgrep -f WebLogic",
        "start_cmd":  "startArtemis && startServer",
        "stop_cmd":   "stopServer",
        "restart_cmd":"stopServer && startArtemis && startServer",
        "build_cmd":  "refresh-payor",
    },
    {
        "app": "connector",
        "check_cmd":  "pgrep -f connector",
        "start_cmd":  "startConnector",
        "stop_cmd":   "stopConnector",
        "restart_cmd":"stopConnector && startConnector",
        "build_cmd":  "refresh-connector",
    },
    {
        "app": "pik",
        "check_cmd":  "pgrep -f pik",
        "start_cmd":  "startPik",
        "stop_cmd":   "stopPik",
        "restart_cmd":"stopPik && startPik",
        "build_cmd":  "",
    },
]

_DEFAULT_BUILD_PARAMS = [
    {"app": "payor", "name": "code_sync",          "flag": "-ncs", "default": "true",  "label": "Code Sync",          "flag_when": "false"},
    {"app": "payor", "name": "execute_unit_test",   "flag": "-st",  "default": "false", "label": "Execute Unit Test",  "flag_when": "false"},
    {"app": "payor", "name": "create_schema",       "flag": "-c",   "default": "false", "label": "Create Schema",      "flag_when": "true"},
]


# ---------------------------------------------------------------------------
# app_config.xlsx bootstrap
# ---------------------------------------------------------------------------

def _ensure_app_config():
    """Create a default app_config.xlsx if it does not exist."""
    if APP_CONFIG_PATH.exists():
        return
    import openpyxl
    wb = openpyxl.Workbook()

    # Apps sheet
    ws_apps        = wb.active
    ws_apps.title  = "Apps"
    app_cols       = ["app", "check_cmd", "start_cmd", "stop_cmd", "restart_cmd", "build_cmd"]
    ws_apps.append(app_cols)
    for row in _DEFAULT_APPS:
        ws_apps.append([row[c] for c in app_cols])

    # BuildParams sheet
    ws_params  = wb.create_sheet("BuildParams")
    param_cols = ["app", "name", "flag", "default", "label", "flag_when"]
    ws_params.append(param_cols)
    for row in _DEFAULT_BUILD_PARAMS:
        ws_params.append([row[c] for c in param_cols])

    try:
        wb.save(str(APP_CONFIG_PATH))
        print(grey(f"  Created default app_config.xlsx at {APP_CONFIG_PATH}"))
    except Exception as e:
        print(f"  Warning: Could not create app_config.xlsx — {e}")


# ---------------------------------------------------------------------------
# Load app config
# ---------------------------------------------------------------------------

def _load_app_config():
    """
    Load app configuration from app_config.xlsx.

    Returns:
        {
          "apps": [{app, check_cmd, start_cmd, stop_cmd, restart_cmd, build_cmd}, ...],
          "build_params": {app: [{name, flag, default, label, flag_when}, ...], ...}
        }
    """
    _ensure_app_config()
    if not APP_CONFIG_PATH.exists():
        return {"apps": [], "build_params": {}}

    import openpyxl
    wb   = openpyxl.load_workbook(str(APP_CONFIG_PATH))
    apps = []

    if "Apps" in wb.sheetnames:
        ws  = wb["Apps"]
        hdr = [str(ws.cell(1, c).value or "").strip()
               for c in range(1, ws.max_column + 1)]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if any(v is not None for v in row):
                d = {k: ("" if v is None else str(v).strip())
                     for k, v in zip(hdr, row)}
                if d.get("app"):
                    apps.append(d)

    build_params = {}
    if "BuildParams" in wb.sheetnames:
        ws  = wb["BuildParams"]
        hdr = [str(ws.cell(1, c).value or "").strip()
               for c in range(1, ws.max_column + 1)]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if any(v is not None for v in row):
                d   = {k: ("" if v is None else str(v).strip())
                       for k, v in zip(hdr, row)}
                app = d.get("app", "")
                if app:
                    build_params.setdefault(app, []).append(d)

    return {"apps": apps, "build_params": build_params}


# ---------------------------------------------------------------------------
# VM helpers  (same pattern as rvmstatus_tool.py)
# ---------------------------------------------------------------------------

def _load_vms():
    if not VMS_PATH.exists():
        return []
    import openpyxl
    wb   = openpyxl.load_workbook(str(VMS_PATH))
    vms  = []
    seen = set()
    for sheet_name in wb.sheetnames:
        ws   = wb[sheet_name]
        hdrs = [str(ws.cell(1, c).value or "").strip().lower()
                for c in range(1, ws.max_column + 1)]
        if "name" not in hdrs or "ip" not in hdrs:
            continue
        for row in ws.iter_rows(min_row=2, values_only=True):
            if any(v is not None for v in row):
                d    = {k: ("" if v is None else str(v).strip())
                        for k, v in zip(hdrs, row)}
                name = d.get("name", "")
                if name and name not in seen:
                    seen.add(name)
                    vms.append(d)
    return vms


def _find_vm(vm_name):
    for vm in _load_vms():
        if vm.get("name", "").lower() == vm_name.lower():
            return vm
    return None


# ---------------------------------------------------------------------------
# SSH app check
# ---------------------------------------------------------------------------

def _check_apps(ip, password, apps=None):
    """
    SSH into `ip` and run check_cmd for each app.

    Args:
        ip:       Remote host IP address.
        password: SSH password for the weblogic user.
        apps:     List of app-config dicts (from _load_app_config()["apps"]).
                  If None, loads all apps from app_config.xlsx.

    Returns:
        List of {app: str, running: bool, pid: str}
    """
    if apps is None:
        apps = _load_app_config()["apps"]

    try:
        import paramiko
    except ImportError:
        print(red("  ERROR: paramiko not installed. Run:  pip install paramiko"))
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=ip, port=SSH_PORT,
            username=SSH_USER, password=password,
            timeout=SSH_TIMEOUT,
            allow_agent=False, look_for_keys=False,
        )
    except Exception as e:
        return [{"app": a.get("app", ""), "running": False, "pid": "", "error": str(e)}
                for a in apps]

    results = []
    for app_cfg in apps:
        app_name  = app_cfg.get("app",       "")
        check_cmd = app_cfg.get("check_cmd", "")
        if not check_cmd:
            results.append({"app": app_name, "running": False, "pid": ""})
            continue
        try:
            _, stdout, _ = client.exec_command(check_cmd, timeout=SSH_TIMEOUT)
            out         = stdout.read().decode("utf-8", errors="replace").strip()
            exit_status = stdout.channel.recv_exit_status()
            results.append({
                "app":     app_name,
                "running": exit_status == 0,
                "pid":     out,
            })
        except Exception as e:
            results.append({"app": app_name, "running": False, "pid": "", "error": str(e)})

    client.close()
    return results


# ---------------------------------------------------------------------------
# CLI output
# ---------------------------------------------------------------------------

def print_app_status(vm_name, app_filter=None):
    vm = _find_vm(vm_name)
    if not vm:
        print(f"\n  {red('ERROR')}: VM '{vm_name}' not found in vms.xlsx.")
        print(f"  Run  rvmstatus  to list available VMs.\n")
        sys.exit(1)

    ip       = vm.get("ip",          "")
    password = vm.get("password",    "")
    desc     = vm.get("description", "")

    config = _load_app_config()
    apps   = config["apps"]

    if app_filter:
        apps = [a for a in apps if a["app"].lower() == app_filter.lower()]
        if not apps:
            print(f"\n  {red('ERROR')}: App '{app_filter}' not found in app_config.xlsx.\n")
            sys.exit(1)

    if not ip:
        print(f"\n  {red('ERROR')}: No IP address for VM '{vm_name}'.\n")
        sys.exit(1)

    print()
    print(bold(f"  App Status — {vm_name}"))
    if desc:
        print(f"  {grey(desc)}")
    print(f"  IP: {grey(ip)}")
    print()
    print(f"  Connecting to {cyan(ip)} as {cyan(SSH_USER)}...")

    results = _check_apps(ip, password, apps)
    print(f"  {green('Connected.')}\n")

    _COL = {"app": 16, "status": 10}

    header = (
        "  " +
        _pad(dim("APP"),    _COL["app"])    + "  " +
        _pad(dim("STATUS"), _COL["status"]) + "  " +
        dim("PID / OUTPUT")
    )
    print(header)
    print("  " + grey("-" * 60))

    for r in results:
        app_name = r.get("app",     "")
        running  = r.get("running", False)
        pid      = r.get("pid",     "")
        err      = r.get("error",   "")

        if err:
            status_d = red("ERROR")
            detail   = grey(err[:60])
        elif running:
            status_d = green("running")
            detail   = grey(pid[:60]) if pid else ""
        else:
            status_d = yellow("stopped")
            detail   = ""

        print(
            "  " +
            _pad(cyan(app_name), _COL["app"])    + "  " +
            _pad(status_d,       _COL["status"]) + "  " +
            detail
        )

    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args       = sys.argv[1:]
    vm_name    = None
    app_filter = None
    i          = 0

    while i < len(args):
        a = args[i]
        if a in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif a in ("-vm", "--vm") and i + 1 < len(args):
            vm_name = args[i + 1]; i += 2
        elif a in ("-app", "--app") and i + 1 < len(args):
            app_filter = args[i + 1]; i += 2
        else:
            i += 1

    if not vm_name:
        print(f"\n  {red('ERROR')}: -vm <vm_name> is required.")
        print(__doc__)
        sys.exit(1)

    print_app_status(vm_name, app_filter)


if __name__ == "__main__":
    main()
