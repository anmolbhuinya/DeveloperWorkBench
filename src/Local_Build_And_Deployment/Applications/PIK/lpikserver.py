#!/usr/bin/env python3
"""
lpikserver (localpikserver) — Local PIK Server management tool.

Manages runtime properties inside the running pik-tc Docker container.
The properties file lives at /home/weblogic/domains/healthedge/runtime.properties.

Usage:
  lpikserver list [--filter TEXT] [--json]
  lpikserver get <key>
  lpikserver set <key> <value>
  lpikserver add <key> <value>
  lpikserver del <key>
"""

import argparse
import json
import subprocess
import sys
import tempfile
import os
import re

PROPS_PATH = "/home/weblogic/domains/healthedge/runtime.properties"
CONTAINER_FILTER = "pik-tc"
CFLAGS = 0x08000000 if sys.platform == "win32" else 0


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
            return ""
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


def _parse_props(raw):
    props = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            props[k.strip()] = v.strip()
    return props


def _serialize_props(props):
    return "\n".join(f"{k}={v}" for k, v in sorted(props.items())) + "\n"


def _load(container):
    return _parse_props(_read_props_raw(container))


def _save(container, props):
    _write_props_raw(container, _serialize_props(props))


def cmd_list(args):
    container = _find_container()
    props = _load(container)
    filt = args.filter.lower() if args.filter else ""
    if filt:
        props = {k: v for k, v in props.items() if filt in k.lower() or filt in v.lower()}
    if args.json:
        print(json.dumps({"ok": True, "properties": props, "count": len(props)}))
    else:
        for k, v in sorted(props.items()):
            print(f"{k}={v}")


def cmd_get(args):
    container = _find_container()
    props = _load(container)
    v = props.get(args.key)
    if args.json:
        print(json.dumps({"ok": v is not None, "key": args.key, "value": v}))
    else:
        if v is None:
            print(f"Key '{args.key}' not found"); sys.exit(1)
        print(v)


def cmd_set(args):
    container = _find_container()
    props = _load(container)
    props[args.key] = args.value
    _save(container, props)
    if args.json:
        print(json.dumps({"ok": True, "key": args.key, "value": args.value}))
    else:
        print(f"Set {args.key}={args.value}")


def cmd_add(args):
    container = _find_container()
    props = _load(container)
    props[args.key] = args.value
    _save(container, props)
    if args.json:
        print(json.dumps({"ok": True, "key": args.key, "value": args.value}))
    else:
        print(f"Added {args.key}={args.value}")


def cmd_del(args):
    container = _find_container()
    props = _load(container)
    if args.key not in props:
        if args.json:
            print(json.dumps({"ok": False, "error": f"Key '{args.key}' not found"}))
        else:
            print(f"Key '{args.key}' not found"); sys.exit(1)
        return
    del props[args.key]
    _save(container, props)
    if args.json:
        print(json.dumps({"ok": True, "key": args.key}))
    else:
        print(f"Deleted {args.key}")


def main():
    parser = argparse.ArgumentParser(prog="lpikserver", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true", help="Output JSON")
    sub = parser.add_subparsers(dest="cmd")

    p_list = sub.add_parser("list")
    p_list.add_argument("--filter", default="")
    p_list.add_argument("--json", action="store_true")

    p_get = sub.add_parser("get")
    p_get.add_argument("key")
    p_get.add_argument("--json", action="store_true")

    p_set = sub.add_parser("set")
    p_set.add_argument("key")
    p_set.add_argument("value")
    p_set.add_argument("--json", action="store_true")

    p_add = sub.add_parser("add")
    p_add.add_argument("key")
    p_add.add_argument("value")
    p_add.add_argument("--json", action="store_true")

    p_del = sub.add_parser("del")
    p_del.add_argument("key")
    p_del.add_argument("--json", action="store_true")

    args = parser.parse_args()
    as_json = args.json or (hasattr(args, "json") and args.json)

    try:
        if args.cmd == "list":    cmd_list(args)
        elif args.cmd == "get":   cmd_get(args)
        elif args.cmd == "set":   cmd_set(args)
        elif args.cmd == "add":   cmd_add(args)
        elif args.cmd == "del":   cmd_del(args)
        else:
            parser.print_help()
    except Exception as e:
        if as_json:
            print(json.dumps({"ok": False, "error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
