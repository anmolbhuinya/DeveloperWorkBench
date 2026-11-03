#!/usr/bin/env python3
"""
gpstatus — Show GP Build project run history.

Usage:
  gpstatus        List latest 10 projects, newest first. Navigate with n/p/q.
  gpstatus -refresh  Refresh Jenkins build status + GitHub PR status for active projects,
                  then display.  Skips projects already in a terminal state
                  (Passed, Failed, Cancelled).
"""

import os
import sys
import re
import time
import json
import requests
import openpyxl
from pathlib import Path
from api_errors import atlassian_error, github_error, jenkins_error, connection_error, http
try:
    import filelock as _filelock
    _FILELOCK_AVAILABLE = True
except ImportError:
    _FILELOCK_AVAILABLE = False

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "GP_Build"        # project data: <DWB>\DWB_Projects\WorkFlows\GP_Build
DATA_ROOT.mkdir(parents=True, exist_ok=True)
WORKFLOWS_ROOT = TOOL_ROOT.parent
PROJECTS_PATH  = DATA_ROOT / "projects.xlsx"
ETA_CACHE_PATH = TOOL_ROOT / "eta_cache.json"
CONFIG_PATH    = TOOL_ROOT / "gp_job_config.xlsx"
SECRETS_PATH   = WORKFLOWS_ROOT.parent / "secrets.xlsx"

PAGE_SIZE = 10

_PROJ_LEASE_SECONDS = 15 * 60

def _projects_filelock():
    _lp = PROJECTS_PATH.with_suffix(".xlsx.lock")
    if _lp.exists():
        try:
            if time.time() - _lp.stat().st_mtime > _PROJ_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30) if _FILELOCK_AVAILABLE else open(os.devnull)

# ── ETA cache (JSON sidecar — more reliable than adding xlsx columns) ─────────

def _load_eta_cache():
    if not ETA_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(ETA_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_eta_cache(pid_timing):
    """pid_timing: dict of {str(pid): {"start_ms": int, "est_ms": int}}"""
    cache = _load_eta_cache()
    cache.update(pid_timing)
    try:
        ETA_CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"  Warning: Could not save eta_cache.json — {e}")

# Terminal statuses — never refreshed
TERMINAL = {"passed", "failed", "cancelled", "completed"}

# Column indices in projects.xlsx  (1-based)
COL_PROJECT_ID    = 1
COL_TICKET_ID     = 2
COL_FEATURE_BR    = 3
COL_DEST_BR       = 4
COL_AUTO_MERGE    = 5
COL_CONFIG_FILE   = 6
COL_STATUS        = 7
COL_PR_URL        = 8
COL_PR_STATUS     = 9
COL_JOB_ID        = 10
COL_SONAR         = 11
# COL_START_MS / COL_EST_MS are not stored in xlsx — they live in eta_cache.json

# ── ANSI helpers ──────────────────────────────────────────────────────────────
R = "\x1b[0m"
def _ansi(code, s): return f"\x1b[{code}m{s}{R}"
BOLD   = lambda s: _ansi("1",  s)
DIM    = lambda s: _ansi("2",  s)
CYAN   = lambda s: _ansi("36", s)
GREEN  = lambda s: _ansi("32", s)
YELLOW = lambda s: _ansi("33", s)
RED    = lambda s: _ansi("31", s)
BLUE   = lambda s: _ansi("34", s)
GREY   = lambda s: _ansi("90", s)
WHITE  = lambda s: _ansi("97", s)

_STATUS_COLOR = {
    "created":    CYAN,
    "scheduled":  CYAN,
    "running":    YELLOW,
    "passed":     GREEN,
    "failed":     RED,
    "cancelled":  GREY,
    "completed":  GREEN,
    "unstable":   YELLOW,
}
_PR_COLOR = {
    "open":          YELLOW,
    "open/approved": GREEN,
    "merged":        GREEN,
    "closed":        GREY,
}

def _color(mapping, val):
    v = (val or "").strip()
    fn = mapping.get(v.lower(), WHITE)
    return fn(v) if v else GREY("—")

color_status   = lambda v: _color(_STATUS_COLOR, v)
color_pr       = lambda v: _color(_PR_COLOR, v)


# ── Data helpers ──────────────────────────────────────────────────────────────

def load_projects(app_name=None):
    if not PROJECTS_PATH.exists():
        return []
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        if app_name and app_name in wb.sheetnames:
            ws = wb[app_name]
        else:
            ws = (wb["Payor"] if "Payor" in wb.sheetnames
                  else wb["Projects"] if "Projects" in wb.sheetnames
                  else wb.active)
        headers = [str(c.value or "").strip() for c in ws[1]]
        eta_cache = _load_eta_cache()
        rows = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            pid = row[0] if row else None
            if pid is not None and str(pid).strip():
                r = dict(zip(headers, row))
                timing = eta_cache.get(str(pid), {})
                r["start_ms"] = timing.get("start_ms")
                r["est_ms"]   = timing.get("est_ms")
                rows.append(r)
    return list(reversed(rows))   # newest first


def load_settings(app_name=None):
    if not CONFIG_PATH.exists():
        return {}
    wb = openpyxl.load_workbook(str(CONFIG_PATH))
    if "Settings" not in wb.sheetnames:
        return {}
    ws = wb["Settings"]
    hdrs = [str(c.value or "").strip().lower() for c in ws[1]]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(v is not None for v in row):
            d = {k: str(v or "").strip() for k, v in zip(hdrs, row)}
            if not d.get("application"):
                continue
            if app_name is None or d["application"].lower() == app_name.lower():
                return d
    return {}


def load_secrets():
    if not SECRETS_PATH.exists():
        return {}
    wb = openpyxl.load_workbook(str(SECRETS_PATH))
    d = {}
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                d[str(row[0]).strip()] = str(row[1]).strip()
    return d


def is_refreshable(row):
    status = str(row.get("status") or "").strip().lower()
    return status not in TERMINAL


# ── Jenkins status ────────────────────────────────────────────────────────────

def fetch_jenkins_status(job_id, settings, secrets):
    """
    Query the specific Jenkins build by job_id.
    Falls back to lastBuild only when job_id is unknown.
    Returns "Running" | "Passed" | "Failed" | "Cancelled" | "Unstable" | None.
    """
    job_base = settings.get("url", "").rstrip("/")
    if not job_base:
        return None
    base = "/".join(job_base.split("/")[:3])

    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    if not username or not token:
        return None

    jid = str(job_id or "").strip().lstrip("#")
    url = (f"{job_base}/{jid}/api/json"
           if jid and jid != "None"
           else f"{job_base}/lastBuild/api/json")

    try:
        resp = http.get(url, auth=(username, token), timeout=15,
                            params={"tree": "result,building,timestamp,estimatedDuration"})
        if resp.status_code == 404:
            return {}
        if resp.status_code in (401, 403):
            print(jenkins_error(resp.status_code, base_url=base, username=username,
                                context="Jenkins refresh"))
            return {}
        resp.raise_for_status()
        data      = resp.json()
        start_ms  = data.get("timestamp")
        est_ms    = data.get("estimatedDuration")
        if data.get("building"):
            return {"status": "Running", "start_ms": start_ms, "est_ms": est_ms}
        result = data.get("result") or ""
        status = {"SUCCESS": "Passed", "FAILURE": "Failed",
                  "ABORTED": "Cancelled", "UNSTABLE": "Unstable"}.get(result)
        return {"status": status, "start_ms": start_ms, "est_ms": est_ms}
    except requests.exceptions.ConnectionError:
        print(connection_error("Jenkins", "Jenkins refresh"))
        return {}
    except Exception:
        return {}


# ── GitHub PR status ──────────────────────────────────────────────────────────

def _parse_github_pr_url(pr_url):
    m = re.match(r'https://github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url or "")
    if m:
        return m.group(1), m.group(2), int(m.group(3))
    return None, None, None


def fetch_pr_status(pr_url, secrets):
    """
    Query GitHub for PR state.
    Returns "Open" | "Merged" | "Closed" | None.
    """
    owner, repo, pr_num = _parse_github_pr_url(pr_url)
    if not owner:
        return None

    github_token = secrets.get("github_token", "")
    headers = {"Accept": "application/vnd.github.v3+json"}
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    try:
        resp = http.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_num}",
            headers=headers, timeout=15
        )
        if resp.status_code == 404:
            return None
        if resp.status_code == 401:
            print("  [warning] GitHub token expired — PR status not refreshed.")
            print("            Renew 'github_token' in secrets.xlsx (GitHub sheet).")
            return None
        if resp.status_code == 403:
            print("  [warning] GitHub access denied (HTTP 403) — PR status not refreshed.")
            return None
        resp.raise_for_status()
        pr = resp.json()
        if pr.get("merged"):
            return "Merged"
        if pr.get("state") != "open":
            return "Closed"
        # Check for approvals
        rev_resp = http.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_num}/reviews",
            headers=headers, timeout=15
        )
        if rev_resp.status_code == 200:
            reviews = rev_resp.json()
            # Latest review per reviewer — approved if any current approval exists
            latest = {}
            for r in reviews:
                uid = r.get("user", {}).get("id")
                if uid:
                    latest[uid] = r.get("state", "")
            if any(s == "APPROVED" for s in latest.values()):
                return "Open/Approved"
        return "Open"
    except requests.exceptions.ConnectionError:
        print("  [warning] GitHub unreachable — PR status not refreshed.")
        return None
    except Exception:
        return None


# ── Write refreshed values back to projects.xlsx ─────────────────────────────

def _ensure_col_header(ws, col_idx, name, width=12):
    from openpyxl.styles import PatternFill as _PF, Font as _F, Alignment as _A
    # Always check the cell value directly — don't rely on max_column (can be stale)
    if not str(ws.cell(1, col_idx).value or "").strip():
        cell = ws.cell(1, col_idx, name)
        cell.font      = _F(color="FFFFFF", bold=True)
        cell.fill      = _PF("solid", fgColor="4472C4")
        cell.alignment = _A(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = width


def save_refreshed(updates, app_name=None):
    """
    updates: list of (project_id, new_status, new_pr_status, new_pr_url, new_job_id, new_start_ms, new_est_ms)
    Finds each row by project_id (col 1) and updates status/PR cols in xlsx.
    ETA timing (start_ms, est_ms) is persisted in eta_cache.json instead of xlsx.
    """
    if not updates or not PROJECTS_PATH.exists():
        return

    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    if app_name and app_name in wb.sheetnames:
        ws = wb[app_name]
    else:
        ws = (wb["Payor"] if "Payor" in wb.sheetnames
              else wb["Projects"] if "Projects" in wb.sheetnames
              else wb.active)

    _ensure_col_header(ws, COL_JOB_ID, "job_id", width=10)

    update_map = {str(u[0]): u for u in updates}
    eta_updates = {}

    for row in ws.iter_rows(min_row=2):
        pid = str(row[COL_PROJECT_ID - 1].value or "").strip()
        if pid not in update_map:
            continue
        _, new_status, new_pr_status, new_pr_url, new_job_id, new_start_ms, new_est_ms = update_map[pid]
        if new_status is not None:
            row[COL_STATUS - 1].value = new_status
        if new_pr_url:
            row[COL_PR_URL - 1].value     = new_pr_url
            row[COL_PR_URL - 1].hyperlink = new_pr_url
        if new_pr_status is not None:
            row[COL_PR_STATUS - 1].value = new_pr_status
        if new_job_id is not None:
            ws.cell(row[0].row, COL_JOB_ID, new_job_id)
        if new_start_ms is not None or new_est_ms is not None:
            eta_updates[pid] = {"start_ms": new_start_ms, "est_ms": new_est_ms}

    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  Warning: projects.xlsx is open — close it in Excel and re-run to persist changes.")
    except Exception as e:
        print(f"  Warning: Could not save projects.xlsx — {e}")

    if eta_updates:
        _save_eta_cache(eta_updates)


# ── Refresh logic ─────────────────────────────────────────────────────────────

def fetch_jenkins_job_id(feature_branch, settings, secrets):
    """
    Return the most recent build number for the branch, or None.
    Used during refresh to fill in job_id when it was missing (e.g. Scheduled→Running).
    """
    job_base = settings.get("url", "").rstrip("/")
    if not job_base:
        return None
    base = "/".join(job_base.split("/")[:3])
    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    if not username or not token:
        return None
    url = f"{job_base}/lastBuild/api/json"
    try:
        resp = http.get(url, auth=(username, token), timeout=15,
                            params={"tree": "number,result,building"})
        if resp.status_code == 404:
            return None
        if resp.status_code in (401, 403):
            print(jenkins_error(resp.status_code, base_url=base, username=username,
                                context="Jenkins job ID refresh"))
            return None
        resp.raise_for_status()
        return resp.json().get("number")
    except requests.exceptions.ConnectionError:
        print(connection_error("Jenkins", "Jenkins job ID refresh"))
        return None
    except Exception:
        return None


def refresh_projects(rows, app_name=None):
    settings = load_settings(app_name)
    secrets  = load_secrets()

    to_refresh = [r for r in rows if is_refreshable(r)]
    if not to_refresh:
        print("  No active projects to refresh.")
        return rows

    print(f"  Refreshing {len(to_refresh)} active project(s)...\n")
    updates = []

    for r in to_refresh:
        pid            = str(r.get("project_id", "") or "")
        feature_branch = str(r.get("feature_branch", "") or "")
        pr_url         = str(r.get("pr_url", "") or "")
        stored_job_id  = str(r.get("job_id", "") or "").strip()

        # Jenkins build status — use stored job_id so each project queries its own build
        jinfo      = fetch_jenkins_status(stored_job_id, settings, secrets)
        new_status = jinfo.get("status")
        new_start_ms = jinfo.get("start_ms")
        new_est_ms   = jinfo.get("est_ms")

        # Also get the job_id if not already stored
        new_job_id = None
        if not stored_job_id or stored_job_id in ("None", ""):
            new_job_id = fetch_jenkins_job_id(feature_branch, settings, secrets)

        # GitHub PR status
        new_pr_status = fetch_pr_status(pr_url, secrets) if pr_url else None
        new_pr_url    = ""

        # If PR URL missing but ticket_id present, try JIRA
        if not pr_url and r.get("ticket_id") and r.get("dest_branch"):
            try:
                from gprun_tool import fetch_branches_for_ticket
                matches = fetch_branches_for_ticket(
                    str(r["ticket_id"]), str(r["dest_branch"]), secrets
                )
                match = next((m for m in matches if m["branch"] == feature_branch), None)
                if match:
                    new_pr_url    = match["pr_url"]
                    new_pr_status = match.get("pr_status", "Open")
            except Exception:
                pass

        label_status    = new_status    or GREY("no change")
        label_pr_status = new_pr_status or GREY("no change")
        label_job_id    = (f"#{new_job_id}" if new_job_id else
                           (f"#{stored_job_id}" if stored_job_id else GREY("—")))

        print(f"  [{pid}] {feature_branch}")
        print(f"        build: {label_status}   PR: {label_pr_status}   job: {label_job_id}")

        updates.append((pid, new_status, new_pr_status, new_pr_url, new_job_id, new_start_ms, new_est_ms))

    print()
    save_refreshed(updates, app_name=app_name)

    return load_projects(app_name)


def refresh_single(row, app_name=None):
    """
    Refresh Jenkins + PR status for one row (ignores terminal status) and save.
    Returns a new row dict with updated values merged in.
    """
    settings = load_settings(app_name)
    secrets  = load_secrets()

    pid            = str(row.get("project_id", "") or "")
    feature_branch = str(row.get("feature_branch", "") or "")
    pr_url         = str(row.get("pr_url", "") or "")
    stored_job_id  = str(row.get("job_id", "") or "").strip()

    jinfo      = fetch_jenkins_status(stored_job_id, settings, secrets)
    new_status   = jinfo.get("status")
    new_start_ms = jinfo.get("start_ms")
    new_est_ms   = jinfo.get("est_ms")
    new_job_id   = None
    if not stored_job_id or stored_job_id in ("None", ""):
        new_job_id = fetch_jenkins_job_id(feature_branch, settings, secrets)
    new_pr_status = fetch_pr_status(pr_url, secrets) if pr_url else None

    save_refreshed([(pid, new_status, new_pr_status, "", new_job_id, new_start_ms, new_est_ms)], app_name=app_name)

    updated = dict(row)
    if new_status:
        updated["status"] = new_status
    if new_pr_status:
        updated["pr_status"] = new_pr_status
    if new_job_id:
        updated["job_id"] = str(new_job_id)
    if new_start_ms is not None:
        updated["start_ms"] = new_start_ms
    if new_est_ms is not None:
        updated["est_ms"] = new_est_ms
    return updated


# ── Display ───────────────────────────────────────────────────────────────────

COL_WIDTHS = {
    "project_id":     4,
    "ticket_id":      16,
    "feature_branch": 26,
    "dest_branch":    18,
    "pr_status":      11,
    "job_id":         8,
    "auto_merge":     6,
    "sonar":          5,
    "status":         10,
    "eta":            9,
}
DISPLAY_COLS = list(COL_WIDTHS.keys())


def _eta_str(row):
    """Return ETA (remaining) or elapsed time for Running builds, '—' otherwise."""
    if str(row.get("status") or "").strip().lower() != "running":
        return GREY("—")
    try:
        raw_start = row.get("start_ms")
        raw_est   = row.get("est_ms")
        start_ms  = int(raw_start) if raw_start not in (None, "", "None") else 0
        est_ms    = int(raw_est)   if raw_est   not in (None, "", "None") else 0

        if not start_ms:
            return GREY("—")

        now_s = time.time()

        if est_ms > 0:
            remaining = (start_ms + est_ms) / 1000 - now_s
            if remaining < 0:
                return YELLOW("overdue")
            total_m, s = divmod(int(remaining), 60)
            if total_m >= 60:
                h, m = divmod(total_m, 60)
                return f"{h}h {m}m"
            return f"{total_m}m {s:02d}s"
        else:
            # No Jenkins estimate — show elapsed time instead
            elapsed_s = int(now_s - start_ms / 1000)
            total_m, s = divmod(elapsed_s, 60)
            if total_m >= 60:
                h, m = divmod(total_m, 60)
                return GREY(f"+{h}h {m}m")
            return GREY(f"+{total_m}m {s:02d}s")
    except Exception:
        return GREY("—")

_ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')
_OSC8_RE = re.compile(r'\x1b\]8;;[^\x1b]*\x1b\\')

def hyperlink(url, text):
    """OSC 8 terminal hyperlink — falls back to plain text if no URL."""
    if not url:
        return text
    return f"\x1b]8;;{url}\x1b\\{text}\x1b]8;;\x1b\\"

def _visible_len(s):
    s = _ANSI_RE.sub('', s)
    s = _OSC8_RE.sub('', s)
    return len(s)

def _pad(s, w):
    return s + " " * max(0, w - _visible_len(str(s)))


_HEADERS = {
    "project_id":     "PID",
    "ticket_id":      "TICKET",
    "feature_branch": "FEATURE BRANCH",
    "dest_branch":    "DEST BRANCH",
    "pr_status":      "PR STATUS",
    "auto_merge":     "MERGE",
    "sonar":          "SONAR",
    "status":         "STATUS",
    "job_id":         "JOB ID",
    "eta":            "ETA",
}

def print_header():
    line = "  " + "  ".join(
        BOLD(_pad(_HEADERS.get(c, c.replace("_", " ").upper()), COL_WIDTHS[c]))
        for c in DISPLAY_COLS
    )
    rule = "  " + GREY("-" * (_visible_len(line) - 2))
    print(line)
    print(rule)


def print_row(row, ctx=None):
    ctx          = ctx or {}
    jira_base    = ctx.get("jira_base", "")
    jenkins_url  = ctx.get("jenkins_url", "")

    job_raw    = str(row.get("job_id")         or "").strip()
    pr_url_raw = str(row.get("pr_url")         or "").strip()
    ticket_raw = str(row.get("ticket_id")      or "")
    feat_raw   = str(row.get("feature_branch") or "")
    dest_raw   = str(row.get("dest_branch")    or "")
    pr_st_raw  = str(row.get("pr_status")      or "")
    status_raw = str(row.get("status")         or "")

    # Extract GitHub repo root from the stored PR URL
    repo_m   = re.match(r'(https://github\.com/[^/]+/[^/]+)/pull/\d+', pr_url_raw)
    repo_url = repo_m.group(1) if repo_m else ""

    # Ticket ID → JIRA browse
    ticket_url  = f"{jira_base}/browse/{ticket_raw}" if jira_base and ticket_raw else ""
    ticket_cell = hyperlink(ticket_url, CYAN(ticket_raw)) if ticket_url else CYAN(ticket_raw)

    # Feature branch → GitHub branch view (truncate display label if too long)
    _fw = COL_WIDTHS["feature_branch"]
    feat_disp = feat_raw[:_fw - 1] + "…" if len(feat_raw) > _fw else feat_raw
    feat_url  = f"{repo_url}/tree/{feat_raw}" if repo_url and feat_raw else ""
    feat_cell = hyperlink(feat_url, feat_disp) if feat_url else feat_disp

    # Dest branch → GitHub branch view (truncate display label if too long)
    _dw = COL_WIDTHS["dest_branch"]
    dest_disp = dest_raw[:_dw - 1] + "…" if len(dest_raw) > _dw else dest_raw
    dest_url  = f"{repo_url}/tree/{dest_raw}" if repo_url and dest_raw else ""
    dest_cell = hyperlink(dest_url, GREY(dest_disp)) if dest_url else GREY(dest_disp)

    # Status → Jenkins build page
    status_colored = color_status(status_raw)
    if jenkins_url:
        j_url = (f"{jenkins_url}/{job_raw}" if job_raw and job_raw != "None" else jenkins_url)
        status_cell = hyperlink(j_url, status_colored)
    else:
        status_cell = status_colored

    # PR status → GitHub PR  (truncate to column width before coloring)
    _prw      = COL_WIDTHS["pr_status"]
    pr_st_disp = pr_st_raw[:_prw - 1] + "…" if len(pr_st_raw) > _prw else pr_st_raw
    pr_st_colored = color_pr(pr_st_disp)
    pr_cell       = hyperlink(pr_url_raw, pr_st_colored) if pr_url_raw else pr_st_colored

    # Job ID → Jenkins build page
    job_label = f"#{job_raw}" if job_raw and job_raw != "None" else GREY("—")
    if jenkins_url and job_raw and job_raw != "None":
        job_cell = hyperlink(f"{jenkins_url}/{job_raw}", job_label)
    else:
        job_cell = job_label

    def _yn(val):
        v = str(val or "").strip().lower()
        return GREEN("yes") if v == "yes" else (GREY("no") if v == "no" else GREY("—"))

    cells = [
        _pad(BLUE(str(row.get("project_id") or "")), COL_WIDTHS["project_id"]),
        _pad(ticket_cell,                            COL_WIDTHS["ticket_id"]),
        _pad(feat_cell,                              COL_WIDTHS["feature_branch"]),
        _pad(dest_cell,                              COL_WIDTHS["dest_branch"]),
        _pad(pr_cell,                                COL_WIDTHS["pr_status"]),
        _pad(job_cell,                               COL_WIDTHS["job_id"]),
        _pad(_yn(row.get("auto_merge")),             COL_WIDTHS["auto_merge"]),
        _pad(_yn(row.get("sonar")),                  COL_WIDTHS["sonar"]),
        _pad(status_cell,                            COL_WIDTHS["status"]),
        _pad(_eta_str(row),                          COL_WIDTHS["eta"]),
    ]
    print("  " + "  ".join(cells))


def print_detail(row, ctx=None):
    """Vertical key:value detail view for a single project — no truncation."""
    ctx         = ctx or {}
    jira_base   = ctx.get("jira_base", "")
    jenkins_url = ctx.get("jenkins_url", "")

    job_raw    = str(row.get("job_id")         or "").strip()
    pr_url_raw = str(row.get("pr_url")         or "").strip()
    ticket_raw = str(row.get("ticket_id")      or "")
    feat_raw   = str(row.get("feature_branch") or "")
    dest_raw   = str(row.get("dest_branch")    or "")
    pr_st_raw  = str(row.get("pr_status")      or "")
    status_raw = str(row.get("status")         or "")
    am_raw     = str(row.get("auto_merge")     or "")
    sonar_raw  = str(row.get("sonar")          or "")
    cfg_name   = str(row.get("config_file")    or "")
    cfg_raw    = str(DATA_ROOT / "projects" / "Payor" / cfg_name) if cfg_name else ""

    repo_m   = re.match(r'(https://github\.com/[^/]+/[^/]+)/pull/\d+', pr_url_raw)
    repo_url = repo_m.group(1) if repo_m else ""

    ticket_url  = f"{jira_base}/browse/{ticket_raw}" if jira_base and ticket_raw else ""
    ticket_val  = hyperlink(ticket_url, CYAN(ticket_raw)) if ticket_url else CYAN(ticket_raw)

    feat_url = f"{repo_url}/tree/{feat_raw}" if repo_url and feat_raw else ""
    feat_val = hyperlink(feat_url, feat_raw) if feat_url else feat_raw

    dest_url = f"{repo_url}/tree/{dest_raw}" if repo_url and dest_raw else ""
    dest_val = hyperlink(dest_url, GREY(dest_raw)) if dest_url else GREY(dest_raw)

    pr_st_colored = color_pr(pr_st_raw)
    pr_val        = hyperlink(pr_url_raw, pr_st_colored) if pr_url_raw else pr_st_colored

    if jenkins_url:
        j_url = (f"{jenkins_url}/{job_raw}" if job_raw and job_raw != "None" else jenkins_url)
        status_val = hyperlink(j_url, color_status(status_raw))
    else:
        status_val = color_status(status_raw)

    job_label = f"#{job_raw}" if job_raw and job_raw != "None" else GREY("—")
    if jenkins_url and job_raw and job_raw != "None":
        job_val = hyperlink(f"{jenkins_url}/{job_raw}", job_label)
    else:
        job_val = job_label

    def _yn(v):
        s = v.strip().lower()
        return GREEN("yes") if s == "yes" else (GREY("no") if s == "no" else GREY("—"))

    LABEL_W = 18
    def _field(label, value):
        print(f"  {BOLD(_pad(label, LABEL_W))}: {value}")

    pid = str(row.get("project_id") or "")
    print()
    print(f"  {BOLD('Project detail')}  {BLUE(pid)}")
    print("  " + GREY("-" * 60))
    _field("Project ID",     BLUE(pid))
    _field("Ticket",         ticket_val)
    _field("Feature Branch", feat_val)
    _field("Dest Branch",    dest_val)
    _field("PR Status",      pr_val)
    _field("PR URL",         hyperlink(pr_url_raw, pr_url_raw) if pr_url_raw else GREY("—"))
    _field("Auto Merge",     _yn(am_raw))
    _field("Sonar",          _yn(sonar_raw))
    _field("Status",         status_val)
    _field("ETA",            _eta_str(row))
    _field("Job ID",         job_val)
    _field("Config File",    cfg_raw or GREY("—"))
    print()


def _enrich_running(rows):
    """
    For every Running build, fetch fresh status + timing from Jenkins and
    persist to xlsx — so status and ETA are always current on plain gpstatus.
    """
    needs = [r for r in rows if str(r.get("status") or "").lower() == "running"]
    if not needs:
        return rows

    settings = load_settings()
    secrets  = load_secrets()
    updates  = []

    for r in needs:
        jid   = str(r.get("job_id") or "").strip().lstrip("#")
        jinfo = fetch_jenkins_status(jid, settings, secrets)
        if not jinfo:
            continue
        new_status = jinfo.get("status")
        sm, em     = jinfo.get("start_ms"), jinfo.get("est_ms")
        if new_status:
            r["status"] = new_status
        if sm:
            r["start_ms"] = sm
        if em and int(em) > 0:
            r["est_ms"] = em
        pid = str(r.get("project_id", ""))
        updates.append((pid, new_status, None, "", None, sm, em))

    if updates:
        save_refreshed(updates)

    return rows


def _print_page(rows, page, total, status_filter=None, ctx=None):
    start     = page * PAGE_SIZE
    end       = min(start + PAGE_SIZE, total)
    page_rows = rows[start:end]

    order_label  = ctx.get("order_label", "newest first") if ctx else "newest first"
    filter_label = f"  [filter: status={status_filter}]" if status_filter else ""
    print()
    print(BOLD(WHITE(f"  GP Build Projects  —  {start + 1}–{end} of {total}  ({order_label}){filter_label}")))
    print()
    print_header()
    for row in page_rows:
        print_row(row, ctx)
    print()


def print_nav(page, total):
    has_prev = page > 0
    has_next = (page + 1) * PAGE_SIZE < total
    parts    = []
    if has_next:
        parts.append(CYAN("[n]") + " next 10")
    if has_prev:
        parts.append(CYAN("[p]") + " previous 10")
    parts.append(GREY("[q]") + " quit")
    print("  " + "   ".join(parts))
    print()


# ── Argument parsing ─────────────────────────────────────────────────────────

def parse_args():
    do_refresh    = False
    reverse_order = False
    status_filter = None
    project_id    = None
    argv          = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] in ("-refresh", "--refresh"):
            do_refresh = True
            i += 1
        elif argv[i] in ("-r", "--reverse"):
            reverse_order = True
            i += 1
        elif argv[i] in ("-fs", "--filter-status") and i + 1 < len(argv):
            status_filter = argv[i + 1].strip().lower()
            i += 2
        elif argv[i] in ("-pid", "--project-id") and i + 1 < len(argv):
            project_id = argv[i + 1].strip()
            i += 2
        elif argv[i] in ("-h", "--help"):
            print("""
  gpstatus                   List all GP Build projects, newest first (10 per page).
  gpstatus -refresh          Refresh Jenkins + GitHub PR status for active projects.
  gpstatus -r                Show projects oldest first.
  gpstatus -fs <status>      Filter projects by status (e.g. -fs running, -fs passed).
  gpstatus -pid <project_id> Show full detail for a single project.
""")
            sys.exit(0)
        else:
            i += 1
    return do_refresh, reverse_order, status_filter, project_id


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    do_refresh, reverse_order, status_filter, project_id = parse_args()

    rows = load_projects()   # newest first by default

    if not rows:
        if not PROJECTS_PATH.exists():
            print(f"\n  projects.xlsx not found at:\n    {PROJECTS_PATH}")
            print("  Run  setupgptool  to initialise the GP Build Tool.\n")
        else:
            print("\n  No projects found in projects.xlsx.\n"
                  "  Run  gprun  to schedule a build.\n")
        sys.exit(0)

    # Detail view for a single project
    if project_id:
        secrets  = load_secrets()
        settings = load_settings()
        ctx = {
            "jira_base":    secrets.get("jira_base_url", "").rstrip("/"),
            "jenkins_url":  settings.get("url", "").rstrip("/"),
        }
        match = next((r for r in rows if str(r.get("project_id") or "") == project_id), None)
        if not match:
            print(f"\n  No project found with ID '{project_id}'.\n")
            sys.exit(1)
        print(f"\n  Refreshing project {project_id}...")
        match = refresh_single(match)
        print_detail(match, ctx)
        sys.exit(0)

    if do_refresh:
        print()
        rows = refresh_projects(rows)

    if reverse_order:
        rows = list(reversed(rows))   # oldest first

    # Apply status filter
    if status_filter:
        rows = [r for r in rows
                if str(r.get("status") or "").strip().lower() == status_filter]
        if not rows:
            print(f"\n  No projects found with status '{status_filter}'.\n")
            sys.exit(0)

    # Build display context for hyperlinks
    secrets  = load_secrets()
    settings = load_settings()
    ctx = {
        "jira_base":    secrets.get("jira_base_url", "").rstrip("/"),
        "jenkins_base": settings.get("gp_base_url", "").rstrip("/"),
        "jenkins_team": settings.get("scrum_team", ""),
        "jenkins_app":  settings.get("application", ""),
        "order_label":  "oldest first" if reverse_order else "newest first",
    }

    total = len(rows)
    page  = 0

    while True:
        _print_page(rows, page, total, status_filter, ctx)
        has_prev = page > 0
        has_next = (page + 1) * PAGE_SIZE < total

        if not has_prev and not has_next:
            break

        print_nav(page, total)
        try:
            choice = input("  > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if choice in ("q", ""):
            break
        elif choice == "n" and has_next:
            page += 1
        elif choice == "p" and has_prev:
            page -= 1
        else:
            print(GREY("  Invalid choice."))

    if not do_refresh:
        print(GREY("  Tips:  gpstatus -refresh           update Jenkins + PR statuses"))
        print(GREY("         gpstatus -pid <project_id>  refreshed detail for one project\n"))


if __name__ == "__main__":
    main()
