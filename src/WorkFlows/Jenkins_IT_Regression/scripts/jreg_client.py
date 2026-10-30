#!/usr/bin/env python3
"""
jreg_client.py — jregstatus: poll Jenkins IT Regression job statuses directly.

Usage:
  jregstatus                 Poll last build status for all configured jobs
  jregstatus -pid <run_id>  Show details for a specific run
  jregstatus --help          Show this help
"""

import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import openpyxl

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
WORKFLOWS_ROOT = TOOL_ROOT.parent
GP_SCRIPTS     = WORKFLOWS_ROOT / "GP_Build" / "scripts"

if str(GP_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(GP_SCRIPTS))

from api_errors import session
import requests

http = session()

SECRETS_PATH  = WORKFLOWS_ROOT.parent / "secrets.xlsx"
REG_CONFIG    = TOOL_ROOT / "reg_job_config.xlsx"
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"
PROJECTS_DIR  = TOOL_ROOT / "projects"

# ── ANSI colours ──────────────────────────────────────────────
RESET  = "\x1b[0m"
BOLD   = lambda s: f"\x1b[1m{s}{RESET}"
GREEN  = lambda s: f"\x1b[32m{s}{RESET}"
RED    = lambda s: f"\x1b[31m{s}{RESET}"
YELLOW = lambda s: f"\x1b[33m{s}{RESET}"
GREY   = lambda s: f"\x1b[90m{s}{RESET}"
CYAN   = lambda s: f"\x1b[36m{s}{RESET}"
WHITE  = lambda s: f"\x1b[97m{s}{RESET}"

STATUS_COLOR = {
    "SUCCESS":     GREEN,
    "PASSED":      GREEN,
    "FAILURE":     RED,
    "FAILED":      RED,
    "ABORTED":     YELLOW,
    "UNSTABLE":    YELLOW,
    "RUNNING":     CYAN,
    "IN_PROGRESS": CYAN,
    "SCHEDULED":   CYAN,
    "NO_BUILDS":   GREY,
    "NO_URL":      GREY,
    "UNKNOWN":     GREY,
    "ERROR":       RED,
    "CONN_ERR":    RED,
    "AUTH_ERROR":  RED,
}


def color_status(s: str) -> str:
    return STATUS_COLOR.get(s.upper(), WHITE)(s)


def _pad(s: str, w: int) -> str:
    s = str(s)
    return s[:w].ljust(w)


def _hl(url: str, text: str) -> str:
    """OSC 8 terminal hyperlink — clickable in Windows Terminal, iTerm2, etc."""
    if not url:
        return text
    return f"\x1b]8;;{url}\x1b\\{text}\x1b]8;;\x1b\\"


def _pad_hl(text: str, url: str, w: int) -> str:
    """Hyperlink padded to visual width w (escape sequences are invisible)."""
    text = str(text)[:w]
    return _hl(url, text) + " " * max(0, w - len(text))


# ── Secrets ───────────────────────────────────────────────────

def load_secrets() -> dict:
    if not SECRETS_PATH.exists():
        print(f"  ERROR: secrets.xlsx not found at {SECRETS_PATH}")
        return {}
    wb = openpyxl.load_workbook(str(SECRETS_PATH))
    if "Jenkins" not in wb.sheetnames:
        return {}
    out = {}
    for row in wb["Jenkins"].iter_rows(min_row=2, values_only=True):
        if row[0] and row[1] is not None:
            out[str(row[0]).strip()] = str(row[1]).strip() if row[1] else ""
    return out


# ── Job config ────────────────────────────────────────────────

def load_job_config() -> list:
    if not REG_CONFIG.exists():
        print("  ERROR: reg_job_config.xlsx not found. Run  setupjenkinsregtool  first.")
        sys.exit(1)
    wb = openpyxl.load_workbook(str(REG_CONFIG))
    if "payor" not in wb.sheetnames:
        print("  ERROR: reg_job_config.xlsx has no 'payor' sheet.")
        sys.exit(1)
    jobs = []
    for row in wb["payor"].iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        jobs.append({
            "job_name": str(row[0]).strip(),
            "job_url":  str(row[1]).strip() if row[1] else "",
        })
    if not jobs:
        print("  ERROR: No jobs in reg_job_config.xlsx payor sheet.")
        sys.exit(1)
    return jobs


# ── Jenkins helpers ───────────────────────────────────────────

def _ago(ts_ms: int) -> str:
    if not ts_ms:
        return ""
    diff = int(datetime.now(timezone.utc).timestamp()) - ts_ms // 1000
    if diff < 60:   return f"{diff}s ago"
    if diff < 3600: return f"{diff // 60}m ago"
    if diff < 86400:return f"{diff // 3600}h ago"
    return f"{diff // 86400}d ago"


def _fmt_duration(ms: int) -> str:
    if not ms: return ""
    s = ms // 1000
    if s < 60:   return f"{s}s"
    if s < 3600: return f"{s // 60}m"
    h, m = s // 3600, (s % 3600) // 60
    return f"{h}h{m}m"


def _is_queue_url(url: str) -> bool:
    return "/queue/item/" in (url or "")


def _build_number_from_url(build_url: str) -> int:
    """Extract build number from a URL like .../job/42/ → 42."""
    try:
        return int(build_url.rstrip('/').split('/')[-1])
    except (ValueError, IndexError):
        return 0


# ── Jenkins API calls ─────────────────────────────────────────

def _resolve_queue_item(queue_url: str, auth: tuple):
    """
    Poll a Jenkins queue item.
    Returns: build URL str if job started, "" if still queued, None if item gone (404).
    """
    try:
        resp = http.get(queue_url.rstrip('/') + "/api/json", auth=auth, timeout=10)
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


def _poll_build_status(build_url: str, auth: tuple) -> str:
    """Return result/status for a specific build URL."""
    try:
        resp = http.get(build_url.rstrip('/') + "/api/json?tree=result,building",
                        auth=auth, timeout=10)
        if resp.status_code != 200:
            return ""
        data = resp.json()
        return data.get("result") or ("RUNNING" if data.get("building") else "")
    except Exception:
        return ""


def _pvp_matches(jenkins_value: str, stored_pvp: str) -> bool:
    """Compare a Jenkins PAYOR_VERSION_PREFIX value against the stored value.
    Normalises both sides: strips any 'staging:'/'releases:' prefix and trailing '-'."""
    if not jenkins_value or not stored_pvp:
        return False
    def _bare(s):
        parts = s.strip().split(":", 1)
        return (parts[1] if len(parts) == 2 else parts[0]).rstrip("-")
    return _bare(jenkins_value) == _bare(stored_pvp)


def _search_builds_after(job_url: str, payor_version_prefix: str,
                          auth: tuple, n: int, after_build_num: int = 0,
                          triggered_after_ms: int = 0) -> list:
    """
    Search the last 20 builds of job_url for ones whose PAYOR_VERSION_PREFIX matches.
    If after_build_num > 0, skip any build with number <= after_build_num.
    If triggered_after_ms > 0, skip any build whose timestamp < triggered_after_ms
    (prevents associating with old builds from previous runs of the same version).
    Stops as soon as n matching URLs are collected.
    Returns list of up to n build URLs (newest first).
    """
    if not job_url or not payor_version_prefix or n < 1:
        return []
    api = (
        f"{job_url.rstrip('/')}/api/json"
        "?tree=builds[number,url,timestamp,actions[parameters[name,value]]]{0,20}"
    )
    try:
        resp = http.get(api, auth=auth, timeout=15)
        if resp.status_code != 200:
            return []
        matches = []
        builds_sorted = sorted(resp.json().get("builds", []),
                               key=lambda b: b.get("number", 0), reverse=True)
        for build in builds_sorted:
            bnum = build.get("number", 0)
            if after_build_num > 0 and bnum <= after_build_num:
                continue   # already known — skip
            if triggered_after_ms > 0 and build.get("timestamp", 0) < triggered_after_ms:
                continue   # build started before this run was triggered — skip
            for action in build.get("actions", []):
                for param in action.get("parameters", []):
                    if (str(param.get("name", "")) == "PAYOR_VERSION_PREFIX" and
                            _pvp_matches(str(param.get("value", "")), payor_version_prefix)):
                        url = build.get("url", "")
                        if url:
                            matches.append(url)
                        break
                else:
                    continue
                break
            if len(matches) >= n:
                break       # found all we need — stop
        return matches
    except Exception:
        return []


# ── Core resolution + status refresh ─────────────────────────

def refresh_job_group(rows: list, job_url: str,
                      payor_version_prefix: str, auth: tuple,
                      triggered_after_ms: int = 0):
    """
    Given n rows for one job, resolve build URLs and fetch statuses.

    Strategy:
      1. Rows with build URLs       → poll status directly.
      2. Rows with queue URLs       → resolve queue item → build URL → poll.
      3. Rows whose queue item 404d → search last 20 builds as last resort.

    We never search builds when we already have a URL — the user expects
    jregstatus to track the specific build that was triggered, not the
    latest build that happens to match the version prefix.

    triggered_after_ms: if > 0, Pass 3 search skips any build whose Jenkins
    timestamp predates the run's triggered_at (avoids matching old same-version
    builds from a previous run).
    """
    resolved_urls = [
        r.get("jenkins_url", "") or r.get("build_url", "") or r.get("queue_url", "")
        for r in rows
    ]
    statuses      = [r.get("completed",    "") for r in rows]

    # ── Pass 1: resolve queue items → build URLs ──────────────
    # Only fall through to search if a queue item has genuinely expired (404).
    needs_search: list = []

    for i, url in enumerate(resolved_urls):
        if not url:
            # No URL recorded yet — will search below
            needs_search.append(i)
        elif _is_queue_url(url):
            result = _resolve_queue_item(url, auth)
            if result:           # promoted to build URL
                resolved_urls[i] = result
            elif result is None: # queue item expired (404) — search as fallback
                resolved_urls[i] = ""
                needs_search.append(i)
            # else still queued → keep queue URL, do not search

    # ── Pass 2: poll status for all known build URLs ──────────
    known_build_numbers: list = []
    for i, url in enumerate(resolved_urls):
        if url and not _is_queue_url(url):
            s = _poll_build_status(url, auth)
            if s:
                statuses[i] = s
            num = _build_number_from_url(url)
            if num:
                known_build_numbers.append(num)

    # ── Pass 3: last-resort search for rows with no URL ───────
    # Only reached when the queue URL was never stored or has expired.
    if needs_search and job_url and payor_version_prefix:
        after_num  = max(known_build_numbers) if known_build_numbers else 0
        found_urls = _search_builds_after(
            job_url, payor_version_prefix, auth, len(needs_search),
            after_num, triggered_after_ms
        )
        for rank, i in enumerate(needs_search):
            if rank < len(found_urls):
                resolved_urls[i] = found_urls[rank]
                s = _poll_build_status(found_urls[rank], auth)
                if s:
                    statuses[i] = s

    return resolved_urls, statuses


# ── Live all-jobs status table ────────────────────────────────

def poll_job_last_build(job: dict, auth: tuple) -> dict:
    url = job["job_url"]
    if not url:
        return {**job, "status": "NO_URL", "build_num": "", "duration": "", "age": ""}
    api = f"{url.rstrip('/')}/lastBuild/api/json?tree=number,result,building,duration,timestamp"
    try:
        resp = http.get(api, auth=auth, timeout=15)
        if resp.status_code == 404:
            return {**job, "status": "NO_BUILDS", "build_num": "", "duration": "", "age": ""}
        if resp.status_code == 401:
            return {**job, "status": "AUTH_ERROR", "build_num": "", "duration": "", "age": ""}
        if resp.status_code != 200:
            return {**job, "status": f"HTTP {resp.status_code}", "build_num": "", "duration": "", "age": ""}
        data     = resp.json()
        building = data.get("building", False)
        result   = data.get("result") or ("RUNNING" if building else "UNKNOWN")
        return {
            **job,
            "status":    result,
            "build_num": str(data.get("number", "")),
            "duration":  _fmt_duration(data.get("duration", 0)),
            "age":       _ago(data.get("timestamp", 0)),
        }
    except requests.exceptions.ConnectionError:
        return {**job, "status": "CONN_ERR", "build_num": "", "duration": "", "age": ""}
    except Exception:
        return {**job, "status": "ERROR", "build_num": "", "duration": "", "age": ""}


def print_live_table(results: list):
    JN_W, ST_W, BN_W, DUR_W, AG_W = 24, 10, 6, 8, 8
    print(
        "  " +
        BOLD(_pad("JOB NAME",  JN_W)) + "  " +
        BOLD(_pad("STATUS",    ST_W)) + "  " +
        BOLD(_pad("#",         BN_W)) + "  " +
        BOLD(_pad("DURATION",  DUR_W)) + "  " +
        BOLD(_pad("LAST RUN",  AG_W))
    )
    print("  " + GREY("-" * (JN_W + ST_W + BN_W + DUR_W + AG_W + 8)))
    for r in results:
        job_url   = r.get("job_url", "")
        build_num = r.get("build_num", "")
        build_url = f"{job_url.rstrip('/')}/{build_num}/" if job_url and build_num else ""
        print(
            "  " +
            _pad_hl(r["job_name"], job_url,   JN_W) + "  " +
            _pad(color_status(r.get("status", "UNKNOWN")), ST_W + 12) + "  " +
            _pad_hl(build_num,     build_url, BN_W) + "  " +
            _pad(r["duration"],  DUR_W) + "  " +
            _pad(r["age"],       AG_W)
        )
    print()


# ── Per-run detail display ────────────────────────────────────

def _find_run_xlsx(run_id: int, app_name: str = "Payor") -> Path:
    app_dir = PROJECTS_DIR / app_name
    if not app_dir.exists():
        return None
    matches = list(app_dir.glob(f"{run_id}_*.xlsx"))
    return matches[0] if matches else None


def _type_from_path(path: Path) -> str:
    """Extract project type from filename: '17_payor_26.1.1.1.xlsx' → 'payor'."""
    parts = path.stem.split("_", 2)
    return parts[1] if len(parts) >= 2 else "?"


def _write_back(path: Path, all_rows: list,
                resolved_urls: list, statuses: list, col_map: dict):
    """Persist resolved build_url and completed status back into the per-run xlsx."""
    try:
        wb = openpyxl.load_workbook(str(path))
        if "jobs" not in wb.sheetnames:
            return
        ws  = wb["jobs"]
        # Support both new schema (build_url col 6) and legacy (jenkins_url col 5)
        if "build_url" in col_map:
            bc = col_map["build_url"] + 1
        else:
            bc = col_map.get("jenkins_url", 5) + 1
        sc  = col_map.get("completed", 2) + 1
        for i, (url, status) in enumerate(zip(resolved_urls, statuses)):
            row_num = i + 2   # skip header row
            ws.cell(row_num, bc, url)
            ws.cell(row_num, sc, status)
        wb.save(str(path))
    except PermissionError:
        pass   # file open in Excel — skip write-back silently


def print_run_details(run_id: int, secrets: dict, app_name: str = "Payor"):
    path = _find_run_xlsx(run_id, app_name)
    if not path:
        print(f"  ERROR: No run file found for project_id {run_id} in projects/{app_name}/")
        print(f"  Expected: projects/{app_name}/{run_id}_{app_name.lower()}_<version>.xlsx")
        sys.exit(1)

    wb = openpyxl.load_workbook(str(path))

    # ── info sheet ───────────────────────────────────────────
    info                 = {}
    payor_version_prefix = ""

    project_type = _type_from_path(path)

    if "info" in wb.sheetnames:
        for row in wb["info"].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                info[str(row[0]).strip()] = str(row[1]).strip()
        payor_version_prefix = info.get("PAYOR_VERSION_PREFIX", "")

        release_ver = info.get("release_version", "?")
        print(f"\n  Jenkins IT Regression — Run #{run_id}  ({release_ver})")
        print("  " + GREY("─" * 64))
        print(f"  {'Type':<34}: {project_type}")
        print(f"  {'Release version':<34}: {release_ver}")
        print(f"  {'Triggered at':<34}: {info.get('triggered_at', '-')}")
        print()
        print(f"  {'PAYOR_VERSION_PREFIX':<34}: {info.get('PAYOR_VERSION_PREFIX', '-')}")
        print(f"  {'BLUECARD_CONFIG_VERSION_PREFIX':<34}: {info.get('BLUECARD_CONFIG_VERSION_PREFIX', '-')}")
        print(f"  {'DATAUNIVERSE_VERSION_PREFIX':<34}: {info.get('DATAUNIVERSE_VERSION_PREFIX', '-')}")
        print()
        print(f"  {'BASE_IMAGE_NAME':<34}: {info.get('BASE_IMAGE_NAME', '-')}")
        print(f"  {'DB_IMAGE_NAME':<34}: {info.get('DB_IMAGE_NAME', '-')}")
        print(f"  {'CES_SERVER_HOST':<34}: {info.get('CES_SERVER_HOST', '-')}")
        print()

    if "jobs" not in wb.sheetnames:
        print("  (no jobs sheet in run file)")
        return

    # ── Load jobs rows ────────────────────────────────────────
    ws_j    = wb["jobs"]
    headers = [str(c.value).strip() if c.value else "" for c in ws_j[1]]
    col_map = {h: i for i, h in enumerate(headers)}

    all_rows = []
    for row in ws_j.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        all_rows.append({
            "job_name":     str(row[col_map.get("job_name",     0)] or ""),
            "runs":         str(row[col_map.get("runs",         1)] or ""),
            "completed":    str(row[col_map.get("completed",    2)] or ""),
            "job_id":       str(row[col_map.get("job_id",       3)] or ""),
            "triggered_at": str(row[col_map.get("triggered_at", 4)] or ""),
            "queue_url":    str(row[col_map.get("queue_url",    5)] or ""),
            "build_url":    str(row[col_map.get("build_url",    6)] or ""),
        })

    if not all_rows:
        print("  (no job rows)")
        return

    # ── Build job_url lookup ──────────────────────────────────
    job_url_map: dict = {}
    if REG_CONFIG.exists():
        wb2 = openpyxl.load_workbook(str(REG_CONFIG))
        if "payor" in wb2.sheetnames:
            for row in wb2["payor"].iter_rows(min_row=2, values_only=True):
                if row[0] and row[1]:
                    job_url_map[str(row[0]).strip()] = str(row[1]).strip()

    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth     = (username, token) if username and token else None

    # ── Group rows by job_name and refresh each group ─────────
    groups: defaultdict = defaultdict(list)
    for idx, jd in enumerate(all_rows):
        groups[jd["job_name"]].append((idx, jd))

    # Use build_url if already resolved, else fall back to queue_url
    resolved_urls = [jd["build_url"] or jd["queue_url"] for jd in all_rows]
    statuses      = [jd["completed"] for jd in all_rows]

    if auth:
        for jname, idx_jd_list in groups.items():
            indices   = [i for i, _ in idx_jd_list]
            rows_only = [jd for _, jd in idx_jd_list]
            jurl      = job_url_map.get(jname, "")

            grp_urls, grp_statuses = refresh_job_group(
                rows_only, jurl, payor_version_prefix, auth
            )
            for rank, idx in enumerate(indices):
                resolved_urls[idx] = grp_urls[rank]
                statuses[idx]      = grp_statuses[rank]

        _write_back(path, all_rows, resolved_urls, statuses, col_map)

    # ── Display table ─────────────────────────────────────────
    JN_W, RN_W, ST_W, TS_W = 28, 6, 14, 20
    print(
        "  " +
        BOLD(_pad("JOB NAME",     JN_W)) + "  " +
        BOLD(_pad("RUNS",         RN_W)) + "  " +
        BOLD(_pad("STATUS",       ST_W)) + "  " +
        BOLD(_pad("TRIGGERED AT", TS_W))
    )
    print("  " + GREY("-" * (JN_W + RN_W + ST_W + TS_W + 6)))

    for idx, jd in enumerate(all_rows):
        ts        = jd["triggered_at"][:19] if jd["triggered_at"] else ""
        build_url = resolved_urls[idx]
        queue_url = jd["queue_url"]
        print(
            "  " +
            _pad(jd["job_name"],              JN_W) + "  " +
            _pad(jd["runs"],                  RN_W) + "  " +
            _pad(color_status(statuses[idx]), ST_W + 12) + "  " +
            _pad(ts,                          TS_W)
        )
        if build_url and not _is_queue_url(build_url):
            print(f"    {GREY('[build] ')}{_hl(build_url, CYAN(build_url))}")
        elif queue_url:
            print(f"    {GREY('[queue] ')}{GREY(queue_url)}")

    print()


# ── Project list (no-args default view) ──────────────────────

def _project_summary(statuses: list, n_jobs: int) -> str:
    n_fail_trig = sum(1 for s in statuses if s == "Trigger Failed")
    n_success   = sum(1 for s in statuses if s in ("SUCCESS", "PASSED"))
    n_running   = sum(1 for s in statuses if s in ("RUNNING", "Scheduled", "IN_PROGRESS"))
    n_unstable  = sum(1 for s in statuses if s == "UNSTABLE")
    n_failed    = sum(1 for s in statuses if s in ("FAILURE", "FAILED", "ABORTED"))

    if n_fail_trig == n_jobs:
        return RED(f"trigger failed  (0/{n_jobs})")
    if n_running > 0 and n_success + n_failed + n_unstable == 0:
        return CYAN(f"running  ({n_running}/{n_jobs})")
    if n_success == n_jobs:
        return GREEN(f"success  ({n_jobs}/{n_jobs})")
    # mixed — show counts
    parts = []
    if n_success:   parts.append(GREEN(f"{n_success} ok"))
    if n_running:   parts.append(CYAN(f"{n_running} running"))
    if n_unstable:  parts.append(YELLOW(f"{n_unstable} unstable"))
    if n_failed:    parts.append(RED(f"{n_failed} failed"))
    if n_fail_trig: parts.append(GREY(f"{n_fail_trig} not triggered"))
    return "  ".join(parts) if parts else GREY("—")


PAGE_SIZE = 10


def _load_job_statuses(path: Path) -> list:
    """Read completed statuses from the jobs sheet of a per-run xlsx."""
    try:
        wb = openpyxl.load_workbook(str(path))
        if "jobs" not in wb.sheetnames:
            return []
        ws_j  = wb["jobs"]
        hdrs  = [str(c.value).strip() if c.value else "" for c in ws_j[1]]
        cmap  = {h: i for i, h in enumerate(hdrs)}
        return [
            str(row[cmap.get("completed", 2)] or "")
            for row in ws_j.iter_rows(min_row=2, values_only=True)
            if any(row)
        ]
    except Exception:
        return []


def print_project_list(reverse: bool = False, page: int = 1, app_name: str = "Payor"):
    """Show one page of projects (newest-first by default, oldest-first with -r)."""
    if not PROJECTS_PATH.exists():
        print("  No projects.xlsx found. Run  jreg -payor <version>  to start a project.")
        return

    wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb[app_name] if app_name in wb.sheetnames else wb.active
    headers = [str(c.value).strip() if c.value else "" for c in ws[1]]
    col     = {h: i for i, h in enumerate(headers)}

    projects: dict = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        try:
            pid = int(row[col.get("project_id", 0)])
        except (TypeError, ValueError):
            continue
        version = str(row[col.get("payor_release_version", 1)] or "")
        ts      = str(row[col.get("triggered_at", 4)]          or "")
        projects[pid] = {"version": version, "triggered_at": ts}

    if not projects:
        print(f"  No projects found for {app_name}. Run  jreg -payor <version> --app {app_name}  to create one.")
        return

    total      = len(projects)
    all_pids   = sorted(projects.keys(), reverse=not reverse)
    last_page  = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page       = max(1, min(page, last_page))

    start      = (page - 1) * PAGE_SIZE
    page_pids  = all_pids[start : start + PAGE_SIZE]
    r_flag     = " -r" if reverse else ""

    # Load per-project type and job statuses for projects on this page
    pid_type     = {}
    pid_statuses = {}
    for pid in page_pids:
        path = _find_run_xlsx(pid, app_name)
        pid_type[pid]     = _type_from_path(path) if path else "?"
        pid_statuses[pid] = _load_job_statuses(path) if path else []

    print(f"\n  Jenkins IT Regression — {app_name} Projects"
          f"  (page {page}/{last_page}, {total} total)")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    PID_W, TY_W, VER_W, JB_W, TS_W = 4, 10, 12, 5, 22
    print(
        "  " + BOLD(_pad("ID",           PID_W)) + "  " +
        BOLD(_pad("TYPE",          TY_W)) + "  " +
        BOLD(_pad("RELEASE",       VER_W)) + "  " +
        BOLD(_pad("JOBS",          JB_W)) + "  " +
        BOLD(_pad("TRIGGERED AT",  TS_W)) + "  " +
        BOLD("STATUS")
    )
    print("  " + GREY("-" * (PID_W + TY_W + VER_W + JB_W + TS_W + 44)))

    for pid in page_pids:
        p        = projects[pid]
        statuses = pid_statuses[pid]
        n_jobs   = len(statuses)
        ts       = p["triggered_at"][:19]
        summary  = _project_summary(statuses, n_jobs) if n_jobs else GREY("—")
        print(
            "  " + _pad(str(pid),        PID_W) + "  " +
            _pad(pid_type[pid],     TY_W) + "  " +
            _pad(p["version"],      VER_W) + "  " +
            _pad(str(n_jobs),       JB_W) + "  " +
            _pad(ts,                TS_W) + "  " +
            summary
        )

    print()
    hints = []
    if page > 1:
        hints.append(f"jregstatus{r_flag} -p {page - 1}  → previous page")
    if page < last_page:
        hints.append(f"jregstatus{r_flag} -p {page + 1}  → next page")
    for h in hints:
        print(GREY(f"  {h}"))
    print(GREY("  jregstatus -pid <id>      → live Jenkins status for a specific project"))
    print()


# ── CLI ───────────────────────────────────────────────────────

def parse_args() -> dict:
    argv, pid, reverse, page, app_name, i = sys.argv[1:], None, False, 1, "Payor", 0
    while i < len(argv):
        if argv[i] in ("-pid", "--pid") and i + 1 < len(argv):
            try:
                pid = int(argv[i + 1])
            except ValueError:
                print(f"  ERROR: -pid must be an integer, got '{argv[i + 1]}'")
                sys.exit(1)
            i += 2
        elif argv[i] in ("-r", "--reverse"):
            reverse = True
            i += 1
        elif argv[i] in ("-p", "--page") and i + 1 < len(argv):
            try:
                page = int(argv[i + 1])
                if page < 1:
                    raise ValueError
            except ValueError:
                print(f"  ERROR: -p must be a positive integer, got '{argv[i + 1]}'")
                sys.exit(1)
            i += 2
        elif argv[i] in ("-app", "--app") and i + 1 < len(argv):
            app_name = argv[i + 1].strip()
            i += 2
        elif argv[i] in ("-h", "--help"):
            print("""
  jregstatus — Jenkins IT Regression project status

  Usage:
    jregstatus                          List latest 10 projects (newest first)
    jregstatus -r                       List oldest 10 projects (oldest first)
    jregstatus -p <n>                   Go to page n (newest-first order)
    jregstatus -r -p <n>                Go to page n (oldest-first order)
    jregstatus -pid <id>                Fetch live Jenkins status for a specific project
    jregstatus --app <app>              Filter by app (Payor|Classic|Connector|Enrollment|PIK)
    jregstatus -pid <id> --app <app>    Live status for a specific project in given app

  -pid resolves queue items → build URLs, polls each build for current status,
  and writes the results back to projects/<app>/<id>_<app>_<version>.xlsx.
  On subsequent calls, already-resolved build URLs are refreshed directly.

  Credentials: secrets.xlsx → Jenkins sheet
  Run  setupjenkinsregtool  to initialise.
""")
            sys.exit(0)
        else:
            i += 1
    return {"pid": pid, "reverse": reverse, "page": page, "app_name": app_name}


def main():
    import io as _io
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    args     = parse_args()
    secrets  = load_secrets()
    app_name = args.get("app_name", "Payor")

    if args["pid"] is not None:
        print_run_details(args["pid"], secrets, app_name)
        return

    print_project_list(reverse=args["reverse"], page=args["page"], app_name=app_name)


if __name__ == "__main__":
    main()
