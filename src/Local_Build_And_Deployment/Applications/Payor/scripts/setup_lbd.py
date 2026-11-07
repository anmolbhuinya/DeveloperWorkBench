#!/usr/bin/env python3
"""
setup_lbd.py — setuplocalbuildanddeploymenttool / setuplbdtool command

Sets up the Local Build and Deployment Tool for Payor.

Usage:
  setuplocalbuildanddeploymenttool
  setuplbdtool
"""

import sys
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
CMD_DIR    = Path.home() / ".local" / "bin"

RESET  = "\x1b[0m"
def bold(s):  return f"\x1b[1m{s}{RESET}"
def green(s): return f"\x1b[32m{s}{RESET}"
def red(s):   return f"\x1b[31m{s}{RESET}"
def grey(s):  return f"\x1b[90m{s}{RESET}"
def yellow(s):return f"\x1b[33m{s}{RESET}"


def _check_node():
    node = shutil.which("node")
    if node:
        try:
            result = subprocess.run(["node", "--version"], capture_output=True, text=True)
            ver = result.stdout.strip()
            print(f"  {green('[ok]')}     node  {grey(ver)}")
        except Exception:
            print(f"  {green('[ok]')}     node  {grey('(version unknown)')}")
        return True
    print(f"  {red('[missing]')} node — install Node.js from https://nodejs.org")
    return False


def _ensure_config():
    config = TOOL_ROOT / "app_config.xlsx"
    if config.exists():
        print(f"  [ok]     app_config.xlsx")
        return True
    print(f"  [create] app_config.xlsx  (running create_config_xlsx.js)...")
    result = subprocess.run(
        ["node", str(SCRIPT_DIR / "create_config_xlsx.js")],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print(f"  {green('[ok]')}     app_config.xlsx created")
        return True
    print(f"  {red('[error]')}  create_config_xlsx.js failed:")
    print(f"           {result.stderr.strip() or result.stdout.strip()}")
    return False


def _ensure_cmd_wrappers():
    wrappers = {
        "listpayormodules.cmd":              f'node "{SCRIPT_DIR / "list_modules.js"}" %*\n',
        "lpm.cmd":                           f'node "{SCRIPT_DIR / "list_modules.js"}" %*\n',
        "buildpayormodule.cmd":              f'node "{SCRIPT_DIR / "build_module.js"}" %*\n',
        "bpm.cmd":                           f'node "{SCRIPT_DIR / "build_module.js"}" %*\n',
        "deploypayormodule.cmd":             f'node "{SCRIPT_DIR / "deploy_jar.js"}" %*\n',
        "dpm.cmd":                           f'node "{SCRIPT_DIR / "deploy_jar.js"}" %*\n',
        "refresh-payor.cmd":                 f'node "{SCRIPT_DIR / "refresh_payor.js"}" %*\n',
        "localpayorregression.cmd":          f'node "{SCRIPT_DIR / "local_regression.js"}" %*\n',
        "lprt.cmd":                          f'node "{SCRIPT_DIR / "local_regression.js"}" %*\n',
        "setuplocalbuildanddeploymenttool.cmd": f'python "{SCRIPT_DIR / "setup_lbd.py"}" %*\n',
        "setuplbdtool.cmd":                  f'python "{SCRIPT_DIR / "setup_lbd.py"}" %*\n',
        "getpayorreleasebranches.cmd":        f'python "{SCRIPT_DIR / "get_payor_release_branches.py"}" %*\n',
        "getpayorrb.cmd":                    f'python "{SCRIPT_DIR / "get_payor_release_branches.py"}" %*\n',
        "setpayorbranch.cmd":                f'python "{SCRIPT_DIR / "set_payor_branch.py"}" %*\n',
        "setpbranch.cmd":                    f'python "{SCRIPT_DIR / "set_payor_branch.py"}" %*\n',
        "getcurrentpayorbranch.cmd":         f'python "{SCRIPT_DIR / "get_current_payor_branch.py"}" %*\n',
        "getpbranch.cmd":                    f'python "{SCRIPT_DIR / "get_current_payor_branch.py"}" %*\n',
    }
    CMD_DIR.mkdir(parents=True, exist_ok=True)
    for name, body in wrappers.items():
        p = CMD_DIR / name
        runner = "python" if body.startswith("python") else "node"
        if p.exists():
            print(f"  [ok]     {p.name}")
        else:
            p.write_text(f"@echo off\n{body}")
            print(f"  [create] {p.name}")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print("\n  Local Build and Deployment Tool — Setup  (Payor)\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Dependencies ─────────────────────────────────────────────────")
    node_ok = _check_node()

    print()
    print("  ── Config files ─────────────────────────────────────────────────")
    if node_ok:
        _ensure_config()
    else:
        print(f"  {yellow('[skip]')}   app_config.xlsx — node not found")

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Open app_config.xlsx and fill in any overridden values")
    print("       (payorRepoRoot, sharedFolder, containerName, deployDir)")
    print("    2. Run:  listpayormodules  (or  lpm)  to list available Payor modules")
    print("    3. Run:  buildpayormodule  (or  bpm)  to build a module")
    print("    4. Run:  deploypayormodule (or  dpm)  to deploy a built jar")
    print("    5. Run:  refresh-payor  for a full build + deploy cycle")
    print()


if __name__ == "__main__":
    main()
