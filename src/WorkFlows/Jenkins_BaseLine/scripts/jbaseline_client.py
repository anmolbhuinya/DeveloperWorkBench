#!/usr/bin/env python3
"""
jbaseline_client.py — jbaselinestatus: view and refresh Jenkins IT BaseLine project status.

Usage:
  jbaselinestatus                 List latest 10 projects (newest first)
  jbaselinestatus -r              List oldest 10 projects
  jbaselinestatus -p <n>          Go to page n
  jbaselinestatus -r -p <n>       Go to page n (oldest-first)
  jbaselinestatus -pid <id>       Fetch live Jenkins status for a specific project
"""

import sys
import time as _time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import openpyxl
import filelock as _filelock

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
WORKFLOWS_ROOT = TOOL_ROOT.parent
GP_SCRIPTS     = WORKFLOWS_ROOT / "GP_Build" / "scripts"

if str(GP_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(GP_SCRIPTS))

from api_errors import session
import requests

http = session()

SECRETS_PATH    = WORKFLOWS_ROOT.parent / "secrets.xlsx"
BASELINE_CONFIG = TOOL_ROOT / "baseline_job_config.xlsx"
PROJECTS_PATH   = TOOL_ROOT / "projects.xlsx"
PROJECTS_DIR    = TOOL_ROOT / "projects"

_JB_LEASE_SECONDS = 15 * 60

def _projects_filelock():
    """Cross-process FileLock for projects.xlsx with 15-min lease eviction."""
    _lp = TOOL_ROOT / "projects.xlsx.lock"
    if _lp.exists():
        try:
            if _time.time() - _lp.stat().st_mtime > _JB_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30)

def _per_file_lock(xlsx_path: Path):
    """Cross-process FileLock for a per-project xlsx file with 15-min lease eviction."""
    _lp = xlsx_path.with_suffix(".xlsx.lock")
    if _lp.exists():
        try:
            if _time.time() - _lp.stat().st_mtime > _JB_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30)

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

PAGE_SIZE = 10

_PHASE_ORDER  = {"pre_build": 0, "certification": 1, "regression": 2}
_PHASE_LABELS = {"pre_build": "Pre-Build", "certification": "Certification", "regression": "Regression"}


def color_status(s: str) -> str:
    return STATUS_COLOR.get(s.upper(), WHITE)(s)


def _pad(s: str, w: int) -> str:
    s = str(s)
    return s[:w].ljust(w)


def _hl(url: str, text: str) -> str:
    if not url:
        return text
    return f"\x1b]8;;{url}\x1b\\{text}\x1b]8;;\x1b\\"


def _pad_hl(text: str, url: str, w: int) -> str:
    text = str(text)[:w]
    return _hl(url, text) + " " * max(0, w - len(text))


# ── Secrets ───────────────────────────────────────────────────────────────────

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


# ── Job config ────────────────────────────────────────────────────────────────

def load_job_config() -> list:
    if not BASELINE_CONFIG.exists():
        return []
    wb = openpyxl.load_workbook(str(BASELINE_CONFIG))
    if "payor" not in wb.sheetnames:
        return []
    jobs = []
    for row in wb["payor"].iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        jobs.append({
            "job_name": str(row[0]).strip(),
            "job_url":  str(row[1]).strip() if row[1] else "",
        })
    return jobs


# ── Jenkins helpers ───────────────────────────────────────────────────────────

def _is_queue_url(url: str) -> bool:
    return "/queue/item/" in (url or "")


def _pvp_matches(jenkins_value: str, stored_pvp: str) -> bool:
    """Compare a Jenkins PAYOR_VERSION_PREFIX value against the stored value.
    Normalises both sides: strips any 'staging:'/'releases:' prefix and trailing '-'."""
    if not jenkins_value or not stored_pvp:
        return False
    def _bare(s):
        parts = s.strip().split(":", 1)
        return (parts[1] if len(parts) == 2 else parts[0]).rstrip("-")
    return _bare(jenkins_value) == _bare(stored_pvp)


def _build_number_from_url(build_url: str) -> int:
    try:
        return int(build_url.rstrip('/').split('/')[-1])
    except (ValueError, IndexError):
        return 0


def _resolve_queue_item(queue_url: str, auth: tuple, expected_pvp: str = ""):
    try:
        resp = http.get(queue_url.rstrip('/') + "/api/json", auth=auth, timeout=10)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            return ""
        exe = resp.json().get("executable")
        if not (exe and exe.get("url")):
            return ""
        build_url = exe["url"].rstrip('/') + "/"
        if not expected_pvp:
            return build_url
        # Verify this build actually carries our PAYOR_VERSION_PREFIX — guards
        # against a concurrent trigger's build landing on this queue item.
        try:
            vresp = http.get(
                build_url.rstrip('/') + "/api/json?tree=actions[parameters[name,value]]",
                auth=auth, timeout=10)
            if vresp.status_code == 200:
                for action in vresp.json().get("actions", []):
                    for param in action.get("parameters", []):
                        if str(param.get("name", "")) == "PAYOR_VERSION_PREFIX":
                            if not _pvp_matches(str(param.get("value", "")), expected_pvp):
                                return None  # wrong build — trigger fallback search
                            return build_url
        except Exception:
            pass
        return build_url
    except Exception:
        return ""


def _poll_build_status(build_url: str, auth: tuple) -> str:
    try:
        resp = http.get(build_url.rstrip('/') + "/api/json?tree=result,building",
                        auth=auth, timeout=10)
        if resp.status_code != 200:
            return ""
        data = resp.json()
        return data.get("result") or ("RUNNING" if data.get("building") else "")
    except Exception:
        return ""


def _search_builds_after(job_url: str, payor_version_prefix: str,
                          auth: tuple, n: int, after_build_num: int = 0,
                          triggered_after_ms: int = 0) -> list:
    if not job_url or not payor_version_prefix or n < 1:
        return []
    api = (f"{job_url.rstrip('/')}/api/json"
           "?tree=builds[number,url,timestamp,actions[parameters[name,value]]]{0,20}")
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
                continue
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
                break
        return matches
    except Exception:
        return []


def refresh_job_group(rows: list, job_url: str,
                      payor_version_prefix: str, auth: tuple,
                      triggered_after_ms: int = 0):
    resolved_urls = [r.get("jenkins_url", "") for r in rows]
    statuses      = [r.get("completed",    "") for r in rows]
    needs_search: list = []

    for i, url in enumerate(resolved_urls):
        if not url:
            needs_search.append(i)
        elif _is_queue_url(url):
            result = _resolve_queue_item(url, auth, payor_version_prefix)
            if result:
                resolved_urls[i] = result
            elif result is None:
                resolved_urls[i] = ""
                needs_search.append(i)

    known_build_numbers: list = []
    for i, url in enumerate(resolved_urls):
        if url and not _is_queue_url(url):
            s = _poll_build_status(url, auth)
            if s:
                statuses[i] = s
            num = _build_number_from_url(url)
            if num:
                known_build_numbers.append(num)

    if needs_search and job_url and payor_version_prefix:
        after_num  = max(known_build_numbers) if known_build_numbers else 0
        found_urls = _search_builds_after(
            job_url, payor_version_prefix, auth, len(needs_search),
            after_num, triggered_after_ms
        )
        # Jenkins returns builds newest-first; reverse so the oldest (first
        # triggered) build maps to the earliest row in needs_search.
        found_urls = list(reversed(found_urls))
        for rank, i in enumerate(needs_search):
            if rank < len(found_urls):
                resolved_urls[i] = found_urls[rank]
                s = _poll_build_status(found_urls[rank], auth)
                if s:
                    statuses[i] = s

    return resolved_urls, statuses


# ── Project list ──────────────────────────────────────────────────────────────

def _find_run_xlsx(run_id: int) -> Path:
    if not PROJECTS_DIR.exists():
        return None
    matches = list(PROJECTS_DIR.glob(f"{run_id}_*.xlsx"))
    return matches[0] if matches else None


def _type_from_path(path: Path) -> str:
    parts = path.stem.split("_", 2)
    return parts[1] if len(parts) >= 2 else "?"


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
    parts = []
    if n_success:   parts.append(GREEN(f"{n_success} ok"))
    if n_running:   parts.append(CYAN(f"{n_running} running"))
    if n_unstable:  parts.append(YELLOW(f"{n_unstable} unstable"))
    if n_failed:    parts.append(RED(f"{n_failed} failed"))
    if n_fail_trig: parts.append(GREY(f"{n_fail_trig} not triggered"))
    return "  ".join(parts) if parts else GREY("—")


def print_project_list(reverse: bool = False, page: int = 1):
    if not PROJECTS_PATH.exists():
        print("  No projects.xlsx found. Run  jbaseline -payor <version>  to start a project.")
        return

    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb.active
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
        status  = str(row[col.get("completed", 4)]             or "")
        ts      = str(row[col.get("triggered_at", 6)]          or "")
        if pid not in projects:
            projects[pid] = {"version": version, "triggered_at": ts, "statuses": []}
        projects[pid]["statuses"].append(status)

    if not projects:
        print("  No projects found. Run  jbaseline -payor <version>  to create one.")
        return

    total     = len(projects)
    all_pids  = sorted(projects.keys(), reverse=not reverse)
    last_page = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page      = max(1, min(page, last_page))
    start     = (page - 1) * PAGE_SIZE
    page_pids = all_pids[start : start + PAGE_SIZE]
    r_flag    = " -r" if reverse else ""

    pid_type = {}
    for pid in page_pids:
        path = _find_run_xlsx(pid)
        pid_type[pid] = _type_from_path(path) if path else "?"

    print(f"\n  Jenkins IT BaseLine — Projects  (page {page}/{last_page}, {total} total)")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    PID_W, TY_W, VER_W, JB_W, TS_W = 4, 10, 12, 5, 22
    print(
        "  " + BOLD(_pad("ID",          PID_W)) + "  " +
        BOLD(_pad("TYPE",         TY_W)) + "  " +
        BOLD(_pad("RELEASE",      VER_W)) + "  " +
        BOLD(_pad("JOBS",         JB_W)) + "  " +
        BOLD(_pad("TRIGGERED AT", TS_W)) + "  " +
        BOLD("STATUS")
    )
    print("  " + GREY("-" * (PID_W + TY_W + VER_W + JB_W + TS_W + 44)))

    for pid in page_pids:
        p       = projects[pid]
        n_jobs  = len(p["statuses"])
        ts      = p["triggered_at"][:19]
        summary = _project_summary(p["statuses"], n_jobs)
        print(
            "  " + _pad(str(pid),      PID_W) + "  " +
            _pad(pid_type[pid],   TY_W) + "  " +
            _pad(p["version"],    VER_W) + "  " +
            _pad(str(n_jobs),     JB_W) + "  " +
            _pad(ts,              TS_W) + "  " +
            summary
        )

    print()
    hints = []
    if page > 1:
        hints.append(f"jbaselinestatus{r_flag} -p {page - 1}  → previous page")
    if page < last_page:
        hints.append(f"jbaselinestatus{r_flag} -p {page + 1}  → next page")
    for h in hints:
        print(GREY(f"  {h}"))
    print(GREY("  jbaselinestatus -pid <id>  → live Jenkins status for a specific project"))
    print()


# ── Per-run detail display ─────────────────────────────────────────────────────

def _write_back(path: Path, all_rows: list,
                resolved_urls: list, statuses: list, col_map: dict):
    try:
        with _per_file_lock(path):
            wb = openpyxl.load_workbook(str(path))
            if "jobs" not in wb.sheetnames:
                return
            ws  = wb["jobs"]
            jc  = col_map.get("jenkins_url", 5) + 1
            sc  = col_map.get("completed",   2) + 1
            for i, (url, status) in enumerate(zip(resolved_urls, statuses)):
                row_num = i + 2
                ws.cell(row_num, jc, url)
                ws.cell(row_num, sc, status)
            wb.save(str(path))
    except PermissionError:
        pass


def print_run_details(run_id: int, secrets: dict):
    path = _find_run_xlsx(run_id)
    if not path:
        print(f"  ERROR: No run file found for project_id {run_id} in projects/")
        sys.exit(1)

    project_type = _type_from_path(path)
    with _per_file_lock(path):
        wb       = openpyxl.load_workbook(str(path))
    info         = {}
    payor_version_prefix = ""

    if "info" in wb.sheetnames:
        for row in wb["info"].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                info[str(row[0]).strip()] = str(row[1]).strip()
        payor_version_prefix = info.get("PAYOR_VERSION_PREFIX", "")

        release_ver = info.get("release_version", "?")
        print(f"\n  Jenkins IT BaseLine — Run #{run_id}  ({release_ver})")
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

    ws_j    = wb["jobs"]
    headers = [str(c.value).strip() if c.value else "" for c in ws_j[1]]
    col_map = {h: i for i, h in enumerate(headers)}

    all_rows = []
    for row in ws_j.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        all_rows.append({
            "job_name":     str(row[col_map.get("job_name",     0)] or ""),
            "phase":        str(row[col_map.get("phase",        1)] or ""),
            "completed":    str(row[col_map.get("completed",    2)] or ""),
            "job_id":       str(row[col_map.get("job_id",       3)] or ""),
            "triggered_at": str(row[col_map.get("triggered_at", 4)] or ""),
            "jenkins_url":  str(row[col_map.get("jenkins_url",  5)] or ""),
        })

    if not all_rows:
        print("  (no job rows)")
        return

    # Build job_url lookup from baseline_job_config.xlsx
    job_url_map: dict = {}
    cfg_jobs = load_job_config()
    for j in cfg_jobs:
        job_url_map[j["job_name"]] = j["job_url"]

    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth     = (username, token) if username and token else None

    # Group rows by job_name for refresh
    groups: defaultdict = defaultdict(list)
    for idx, jd in enumerate(all_rows):
        groups[jd["job_name"]].append((idx, jd))

    resolved_urls = [jd["jenkins_url"] for jd in all_rows]
    statuses      = [jd["completed"]   for jd in all_rows]

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

    # Display grouped by phase
    JN_W, RN_W, ST_W, TS_W = 28, 14, 14, 20

    # Group indices by phase in display order
    phase_groups: dict = defaultdict(list)
    for idx, jd in enumerate(all_rows):
        phase_groups[jd["phase"]].append(idx)

    ordered_phases = sorted(phase_groups.keys(),
                            key=lambda p: _PHASE_ORDER.get(p, 99))

    for phase in ordered_phases:
        label = _PHASE_LABELS.get(phase, phase.replace("_", " ").title())
        print(f"  {BOLD(label)}")
        print("  " + GREY("─" * (JN_W + RN_W + ST_W + TS_W + 6)))
        print(
            "  " +
            BOLD(_pad("JOB NAME",     JN_W)) + "  " +
            BOLD(_pad("PHASE",        RN_W)) + "  " +
            BOLD(_pad("STATUS",       ST_W)) + "  " +
            BOLD(_pad("TRIGGERED AT", TS_W))
        )
        print("  " + GREY("-" * (JN_W + RN_W + ST_W + TS_W + 6)))

        for idx in phase_groups[phase]:
            jd  = all_rows[idx]
            ts  = jd["triggered_at"][:19] if jd["triggered_at"] else ""
            url = resolved_urls[idx]
            print(
                "  " +
                _pad(jd["job_name"],           JN_W) + "  " +
                _pad(jd["phase"],              RN_W) + "  " +
                _pad(color_status(statuses[idx]), ST_W + 12) + "  " +
                _pad(ts,                       TS_W)
            )
            if url:
                label_url = "queue" if _is_queue_url(url) else "build"
                print(f"    {GREY(f'[{label_url}] {url}')}")
        print()


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args() -> dict:
    argv, pid, reverse, page, i = sys.argv[1:], None, False, 1, 0
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
        elif argv[i] in ("-h", "--help"):
            print("""
  jbaselinestatus — Jenkins IT BaseLine project status

  Usage:
    jbaselinestatus                  List latest 10 projects (newest first)
    jbaselinestatus -r               List oldest 10 projects
    jbaselinestatus -p <n>           Go to page n
    jbaselinestatus -r -p <n>        Go to page n (oldest-first)
    jbaselinestatus -pid <id>        Fetch live Jenkins status for a specific project

  Credentials: secrets.xlsx → Jenkins sheet
  Run  setupjbaselinetool  to initialise.
""")
            sys.exit(0)
        else:
            i += 1
    return {"pid": pid, "reverse": reverse, "page": page}


def main():
    import io as _io
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    args    = parse_args()
    secrets = load_secrets()

    if args["pid"] is not None:
        print_run_details(args["pid"], secrets)
        return

    print_project_list(reverse=args["reverse"], page=args["page"])


if __name__ == "__main__":
    main()
