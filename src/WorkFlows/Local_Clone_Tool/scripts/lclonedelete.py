#!/usr/bin/env python3
"""
lclonedelete.py — lclonedelete command

Delete a clone project entry by project ID.

Usage:
  lclonedelete -pid <project_id>
  lclonedelete --help
"""

import sys
from lclone_client import delete_project


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    pid = None
    i = 0
    while i < len(args):
        if args[i] in ("-pid", "--pid") and i + 1 < len(args):
            pid = args[i + 1]
            i += 2
        else:
            i += 1

    if not pid:
        print("\n  Usage: lclonedelete -pid <project_id>\n")
        sys.exit(1)

    delete_project(pid)


if __name__ == "__main__":
    main()
