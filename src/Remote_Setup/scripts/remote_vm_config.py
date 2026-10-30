#!/usr/bin/env python3
"""
remote_vm_config.py — remotevmconfig / rvmconfig command

Show the latest parameter configuration for configured remote servers.

Usage:
  rvmconfig                  List all configured servers with last-run summary
  rvmconfig -ip <ip>         Show full latest config for a specific server
  rvmconfig --help
"""

import sys
from pathlib import Path
import openpyxl

SCRIPT_DIR  = Path(__file__).resolve().parent
TOOL_ROOT   = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "Remote_Setup"        # project data: <DWB>\Projects\Remote_Setup
DATA_ROOT.mkdir(parents=True, exist_ok=True)
SERVERS_DIR = DATA_ROOT / "configured_servers"

RESET  = "\x1b[0m"
def bold(s):  return f"\x1b[1m{s}{RESET}"
def cyan(s):  return f"\x1b[36m{s}{RESET}"
def green(s): return f"\x1b[32m{s}{RESET}"
def yellow(s):return f"\x1b[33m{s}{RESET}"
def grey(s):  return f"\x1b[90m{s}{RESET}"
def white(s): return f"\x1b[97m{s}{RESET}"
def dim(s):   return f"\x1b[2m{s}{RESET}"

_PASSWORD_KEYS = {
    "password", "vm_password", "server_password", "host_password",
    "target_password", "gh_pass", "github_pass", "github_password",
    "git_password", "git_pass",
}

STD_COLS = {"pid", "timestamp", "vm_name", "vm_ip", "status", "queue_url"}


def _status_color(status):
    s = str(status or "").lower()
    if s in ("triggered", "running", "queued"): return green(status)
    if "pass" in s or "success" in s:           return green(status)
    if "fail" in s:                             return yellow(status)
    if "cancel" in s or "abort" in s:           return grey(status)
    return white(status)


def _all_server_files():
    return sorted(SERVERS_DIR.glob("server_*_conf.xlsx"))


def _ip_from_path(path):
    parts = path.stem.split("_")   # ['server', '10', '0', '0', '1', 'conf']
    return ".".join(parts[1:-1])


def _load_latest_run(path):
    wb = openpyxl.load_workbook(str(path))
    if "Setups" not in wb.sheetnames:
        return [], None
    ws      = wb["Setups"]
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    last    = None
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            last = dict(zip(headers, row))
    return headers, last


def _mask(key, value):
    if str(key or "").lower() in _PASSWORD_KEYS:
        return "*" * len(str(value or ""))
    return str(value or "")


def _visible_len(s):
    import re
    s = re.sub(r'\x1b\[[0-9;]*[mK]', '', s)
    s = re.sub(r'\x1b\][^\x07]*\x07', '', s)
    return len(s)


def _pad(s, w):
    return s + " " * max(0, w - _visible_len(s))


# ---------------------------------------------------------------------------
# Summary list (no args)
# ---------------------------------------------------------------------------

def print_vm_list():
    files = _all_server_files()
    print()
    print(bold(white("  Remote VM Configurations")))
    print()

    if not files:
        print(grey("  No configured servers found in configured_servers/."))
        print(grey("  Run  remotesetup  to configure a server first."))
        print()
        return

    IP_W   = 18
    VM_W   = 24
    TS_W   = 22

    hdr = (
        "  " +
        _pad(dim("IP"),       IP_W) + "  " +
        _pad(dim("VM NAME"),  VM_W) + "  " +
        _pad(dim("LAST RUN"), TS_W) + "  " +
        dim("LAST STATUS")
    )
    print(hdr)
    print("  " + grey("-" * (_visible_len(hdr) - 2)))

    for f in files:
        ip         = _ip_from_path(f)
        _, run     = _load_latest_run(f)
        vm_name    = str(run.get("vm_name",   "") if run else "")
        last_ts    = str(run.get("timestamp", "") if run else "")
        last_status= str(run.get("status",    "") if run else "")

        print(
            "  " +
            _pad(cyan(ip),                 IP_W) + "  " +
            _pad(vm_name,                  VM_W) + "  " +
            _pad(grey(last_ts),            TS_W) + "  " +
            _status_color(last_status)
        )

    print()
    print(grey("  Tip:  rvmconfig -ip <ip>  to see full parameter configuration\n"))


# ---------------------------------------------------------------------------
# Detail (by IP)
# ---------------------------------------------------------------------------

def print_vm_config(ip):
    ip_file = ip.replace(".", "_")
    path    = SERVERS_DIR / f"server_{ip_file}_conf.xlsx"
    if not path.exists():
        print(f"\n  ERROR: No config file for IP '{ip}'.")
        print(f"  Expected: configured_servers/{path.name}\n")
        sys.exit(1)

    headers, run = _load_latest_run(path)
    if run is None:
        print(f"\n  No runs recorded for {ip}.\n")
        return

    vm_name    = str(run.get("vm_name",   "") or "")
    ts         = str(run.get("timestamp", "") or "")
    status     = str(run.get("status",    "") or "")
    queue_url  = str(run.get("queue_url", "") or "")
    param_cols = [h for h in (headers or []) if h and str(h) not in STD_COLS]

    print()
    print(bold(white(f"  Latest Configuration — {ip}")))
    print(grey(f"  {'─' * 56}"))
    print(f"  {'VM Name':<22} : {bold(vm_name)}")
    print(f"  {'Last Configured':<22} : {grey(ts)}")
    print(f"  {'Status':<22} : {_status_color(status)}")
    if queue_url:
        print(f"  {'Queue URL':<22} : {grey(queue_url)}")

    if param_cols:
        print()
        print(grey(f"  {'─' * 56}"))
        print(f"  Parameters:")
        for col in param_cols:
            val = run.get(col, "")
            if val not in (None, ""):
                display = _mask(col, val)
                print(f"    {str(col):<32} : {display}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    ip   = None
    i    = 0
    while i < len(args):
        if args[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif args[i] in ("-ip", "--ip") and i + 1 < len(args):
            ip = args[i + 1]; i += 2
        else:
            i += 1

    if ip:
        print_vm_config(ip)
    else:
        print_vm_list()


if __name__ == "__main__":
    main()
