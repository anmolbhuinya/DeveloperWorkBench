#!/usr/bin/env python3
"""
lclone_client.py — lclonestatus command

Usage:
  lclonestatus                   List all projects (newest first, 10 per page)
  lclonestatus -pid <id>         Show project detail + interactive PR status update
  lclonestatus -p <n>            Page n
  lclonestatus -r                Oldest first
  lclonestatus --help            Show this help
"""

import sys
import os
import openpyxl
from pathlib import Path
from datetime import datetime

TOOL_ROOT  = Path(__file__).resolve().parent.parent
PAGE_SIZE  = 10

# ANSI colour helpers
RESET  = "\x1b[0m"

def bold(s):    return f"\x1b[1m{s}{RESET}"
def dim(s):     return f"\x1b[2m{s}{RESET}"
def green(s):   return f"\x1b[32m{s}{RESET}"
def yellow(s):  return f"\x1b[33m{s}{RESET}"
def cyan(s):    return f"\x1b[36m{s}{RESET}"
def red(s):     return f"\x1b[31m{s}{RESET}"
def grey(s):    return f"\x1b[90m{s}{RESET}"
def white(s):   return f"\x1b[97m{s}{RESET}"


def _status_color(status):
    s = str(status or "").strip().lower()
    if s == "complete":
        return green(status)
    if s == "in progress":
        return cyan(status)
    if "merged" in s:
        return green(status)
    if "raised" in s or "pr raised" in s:
        return yellow(status)
    if "created" in s:
        return cyan(status)
    if "cloned" in s:
        return grey(status)
    return white(status)


def _projects_path(ptype):
    return TOOL_ROOT / "projects" / f"{ptype}_projects.xlsx"


def _find_project_detail_file(project_id):
    """Locate per-project detail file by scanning projects/<pid>_*.xlsx."""
    proj_dir = TOOL_ROOT / "projects"
    for f in sorted(proj_dir.glob(f"{project_id}_*.xlsx")):
        if not f.name.endswith("_projects.xlsx"):
            return str(f)
    return None


def _load_master():
    """Returns {jira_prefix: ptype} derived from project_type_config/*_config.xlsx filenames.
    e.g. payor_config.xlsx -> {"PAYOR": "payor"}
    """
    config_dir = TOOL_ROOT / "project_type_config"
    if not config_dir.exists():
        return {}
    return {
        f.stem[:-len("_config")].upper(): f.stem[:-len("_config")]
        for f in sorted(config_dir.glob("*_config.xlsx"))
    }


def load_all_projects():
    """Return list of row dicts with added 'ptype' key, sorted by project_id desc."""
    master = _load_master()
    if not master:
        return []

    all_rows = []
    for prefix, ptype in master.items():
        path = _projects_path(ptype)
        if not path.exists():
            continue
        wb = openpyxl.load_workbook(str(path))
        if "Projects" not in wb.sheetnames:
            # Old CloneLog format — show as best we can
            if "CloneLog" in wb.sheetnames:
                ws = wb["CloneLog"]
                for row in ws.iter_rows(min_row=2, values_only=True):
                    if not row[0]:
                        continue
                    all_rows.append({
                        "ptype":         ptype,
                        "project_id":    row[0],
                        "ticket_id":     row[1] or "",
                        "parent_ticket": row[3] or "",
                        "payor_version": "",
                        "created_at":    "",
                        "status":        row[5] or "In Progress",
                    })
            continue
        ws = wb["Projects"]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row[0]:
                continue
            all_rows.append({
                "ptype":         ptype,
                "project_id":    row[0],
                "ticket_id":     str(row[1] or ""),
                "parent_ticket": str(row[2] or ""),
                "payor_version": str(row[3] or ""),
                "created_at":    str(row[4] or ""),
                "status":        str(row[5] or "In Progress"),
            })

    all_rows.sort(key=lambda r: r["project_id"], reverse=True)
    return all_rows


def load_project_detail(project_id):
    """Return project detail dict (with from_repo/to_repo) from per-project file, or {}."""
    detail_path = _find_project_detail_file(project_id)
    if not detail_path or not Path(detail_path).exists():
        return {}
    wb = openpyxl.load_workbook(detail_path)
    if "Project" not in wb.sheetnames:
        return {}
    ws = wb["Project"]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] == project_id:
            return {
                "from_repo": str(row[6] or "") if len(row) > 6 else "",
                "to_repo":   str(row[7] or "") if len(row) > 7 else "",
            }
    return {}


def load_prs_for_project(ptype, project_id):
    """Return list of PR row dicts for a given project_id."""
    # Try per-project detail file first
    detail_path = _find_project_detail_file(project_id)
    if detail_path and Path(detail_path).exists():
        wb = openpyxl.load_workbook(detail_path)
    else:
        path = _projects_path(ptype)
        if not path.exists():
            return []
        wb = openpyxl.load_workbook(str(path))
    if "PRs" not in wb.sheetnames:
        return []
    ws   = wb["PRs"]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] == project_id:
            rows.append({
                "project_id":      row[0],
                "pr_index":        row[1],
                "original_pr_url": str(row[2] or ""),
                "original_branch": str(row[3] or ""),
                "clone_branch":    str(row[4] or ""),
                "clone_pr_url":    str(row[5] or ""),
                "pr_status":       str(row[6] or ""),
            })
    rows.sort(key=lambda r: r["pr_index"] or 0)
    return rows


def print_project_list(all_rows, page=1, reverse=False):
    rows = list(all_rows)
    if reverse:
        rows = list(reversed(rows))

    total = len(rows)
    start = (page - 1) * PAGE_SIZE
    end   = start + PAGE_SIZE
    page_rows = rows[start:end]

    print()
    print(bold(white("  Local Clone Projects")))
    print(grey(f"  Total: {total}   Page {page}/{max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)}"))
    print()

    # Header
    ID_W   = 6
    TKT_W  = 18
    PAR_W  = 18
    VER_W  = 12
    TS_W   = 20
    STA_W  = 18
    hdr = (
        "  " +
        dim(f"{'ID':<{ID_W}}") + "  " +
        dim(f"{'TICKET':<{TKT_W}}") + "  " +
        dim(f"{'PARENT':<{PAR_W}}") + "  " +
        dim(f"{'VERSION':<{VER_W}}") + "  " +
        dim(f"{'CREATED':<{TS_W}}") + "  " +
        dim("STATUS")
    )
    print(hdr)
    print("  " + grey("-" * (ID_W + TKT_W + PAR_W + VER_W + TS_W + STA_W + 12)))

    if not page_rows:
        print(grey("  (no projects found)"))
    else:
        for r in page_rows:
            pid_str = str(r["project_id"])
            row_str = (
                "  " +
                bold(f"{pid_str:<{ID_W}}") + "  " +
                cyan(f"{r['ticket_id']:<{TKT_W}}") + "  " +
                f"{r['parent_ticket']:<{PAR_W}}" + "  " +
                f"{r['payor_version']:<{VER_W}}" + "  " +
                grey(f"{r['created_at']:<{TS_W}}") + "  " +
                _status_color(r["status"])
            )
            print(row_str)

    print()
    if total > end:
        remaining = total - end
        print(grey(f"  {remaining} more.  Use  lclonestatus -p {page+1}  for next page."))
    print(grey("  lclonestatus -pid <id>  to view detail + update PR status"))
    print()


def print_project_detail(project_id):
    all_rows = load_all_projects()
    row = next((r for r in all_rows if str(r["project_id"]) == str(project_id)), None)
    if not row:
        print(f"\n  ERROR: No project found with ID '{project_id}'.\n")
        sys.exit(1)

    ptype   = row["ptype"]
    prs     = load_prs_for_project(ptype, row["project_id"])
    detail  = load_project_detail(row["project_id"])

    print()
    print(bold(white(f"  Project #{row['project_id']}  —  {row['ticket_id']}")))
    print(grey("  " + "─" * 62))
    print(f"  {'Ticket':<16}: {cyan(bold(row['ticket_id']))}")
    print(f"  {'Parent Ticket':<16}: {row['parent_ticket'] or grey('(none)')}")
    print(f"  {'Version':<16}: {row['payor_version'] or grey('(unknown)')}")
    print(f"  {'Created':<16}: {grey(row['created_at']) or grey('(unknown)')}")
    print(f"  {'Status':<16}: {_status_color(row['status'])}")
    if detail.get("from_repo"):
        print(f"  {'from_repo':<16}: {grey(detail['from_repo'])}")
    if detail.get("to_repo"):
        print(f"  {'to_repo':<16}: {grey(detail['to_repo'])}")
    print()

    if not prs:
        print(grey("  No PR entries found."))
    else:
        print(bold("  PRs:"))
        print("  " + grey("─" * 62))
        PR_IDX_W  = 4
        BRNCH_W   = 34
        STA_W     = 16
        print(
            "  " + dim(f"{'#':<{PR_IDX_W}}") + "  " +
            dim(f"{'CLONE BRANCH':<{BRNCH_W}}") + "  " + dim("STATUS")
        )
        print("  " + grey("-" * (PR_IDX_W + BRNCH_W + STA_W + 6)))

        for pr in prs:
            idx        = str(pr["pr_index"] or "")
            branch     = pr["clone_branch"] or grey("(not set)")
            status_str = _status_color(pr["pr_status"])
            print(f"  {bold(idx):<{PR_IDX_W+9}}  {branch:<{BRNCH_W}}  {status_str}")
            if pr["original_pr_url"]:
                print(f"  {'':{PR_IDX_W}}    {grey('Original PR:')} {grey(pr['original_pr_url'])}")
            if pr["clone_pr_url"]:
                print(f"  {'':{PR_IDX_W}}    {grey('Clone PR:   ')} {pr['clone_pr_url']}")
            else:
                print(f"  {'':{PR_IDX_W}}    {grey('Clone PR:    (not set)')}")
        print()

    # Interactive status update
    print(grey("  ─────────────────────────────────────────────────────────────"))
    try:
        ans = input("  Update a PR status? Enter PR index, or Enter to skip: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return

    if not ans:
        return

    pr_row = next((p for p in prs if str(p["pr_index"]) == ans), None)
    if not pr_row:
        print(f"  No PR with index '{ans}'.")
        return

    statuses    = ["Cloned", "Branch Created", "PR Raised", "Merged"]
    current_s   = pr_row["pr_status"]
    print(f"\n  PR #{ans}  —  current status: {_status_color(current_s)}")
    for i, s in enumerate(statuses, 1):
        marker = " <─ current" if s == current_s else ""
        print(f"    [{i}] {s}{marker}")
    print(f"    [5] Enter manually")

    try:
        choice = input("  Select status [1-5]: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return

    new_status = None
    if choice in ("1", "2", "3", "4"):
        new_status = statuses[int(choice) - 1]
    elif choice == "5":
        try:
            new_status = input("  New status: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
    else:
        print("  Invalid choice. No update made.")
        return

    if not new_status:
        return

    # Also prompt for clone PR URL if moving to PR Raised/Merged and URL not set
    clone_pr_url = pr_row.get("clone_pr_url", "")
    if new_status in ("PR Raised", "Merged") and not clone_pr_url:
        try:
            clone_pr_url = input("  Enter clone PR URL (optional): ").strip()
        except (EOFError, KeyboardInterrupt):
            clone_pr_url = ""

    _update_pr_status_client(ptype, row["project_id"], int(pr_row["pr_index"]),
                              clone_pr_url or None, new_status)
    _recompute_and_update_project_status(ptype, row["project_id"])

    print(f"\n  PR #{ans} status updated to: {_status_color(new_status)}")
    print()


def _update_pr_status_client(ptype, project_id, pr_index, clone_pr_url, pr_status):
    from openpyxl.styles import Font as XlFont
    _LINK_FONT = XlFont(color="0563C1", underline="single")
    # Try per-project detail file first
    detail_path = _find_project_detail_file(project_id)
    if detail_path and Path(detail_path).exists():
        wb   = openpyxl.load_workbook(detail_path)
        save = detail_path
    else:
        path = _projects_path(ptype)
        if not path.exists():
            return
        wb   = openpyxl.load_workbook(str(path))
        save = str(path)
    if "PRs" not in wb.sheetnames:
        return
    ws = wb["PRs"]
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if (row[0].value == project_id and
                row[1].value is not None and int(row[1].value) == pr_index):
            if clone_pr_url is not None:
                c = ws.cell(i, 6, clone_pr_url)
                if clone_pr_url:
                    c.hyperlink = clone_pr_url
                    c.font      = _LINK_FONT
            ws.cell(i, 7, pr_status)
            break
    try:
        wb.save(save)
    except PermissionError:
        print(f"  Warning: Could not save (file may be open): {save}")


def _recompute_and_update_project_status(ptype, project_id):
    # Read PRs from per-project detail file
    detail_path = _find_project_detail_file(project_id)
    pr_statuses = []
    if detail_path and Path(detail_path).exists():
        wb_det = openpyxl.load_workbook(detail_path)
        if "PRs" in wb_det.sheetnames:
            for row in wb_det["PRs"].iter_rows(min_row=2, values_only=True):
                if row[0] == project_id:
                    pr_statuses.append(str(row[6] or "").strip())
        new_status = "Complete" if (pr_statuses and all(s == "Merged" for s in pr_statuses)) else "In Progress"
        # Update per-project detail file status
        if "Project" in wb_det.sheetnames:
            ws = wb_det["Project"]
            for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
                if row[0].value == project_id:
                    ws.cell(i, 6, new_status)
                    break
        try:
            wb_det.save(detail_path)
        except PermissionError:
            pass
    else:
        # Fallback: shared index
        path = _projects_path(ptype)
        if not path.exists():
            return
        wb_idx = openpyxl.load_workbook(str(path))
        if "PRs" in wb_idx.sheetnames:
            for row in wb_idx["PRs"].iter_rows(min_row=2, values_only=True):
                if row[0] == project_id:
                    pr_statuses.append(str(row[6] or "").strip())
        new_status = "Complete" if (pr_statuses and all(s == "Merged" for s in pr_statuses)) else "In Progress"
        if "Projects" in wb_idx.sheetnames:
            ws = wb_idx["Projects"]
            for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
                if row[0].value == project_id:
                    ws.cell(i, 6, new_status)
                    break
        try:
            wb_idx.save(str(path))
        except PermissionError:
            pass
        return

    # Also update shared index status
    index_path = _projects_path(ptype)
    if index_path.exists():
        wb_idx = openpyxl.load_workbook(str(index_path))
        if "Projects" in wb_idx.sheetnames:
            ws = wb_idx["Projects"]
            for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
                if row[0].value == project_id:
                    ws.cell(i, 6, new_status)
                    break
            try:
                wb_idx.save(str(index_path))
            except PermissionError:
                pass


def delete_project(project_id):
    """Remove a project entry: deletes per-project xlsx and removes rows from shared index."""
    all_rows = load_all_projects()
    row = next((r for r in all_rows if str(r["project_id"]) == str(project_id)), None)
    if not row:
        print(f"\n  ERROR: No project found with ID '{project_id}'.\n")
        sys.exit(1)

    ptype      = row["ptype"]
    ticket_id  = row["ticket_id"]

    print(f"\n  Project #{project_id}  —  {ticket_id}  [{ptype}]")
    try:
        ans = input("  Delete this project? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return
    if ans != "y":
        print("  Cancelled.")
        return

    deleted = []

    # Delete per-project detail file
    detail_path = _find_project_detail_file(project_id)
    if detail_path and Path(detail_path).exists():
        try:
            Path(detail_path).unlink()
            deleted.append(Path(detail_path).name)
        except OSError as e:
            print(f"  Warning: Could not delete {detail_path}: {e}")

    # Remove rows from shared index (Projects + PRs sheets)
    index_path = _projects_path(ptype)
    if index_path.exists():
        wb  = openpyxl.load_workbook(str(index_path))
        changed = False
        for sheet_name in ("Projects", "PRs"):
            if sheet_name not in wb.sheetnames:
                continue
            ws   = wb[sheet_name]
            keep = [list(ws.iter_rows(min_row=1, max_row=1, values_only=True))[0]]
            for r in ws.iter_rows(min_row=2, values_only=True):
                if str(r[0] or "") != str(project_id):
                    keep.append(r)
                else:
                    changed = True
            if changed:
                ws.delete_rows(2, ws.max_row)
                for r in keep[1:]:
                    ws.append(list(r))
        if changed:
            try:
                wb.save(str(index_path))
                deleted.append(f"{ptype}_projects.xlsx (rows removed)")
            except PermissionError:
                print(f"  Warning: Could not save {index_path} (file may be open).")

    if deleted:
        for d in deleted:
            print(f"  Deleted : {d}")
    print(f"  Project #{project_id} removed.\n")


def parse_args(args):
    pid     = None
    page    = 1
    reverse = False
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        elif a in ("-pid", "--pid") and i + 1 < len(args):
            pid = args[i + 1]
            i  += 2
        elif a in ("-p", "--page") and i + 1 < len(args):
            try:
                page = int(args[i + 1])
            except ValueError:
                page = 1
            i += 2
        elif a in ("-r", "--reverse"):
            reverse = True
            i += 1
        else:
            i += 1
    return pid, page, reverse


def main():
    pid, page, reverse = parse_args(sys.argv[1:])

    if pid:
        print_project_detail(pid)
    else:
        all_rows = load_all_projects()
        print_project_list(all_rows, page=page, reverse=reverse)


if __name__ == "__main__":
    main()
