#!/usr/bin/env python3
"""
puc_status.py — pucstatus command

Show Payor Utils Certification project history.

Usage:
  pucstatus                    List latest 10 projects (newest first)
  pucstatus -r                 List oldest first
  pucstatus -p <n>             Go to page n
  pucstatus -pid <project_id>  Show live detail for one project
  pucstatus --help
"""

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import io
import threading
from pathlib import Path
import openpyxl

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Jenkins_Payor_Utils_Certification"        # project data: <DWB>\DWB_Projects\WorkFlows\Jenkins_Payor_Utils_Certification
DATA_ROOT.mkdir(parents=True, exist_ok=True)
WORKFLOWS_ROOT = TOOL_ROOT.parent
SECRETS_PATH   = WORKFLOWS_ROOT.parent / "secrets.xlsx"
PROJECTS_PATH  = DATA_ROOT / "projects.xlsx"

PAGE_SIZE = 10

_eta_cache_lock = threading.Lock()

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"
def hyperlink(url, label=None):
    return f"\x1b]8;;{url}\x1b\\{cyan(bold(label or url))}\x1b]8;;\x1b\\"

_STATUS_COLOR = {
    "SUCCESS": green, "PASSED": green,
    "FAILURE": red,   "FAILED": red,
    "ABORTED": yellow, "UNSTABLE": yellow,
    "RUNNING": cyan,  "TRIGGERED": cyan, "SCHEDULED": cyan,
    "TRIGGER FAILED": red,
}


def _color_status(s):
    return _STATUS_COLOR.get(s.upper(), white)(s)


def _pad(s, w):
    s = str(s)
    return s[:w].ljust(w)


def load_secrets() -> dict:
    if not SECRETS_PATH.exists():
        return {}
    wb = openpyxl.load_workbook(str(SECRETS_PATH))
    if "Jenkins" not in wb.sheetnames:
        return {}
    out = {}
    for row in wb["Jenkins"].iter_rows(min_row=2, values_only=True):
        if row[0] and row[1] is not None:
            out[str(row[0]).strip()] = str(row[1]).strip() if row[1] else ""
    return out


def _resolve_queue_item(queue_url, auth):
    try:
        import requests
        resp = requests.get(queue_url.rstrip('/') + "/api/json", auth=auth, timeout=10)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            return ""
        exe = resp.json().get("executable")
        if exe and exe.get("url"):
            return exe["url"].rstrip('/') + "/"
        return ""
    except Exception:
        return ""


def _poll_build_status(build_url, auth) -> str:
    try:
        import requests
        resp = requests.get(build_url.rstrip('/') + "/api/json?tree=result,building",
                            auth=auth, timeout=10)
        if resp.status_code != 200:
            return ""
        data = resp.json()
        return data.get("result") or ("RUNNING" if data.get("building") else "")
    except Exception:
        return ""


def _poll_build_info(build_url, auth) -> dict:
    """Returns {status, start_ms, est_ms} — start_ms and est_ms may be None."""
    try:
        import requests
        resp = requests.get(
            build_url.rstrip('/') + "/api/json?tree=result,building,timestamp,estimatedDuration",
            auth=auth, timeout=10)
        if resp.status_code != 200:
            return {}
        data   = resp.json()
        status = data.get("result") or ("RUNNING" if data.get("building") else "")
        return {
            "status":  status,
            "start_ms": data.get("timestamp"),
            "est_ms":   data.get("estimatedDuration"),
        }
    except Exception:
        return {}


def _load_eta_cache() -> dict:
    path = TOOL_ROOT / "eta_cache.json"
    if not path.exists():
        return {}
    with _eta_cache_lock:
        try:
            import json
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}


def _save_eta_cache(cache: dict):
    import json
    path = TOOL_ROOT / "eta_cache.json"
    with _eta_cache_lock:
        try:
            path.write_text(json.dumps(cache, indent=2), encoding="utf-8")
        except Exception:
            pass


def _update_project(pid, status, build_url):
    if not PROJECTS_PATH.exists():
        return
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i for i, h in enumerate(headers, 1)}
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value or "").strip() == str(pid).strip():
            if "status"    in col_map: row[col_map["status"]    - 1].value = status
            if "build_url" in col_map: row[col_map["build_url"] - 1].value = build_url
            break
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        pass


def _load_projects():
    if not PROJECTS_PATH.exists():
        return []
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i - 1 for i, h in enumerate(headers, 1)}
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        rows.append({h: str(row[i] or "").strip() for h, i in col_map.items()})
    return rows


def print_list(reverse=False, page=1):
    rows = _load_projects()
    if not rows:
        print("\n  No projects yet. Run  puc -payor <version>  to start.\n")
        return

    # Sort by pid numeric
    def pid_key(r):
        try:
            return int(r.get("pid", 0))
        except ValueError:
            return 0

    rows.sort(key=pid_key, reverse=not reverse)

    total     = len(rows)
    last_page = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page      = max(1, min(page, last_page))
    start     = (page - 1) * PAGE_SIZE
    page_rows = rows[start:start + PAGE_SIZE]
    r_flag    = " -r" if reverse else ""

    PID_W, VER_W, JN_W, ST_W, TS_W = 4, 12, 28, 16, 22
    print(f"\n  Payor Utils Certification - Projects  (page {page}/{last_page}, {total} total)\n")
    print(
        "  " + bold(_pad("PID",  PID_W)) + "  " +
        bold(_pad("VERSION",     VER_W)) + "  " +
        bold(_pad("JOB",         JN_W))  + "  " +
        bold(_pad("STATUS",      ST_W))  + "  " +
        bold(_pad("TRIGGERED AT",TS_W))
    )
    print("  " + grey("-" * (PID_W + VER_W + JN_W + ST_W + TS_W + 8)))

    for r in page_rows:
        status_str = _color_status(r.get("status", ""))
        print(
            "  " + _pad(r.get("pid", ""),          PID_W) + "  " +
            _pad(r.get("payor_version", ""),        VER_W) + "  " +
            _pad(r.get("job_name", ""),             JN_W)  + "  " +
            _pad(status_str,                        ST_W + 10) + "  " +
            _pad(r.get("triggered_at", "")[:19],    TS_W)
        )

    print()
    if page > 1:
        print(grey(f"  pucstatus{r_flag} -p {page - 1}  -> previous page"))
    if page < last_page:
        print(grey(f"  pucstatus{r_flag} -p {page + 1}  -> next page"))
    print(grey("  pucstatus -pid <id>  -> live Jenkins status for a specific project"))
    print()


def print_detail(pid_str, secrets):
    rows = _load_projects()
    row  = next((r for r in rows if r.get("pid", "") == str(pid_str)), None)
    if not row:
        print(f"\n  ERROR: Project #{pid_str} not found in projects.xlsx.\n")
        sys.exit(1)

    username = secrets.get("jenkins_username", "")
    password = secrets.get("jenkins_password", "") or secrets.get("jenkins_api_token", "")
    auth     = (username, password) if username and password else None

    status    = row.get("status", "")
    build_url = row.get("build_url", "")
    queue_url = row.get("queue_url", "")

    # Resolve queue → build URL if needed
    if not build_url and queue_url and auth:
        resolved = _resolve_queue_item(queue_url, auth)
        if resolved:
            build_url = resolved

    # Poll live status
    if build_url and auth:
        live = _poll_build_status(build_url, auth)
        if live:
            status = live
            _update_project(pid_str, status, build_url)

    print(f"\n  Payor Utils Certification - Project #{pid_str}")
    print(f"  {'-' * 54}")
    print(f"  {'PID':<22}: {row.get('pid', '')}")
    print(f"  {'Payor version':<22}: {bold(row.get('payor_version', ''))}")
    print(f"  {'Job name':<22}: {row.get('job_name', '')}")
    print(f"  {'Triggered at':<22}: {row.get('triggered_at', '')}")
    print(f"  {'Status':<22}: {_color_status(status)}")
    print(f"  {'Queue URL':<22}: {grey(queue_url) if queue_url else grey('-')}")
    if build_url:
        print(f"  {'Build URL':<22}: {hyperlink(build_url)}")
    else:
        print(f"  {'Build URL':<22}: {grey('-')}")
    notes = row.get("notes", "")
    if notes:
        print(f"  {'Notes':<22}: {grey(notes)}")
    print()


def parse_args():
    argv = sys.argv[1:]
    pid, reverse, page = None, False, 1
    i = 0
    while i < len(argv):
        if argv[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif argv[i] in ("-pid", "--pid") and i + 1 < len(argv):
            pid = argv[i + 1]; i += 2
        elif argv[i] in ("-r", "--reverse"):
            reverse = True; i += 1
        elif argv[i] in ("-p", "--page") and i + 1 < len(argv):
            try:
                page = max(1, int(argv[i + 1]))
            except ValueError:
                pass
            i += 2
        else:
            i += 1
    return {"pid": pid, "reverse": reverse, "page": page}


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    args    = parse_args()
    secrets = load_secrets()

    if args["pid"] is not None:
        print_detail(args["pid"], secrets)
    else:
        print_list(reverse=args["reverse"], page=args["page"])


if __name__ == "__main__":
    main()
