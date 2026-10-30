#!/usr/bin/env python3
"""
setup_idp.py — setupidptool / setupidp command

Sets up the Internal Developer Platform (React UI + Flask server).

Usage:
  setupidptool
  setupidp
"""

import sys
import shutil
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent   # Internal_Developer_Tool/scripts/
TOOL_ROOT  = SCRIPT_DIR.parent                # Internal_Developer_Tool/
UI_DIR     = TOOL_ROOT / "ui"
STATIC_DIR = TOOL_ROOT / "static"
CMD_DIR    = Path.home() / ".local" / "bin"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"


def _check_flask() -> bool:
    try:
        import flask
        print(f"  {green('[ok]')}     flask  {grey(flask.__version__)}")
        return True
    except ImportError:
        print(f"  Installing flask...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "flask"],
            capture_output=False
        )
        if result.returncode == 0:
            import flask
            print(f"  {green('[ok]')}     flask  {grey(flask.__version__)}")
            return True
        print(f"  {red('[error]')}  pip install flask failed")
        return False


def _check_flask_sock() -> bool:
    def _ver():
        try:
            from importlib.metadata import version
            return version("flask-sock")
        except Exception:
            return ""

    try:
        import flask_sock  # noqa: F401
        print(f"  {green('[ok]')}     flask-sock  {grey(_ver())}")
        return True
    except ImportError:
        print(f"  Installing flask-sock...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "flask-sock"],
            capture_output=False
        )
        if result.returncode == 0:
            print(f"  {green('[ok]')}     flask-sock  {grey(_ver())}")
            return True
        print(f"  {red('[error]')}  pip install flask-sock failed")
        return False


def _check_pip_pkg(import_name: str, pip_name: str) -> bool:
    try:
        __import__(import_name)
        from importlib.metadata import version as _v
        try:
            ver = _v(pip_name)
        except Exception:
            ver = ""
        print(f"  {green('[ok]')}     {pip_name}  {grey(ver)}")
        return True
    except ImportError:
        print(f"  Installing {pip_name}...")
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", pip_name],
            capture_output=False
        )
        if result.returncode == 0:
            print(f"  {green('[ok]')}     {pip_name}")
            return True
        print(f"  {red('[error]')}  pip install {pip_name} failed")
        return False


def _check_node() -> bool:
    node = shutil.which("node")
    if node:
        try:
            ver = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
            print(f"  {green('[ok]')}     node  {grey(ver)}")
        except Exception:
            print(f"  {green('[ok]')}     node")
        return True
    print(f"  {red('[missing]')} node — install Node.js from https://nodejs.org")
    return False


def _check_npm() -> bool:
    if shutil.which("npm"):
        print(f"  {green('[ok]')}     npm")
        return True
    print(f"  {red('[missing]')} npm — comes with Node.js")
    return False


def _npm_install() -> bool:
    if not (UI_DIR / "package.json").exists():
        print(f"  {red('[error]')}  Internal_Developer_Tool/ui/package.json not found")
        return False
    if (UI_DIR / "node_modules").exists():
        print(f"  [ok]     node_modules  {grey('(already installed)')}")
        return True
    print(f"  Installing npm packages in Internal_Developer_Tool/ui/...")
    result = subprocess.run(["npm", "install"], cwd=str(UI_DIR), capture_output=False, shell=True)
    if result.returncode == 0:
        print(f"  {green('[ok]')}     npm install")
        return True
    print(f"  {red('[error]')}  npm install failed")
    return False


def _npm_build() -> bool:
    print(f"  Building React app  {grey('(npm run build → Internal_Developer_Tool/static/)')}")
    result = subprocess.run(["npm", "run", "build"], cwd=str(UI_DIR), capture_output=False, shell=True)
    if result.returncode == 0:
        print(f"  {green('[ok]')}     build → Internal_Developer_Tool/static/")
        return True
    print(f"  {red('[error]')}  npm run build failed")
    return False


def _ensure_cmd_wrappers():
    s = SCRIPT_DIR
    wrappers = {
        "startidp.cmd":     f'python "{s / "idp_server.py"}" %*\n',
        "stopidp.cmd":      f'python "{s / "idp_server.py"}" --stop %*\n',
        "setupidptool.cmd": f'python "{s / "setup_idp.py"}" %*\n',
        "setupidp.cmd":     f'python "{s / "setup_idp.py"}" %*\n',
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

    print("\n  Internal Developer Platform — Setup\n")
    print(f"  IDP root   : {TOOL_ROOT}")
    print(f"  UI source  : {UI_DIR}")
    print(f"  Static out : {STATIC_DIR}\n")

    print("  ── Dependencies ─────────────────────────────────────────────────")
    _check_flask()
    _check_flask_sock()
    _check_pip_pkg("openpyxl", "openpyxl")
    _check_pip_pkg("xlwt",     "xlwt")
    node_ok = _check_node()
    npm_ok  = _check_npm()

    print()
    print("  ── React UI ─────────────────────────────────────────────────────")
    import os as _os
    if _os.environ.get("DWB_INSTALLER") and (STATIC_DIR / "index.html").exists():
        print(f"  {green('[ok]')}     UI already built (installer) - skipping npm install / build")
    elif not node_ok or not npm_ok:
        print(f"  {yellow('[skip]')}   Node.js / npm not available — UI cannot be built")
    else:
        ok = _npm_install()
        if ok:
            _npm_build()

    print()
    print("  ── CMD wrappers ─────────────────────────────────────────────────")
    _ensure_cmd_wrappers()

    built = (STATIC_DIR / "index.html").exists()
    print()
    print("  Setup complete.")
    print(f"    Run:  startidp  — start the Developer Platform UI in background{'' if built else '  ' + yellow('(build required)')}")
    print(f"    Run:  stopidp   — stop the Developer Platform UI")
    print()


if __name__ == "__main__":
    main()
