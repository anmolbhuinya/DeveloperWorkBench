#!/usr/bin/env python3
"""
rvmapp.py — rvmapp command

Execute application actions (start/stop/build/restart) on a remote VM via SSH.

Usage:
  rvmapp -vm <vm_name> -<app> start
  rvmapp -vm <vm_name> -<app> stop
  rvmapp -vm <vm_name> -<app> restart
  rvmapp -vm <vm_name> -<app> build
  rvmapp -vm <vm_name> -<app> build <flags...>
  rvmapp --help

Examples:
  rvmapp -vm my-vm -payor start
  rvmapp -vm my-vm -payor build -ncs
  rvmapp -vm my-vm -payor build -ncs -st
  rvmapp -vm my-vm -connector restart
"""

import sys
from pathlib import Path

SCRIPT_DIR      = Path(__file__).resolve().parent
TOOL_ROOT       = SCRIPT_DIR.parent
VMS_PATH        = TOOL_ROOT.parent / "vms.xlsx"
APP_CONFIG_PATH = TOOL_ROOT / "app_config.xlsx"
SSH_USER        = "weblogic"
SSH_PORT        = 22
SSH_TIMEOUT     = 300

RESET = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"
def dim(s):    return f"\x1b[2m{s}{RESET}"


# ---------------------------------------------------------------------------
# Default app_config data  (shared definition with rvmappstatus.py)
# ---------------------------------------------------------------------------

_DEFAULT_APPS = [
    {
        "app": "payor",
        "check_cmd":       "pgrep -f WebLogic",
        "start_cmd":       "startArtemis && startServer",
        "stop_cmd":        "stopServer",
        "restart_cmd":     "stopServer && startArtemis && startServer",
        "build_cmd":       "refresh-payor",
        "success_pattern": "",
    },
    {
        "app": "connector",
        "check_cmd":       "pgrep -f connector",
        "start_cmd":       "startConnector",
        "stop_cmd":        "stopConnector",
        "restart_cmd":     "stopConnector && startConnector",
        "build_cmd":       "refresh-connector",
        "success_pattern": "has status of Running",
    },
    {
        "app": "pik",
        "check_cmd":       "pgrep -f pik",
        "start_cmd":       "startPik",
        "stop_cmd":        "stopPik",
        "restart_cmd":     "stopPik && startPik",
        "build_cmd":       "",
        "success_pattern": "",
    },
]

_DEFAULT_BUILD_PARAMS = [
    {"app": "payor", "name": "code_sync",          "flag": "-ncs", "default": "true",  "label": "Code Sync",          "flag_when": "false"},
    {"app": "payor", "name": "execute_unit_test",   "flag": "-st",  "default": "false", "label": "Execute Unit Test",  "flag_when": "false"},
    {"app": "payor", "name": "create_schema",       "flag": "-c",   "default": "false", "label": "Create Schema",      "flag_when": "true"},
]

_VALID_ACTIONS = {"start", "stop", "restart", "build"}


# ---------------------------------------------------------------------------
# app_config.xlsx bootstrap
# ---------------------------------------------------------------------------

def _ensure_app_config():
    """Create a default app_config.xlsx if it does not exist."""
    if APP_CONFIG_PATH.exists():
        return
    import openpyxl
    wb = openpyxl.Workbook()

    ws_apps        = wb.active
    ws_apps.title  = "Apps"
    app_cols       = ["app", "check_cmd", "start_cmd", "stop_cmd", "restart_cmd", "build_cmd", "success_pattern"]
    ws_apps.append(app_cols)
    for row in _DEFAULT_APPS:
        ws_apps.append([row[c] for c in app_cols])

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
# SSH action executor
# ---------------------------------------------------------------------------

def _execute_action(ip, password, app_cfg, action, extra_flags=""):
    """
    Execute an application action on a remote VM via SSH.

    For start: commands separated by ' && ' are run sequentially, each
    waiting to finish before the next begins.
    For build: extra_flags are appended to build_cmd verbatim.

    Args:
        ip:          Remote host IP address.
        password:    SSH password for the weblogic user.
        app_cfg:     App config dict from _load_app_config()["apps"].
        action:      One of: start, stop, restart, build.
        extra_flags: Additional CLI flags appended to build_cmd (build only).

    Returns:
        {success: bool, output: str}   stdout+stderr combined, timeout=300s
    """
    try:
        import paramiko
    except ImportError:
        return {"success": False, "output": "paramiko not installed. Run:  pip install paramiko"}

    action_key = action.lower()
    cmd_map = {
        "start":   app_cfg.get("start_cmd",   ""),
        "stop":    app_cfg.get("stop_cmd",     ""),
        "restart": app_cfg.get("restart_cmd",  ""),
        "build":   app_cfg.get("build_cmd",    ""),
    }
    if action_key not in cmd_map:
        return {
            "success": False,
            "output":  f"Unknown action '{action}'. Valid: start, stop, restart, build",
        }

    base_cmd = cmd_map[action_key]
    if not base_cmd:
        app_name = app_cfg.get("app", "")
        return {
            "success": False,
            "output":  f"No {action_key}_cmd configured for app '{app_name}'.",
        }

    # Append extra flags for build
    if action_key == "build" and extra_flags:
        cmd = f"{base_cmd} {extra_flags.strip()}"
    else:
        cmd = base_cmd

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=ip, port=SSH_PORT,
            username=SSH_USER, password=password,
            timeout=30,
            allow_agent=False, look_for_keys=False,
        )
    except Exception as e:
        return {"success": False, "output": f"SSH connection failed: {e}"}

    # Split on ' && ' so each sub-command is run individually and we wait
    # for each one to finish before proceeding to the next.
    sub_cmds   = [c.strip() for c in cmd.split(" && ") if c.strip()]
    all_lines  = []
    success    = True

    for sub_cmd in sub_cmds:
        try:
            # Use low-level channel API so we can combine stderr into stdout
            # and stream output line by line.
            transport = client.get_transport()
            channel   = transport.open_session()
            channel.set_combine_stderr(True)
            channel.settimeout(SSH_TIMEOUT)
            channel.exec_command(sub_cmd)

            # Stream output line by line as the remote process produces it
            with channel.makefile("r") as chan_file:
                for raw_line in chan_file:
                    line = raw_line.rstrip("\n")
                    all_lines.append(line)
                    print(f"  {line}")

            exit_status = channel.recv_exit_status()
            if exit_status != 0:
                success_pattern = app_cfg.get("success_pattern", "") if action_key == "build" else ""
                combined_output = "\n".join(all_lines)
                if success_pattern and success_pattern in combined_output:
                    pass  # non-zero exit but success marker found — treat as success
                else:
                    success = False
                    break

        except Exception as e:
            msg = f"Error running '{sub_cmd}': {e}"
            all_lines.append(msg)
            print(f"  {red(msg)}")
            success = False
            break

    client.close()
    return {"success": success, "output": "\n".join(all_lines)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def run_app_action(vm_name, app_name, action, extra_flags=""):
    vm = _find_vm(vm_name)
    if not vm:
        print(f"\n  {red('ERROR')}: VM '{vm_name}' not found in vms.xlsx.")
        print(f"  Run  rvmstatus  to list available VMs.\n")
        sys.exit(1)

    ip       = vm.get("ip",          "")
    password = vm.get("password",    "")
    desc     = vm.get("description", "")

    config  = _load_app_config()
    app_cfg = next(
        (a for a in config["apps"] if a["app"].lower() == app_name.lower()),
        None,
    )
    if not app_cfg:
        print(f"\n  {red('ERROR')}: App '{app_name}' not found in app_config.xlsx.\n")
        sys.exit(1)

    if action not in _VALID_ACTIONS:
        print(f"\n  {red('ERROR')}: Unknown action '{action}'."
              f" Valid: {', '.join(sorted(_VALID_ACTIONS))}\n")
        sys.exit(1)

    if not ip:
        print(f"\n  {red('ERROR')}: No IP address for VM '{vm_name}'.\n")
        sys.exit(1)

    # Header
    print()
    print(bold(f"  {action.capitalize()} {app_cfg['app']}  —  {vm_name}"))
    if desc:
        print(f"  {grey(desc)}")
    print(f"  IP: {grey(ip)}")
    if action == "build" and extra_flags:
        print(f"  Flags: {cyan(extra_flags)}")
    print()
    print(f"  Connecting to {cyan(ip)} as {cyan(SSH_USER)}...")
    print(grey("  " + "─" * 60))

    result = _execute_action(ip, password, app_cfg, action, extra_flags)

    print(grey("  " + "─" * 60))
    if result["success"]:
        print(f"  {green('Done.')}")
    else:
        # If there was a connection-level error not yet printed, show it now
        output = result.get("output", "")
        if output and "SSH connection failed" in output:
            print(f"  {red('ERROR')}: {output}")
        elif output and ("not installed" in output or "not configured" in output):
            print(f"  {red('ERROR')}: {output}")
        else:
            print(f"  {red('Failed.')}  (exit status non-zero)")
    print()


def main():
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    vm_name          = None
    app_name         = None
    action           = None
    extra_flags_list = []

    # First pass: strip out -vm / --vm so the remaining args are clean
    remaining = []
    i         = 0
    while i < len(args):
        a = args[i]
        if a in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif a in ("-vm", "--vm") and i + 1 < len(args):
            vm_name = args[i + 1]; i += 2
        else:
            remaining.append(a); i += 1

    # Second pass: first -<word> = app name, next word = action, rest = flags
    for tok in remaining:
        if app_name is None and tok.startswith("-"):
            candidate = tok.lstrip("-")
            if candidate:
                app_name = candidate
        elif action is None and not tok.startswith("-"):
            action = tok
        else:
            extra_flags_list.append(tok)

    if not vm_name:
        print(f"\n  {red('ERROR')}: -vm <vm_name> is required.")
        print(__doc__)
        sys.exit(1)

    if not app_name:
        print(f"\n  {red('ERROR')}: App flag is required (e.g. -payor).")
        print(__doc__)
        sys.exit(1)

    if not action:
        print(f"\n  {red('ERROR')}: Action is required (start, stop, restart, build).")
        print(__doc__)
        sys.exit(1)

    extra_flags = " ".join(extra_flags_list)
    run_app_action(vm_name, app_name, action, extra_flags)


if __name__ == "__main__":
    main()
