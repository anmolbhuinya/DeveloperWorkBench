#!/usr/bin/env python3
"""
setup_rregtest.py -- setupremoteregtool / setupremoteregressiontool command

Set up the Remote Regression tool: create config.xlsx, projects.xlsx,
and CMD wrappers for all remoteregression commands.

Usage:
  setupremoteregtool
  setupremoteregressiontool
"""
import sys
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TOOL_ROOT  = SCRIPT_DIR.parent
CMD_DIR    = Path.home() / ".local" / "bin"


def _write_cmds():
    cmds = {
        "setupremoteregtool.cmd":        f'@python "{SCRIPT_DIR / "setup_rregtest.py"}" %*\n',
        "setupremoteregressiontool.cmd": f'@python "{SCRIPT_DIR / "setup_rregtest.py"}" %*\n',
        "remoteregression.cmd":          f'@python "{SCRIPT_DIR / "rregtest_tool.py"}" %*\n',
        "remotereg.cmd":                 f'@python "{SCRIPT_DIR / "rregtest_tool.py"}" %*\n',
        "remoteregdelete.cmd":           f'@python "{SCRIPT_DIR / "rregtest_delete.py"}" %*\n',
    }
    CMD_DIR.mkdir(parents=True, exist_ok=True)
    for name, content in cmds.items():
        p = CMD_DIR / name
        p.write_text(content, encoding="utf-8")
        print(f"  [cmd] {p}")


def setup():
    print("\n  Remote Regression Tool -- Setup\n")
    print(f"  Tool root: {TOOL_ROOT}\n")

    config = TOOL_ROOT / "config.xlsx"
    if config.exists():
        print("  [skip] config.xlsx already exists")
    else:
        node = subprocess.run(["where", "node"], capture_output=True, text=True, shell=True)
        if node.returncode == 0:
            r = subprocess.run(
                ["node", str(SCRIPT_DIR / "create_config_xlsx.js")],
                capture_output=False
            )
            if r.returncode != 0:
                print("  WARNING: config.xlsx generation failed. "
                      "Run  node scripts/create_config_xlsx.js  manually.")
        else:
            print("  [skip] node not found -- config.xlsx not created. "
                  "Run  node scripts/create_config_xlsx.js  manually.")

    from pathlib import Path as _DwPath
    import os as _dwos
    _base = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Remote_Regression_Jenkins_IT_Failure"
    _base.mkdir(parents=True, exist_ok=True)
    projects = _base / "projects.xlsx"
    if projects.exists():
        print("  [skip] projects.xlsx already exists")
    else:
        subprocess.run([sys.executable, str(SCRIPT_DIR / "create_rregtest_projects.py")],
                       capture_output=False)

    baseline_dir = TOOL_ROOT / "baseline"
    if baseline_dir.is_dir():
        print("  [skip] baseline/ folder already exists")
    else:
        baseline_dir.mkdir(parents=True, exist_ok=True)
        print("  [create] baseline/")

    print()
    _write_cmds()

    print()
    print("  Setup complete. Next steps:")
    print("    1. Create a project in the IDP Remote Regression UI and select a VM + repo path")
    print("    2. Fill in baseline URLs in the project's per-project xlsx (projects/<pid>_<version>.xlsx)")
    print("    3. Run:  remoteregression -payor 26.1.1.1")
    print()


def print_help():
    print("""
  setupremoteregtool -- Remote Regression Tool setup

  Usage:
    setupremoteregtool            Create config.xlsx, projects.xlsx, CMD wrappers
    setupremoteregressiontool     (long alias)
    --help                        Show this help

  Commands created:
    remoteregression -payor <ver>   Run the guided regression orchestrator
    remotereg -payor <ver>          (alias)
    remoteregdelete -pid <id>       Delete a project entry
    setupremoteregtool              Re-run setup (safe to run again)
""")


def main():
    args = sys.argv[1:]
    if args and args[0] in ("--help", "-h"):
        print_help()
    else:
        setup()


if __name__ == "__main__":
    main()
