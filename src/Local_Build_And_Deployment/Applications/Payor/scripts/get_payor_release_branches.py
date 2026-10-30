#!/usr/bin/env python3
"""
get_payor_release_branches.py — getpayorreleasebranches / getpayorrb command

Lists all Payor release branches from the local clone (same as setbranch does).
Reads the local clone path from the SRCDIR environment variable, or falls back
to searching GIT_HOME for hrp.payer.core-* directories.

Usage:
  getpayorreleasebranches
  getpayorrb
  getpayorrb -v 26.1         Filter versions starting with 26.1
  getpayorrb --json          Print as JSON array
  getpayorrb --prefix <pfx>  Override release branch prefix (default: release-)
"""

import sys
import os
import re
import json
import subprocess
from pathlib import Path

# Ensure Unicode output works on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR     = Path(__file__).resolve().parent
WORKFLOWS_ROOT = SCRIPT_DIR.parents[2]
PAYOR_CONFIG   = WORKFLOWS_ROOT / "WorkFlows" / "Local_Clone_Tool" / "project_type_config" / "payor_config.xlsx"

RESET  = "\x1b[0m"
BOLD   = "\x1b[1m"
GREEN  = "\x1b[32m"
CYAN   = "\x1b[36m"
GREY   = "\x1b[90m"
RED    = "\x1b[31m"
YELLOW = "\x1b[33m"

def bold(s):   return f"{BOLD}{s}{RESET}"
def green(s):  return f"{GREEN}{s}{RESET}"
def cyan(s):   return f"{CYAN}{s}{RESET}"
def grey(s):   return f"{GREY}{s}{RESET}"
def red(s):    return f"{RED}{s}{RESET}"
def yellow(s): return f"{YELLOW}{s}{RESET}"


def _find_clone_dir():
    """Find the local Payor clone directory, mirroring setbranch's logic."""
    # 1. $SRCDIR env var (set by setbranch)
    srcdir = os.environ.get("SRCDIR", "").strip()
    if srcdir and Path(srcdir).is_dir() and (Path(srcdir) / ".git").exists():
        return Path(srcdir)

    # 2. Search GIT_HOME for hrp.payer.core-* directories
    git_home = os.environ.get("GIT_HOME", "").strip()
    if git_home and Path(git_home).is_dir():
        candidates = sorted(Path(git_home).glob("hrp.payer.core-*"), reverse=True)
        for c in candidates:
            if (c / ".git").exists():
                return c

    # 3. Read payorRepoRoot from payor_config.xlsx
    if PAYOR_CONFIG.exists():
        try:
            import openpyxl
            wb = openpyxl.load_workbook(str(PAYOR_CONFIG))
            cfg = {}
            for row in wb["Config"].iter_rows(min_row=2, values_only=True):
                if row[0] and row[1] is not None:
                    cfg[str(row[0]).strip()] = str(row[1]).strip()
            root = cfg.get("payorRepoRoot") or cfg.get("payor_repo_root", "")
            if root:
                candidates = sorted(Path(root).glob("hrp.payer.core-*"), reverse=True)
                for c in candidates:
                    if (c / ".git").exists():
                        return c
        except Exception:
            pass

    return None


def _sort_key(version_str):
    parts = re.split(r"[.\-]", version_str)
    # primary=1 for numeric versions (26.1.1.1), primary=0 for alpha-prefix (test-18.5)
    # reverse=True → primary=1 first, so numeric versions appear first; alpha-prefix last
    primary = 1 if parts[0].isdigit() else 0
    return [primary] + [(0, int(x)) if x.isdigit() else (1, x) for x in parts]


def _list_branches(clone_dir, prefix):
    """Run git branch -a in clone_dir and return release branch versions, sorted."""
    try:
        result = subprocess.run(
            ["git", "branch", "-a"],
            cwd=str(clone_dir),
            capture_output=True,
            text=True,
            timeout=15,
        )
    except subprocess.TimeoutExpired:
        print(f"  {red('[error]')}  git branch -a timed out in {clone_dir}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"  {red('[error]')}  git not found — make sure Git is on your PATH")
        sys.exit(1)

    pattern = re.compile(r"remotes/[^/]+/" + re.escape(prefix) + r"(.+)")
    seen    = set()
    results = []
    for line in result.stdout.splitlines():
        m = pattern.search(line.strip())
        if m:
            version = m.group(1)
            if version not in seen:
                seen.add(version)
                results.append(version)

    return sorted(results, key=_sort_key, reverse=True)


def main():
    args            = sys.argv[1:]
    as_json         = "--json" in args
    prefix_override = None
    version_filter  = None
    i = 0
    while i < len(args):
        if args[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif args[i] == "--prefix" and i + 1 < len(args):
            prefix_override = args[i + 1]; i += 2
        elif args[i] == "-v" and i + 1 < len(args):
            version_filter = args[i + 1]; i += 2
        else:
            i += 1

    branch_prefix = prefix_override or "release-"

    # Try to read prefix from payor_config.xlsx if available
    if not prefix_override and PAYOR_CONFIG.exists():
        try:
            import openpyxl
            wb  = openpyxl.load_workbook(str(PAYOR_CONFIG))
            cfg = {}
            for row in wb["Config"].iter_rows(min_row=2, values_only=True):
                if row[0] and row[1] is not None:
                    cfg[str(row[0]).strip()] = str(row[1]).strip()
            branch_prefix = cfg.get("release_branch_prefix") or branch_prefix
        except Exception:
            pass

    clone_dir = _find_clone_dir()
    if not clone_dir:
        print(f"  {red('[error]')}  Could not find local Payor clone.\n"
              f"           Set SRCDIR or GIT_HOME environment variable,\n"
              f"           or run  setbranch  first to initialize the clone.")
        sys.exit(1)

    if not as_json:
        print(f"\n  Payor release branches  {grey(f'(from {clone_dir.name})')}")
        print(f"  Prefix : {grey(branch_prefix)}", end="")
        if version_filter:
            print(f"   Filter : {grey(version_filter + '*')}", end="")
        print()
        print(f"  {'-' * 54}")

    versions = _list_branches(clone_dir, branch_prefix)

    if version_filter:
        versions = [v for v in versions if v.startswith(version_filter)]

    if as_json:
        print(json.dumps([f"{branch_prefix}{v}" for v in versions], indent=2))
        return

    if not versions:
        msg = f"No release branches found" + (f" matching {version_filter!r}" if version_filter else "")
        print(f"  {yellow('[none]')}  {msg}")
    else:
        for v in versions:
            print(f"  {green('*')}  {bold(v)}")
        print()
        print(f"  {green(str(len(versions)))} release branch(es) found.")

    print()


if __name__ == "__main__":
    main()
