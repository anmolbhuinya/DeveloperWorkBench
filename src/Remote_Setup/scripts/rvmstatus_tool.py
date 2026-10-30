#!/usr/bin/env python3
"""
rvmstatus_tool.py -- remotevmstatus / rvmstatus command

Check remote VM branch and environment status.

Usage:
  rvmstatus                     List all VMs from vms.xlsx
  rvmstatus -vmid <vm_name>     SSH to VM and run 'branch', show output
  rvmstatus --help
"""

import sys
from pathlib import Path

SCRIPT_DIR  = Path(__file__).resolve().parent
TOOL_ROOT   = SCRIPT_DIR.parent
VMS_PATH    = TOOL_ROOT.parent / "vms.xlsx"
SSH_USER    = "weblogic"
SSH_PORT    = 22
SSH_TIMEOUT = 30

RESET = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
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
                    d["_sheet"] = sheet_name
                    vms.append(d)
    return vms


def _find_vm(vm_id):
    for vm in _load_vms():
        if vm.get("name", "").lower() == vm_id.lower():
            return vm
    return None


def _ssh_branch(ip, password, username=SSH_USER):
    try:
        import paramiko
    except ImportError:
        return False, "paramiko not installed. Run:  pip install paramiko"

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=ip, port=SSH_PORT,
            username=username, password=password,
            timeout=SSH_TIMEOUT,
            allow_agent=False, look_for_keys=False,
        )
        _, stdout, stderr = client.exec_command("branch", timeout=SSH_TIMEOUT)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        client.close()
        combined = (out + ("\n" + err if err.strip() else "")).strip()
        return True, combined
    except Exception as e:
        return False, str(e)


def list_vms():
    vms = _load_vms()
    print()
    print(bold("  Developer VMs"))
    print()
    if not vms:
        if not VMS_PATH.exists():
            print(grey(f"  vms.xlsx not found at {VMS_PATH}"))
        else:
            print(grey("  No VMs found in vms.xlsx."))
        print()
        return

    COL = {"name": 24, "ip": 16, "desc": 32, "assigned": 20}
    print(grey("  " +
               f"{'NAME':<{COL['name']}}  " +
               f"{'IP':<{COL['ip']}}  " +
               f"{'DESCRIPTION':<{COL['desc']}}  " +
               f"{'ASSIGNED TO':<{COL['assigned']}}"))
    print("  " + grey("-" * (sum(COL.values()) + 8)))
    for vm in vms:
        name     = vm.get("name",        "")
        ip       = vm.get("ip",          "")
        desc     = vm.get("description", "")
        assigned = vm.get("assigned_to", "")
        name_d   = (name[:COL["name"] - 1] + "…") if len(name) > COL["name"] else name
        desc_d   = (desc[:COL["desc"] - 1] + "…") if len(desc) > COL["desc"] else desc
        # cyan has 9 invisible chars
        print(f"  {cyan(name_d):<{COL['name'] + 9}}  "
              f"{grey(ip):<{COL['ip'] + 9}}  "
              f"{desc_d:<{COL['desc']}}  "
              f"{grey(assigned)}")
    print()
    print(grey("  Tip:  rvmstatus -vmid <vm_name>   SSH to VM and show branch info"))
    print()


def show_vm_status(vm_id):
    vm = _find_vm(vm_id)
    if not vm:
        print(f"\n  {red('ERROR')}: VM '{vm_id}' not found in vms.xlsx.")
        print(f"  Run  rvmstatus  to list available VMs.\n")
        sys.exit(1)

    name     = vm.get("name",        "")
    ip       = vm.get("ip",          "")
    password = vm.get("password",    "")
    desc     = vm.get("description", "")

    print()
    print(bold(f"  VM: {name}"))
    print(f"  IP:          {grey(ip)}")
    if desc:
        print(f"  Description: {grey(desc)}")
    print()

    if not ip:
        print(f"  {red('ERROR')}: No IP address for VM '{name}'.\n")
        sys.exit(1)

    print(f"  Connecting to {cyan(ip)} as {cyan(SSH_USER)}...")
    ok, output = _ssh_branch(ip, password)
    if not ok:
        print(f"  {red('ERROR')}: {output}\n")
        sys.exit(1)

    print(f"  {green('Connected.')} Running branch...\n")
    print("  " + grey("─" * 60))
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        if ":" in line:
            key, _, val = line.partition(":")
            print(f"  {cyan(key.strip()):<30}  {val.strip()}")
        else:
            print(f"  {line}")
    print("  " + grey("─" * 60))
    print()


def print_help():
    print("""
  remotevmstatus / rvmstatus -- Remote VM Branch Status

  Usage:
    rvmstatus                     List all VMs from vms.xlsx
    rvmstatus -vmid <vm_name>     SSH to VM and run 'branch' command

  Prerequisites:
    - vms.xlsx must exist with columns: name, ip, password
    - pip install paramiko  (required for SSH)

  Examples:
    rvmstatus
    rvmstatus -vmid haeng-haproxy2
""")


def main():
    args = sys.argv[1:]

    if args and args[0] in ("-h", "--help"):
        print_help(); sys.exit(0)

    if not args:
        list_vms(); sys.exit(0)

    i      = 0
    vm_id  = None
    while i < len(args):
        if args[i] in ("-vmid", "--vmid") and i + 1 < len(args):
            vm_id = args[i + 1]; i += 2
        else:
            i += 1

    if vm_id:
        show_vm_status(vm_id)
    else:
        list_vms()


if __name__ == "__main__":
    main()
