#!/usr/bin/env python3
"""
rvmsetupstatus.py — rvmsetupstatus command

Show remote VM setup history.

Usage:
  rvmsetupstatus                      List all projects (newest first) with cached ETA
  rvmsetupstatus -refresh             Fetch live Jenkins status for all active projects
  rvmsetupstatus -pid <project_id>    Show detail for one project; fetch live ETA if running
  rvmsetupstatus -ip <ip>             Show full run history for a specific server
  rvmsetupstatus --help
"""

import sys
import re
import time
import json
from pathlib import Path
import openpyxl

try:
    import requests as _requests
except ImportError:
    _requests = None

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "Remote_Setup"        # project data: <DWB>\Projects\Remote_Setup
DATA_ROOT.mkdir(parents=True, exist_ok=True)
SERVERS_DIR   = DATA_ROOT / "configured_servers"
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"
SECRETS_PATH  = TOOL_ROOT.parent / "secrets.xlsx"
ETA_CACHE_PATH = TOOL_ROOT / "eta_cache.json"

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"
def dim(s):    return f"\x1b[2m{s}{RESET}"

_ACTIVE_STATUSES = {"triggered", "running", "queued", "building"}


def _status_color(status):
    s = str(status or "").lower()
    if s in _ACTIVE_STATUSES:          return green(status)
    if "pass" in s or "success" in s:  return green(status)
    if "fail" in s:                    return yellow(status)
    if "cancel" in s or "abort" in s:  return grey(status)
    return white(status)


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

def _load_secrets():
    if not SECRETS_PATH.exists():
        return {}
    wb   = openpyxl.load_workbook(str(SECRETS_PATH))
    data = {}
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                data[str(row[0]).strip()] = str(row[1]).strip()
    return data


# ---------------------------------------------------------------------------
# ETA cache (JSON sidecar)
# ---------------------------------------------------------------------------

def _load_eta_cache():
    if not ETA_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(ETA_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_eta_cache(updates):
    cache = _load_eta_cache()
    cache.update(updates)
    try:
        ETA_CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"  Warning: Could not save eta_cache.json — {e}")


# ---------------------------------------------------------------------------
# Server file helpers (for -ip detail view)
# ---------------------------------------------------------------------------

def _all_server_files():
    return sorted(SERVERS_DIR.glob("server_*_conf.xlsx"))


def _ip_from_path(path):
    name  = path.stem                # server_10_0_0_1_conf
    parts = name.split("_")          # ['server', '10', '0', '0', '1', 'conf']
    return ".".join(parts[1:-1])     # '10.0.0.1'


def _load_runs(path):
    wb = openpyxl.load_workbook(str(path))
    if "Setups" not in wb.sheetnames:
        return [], []
    ws      = wb["Setups"]
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    runs    = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            runs.append(dict(zip(headers, row)))
    return headers, runs


STD_COLS = {"pid", "timestamp", "vm_name", "vm_ip", "status", "queue_url"}


# ---------------------------------------------------------------------------
# Projects helpers
# ---------------------------------------------------------------------------

def _load_projects():
    if not PROJECTS_PATH.exists():
        return []
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    rows    = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            rows.append(dict(zip(headers, row)))
    return rows


def _load_projects_with_eta():
    projects = _load_projects()
    cache    = _load_eta_cache()
    for p in projects:
        timing       = cache.get(str(p.get("pid", "")), {})
        p["_start_ms"] = timing.get("start_ms")
        p["_est_ms"]   = timing.get("est_ms")
    return list(reversed(projects))  # newest first


def _find_project(pid):
    for r in _load_projects():
        if str(r.get("pid", "")).strip() == str(pid).strip():
            return r
    return None


def _update_project_fields(pid, **fields):
    """Update arbitrary columns in projects.xlsx for a given pid. fields: col_name=value."""
    if not PROJECTS_PATH.exists() or not fields:
        return
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
    pid_col = next((i for i, h in enumerate(headers, 1) if h == "pid"), None)
    if not pid_col:
        return
    col_map = {name: next((i for i, h in enumerate(headers, 1) if h == name), None)
               for name in fields}
    for row in ws.iter_rows(min_row=2):
        if str(row[pid_col - 1].value or "").strip() == str(pid).strip():
            for name, col in col_map.items():
                if col:
                    row[col - 1].value = fields[name]
            break
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print(f"  Warning: Could not save projects.xlsx (file may be open).")


def _update_project_status(pid, new_status):
    _update_project_fields(pid, status=new_status)


def _batch_update_projects(updates_map):
    """Batch-update projects.xlsx. updates_map: {pid_str: {col_name: value, ...}}"""
    if not updates_map or not PROJECTS_PATH.exists():
        return
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
    pid_col = next((i for i, h in enumerate(headers, 1) if h == "pid"), None)
    if not pid_col:
        return
    col_index = {h: i for i, h in enumerate(headers, 1)}
    for row in ws.iter_rows(min_row=2):
        pid_val = str(row[pid_col - 1].value or "").strip()
        if pid_val in updates_map:
            for col_name, val in updates_map[pid_val].items():
                col = col_index.get(col_name)
                if col:
                    row[col - 1].value = val
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print(f"  Warning: Could not save projects.xlsx (file may be open).")


# ---------------------------------------------------------------------------
# Jenkins live status + ETA
# ---------------------------------------------------------------------------

def _is_build_url(url):
    """True when url points to a specific build number, e.g. .../job/name/1229/"""
    u = str(url or "")
    return bool(re.search(r'/\d+/?$', u)) and "buildWithParameters" not in u


def _fetch_build_info(jenkins_url, queue_url, secrets):
    """Return Jenkins build info dict.  Prefers direct build URL; falls back to queue resolution."""
    if _requests is None:
        return {}
    username  = secrets.get("jenkins_username", "")
    api_token = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth      = (username, api_token) if username and api_token else None

    build_url     = None
    resolved_from = None   # "direct" or "queue"

    if _is_build_url(jenkins_url):
        build_url     = jenkins_url
        resolved_from = "direct"
    elif queue_url:
        try:
            r = _requests.get(queue_url.rstrip("/") + "/api/json", auth=auth, timeout=10)
            if r.status_code == 200:
                exe = r.json().get("executable") or {}
                url = exe.get("url")
                if url:
                    build_url     = url
                    resolved_from = "queue"
        except Exception:
            pass

    if not build_url:
        return {}

    try:
        r = _requests.get(
            build_url.rstrip("/") + "/api/json",
            auth=auth, timeout=10,
            params={"tree": "result,building,timestamp,estimatedDuration"},
        )
        if r.status_code == 200:
            data = r.json()
            data["_build_url"]     = build_url
            data["_resolved_from"] = resolved_from
            return data
    except Exception:
        pass
    return {}


def _eta_str(start_ms, est_ms):
    try:
        now_s = time.time()
        if est_ms and int(est_ms) > 0:
            remaining = (int(start_ms) + int(est_ms)) / 1000 - now_s
            if remaining < 0:
                return yellow("overdue")
            total_m, s = divmod(int(remaining), 60)
            if total_m >= 60:
                h, m = divmod(total_m, 60)
                return f"{h}h {m}m"
            return f"{total_m}m {s:02d}s"
        else:
            elapsed_s = int(now_s - int(start_ms) / 1000)
            total_m, s = divmod(elapsed_s, 60)
            if total_m >= 60:
                h, m = divmod(total_m, 60)
                return grey(f"+{h}h {m}m")
            return grey(f"+{total_m}m {s:02d}s")
    except Exception:
        return grey("—")


def _row_eta(project):
    if str(project.get("status", "") or "").lower() not in _ACTIVE_STATUSES:
        return grey("—")
    start_ms = project.get("_start_ms")
    est_ms   = project.get("_est_ms")
    if not start_ms:
        return grey("—")
    return _eta_str(start_ms, est_ms)


# ---------------------------------------------------------------------------
# Print: project list (default)
# ---------------------------------------------------------------------------

_COL = {"pid": 4, "vm": 20, "ip": 16, "time": 20, "status": 12, "eta": 9}


def _visible_len(s):
    import re
    s = re.sub(r'\x1b\[[0-9;]*[mK]', '', s)
    s = re.sub(r'\x1b\][^\x07]*\x07', '', s)
    return len(s)


def _pad(s, w):
    vl = _visible_len(s)
    return s + " " * max(0, w - vl)


def print_project_list():
    projects = _load_projects_with_eta()
    print()
    print(bold(white("  Remote Server Setup Projects")))
    print()

    if not projects:
        print(grey("  No projects found."))
        print(grey("  Run  remotesetup  to trigger a server setup."))
        print()
        return

    header = (
        "  " +
        _pad(dim("PID"),    _COL["pid"])    + "  " +
        _pad(dim("VM"),     _COL["vm"])     + "  " +
        _pad(dim("IP"),     _COL["ip"])     + "  " +
        _pad(dim("TIME"),   _COL["time"])   + "  " +
        _pad(dim("STATUS"), _COL["status"]) + "  " +
        dim("ETA")
    )
    print(header)
    print("  " + grey("-" * (_visible_len(header) - 2)))

    for p in projects:
        pid    = str(p.get("pid",       "") or "")
        vm     = str(p.get("vm_name",   "") or "")
        ip     = str(p.get("vm_ip",     "") or "")
        ts     = str(p.get("timestamp", "") or "")
        status = str(p.get("status",    "") or "")

        vm_disp = vm[:_COL["vm"] - 1] + "…" if len(vm) > _COL["vm"] else vm

        print(
            "  " +
            _pad(cyan(pid),               _COL["pid"])    + "  " +
            _pad(vm_disp,                 _COL["vm"])     + "  " +
            _pad(grey(ip),                _COL["ip"])     + "  " +
            _pad(grey(ts),                _COL["time"])   + "  " +
            _pad(_status_color(status),   _COL["status"]) + "  " +
            _row_eta(p)
        )

    print()
    print(grey("  Tips:  rvmsetupstatus -refresh          update Jenkins + ETA for active projects"))
    print(grey("         rvmsetupstatus -pid <project_id>  detail + live ETA for one project\n"))


# ---------------------------------------------------------------------------
# Refresh: fetch all active projects from Jenkins
# ---------------------------------------------------------------------------

def refresh_projects():
    projects = _load_projects()
    active   = [p for p in projects if str(p.get("status", "") or "").lower() in _ACTIVE_STATUSES]

    print()
    print(bold(white("  Remote Server Setup Projects  —  Refreshing...\n")))

    if not active:
        print(grey("  No active projects to refresh."))
        print()
        _print_table_after_refresh(_load_projects_with_eta())
        return

    secrets     = _load_secrets()
    updates_map = {}   # pid_str → {col: value, ...}  (batch save to projects.xlsx)
    eta_map     = {}   # pid_str → {start_ms, est_ms}

    for p in active:
        pid         = str(p.get("pid",         "") or "")
        vm_name     = str(p.get("vm_name",     "") or "")
        jenkins_url = str(p.get("jenkins_url", "") or "")
        queue_url   = str(p.get("queue_url",   "") or "")

        print(f"  Checking #{pid}  {vm_name}...", end="  ", flush=True)
        build_info = _fetch_build_info(jenkins_url, queue_url, secrets)

        if not build_info:
            print(grey("no data"))
            continue

        building      = build_info.get("building", False)
        result        = build_info.get("result", "")
        start_ms      = build_info.get("timestamp")
        est_ms        = build_info.get("estimatedDuration")
        resolved_url  = build_info.get("_build_url", "")
        resolved_from = build_info.get("_resolved_from", "")

        row_updates = {}
        # Persist resolved build URL if we got it via queue (jenkins_url was wrong)
        if resolved_from == "queue" and resolved_url:
            row_updates["jenkins_url"] = resolved_url

        if building:
            eta = _eta_str(start_ms, est_ms) if start_ms else grey("—")
            print(f"{green('Running')}  ETA {eta}")
            row_updates["status"] = "Running"
            if start_ms is not None:
                eta_map[pid] = {"start_ms": start_ms, "est_ms": est_ms}
        else:
            new_status = {
                "SUCCESS":  "Passed",
                "FAILURE":  "Failed",
                "ABORTED":  "Cancelled",
                "UNSTABLE": "Unstable",
            }.get(result, result or "Unknown")
            print(_status_color(new_status))
            row_updates["status"] = new_status

        if row_updates:
            updates_map[pid] = row_updates

    if updates_map:
        _batch_update_projects(updates_map)
    if eta_map:
        _save_eta_cache(eta_map)

    print()
    _print_table_after_refresh(_load_projects_with_eta())


def _print_table_after_refresh(projects):
    if not projects:
        return

    header = (
        "  " +
        _pad(dim("PID"),    _COL["pid"])    + "  " +
        _pad(dim("VM"),     _COL["vm"])     + "  " +
        _pad(dim("IP"),     _COL["ip"])     + "  " +
        _pad(dim("TIME"),   _COL["time"])   + "  " +
        _pad(dim("STATUS"), _COL["status"]) + "  " +
        dim("ETA")
    )
    print(header)
    print("  " + grey("-" * (_visible_len(header) - 2)))

    for p in projects:
        pid    = str(p.get("pid",       "") or "")
        vm     = str(p.get("vm_name",   "") or "")
        ip     = str(p.get("vm_ip",     "") or "")
        ts     = str(p.get("timestamp", "") or "")
        status = str(p.get("status",    "") or "")
        vm_disp = vm[:_COL["vm"] - 1] + "…" if len(vm) > _COL["vm"] else vm

        print(
            "  " +
            _pad(cyan(pid),               _COL["pid"])    + "  " +
            _pad(vm_disp,                 _COL["vm"])     + "  " +
            _pad(grey(ip),                _COL["ip"])     + "  " +
            _pad(grey(ts),                _COL["time"])   + "  " +
            _pad(_status_color(status),   _COL["status"]) + "  " +
            _row_eta(p)
        )
    print()


# ---------------------------------------------------------------------------
# Print: server detail (by IP)
# ---------------------------------------------------------------------------

def print_server_detail(ip):
    ip_file = ip.replace(".", "_")
    path    = SERVERS_DIR / f"server_{ip_file}_conf.xlsx"
    if not path.exists():
        print(f"\n  ERROR: No config file found for IP '{ip}'.")
        print(f"  Expected: configured_servers/{path.name}\n")
        sys.exit(1)

    headers, runs = _load_runs(path)
    param_cols    = [h for h in (headers or []) if h and str(h) not in STD_COLS]

    print()
    print(bold(white(f"  Setup History — {ip}")))
    print(grey(f"  {'─' * 60}"))
    print(f"  {len(runs)} run(s) recorded\n")

    if not runs:
        print(grey("  No runs yet."))
        print()
        return

    for run in reversed(runs):
        run_id  = run.get("pid",        "")
        ts      = run.get("timestamp",  "")
        status  = run.get("status",     "")
        vm_name = run.get("vm_name",    "")
        vm_ip   = run.get("vm_ip",      "")
        q_url   = run.get("queue_url",  "")

        print(f"  Run #{bold(str(run_id))}  {grey(str(ts))}  {_status_color(str(status))}")
        if vm_name:
            print(f"    {'VM':<28} : {vm_name}  {grey(str(vm_ip))}")
        if q_url:
            print(f"    {'Queue URL':<28} : {grey(str(q_url))}")
        for col in param_cols:
            val = run.get(col, "")
            if val:
                print(f"    {str(col):<28} : {val}")
        print()


# ---------------------------------------------------------------------------
# Print: project detail by PID (with live ETA)
# ---------------------------------------------------------------------------

def print_project_detail(pid):
    project = _find_project(pid)
    if not project:
        print(f"\n  ERROR: Project #{pid} not found in projects.xlsx.\n")
        sys.exit(1)

    vm_name     = str(project.get("vm_name",     "") or "")
    vm_ip       = str(project.get("vm_ip",       "") or "")
    status      = str(project.get("status",      "") or "")
    ts          = str(project.get("timestamp",   "") or "")
    jenkins_url = str(project.get("jenkins_url", "") or "")
    queue_url   = str(project.get("queue_url",   "") or "")
    config_file = str(project.get("config_file", "") or "")

    print()
    print(bold(white(f"  Project #{pid}")))
    print(grey(f"  {'─' * 56}"))
    print(f"  {'VM':<20} : {bold(vm_name)}  {grey(vm_ip)}")
    print(f"  {'Time':<20} : {grey(ts)}")
    print(f"  {'Status':<20} : {_status_color(status)}")

    if status.lower() in _ACTIVE_STATUSES:
        print(f"\n  Fetching live status from Jenkins...")
        secrets    = _load_secrets()
        build_info = _fetch_build_info(jenkins_url, queue_url, secrets)
        if build_info:
            building      = build_info.get("building", False)
            result        = build_info.get("result", "")
            start_ms      = build_info.get("timestamp")
            est_ms        = build_info.get("estimatedDuration")
            resolved_url  = build_info.get("_build_url", "")
            resolved_from = build_info.get("_resolved_from", "")

            # If we resolved the build URL via queue, persist it
            if resolved_from == "queue" and resolved_url:
                _update_project_fields(pid, jenkins_url=resolved_url)
                jenkins_url = resolved_url
                print(f"  {'Build URL':<20} : {grey(resolved_url)}  {grey('(saved)')}")

            if building:
                eta = _eta_str(start_ms, est_ms) if start_ms else grey("—")
                print(f"  {'Live Status':<20} : {green('Running')}")
                print(f"  {'ETA':<20} : {eta}")
                if start_ms is not None:
                    _save_eta_cache({str(pid): {"start_ms": start_ms, "est_ms": est_ms}})
            else:
                live_status = {
                    "SUCCESS":  "Passed",
                    "FAILURE":  "Failed",
                    "ABORTED":  "Cancelled",
                    "UNSTABLE": "Unstable",
                }.get(result, result or "Unknown")
                print(f"  {'Live Status':<20} : {_status_color(live_status)}")
                _update_project_status(pid, live_status)
                print(f"  {grey('(status updated in projects.xlsx)')}")
        else:
            print(f"  {grey('Could not fetch live status from Jenkins.')}")
            print(f"  {grey('Try updating jenkins_url in projects.xlsx to the specific build URL.')}")

    if jenkins_url:
        print(f"  {'Jenkins URL':<20} : {grey(jenkins_url)}")

    if config_file:
        path = SERVERS_DIR / config_file
        if path.exists():
            headers, runs = _load_runs(path)
            run = next((r for r in runs if str(r.get("pid", "")).strip() == str(pid).strip()), None)
            if run:
                param_cols = [h for h in (headers or []) if h and str(h) not in STD_COLS]
                if param_cols:
                    print()
                    print(grey(f"  {'─' * 56}"))
                    print(f"  Parameters used:")
                    for col in param_cols:
                        val = run.get(col, "")
                        if val:
                            print(f"    {str(col):<30} : {val}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args        = sys.argv[1:]
    ip          = None
    pid         = None
    do_refresh  = False
    i           = 0
    while i < len(args):
        if args[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif args[i] in ("-refresh", "--refresh"):
            do_refresh = True; i += 1
        elif args[i] in ("-ip", "--ip") and i + 1 < len(args):
            ip = args[i + 1]; i += 2
        elif args[i] in ("-pid", "--pid") and i + 1 < len(args):
            pid = args[i + 1]; i += 2
        else:
            i += 1

    if pid:
        print_project_detail(pid)
    elif ip:
        print_server_detail(ip)
    elif do_refresh:
        refresh_projects()
    else:
        print_project_list()


if __name__ == "__main__":
    main()
