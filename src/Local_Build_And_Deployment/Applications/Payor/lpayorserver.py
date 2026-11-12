#!/usr/bin/env python3
"""
lpayorserver (localpayorserver) — Local Payor Server management tool.

Manages runtime properties inside the running payer-tc Docker container.
The properties file lives at /home/weblogic/domains/healthedge/runtime.properties.

Usage:
  lpayorserver list [--filter TEXT] [--json]
  lpayorserver get <key>
  lpayorserver set <key> <value>
  lpayorserver add <key> <value>
  lpayorserver del <key>

All commands output JSON by default when --json is passed or when called from IDP.
Without --json, output is human-readable.
"""

import argparse
import json
import subprocess
import sys
import tempfile
import os
import re

PROPS_PATH = os.environ.get("DWB_RUNTIME_PROPS_PATH") or "/home/weblogic/domains/healthedge/runtime.properties"
CONTAINER_FILTER = "payer-tc"
CFLAGS = 0x08000000 if sys.platform == "win32" else 0


# ── Docker helpers ─────────────────────────────────────────────────────────────

def _find_container():
    r = subprocess.run(
        ["docker", "ps", "--filter", f"name={CONTAINER_FILTER}",
         "--filter", "status=running", "--format", "{{.Names}}"],
        capture_output=True, text=True, creationflags=CFLAGS, timeout=10,
    )
    names = [n.strip() for n in r.stdout.strip().splitlines() if n.strip()]
    if not names:
        raise RuntimeError(f"No running container matching '{CONTAINER_FILTER}' found")
    return names[0]


def _read_props_raw(container):
    r = subprocess.run(
        ["docker", "exec", container, "sh", "-c", f"cat {PROPS_PATH}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=CFLAGS, timeout=15,
    )
    if r.returncode != 0:
        stderr = r.stderr.strip()
        if "No such file or directory" in stderr:
            return ""   # file not created yet — treat as empty
        raise RuntimeError(f"Cannot read {PROPS_PATH}: {stderr}")
    return r.stdout


def _write_props_raw(container, content):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".properties",
                                    delete=False, encoding="utf-8") as f:
        f.write(content)
        tmp = f.name
    try:
        r = subprocess.run(
            ["docker", "cp", tmp, f"{container}:{PROPS_PATH}"],
            capture_output=True, text=True, creationflags=CFLAGS, timeout=15,
        )
        if r.returncode != 0:
            raise RuntimeError(f"docker cp failed: {r.stderr.strip()}")
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass


# ── Properties parsing ─────────────────────────────────────────────────────────

def _parse(raw):
    """Return OrderedDict of key→value from a .properties file."""
    props = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = re.match(r"^([^=]+?)=(.*)$", stripped)
        if m:
            props[m.group(1).strip()] = m.group(2)
    return props


def _update_raw(raw, key, value, mode):
    """
    mode: 'set'   → update existing or append new
          'add'   → fail if key already exists
          'del'   → remove the line entirely

    Returns updated raw string or raises ValueError.
    """
    lines = raw.splitlines(keepends=True)
    key_pat = re.compile(r"^" + re.escape(key) + r"\s*=")
    found = False
    result = []

    for line in lines:
        if key_pat.match(line.strip() if not line.startswith(" ") else line):
            # Be more precise: match from start of stripped line
            stripped = line.strip()
            if key_pat.match(stripped):
                found = True
                if mode == "add":
                    raise ValueError(f"Key already exists: {key}")
                if mode == "del":
                    continue  # skip this line
                # mode == "set" → replace
                indent = len(line) - len(line.lstrip())
                result.append(" " * indent + f"{key}={value}\n")
                continue
        result.append(line)

    if not found:
        if mode == "del":
            raise KeyError(f"Key not found: {key}")
        if mode == "set" or mode == "add":
            # Append at end
            if result and not result[-1].endswith("\n"):
                result.append("\n")
            result.append(f"{key}={value}\n")

    return "".join(result)


# ── Commands ───────────────────────────────────────────────────────────────────

def cmd_list(args):
    container = _find_container()
    raw = _read_props_raw(container)
    props = _parse(raw)
    q = (args.filter or "").lower()
    if q:
        props = {k: v for k, v in props.items()
                 if q in k.lower() or q in v.lower()}
    if args.json:
        _out({"ok": True, "container": container, "properties": props, "count": len(props)})
    else:
        if not props:
            print("(no properties found)")
            return
        max_k = max(len(k) for k in props)
        for k, v in props.items():
            print(f"{k:<{max_k}}  =  {v}")


def cmd_get(args):
    container = _find_container()
    raw = _read_props_raw(container)
    props = _parse(raw)
    key = args.key
    if key not in props:
        if args.json:
            _out({"ok": False, "error": f"Key not found: {key}"})
        else:
            print(f"Key not found: {key}", file=sys.stderr)
        sys.exit(1)
    if args.json:
        _out({"ok": True, "key": key, "value": props[key]})
    else:
        print(props[key])


def cmd_set(args):
    container = _find_container()
    raw = _read_props_raw(container)
    updated = _update_raw(raw, args.key, args.value, "set")
    _write_props_raw(container, updated)
    if args.json:
        _out({"ok": True, "key": args.key, "value": args.value})
    else:
        print(f"Set {args.key}={args.value}")


def cmd_add(args):
    container = _find_container()
    raw = _read_props_raw(container)
    try:
        updated = _update_raw(raw, args.key, args.value, "add")
    except ValueError as e:
        if args.json:
            _out({"ok": False, "error": str(e)})
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    _write_props_raw(container, updated)
    if args.json:
        _out({"ok": True, "key": args.key, "value": args.value})
    else:
        print(f"Added {args.key}={args.value}")


def cmd_del(args):
    container = _find_container()
    raw = _read_props_raw(container)
    try:
        updated = _update_raw(raw, args.key, None, "del")
    except KeyError as e:
        if args.json:
            _out({"ok": False, "error": str(e)})
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    _write_props_raw(container, updated)
    if args.json:
        _out({"ok": True, "key": args.key})
    else:
        print(f"Deleted {args.key}")


def _out(data):
    print(json.dumps(data, ensure_ascii=False))


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="lpayorserver",
        description="Local Payor Server management tool",
    )
    parser.add_argument("--json", action="store_true", help="Output JSON (used by IDP)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List all runtime properties")
    p_list.add_argument("--filter", "-f", default="", help="Case-insensitive filter on key or value")

    p_get = sub.add_parser("get", help="Get a property value")
    p_get.add_argument("key")

    p_set = sub.add_parser("set", help="Set (add or update) a property")
    p_set.add_argument("key")
    p_set.add_argument("value")

    p_add = sub.add_parser("add", help="Add a new property (fails if key exists)")
    p_add.add_argument("key")
    p_add.add_argument("value")

    p_del = sub.add_parser("del", help="Delete a property")
    p_del.add_argument("key")

    args = parser.parse_args()

    # Propagate --json to all subcommands
    if not hasattr(args, "json"):
        args.json = False

    try:
        {"list": cmd_list, "get": cmd_get, "set": cmd_set,
         "add": cmd_add, "del": cmd_del}[args.command](args)
    except Exception as e:
        if args.json:
            _out({"ok": False, "error": str(e)})
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
