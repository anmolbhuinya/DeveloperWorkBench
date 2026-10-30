#!/usr/bin/env python3
"""
get_current_payor_branch.py — getcurrentpayorbranch / getpbranch command

Shows the currently active Payor branch (same source as setbranch uses).

Usage:
  getcurrentpayorbranch
  getpbranch
  getpbranch --json
"""

import sys
import os
import json
import re
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOME = Path.home()

RESET  = "\x1b[0m"
BOLD   = "\x1b[1m"
GREEN  = "\x1b[32m"
GREY   = "\x1b[90m"
RED    = "\x1b[31m"
YELLOW = "\x1b[33m"
CYAN   = "\x1b[36m"

def bold(s):   return f"{BOLD}{s}{RESET}"
def green(s):  return f"{GREEN}{s}{RESET}"
def grey(s):   return f"{GREY}{s}{RESET}"
def red(s):    return f"{RED}{s}{RESET}"
def yellow(s): return f"{YELLOW}{s}{RESET}"
def cyan(s):   return f"{CYAN}{s}{RESET}"


def _read_release_txt(srcdir):
    release_file = Path(srcdir) / "metadata" / "release.txt"
    if not release_file.exists():
        return {}
    result = {}
    for line in release_file.read_text(errors="replace").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            result[k.strip()] = v.strip()
    return result


def main():
    as_json = "--json" in sys.argv[1:]
    if "-h" in sys.argv[1:] or "--help" in sys.argv[1:]:
        print(__doc__); sys.exit(0)

    # Read from ~/.default-branch (written by setbranch / setpbranch)
    default_branch_file = HOME / ".default-branch"
    if default_branch_file.exists():
        branch = default_branch_file.read_text(errors="replace").strip()
    else:
        branch = ""

    # Always derive SRCDIR from the branch in ~/.default-branch so we reflect
    # the latest setpayorbranch call, not the stale process-level SRCDIR env var.
    git_home   = os.environ.get("GIT_HOME", "").strip()
    repo_payor = os.environ.get("REPO_PAYOR", "hrp.payer.core").strip()
    if branch and git_home:
        srcdir = str(Path(git_home) / f"{repo_payor}-{branch}")
    else:
        srcdir = os.environ.get("SRCDIR", "").strip()

    # WL_DOMAIN is set by setpbranch via `setx` (Windows User env var registry entry).
    # Read directly from the registry so we always get the current value, even when
    # the IDP server process was started before the last setpbranch call.
    wl_domain = ""
    try:
        import winreg
        _reg = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment")
        try:
            wl_domain, _ = winreg.QueryValueEx(_reg, "WL_DOMAIN")
            wl_domain = wl_domain.strip()
        finally:
            winreg.CloseKey(_reg)
    except Exception:
        wl_domain = os.environ.get("WL_DOMAIN", "").strip()
    release_ver = ""
    if wl_domain.startswith("healthedge_"):
        release_ver = wl_domain[len("healthedge_"):]

    # Read release.txt for other metadata (tomcat_ver) and as a version fallback.
    release = _read_release_txt(srcdir) if srcdir and Path(srcdir).exists() else {}
    if not release_ver:
        release_ver = release.get("release_ver", "")
    # Last resort: derive from branch name.
    if not release_ver:
        m = re.search(r"(\d+\.\d+(?:\.\d+)*)", branch)
        release_ver = m.group(1) if m else ""
    is_tomcat   = bool(release.get("tomcat_ver", ""))
    env_type    = "Tomcat" if is_tomcat else ("WebLogic" if release else "")

    if as_json:
        print(json.dumps({
            "branch":      branch,
            "release_ver": release_ver,
            "srcdir":      srcdir,
            "env_type":    env_type,
        }, indent=2))
        return

    print()
    if not branch:
        print(f"  {yellow('[none]')}  No active Payor branch found.")
        print(f"           Run  setpbranch <version>  or  setbranch <version>  first.")
        print()
        sys.exit(1)

    print(f"  Current Payor branch : {cyan(bold(branch))}")
    if release_ver:
        print(f"  Release version      : {grey(release_ver)}")
    if env_type:
        print(f"  Environment type     : {grey(env_type)}")
    if srcdir:
        exists = Path(srcdir).exists()
        status = green("exists") if exists else red("not found")
        print(f"  Clone directory      : {grey(srcdir)}  [{status}]")
    print()


if __name__ == "__main__":
    main()
