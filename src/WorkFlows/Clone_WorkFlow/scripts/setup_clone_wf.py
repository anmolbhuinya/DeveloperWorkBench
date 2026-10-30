#!/usr/bin/env python3
"""
setup_clone_wf.py — setupcloneworkflowtool / setupclonewftool command

Sets up the Clone Workflow Tool.

Usage:
  setupcloneworkflowtool
  setupclonewftool
"""

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent   # Clone_WorkFlow/scripts/
TOOL_ROOT  = SCRIPT_DIR.parent                # Clone_WorkFlow/
CMD_DIR    = Path.home() / ".local" / "bin"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"


def _ensure_dirs():
    for d in [TOOL_ROOT / "project_status"]:
        d.mkdir(parents=True, exist_ok=True)
        print(f"  [ok]     {d.relative_to(TOOL_ROOT)}/")


def _ensure_cmd_wrappers():
    s = SCRIPT_DIR
    wrappers = {
        "cloneworkflow.cmd":          f'python "{s / "clone_workflow.py"}" %*\n',
        "clonewf.cmd":                f'python "{s / "clone_workflow.py"}" %*\n',
        "clonewfstatus.cmd":          f'python "{s / "clone_wf_status.py"}" %*\n',
        "clonewfdelete.cmd":          f'python "{s / "clone_wf_delete.py"}" %*\n',
        "setupcloneworkflowtool.cmd": f'python "{s / "setup_clone_wf.py"}" %*\n',
        "setupclonewftool.cmd":       f'python "{s / "setup_clone_wf.py"}" %*\n',
    }
    CMD_DIR.mkdir(parents=True, exist_ok=True)
    for name, body in wrappers.items():
        p = CMD_DIR / name
        if p.exists():
            print(f"  [ok]     {name}")
        else:
            p.write_text(f"@echo off\n{body}")
            print(f"  [create] {name}")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print("\n  Clone Workflow Tool — Setup\n")
    print(f"  Tool root  : {TOOL_ROOT}\n")

    print("  ── Directories ──────────────────────────────────────────────────")
    _ensure_dirs()

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete.")
    print(f"    Run:  clonewf                — start a new workflow (CLI)")
    print(f"    Run:  clonewfstatus          — list all projects")
    print(f"    Run:  clonewfstatus -pid <n> — show stages for a project")
    print(f"    Run:  clonewfdelete -pid <n> — delete project + stages file")
    print(f"    Run:  setupidptool           — set up the Internal Developer Platform UI")
    print()


if __name__ == "__main__":
    main()
