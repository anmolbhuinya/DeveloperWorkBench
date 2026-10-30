#!/usr/bin/env python3
"""
sync_wrappers.py - point every command wrapper at THIS copy of the Developer Workbench

The command wrappers (listwfc, gprun, refresh-payor, startidp, ... both the Windows `.cmd` files and the extension-less
Git Bash scripts) live in  ~/.local/bin  and contain absolute paths. This rewrites any path that points into an older
Developer Workbench / DeveloperPlatform folder so that it points into the folder this script is installed in, and
repairs targets that were moved (e.g. GP_Build/scripts -> WorkFlows/GP_Build/scripts) by locating the file by name.

Usage:  python sync_wrappers.py [--dry-run]
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent            # .../DeveloperWorkBench
BIN = Path.home() / ".local" / "bin"
DRY = "--dry-run" in sys.argv

# <drive path ending in DeveloperPlatform|DeveloperWorkBench>[<tail>]
PATH_RE = re.compile(r'([A-Za-z]:[\\/][^"\'\s%]*?[\\/](?:DeveloperPlatform|DeveloperWorkBench))((?:[\\/][^"\'\s%]*)?)')
SKIP_DIRS = {"python", "node_modules", "__pycache__", ".git"}

_index = None


def index():
    global _index
    if _index is None:
        _index = {}
        for dp, dns, fns in os.walk(ROOT):
            dns[:] = [d for d in dns if d not in SKIP_DIRS]
            for fn in fns:
                _index.setdefault(fn.lower(), []).append(Path(dp).relative_to(ROOT).as_posix() + "/" + fn)
    return _index


def resolve(tail: str):
    """tail: '/Local_Build_And_Deployment/Payor/scripts/x.js' -> an existing relative path (or None)."""
    rel = tail.replace("\\", "/").strip("/")
    if not rel:
        return ""
    if (ROOT / rel).exists():
        return rel
    cands = index().get(rel.rsplit("/", 1)[-1].lower(), [])
    if not cands:
        return None
    want = rel.lower().split("/")

    def score(c):                       # number of trailing path segments shared with the wanted path
        have = c.lower().split("/")
        n = 0
        while n < min(len(have), len(want)) and have[-1 - n] == want[-1 - n]:
            n += 1
        return n
    best = max(cands, key=score)
    return best if score(best) >= 2 or len(cands) == 1 else None


def install_templates():
    """Create / refresh the wrappers shipped in scripts/wrappers/ ({ROOT} = this installation), also on a machine that has none yet."""
    tdir = Path(__file__).resolve().parent / "wrappers"
    if not tdir.is_dir():
        return
    BIN.mkdir(parents=True, exist_ok=True)
    n = 0
    for t in sorted(tdir.iterdir()):
        if not t.is_file():
            continue
        back = t.suffix.lower() in (".cmd", ".bat", ".ps1")          # Windows wrappers use backslashes, bash wrappers '/'
        root = str(ROOT) if back else str(ROOT).replace("\\", "/")
        new = t.read_bytes().decode("utf-8").replace("{ROOT}", root).encode("utf-8")
        dest = BIN / t.name
        if DRY:
            n += 1
        elif not dest.exists() or dest.read_bytes() != new:
            dest.write_bytes(new)
            n += 1
    print(f"wrapper templates: {n} created/updated in {BIN}")


def main():
    BIN.mkdir(parents=True, exist_ok=True)
    install_templates()
    if not BIN.is_dir():
        print(f"no wrapper folder at {BIN} - nothing to do")
        return 0
    changed = same = 0
    missing, eol_fixed = [], []
    for f in sorted(BIN.iterdir()):
        if not f.is_file() or f.name.lower().startswith("claude"):
            continue
        try:
            raw = f.read_bytes()
            text = raw.decode("utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        back = f.suffix.lower() in (".cmd", ".bat", ".ps1")        # Windows wrappers use backslashes, bash wrappers '/'
        if not back and text.startswith("#!") and "\r\n" in text:   # CRLF breaks "#!/usr/bin/env bash" in Git Bash
            text = text.replace("\r\n", "\n")
            if not DRY:
                f.write_bytes(text.encode("utf-8"))
            eol_fixed.append(f.name)
        if not PATH_RE.search(text):
            continue

        def fix(m):
            tail = resolve(m.group(2))
            if tail is None:
                missing.append((f.name, m.group(0)))
                return m.group(0)
            full = str(ROOT) + ("/" + tail if tail else "")
            return full.replace("/", "\\") if back else full.replace("\\", "/")
        new = PATH_RE.sub(fix, text)
        if new == text:
            same += 1
            continue
        changed += 1
        if not DRY:
            f.write_bytes(new.encode("utf-8"))
    print(f"wrappers: {changed} updated, {same} already correct, {len(missing)} with a missing target  (folder: {BIN})")
    if eol_fixed:
        print(f"  line endings fixed (CRLF -> LF) in {len(eol_fixed)} bash wrapper(s): {', '.join(eol_fixed[:8])}{' ...' if len(eol_fixed) > 8 else ''}")
    for n, p in missing:
        print(f"  MISSING TARGET  {n}: {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
