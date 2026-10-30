#!/usr/bin/env python3
"""
setup_ld.py — setuplocaldockersetuptool / setupldtool command

Sets up the Local Docker Setup Tool.

Usage:
  setuplocaldockersetuptool
  setupldtool
"""

import sys
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
CMD_DIR    = Path.home() / ".local" / "bin"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"


def _ps_wrapper(script_path: str) -> str:
    """CMD body that tries pwsh first, falls back to powershell."""
    return (
        f'where pwsh >nul 2>&1\n'
        f'if %ERRORLEVEL% == 0 (\n'
        f'    pwsh -NoProfile -ExecutionPolicy Bypass -File "{script_path}" %*\n'
        f') else (\n'
        f'    powershell -NoProfile -ExecutionPolicy Bypass -File "{script_path}" %*\n'
        f')\n'
    )


def _py_wrapper(script_path: str) -> str:
    return f'python "{script_path}" %*\n'


def _check_docker():
    docker = shutil.which("docker")
    if docker:
        try:
            result = subprocess.run(["docker", "--version"], capture_output=True, text=True)
            ver = result.stdout.strip()
            print(f"  {green('[ok]')}     docker  {grey(ver)}")
        except Exception:
            print(f"  {green('[ok]')}     docker  {grey('(version unknown)')}")
        return True
    print(f"  {yellow('[warn]')}   docker not found — install Docker Desktop")
    return False


def _check_powershell():
    pwsh = shutil.which("pwsh") or shutil.which("powershell")
    if pwsh:
        name = "pwsh" if shutil.which("pwsh") else "powershell"
        print(f"  {green('[ok]')}     {name}")
        return True
    print(f"  {red('[missing]')} powershell / pwsh — required for all docker scripts")
    return False


def _ensure_cmd_wrappers():
    s = SCRIPT_DIR

    # (name, script, use_pwsh_wrapper)
    entries = [
        # Docker Desktop
        ("startdocker.cmd",     str(s / "startdocker.ps1"),         True),
        # Container Lifecycle
        ("setupservers.cmd",    str(s / "setupservers.ps1"),         True),
        ("startservers.cmd",    str(s / "startservers.ps1"),         True),
        ("stopservers.cmd",     str(s / "stopservers.ps1"),          True),
        ("deleteservers.cmd",   str(s / "deleteservers.ps1"),        True),
        ("restartservers.cmd",  str(s / "restartservers.ps1"),       True),
        # State Snapshot
        ("savedockerstate.cmd", str(s / "save_docker_state.ps1"),    True),
        ("saveds.cmd",          str(s / "save_docker_state.ps1"),    True),
        ("loaddockerstate.cmd", str(s / "load_docker_state.ps1"),    True),
        ("loadds.cmd",          str(s / "load_docker_state.ps1"),    True),
        ("removedockerstate.cmd", str(s / "remove_docker_state.ps1"), True),
        ("removeds.cmd",          str(s / "remove_docker_state.ps1"), True),
        ("listdockerstate.cmd", str(s / "list_docker_states.ps1"),   True),
        ("listds.cmd",          str(s / "list_docker_states.ps1"),   True),
        # Setup
        ("setuplocaldockersetuptool.cmd", str(s / "setup_ld.py"),    False),
        ("setupldtool.cmd",              str(s / "setup_ld.py"),    False),
    ]

    CMD_DIR.mkdir(parents=True, exist_ok=True)
    for name, script, use_ps in entries:
        p = CMD_DIR / name
        body = _ps_wrapper(script) if use_ps else _py_wrapper(script)
        if p.exists():
            print(f"  [ok]     {name}")
        else:
            p.write_text(f"@echo off\n{body}")
            print(f"  [create] {name}")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("-h", "--help"):
        print(__doc__); sys.exit(0)

    print("\n  Local Docker Setup Tool — Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    print("  ── Dependencies ─────────────────────────────────────────────────")
    _check_powershell()
    _check_docker()

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Run:  startdocker      — start Docker Desktop and wait for daemon")
    print("    2. Run:  setupservers     — docker compose up (create + start full stack)")
    print("    3. Run:  startservers     — start stopped containers")
    print("    4. Run:  stopservers      — stop running containers")
    print("    5. Run:  saveds <name>    — snapshot container state")
    print("    6. Run:  loadds <name>    — restore a snapshot")
    print()


if __name__ == "__main__":
    main()
