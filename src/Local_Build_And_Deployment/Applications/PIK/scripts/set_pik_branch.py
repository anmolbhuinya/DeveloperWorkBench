#!/usr/bin/env python3
"""
set_pik_branch.py — lsetpikbranch command

Sets the active PIK (Portal Integration Kit) branch, mirroring what
setc3branch does for Classic and setbranch/setpbranch does for Payor:
  - Writes ~/.default-pik-branch
  - Sets user env vars: PIKSRCDIR, PIKENV
  - Creates ~/environments/healthedge_<release_ver> directory
  - Auto-clones the repo if the target directory does not exist

Usage:
  lsetpikbranch <version>      e.g. lsetpikbranch 26.1.1.1
  lsetpikbranch master
"""

import sys
import os
import re
import subprocess
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Windows: enable VT100 so ANSI colours work in cmd.exe / PowerShell ──────
if os.name == "nt":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        # ENABLE_PROCESSED_OUTPUT | ENABLE_WRAP_AT_EOL_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING
        # SetConsoleMode returns 0 on failure (e.g. when stdout is not a real console); check it.
        _USE_COLOR = bool(kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7))
    except Exception:
        _USE_COLOR = False
else:
    _USE_COLOR = sys.stdout.isatty()

if os.environ.get("NO_COLOR"):
    _USE_COLOR = False

def _c(code, s):
    return f"\x1b[{code}m{s}\x1b[0m" if _USE_COLOR else s

def bold(s):   return _c("1",  s)
def green(s):  return _c("32", s)
def grey(s):   return _c("90", s)
def red(s):    return _c("31", s)
def yellow(s): return _c("33", s)
def cyan(s):   return _c("36", s)

HOME = Path.home()


def _setx(name, value):
    """Set a user-level persistent environment variable (survives terminal restart)."""
    subprocess.run(
        ["setx", name, str(value)],
        capture_output=True, text=True
    )


def _read_pom_version_prefix(srcdir):
    """Parse version.prefix from pom.xml."""
    pom = Path(srcdir) / "pom.xml"
    if not pom.exists():
        return ""
    text = pom.read_text(errors="replace")
    m = re.search(r'<version\.prefix>([^<]+)</version\.prefix>', text)
    return m.group(1).strip() if m else ""


def _find_remote_url(git_home, repo_name):
    """Return the remote origin URL from an existing clone, or fall back to env / None."""
    # 1. Explicit env override
    env_url = os.environ.get("REPO_PIK_URL", "").strip()
    if env_url:
        return env_url

    # 2. Derive from the master / bare clone if it exists
    for candidate in [repo_name, f"{repo_name}-master"]:
        candidate_dir = Path(git_home) / candidate
        if candidate_dir.is_dir():
            result = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=str(candidate_dir),
                capture_output=True, text=True
            )
            if result.returncode == 0:
                url = result.stdout.strip()
                if url:
                    return url

    return None


def _version_to_git_branch(version):
    """Map user-facing version (e.g. 'r21.6', '26.1') to git branch name ('release-r21.6', 'release-26.1').
    Returns 'master' unchanged."""
    if version == "master":
        return "master"
    return f"release-{version}"


def _clone_repo(remote_url, target_dir, git_branch):
    """Clone remote_url into target_dir, checking out git_branch (e.g. 'release-r21.6')."""
    print(f"  {yellow('[clone]')}  Cloning {grey(remote_url)}")
    print(f"           -> {grey(str(target_dir))}")
    print(f"           branch: {grey(git_branch)}")

    cmd = ["git", "clone", remote_url, str(target_dir), "--branch", git_branch, "--no-single-branch"]
    result = subprocess.run(cmd, text=True)
    if result.returncode != 0:
        print(f"  {yellow('[warn]')}   --branch {git_branch} failed; retrying without branch filter...")
        cmd_plain = ["git", "clone", remote_url, str(target_dir)]
        result2 = subprocess.run(cmd_plain, text=True)
        if result2.returncode != 0:
            print(f"  {red('[error]')}  git clone failed (exit {result2.returncode}).")
            return False
        co = subprocess.run(
            ["git", "checkout", git_branch],
            cwd=str(target_dir), text=True
        )
        if co.returncode != 0:
            print(f"  {yellow('[warn]')}   Could not checkout {git_branch}; left on default branch.")
    return True


def main():
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    version = args[0].strip()
    if not version:
        print(f"  {red('[error]')}  Usage: lsetpikbranch <version>  (e.g. lsetpikbranch 26.1.1.1)")
        sys.exit(1)

    git_home     = os.environ.get("GIT_HOME", "").strip()
    repo_pik     = os.environ.get("REPO_PIK", "hrp.portal.integration.kit").strip()
    user_profile = os.environ.get("USERPROFILE", str(HOME)).strip()

    if not git_home:
        print(f"  {red('[error]')}  GIT_HOME environment variable is not set.")
        print(f"           Run the initialization script first.")
        sys.exit(1)

    # ── Locate or create clone ───────────────────────────────────────────────
    if version == "master":
        candidate_a = Path(git_home) / repo_pik
        candidate_b = Path(git_home) / f"{repo_pik}-master"
        srcdir = candidate_a if candidate_a.exists() else candidate_b
    else:
        srcdir = Path(git_home) / f"{repo_pik}-{version}"

    print(f"\n  {bold('lsetpikbranch')} — Setting PIK branch to {cyan(version)}\n")

    if not srcdir.exists():
        print(f"  {yellow('[info]')}   Clone not found: {grey(str(srcdir))}")
        remote_url = _find_remote_url(git_home, repo_pik)
        if not remote_url:
            print(f"  {red('[error]')}  Cannot determine remote URL.")
            print(f"           Set REPO_PIK_URL env var or ensure a master clone exists in {git_home}.")
            sys.exit(1)

        cloned = _clone_repo(remote_url, srcdir, _version_to_git_branch(version))
        if not cloned or not srcdir.exists():
            print(f"  {red('[error]')}  Clone failed — directory still missing: {srcdir}")
            sys.exit(1)
        print(f"  {green('[ok]')}     Cloned to: {grey(str(srcdir))}")
    else:
        print(f"  {green('[ok]')}     Clone found: {grey(str(srcdir))}")

    # ── Read version.prefix from pom.xml ─────────────────────────────────────
    release_ver = _read_pom_version_prefix(srcdir)
    if not release_ver:
        print(f"  {yellow('[warn]')}  version.prefix not found in pom.xml — using branch version")
        release_ver = version
    print(f"  {green('[ok]')}     release_ver = {grey(release_ver)}")

    # ── Write ~/.default-pik-branch ──────────────────────────────────────────
    default_pik_branch_file = HOME / ".default-pik-branch"
    default_pik_branch_file.write_text(version)
    print(f"  {green('[ok]')}     Wrote ~/.default-pik-branch = {grey(version)}")

    # ── Compute paths ────────────────────────────────────────────────────────
    env_name = f"healthedge_{release_ver}"
    pik_env  = Path(user_profile) / "environments" / env_name

    # ── Create environment directory ─────────────────────────────────────────
    pik_env.mkdir(parents=True, exist_ok=True)
    print(f"  {green('[ok]')}     Environment dir: {grey(str(pik_env))}")

    # ── Set user env vars (persist across terminal restarts) ─────────────────
    print(f"\n  Setting environment variables...")
    vars_to_set = {
        "PIKSRCDIR": str(srcdir),
        "PIKENV":    str(pik_env),
    }
    for k, v in vars_to_set.items():
        _setx(k, v)
        print(f"    {grey(k + ':')} {v}")

    print()
    print(f"  {green(bold('Done!'))}  PIK branch set to {cyan(version)}")
    print()
    print(f"  {yellow('Note:')} Open a new terminal for env var changes to take effect.")
    print()


if __name__ == "__main__":
    main()
