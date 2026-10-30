#!/usr/bin/env python3
"""
vmsearch_tool.py -- vmsearch command

Search available VMs by branch/environment criteria.
SSHes to each VM concurrently and runs 'branch', then filters by the given criteria.

Usage:
  vmsearch -prb <branch>                     Filter by Payor release branch
  vmsearch --payor-release-branch <branch>   (long form)
  vmsearch --help

Examples:
  vmsearch -prb master
  vmsearch -prb 26.2.2.0.1
"""

import sys
import threading
from pathlib import Path

SCRIPT_DIR  = Path(__file__).resolve().parent
TOOL_ROOT   = SCRIPT_DIR.parent
VMS_PATH    = TOOL_ROOT.parent / "vms.xlsx"
SSH_USER    = "weblogic"
SSH_PORT    = 22
SSH_TIMEOUT = 20

RESET = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"


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


def _ssh_branch(ip, password):
    try:
        import paramiko
    except ImportError:
        return None, "paramiko not installed"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname=ip, port=SSH_PORT, username=SSH_USER,
                       password=password, timeout=SSH_TIMEOUT,
                       allow_agent=False, look_for_keys=False)
        _, stdout, _ = client.exec_command("branch", timeout=SSH_TIMEOUT)
        out = stdout.read().decode("utf-8", errors="replace").strip()
        client.close()
        parsed = {}
        for line in out.splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                parsed[k.strip()] = v.strip()
        return parsed, None
    except Exception as e:
        return None, str(e)


def _fetch_all(vms):
    results = [None] * len(vms)

    def worker(i, vm):
        ip       = vm.get("ip",       "")
        password = vm.get("password", "")
        if not ip:
            results[i] = (vm, None, "no IP")
            return
        parsed, err = _ssh_branch(ip, password)
        results[i] = (vm, parsed, err)

    threads = [threading.Thread(target=worker, args=(i, vm)) for i, vm in enumerate(vms)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def search_prb(branch):
    vms = _load_vms()
    if not vms:
        print(f"\n  {yellow('No VMs found')} in vms.xlsx.\n")
        return

    print()
    print(bold(f"  Searching for VMs with Payor branch: {cyan(branch)}"))
    print(f"  Checking {len(vms)} VM(s) via SSH...\n")

    results = _fetch_all(vms)

    matched = []
    for vm, parsed, err in results:
        if err or not parsed:
            continue
        if parsed.get("Current branch", "").lower() == branch.lower():
            matched.append((vm, parsed))

    if not matched:
        print(f"  {yellow('No VMs found')} with Payor branch '{branch}'.\n")
        return

    print(f"  {green(str(len(matched)))} VM(s) found:\n")
    COL = {"name": 24, "ip": 16, "branch": 20, "domain": 30}
    print(grey("  " +
               f"{'NAME':<{COL['name']}}  " +
               f"{'IP':<{COL['ip']}}  " +
               f"{'CURRENT BRANCH':<{COL['branch']}}  " +
               f"DOMAIN"))
    print("  " + grey("-" * (sum(COL.values()) + 8)))
    for vm, parsed in matched:
        name       = vm.get("name", "")
        ip         = vm.get("ip",   "")
        branch_val = parsed.get("Current branch", "")
        domain     = parsed.get("Domain",         "")
        name_d     = (name[:COL["name"] - 1] + "…") if len(name) > COL["name"] else name
        print(f"  {cyan(name_d):<{COL['name'] + 9}}  "
              f"{grey(ip):<{COL['ip'] + 9}}  "
              f"{green(branch_val):<{COL['branch'] + 9}}  "
              f"{grey(domain)}")
    print()


def print_help():
    print("""
  vmsearch -- VM Search

  Usage:
    vmsearch -prb <branch>                    Filter VMs by Payor release branch
    vmsearch --payor-release-branch <branch>  (long form)
    vmsearch --help

  Examples:
    vmsearch -prb master
    vmsearch -prb 26.2.2.0.1

  Notes:
    - Reads VMs from vms.xlsx (all sheets)
    - SSHes to each VM concurrently and runs 'branch'
    - pip install paramiko  required
""")


def main():
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print_help(); sys.exit(0)

    i   = 0
    prb = None
    while i < len(args):
        if args[i] in ("-prb", "--payor-release-branch") and i + 1 < len(args):
            prb = args[i + 1]; i += 2
        else:
            i += 1

    if prb:
        search_prb(prb)
    else:
        print(f"\n  {red('ERROR')}: No filter specified. Run  vmsearch --help  for usage.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
