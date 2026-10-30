#!/usr/bin/env python3
"""
set_payor_branch.py — setpbranch command

Sets the active Payor branch, mirroring what setbranch does in PowerShell:
  - Writes ~/.default-branch
  - Writes ~/.release-file-source
  - Sets user env vars: SRCDIR, ANT_HOME, JAVA_HOME, WL_DOMAIN,
    ENVIRONMENT_HOME, BEA_HOME, WL_HOME, DOMAIN_HOME
  - Creates ~/environments/healthedge_<release_ver> directory
  - Creates the domain directory

Note: user env vars take effect in new terminals (same as setbranch behaviour
when called from a different session).

Usage:
  setpbranch <version>      e.g. setpbranch 26.1.1.1
"""

import sys
import os
import subprocess
from pathlib import Path

# Ensure Unicode output works on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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

HOME = Path.home()


def _setx(name, value):
    """Set a user-level persistent environment variable (survives terminal restart)."""
    subprocess.run(
        ["setx", name, str(value)],
        capture_output=True, text=True
    )


def _read_release_txt(srcdir):
    """Parse key=value pairs from metadata/release.txt."""
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
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    version = args[0].strip()
    if not version:
        print(f"  {red('[error]')}  Usage: setpbranch <version>  (e.g. setpbranch 26.1.1.1)")
        sys.exit(1)

    git_home    = os.environ.get("GIT_HOME", "").strip()
    repo_payor  = os.environ.get("REPO_PAYOR", "hrp.payer.core").strip()
    user_profile = os.environ.get("USERPROFILE", str(HOME)).strip()

    if not git_home:
        print(f"  {red('[error]')}  GIT_HOME environment variable is not set.")
        print(f"           Run the initialization script first.")
        sys.exit(1)

    srcdir = Path(git_home) / f"{repo_payor}-{version}"

    print(f"\n  {bold('setpbranch')} — Setting Payor branch to {cyan(version)}\n")

    # ── Validate clone exists ────────────────────────────────────────────────
    if not srcdir.exists():
        print(f"  {red('[error]')}  Clone not found: {srcdir}")
        print(f"           Run  setbranch {version} -clonePayor  in PowerShell to clone it first.")
        sys.exit(1)
    print(f"  {green('[ok]')}     Clone found: {grey(str(srcdir))}")

    # ── Read release.txt ─────────────────────────────────────────────────────
    release = _read_release_txt(srcdir)
    release_ver  = release.get("release_ver", "")
    is_tomcat    = bool(release.get("tomcat_ver", ""))

    if not release_ver:
        print(f"  {yellow('[warn]')}  release_ver not found in metadata/release.txt — using branch version")
        release_ver = version

    env_type = "Tomcat" if is_tomcat else "WebLogic"
    print(f"  {green('[ok]')}     release_ver={grey(release_ver)}  type={grey(env_type)}")

    # ── Write ~/.default-branch ──────────────────────────────────────────────
    default_branch_file = HOME / ".default-branch"
    default_branch_file.write_text(version)
    print(f"  {green('[ok]')}     Wrote ~/.default-branch = {grey(version)}")

    # ── Write ~/.release-file-source ─────────────────────────────────────────
    release_source_file = HOME / ".release-file-source"
    release_source_file.write_text(str(srcdir))
    print(f"  {green('[ok]')}     Wrote ~/.release-file-source")

    # ── Compute paths ────────────────────────────────────────────────────────
    ant_home     = srcdir / "ant" / "ant_1.10.7"
    env_name     = f"healthedge_{release_ver}"
    env_home     = Path(user_profile) / "environments" / env_name

    if is_tomcat:
        java_home   = Path(user_profile) / "HRPSoftwares" / "Java" / "jdk-11.0.28"
        domain_home = Path(user_profile) / "domains" / env_name
        bea_home    = None
        wl_home     = None
    else:
        java_home   = Path(user_profile) / "HRPSoftwares" / "Java" / "jdk-11.0.2"
        bea_home    = Path(user_profile) / "opt" / "oracle" / "wls_14.1.1.0.0"
        wl_home     = bea_home / "wlserver"
        domain_home = bea_home / "user_projects" / "domains" / env_name

    # ── Create directories ───────────────────────────────────────────────────
    env_home.mkdir(parents=True, exist_ok=True)
    print(f"  {green('[ok]')}     Environment dir: {grey(str(env_home))}")

    domain_home.mkdir(parents=True, exist_ok=True)
    print(f"  {green('[ok]')}     Domain dir:      {grey(str(domain_home))}")

    # ── Warn if JAVA_HOME target missing ─────────────────────────────────────
    if not java_home.exists():
        print(f"  {yellow('[warn]')}  JAVA_HOME target not found: {java_home}")
    else:
        print(f"  {green('[ok]')}     JAVA_HOME: {grey(str(java_home))}")

    # ── Set user env vars (persist across terminal restarts) ─────────────────
    print(f"\n  Setting user environment variables...")
    vars_to_set = {
        "SRCDIR":           str(srcdir),
        "ANT_HOME":         str(ant_home),
        "JAVA_HOME":        str(java_home),
        "WL_DOMAIN":        env_name,
        "ENVIRONMENT_HOME": str(env_home),
        "DOMAIN_HOME":      str(domain_home),
    }
    if bea_home:
        vars_to_set["BEA_HOME"] = str(bea_home)
        vars_to_set["WL_HOME"]  = str(wl_home)
    else:
        # Tomcat: clear BEA_HOME and WL_HOME
        vars_to_set["BEA_HOME"] = ""
        vars_to_set["WL_HOME"]  = ""

    for k, v in vars_to_set.items():
        if v:
            _setx(k, v)
        else:
            # setx can't delete — use winreg to remove
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_SET_VALUE)
                try:
                    winreg.DeleteValue(key, k)
                except FileNotFoundError:
                    pass
                winreg.CloseKey(key)
            except Exception:
                pass
        print(f"    {grey(k + ':')} {v if v else grey('(cleared)')}")

    print()
    print(f"  {green(bold('Done!'))}  Branch set to {cyan(version)}")
    print()
    print(f"  {yellow('Note:')} Open a new terminal for env var changes to take effect.")
    print(f"        To also switch the git checkout, run in PowerShell:")
    print(f"        {grey('  setbranch ' + version)}")
    print()


if __name__ == "__main__":
    main()
