#!/usr/bin/env python3
"""
setup_all_tools.py — setupalltools command

Runs the setup script for every tool in the workspace in sequence.

Usage:
  setupalltools
  setupalltools --help
"""

import sys
import subprocess
from pathlib import Path

SCRIPT_DIR     = Path(__file__).resolve().parent
WORKFLOWS_ROOT = SCRIPT_DIR.parent
CMD_DIR        = Path.home() / ".local" / "bin"

RESET  = "\x1b[0m"
def bold(s):  return f"\x1b[1m{s}{RESET}"
def green(s): return f"\x1b[32m{s}{RESET}"
def red(s):   return f"\x1b[31m{s}{RESET}"
def grey(s):  return f"\x1b[90m{s}{RESET}"
def cyan(s):  return f"\x1b[36m{s}{RESET}"


WF_DIR = WORKFLOWS_ROOT / "WorkFlows"

TOOLS = [
    ("Local Build and Deployment",          WORKFLOWS_ROOT / "Local_Build_And_Deployment"  / "Applications" / "Payor" / "scripts" / "setup_lbd.py"),
    ("Remote Build and Deployment",         WORKFLOWS_ROOT / "Remote_Build_And_Deployment" / "scripts"       / "setup_rbd.py"),
    ("Local Docker Setup",                  WORKFLOWS_ROOT / "Local_Docker_Setup"          / "scripts"       / "setup_ld.py"),
    ("GP Build Tool",                       WF_DIR / "GP_Build"                            / "scripts" / "setupgptool.py"),
    ("Local Clone Tool",                    WF_DIR / "Local_Clone_Tool"                    / "scripts" / "setup_lclone.py"),
    ("Jenkins IT Regression",               WF_DIR / "Jenkins_IT_Regression"               / "scripts" / "setup_jreg.py"),
    ("Jenkins Baseline Tool",               WF_DIR / "Jenkins_BaseLine"                    / "scripts" / "setup_jbaseline.py"),
    ("Remote VM Setup Tool",                WORKFLOWS_ROOT / "Remote_Setup"                / "scripts" / "setup_remote_setup.py"),
    ("Remote Regression Tool",              WF_DIR / "Remote_Regression_Jenkins_IT_Failure" / "projects" / "Payor" / "scripts" / "setup_rregtest.py"),
    ("Payor Utils Certification Tool",      WF_DIR / "Jenkins_Payor_Utils_Certification"   / "scripts" / "setup_puc.py"),
    ("Update Melissa Data License Tool",    WF_DIR / "Remote_Melissa_Data_Update_License"  / "scripts" / "setup_update_melissa_data.py"),
    ("Clone Workflow Tool",                 WF_DIR / "Clone_WorkFlow"                      / "scripts" / "setup_clone_wf.py"),
    ("Internal Developer Platform (IDP)",   WORKFLOWS_ROOT / "Internal_Developer_Tool"     / "scripts" / "setup_idp.py"),
]


def _run_setup(label: str, script: Path) -> bool:
    if not script.exists():
        print(f"  {red('[SKIP]')}  {label} — script not found: {grey(str(script))}")
        return False
    print(f"\n{'─' * 70}")
    print(f"  {cyan(bold(label))}")
    print(f"{'─' * 70}")
    result = subprocess.run([sys.executable, str(script)], capture_output=False)
    return result.returncode == 0


def _ensure_cmd_wrapper():
    CMD_DIR.mkdir(parents=True, exist_ok=True)
    p = CMD_DIR / "setupalltools.cmd"
    body = f'@echo off\npython "{SCRIPT_DIR / "setup_all_tools.py"}" %*\n'
    if p.exists():
        print(f"  [ok]     {p}")
    else:
        p.write_text(body)
        print(f"  [create] {p}")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print(f"\n{'=' * 70}")
    print(f"  {bold('All Tools Setup')}")
    print(f"  Workspace: {grey(str(WORKFLOWS_ROOT))}")
    print(f"{'=' * 70}")

    results = []
    for label, script in TOOLS:
        ok = _run_setup(label, script)
        results.append((label, ok))

    # Self-register setupalltools command
    print(f"\n{'─' * 70}")
    print(f"  {cyan(bold('setupalltools CMD wrapper'))}")
    print(f"{'─' * 70}")
    _ensure_cmd_wrapper()

    # Summary
    passed = [l for l, ok in results if ok]
    failed = [l for l, ok in results if not ok]

    print(f"\n{'=' * 70}")
    print(f"  {bold('Setup Summary')}")
    print(f"{'=' * 70}")
    for label, ok in results:
        status = green("ok    ") if ok else red("FAILED")
        print(f"  [{status}]  {label}")

    print()
    if failed:
        print(f"  {red(str(len(failed)))} tool(s) had issues — check output above.")
    else:
        print(f"  {green('All tools set up successfully.')}")
    print()


if __name__ == "__main__":
    main()
