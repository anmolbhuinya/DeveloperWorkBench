#!/usr/bin/env python3
"""
jbaseline_tool.py — Jenkins IT BaseLine trigger tool

Usage:
  jbaseline -payor <release_version>

Workflow:
  Trigger payor-utils-certification + all baseline regression jobs.
  (payor-core-commit is exclusively handled by the Jenkins Commit Job tool.)
"""

import sys
import io
import re
import time as _time
from pathlib import Path
from datetime import datetime
from urllib.parse import urlencode, urlparse
import openpyxl
from openpyxl.styles import Font, PatternFill
import filelock as _filelock

SCRIPT_DIR      = Path(__file__).resolve().parent
TOOL_ROOT       = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "Jenkins_BaseLine"        # project data: <DWB>\Projects\WorkFlows\Jenkins_BaseLine
DATA_ROOT.mkdir(parents=True, exist_ok=True)
WORKFLOWS_ROOT  = TOOL_ROOT.parent
GP_SCRIPTS      = WORKFLOWS_ROOT / "GP_Build" / "scripts"

if str(GP_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(GP_SCRIPTS))

from api_errors import session
import requests

http = session()

SECRETS_PATH     = WORKFLOWS_ROOT.parent / "secrets.xlsx"
BASELINE_CONFIG  = TOOL_ROOT / "baseline_job_config.xlsx"
PROJECTS_PATH   = DATA_ROOT / "projects.xlsx"
PROJECTS_DIR    = DATA_ROOT / "projects" / "Payor"

_JB_LEASE_SECONDS = 15 * 60

def _projects_filelock():
    """Cross-process FileLock for projects.xlsx with 15-min lease eviction."""
    _lp = DATA_ROOT / "projects.xlsx.lock"
    if _lp.exists():
        try:
            if _time.time() - _lp.stat().st_mtime > _JB_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30)

PARAMS_DIR      = TOOL_ROOT / "jenkins_params"
GIT_CONFIG_PATH = TOOL_ROOT / "git_config.xlsx"

PROJ_COLS = ["project_id", "payor_release_version", "runs", "status", "triggered_at"]
COL = {c: i + 1 for i, c in enumerate(PROJ_COLS)}

_HDR_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
_HDR_FILL = PatternFill("solid", fgColor="1F3864")

_SYSTEM_BROWSER_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


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


def load_github_token() -> str:
    if not SECRETS_PATH.exists():
        return ""
    wb = openpyxl.load_workbook(str(SECRETS_PATH))
    if "GitHub" not in wb.sheetnames:
        return ""
    for row in wb["GitHub"].iter_rows(min_row=2, values_only=True):
        if row[0] and str(row[0]).strip() == "github_token":
            return str(row[1]).strip() if row[1] else ""
    return ""


# ── Config loading ─────────────────────────────────────────────────────────────

def load_job_config() -> list:
    if not BASELINE_CONFIG.exists():
        print("  ERROR: baseline_job_config.xlsx not found. Run  setupjbaselinetool  first.")
        sys.exit(1)
    wb = openpyxl.load_workbook(str(BASELINE_CONFIG))
    if "payor" not in wb.sheetnames:
        print("  ERROR: baseline_job_config.xlsx has no 'payor' sheet.")
        sys.exit(1)
    ws = wb["payor"]
    hdrs = [str(c.value or "").strip().lower() for c in ws[1]]
    jobs = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        d = {hdrs[i]: (str(v or "").strip() if v is not None else "") for i, v in enumerate(row) if i < len(hdrs)}
        if d.get("enabled", "1") in ("0", "false", "no"):
            continue
        jobs.append({
            "job_name": d.get("job_name", ""),
            "job_url":  d.get("job_url", ""),
        })
    if not jobs:
        print("  ERROR: No jobs in baseline_job_config.xlsx payor sheet.")
        sys.exit(1)
    return jobs


def load_jenkins_params(job_name: str, app_name: str = "Payor") -> dict:
    params_file = PARAMS_DIR / app_name / f"payor_{job_name}_jenkins_params.xlsx"
    if not params_file.exists():
        return {}
    wb = openpyxl.load_workbook(str(params_file))
    if "BuildParameters" not in wb.sheetnames:
        return {}
    out = {}
    for row in wb["BuildParameters"].iter_rows(min_row=2, values_only=True):
        if row[0]:
            val = str(row[1]).strip() if row[1] is not None else ""
            out[str(row[0]).strip()] = val
    return out


def _create_git_config():
    from openpyxl.styles import Alignment, PatternFill as _PF
    HDR_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
    HDR_FILL = _PF("solid", fgColor="1F3864")
    A_ALIGN  = Alignment(horizontal="left", vertical="center")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "repos"
    ws.append(["name", "repo_url"])
    for i in range(1, 3):
        c = ws.cell(1, i)
        c.font = HDR_FONT; c.fill = HDR_FILL; c.alignment = A_ALIGN
    ws.append(["payor", "https://github.com/HE-Core/hrp.payer.core/"])
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 80
    wb.save(str(GIT_CONFIG_PATH))
    print(f"  [create] git_config.xlsx (default payor repo URL)")


def load_git_config() -> dict:
    if not GIT_CONFIG_PATH.exists():
        _create_git_config()
    wb = openpyxl.load_workbook(str(GIT_CONFIG_PATH))
    if "repos" not in wb.sheetnames:
        return {}
    out = {}
    for row in wb["repos"].iter_rows(min_row=2, values_only=True):
        if row[0] and row[1]:
            out[str(row[0]).strip().lower()] = str(row[1]).strip()
    return out


# ── pom.xml fetch ──────────────────────────────────────────────────────────────

def _github_api_url(repo_url: str, branch: str, file_path: str) -> str:
    parsed = urlparse(repo_url.rstrip('/'))
    path   = parsed.path.strip('/')
    return f"https://api.github.com/repos/{path}/contents/{file_path}?ref={branch}"


def _numeric_prefix(v: str) -> str:
    """Strip build timestamps and SNAPSHOT suffix, keeping only leading numeric version."""
    v = re.sub(r'-SNAPSHOT$', '', v.strip())
    m = re.match(r'^(\d+(?:\.\d+)*)', v)
    return m.group(1) if m else v


def _parse_pom(content: str) -> dict:
    clean = re.sub(r'<parent>.*?</parent>', '', content, flags=re.DOTALL)
    m     = re.search(r'<version>([^<]+)</version>', clean)
    pv    = _numeric_prefix(m.group(1)) if m else ""
    m_bc  = re.search(r'<bluecardConfig\.version>([^<]+)</bluecardConfig\.version>', content)
    m_du  = re.search(r'<data-universe\.version>([^<]+)</data-universe\.version>', content)
    return {
        "payor_version_prefix":           pv,
        "bluecard_config_version_prefix": _numeric_prefix(m_bc.group(1)) if m_bc else "",
        "datauniverse_version_prefix":    _numeric_prefix(m_du.group(1)) if m_du else "",
    }


def fetch_pom_versions(release_version: str, repo_url: str, gh_token: str) -> dict:
    import base64 as _b64
    branch  = f"release-{release_version}"
    api_url = _github_api_url(repo_url, branch, "pom.xml")
    headers = {"Accept": "application/vnd.github.v3+json"}
    if gh_token:
        headers["Authorization"] = f"token {gh_token}"
    def _do_get(verify_ssl):
        return http.get(api_url, headers=headers, timeout=20, verify=verify_ssl)
    try:
        try:
            resp = _do_get(True)
        except requests.exceptions.SSLError:
            resp = _do_get(False)
        if resp.status_code == 404:
            print(f"  [warning] pom.xml not found on branch '{branch}'.")
            return {}
        if resp.status_code in (401, 403):
            print(f"  [warning] GitHub HTTP {resp.status_code} — check github_token in secrets.xlsx.")
            return {}
        resp.raise_for_status()
        data    = resp.json()
        content = _b64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return _parse_pom(content)
    except requests.exceptions.ConnectionError:
        print("  [warning] Cannot reach GitHub — pom.xml skipped.")
        return {}
    except Exception as e:
        print(f"  [warning] pom.xml fetch: {e}")
        return {}


# ── Param injection ────────────────────────────────────────────────────────────

def _staging(v: str, trailing_dash: bool = False) -> str:
    v = v.strip()
    if trailing_dash and not v.endswith("-"):
        v = v + "-"
    return f"staging:{v}" if not v.startswith("staging:") else v


def apply_pom_params(params: dict, pom: dict) -> dict:
    _PLACEHOLDER = "staging:latest"
    updated = dict(params)
    if pom.get("payor_version_prefix"):
        cur = updated.get("PAYOR_VERSION_PREFIX", "")
        if not cur or cur.lower() == _PLACEHOLDER:
            updated["PAYOR_VERSION_PREFIX"] = _staging(pom["payor_version_prefix"], trailing_dash=True)
    if pom.get("bluecard_config_version_prefix"):
        cur = updated.get("BLUECARD_CONFIG_VERSION_PREFIX", "")
        if not cur or cur.lower() == _PLACEHOLDER:
            updated["BLUECARD_CONFIG_VERSION_PREFIX"] = _staging(pom["bluecard_config_version_prefix"], trailing_dash=True)
    if pom.get("datauniverse_version_prefix"):
        cur = updated.get("DATAUNIVERSE_VERSION_PREFIX", "")
        if not cur or cur.lower() == _PLACEHOLDER:
            updated["DATAUNIVERSE_VERSION_PREFIX"] = _staging(pom["datauniverse_version_prefix"], trailing_dash=True)
    return updated


def _ver(v: str) -> tuple:
    parts, result = v.strip().split("."), []
    for p in parts[:4]:
        try:
            result.append(int(p))
        except ValueError:
            result.append(0)
    while len(result) < 4:
        result.append(0)
    return tuple(result)


def _base_image(v: tuple) -> str:
    if v >= (26, 1, 100, 0):
        return "he-rhel-8.10-jdk-11.0.30_7-mvn-3.9.2-tc-9.0.117-art-2.36.0:20260520135507"
    if v >= (26, 1, 0, 0):
        return "he-rhel-8.10-jdk-11.0.26_4-mvn-3.9.2-tc-9.0.104-art-2.36.0"
    if v >= (24, 2, 0, 0):
        return "he-rhel-8.10-jdk-11.0.32-mvn-3.9.2-wl-14.1.1.0.0.260728:20260914093917"
    if v >= (23, 4, 0, 0):
        return "he-rhel-8.10-jdk-11.0.32-8u501-mvn-3.3.9-wl-14.1.1.0.0.260728:20260914102506"
    return "he-rhel-8.10-jdk-8u501-mvn-3.3.9-wl-12.2.1.4.0.260728:20260914112517"


_DB_IMAGES = [
    ((26, 1), "oracledb:19.30-26.1-ext"),
    ((25, 1), "oracledb:19.30-25.1-ext"),
    ((24, 1), "oracledb:19.22-24.1-ext"),
    ((22, 1), "oracledbee:19.22-22.1-ext"),
    ((0,  0), "oracledb:19.27-21.5-ext"),
]


def _db_image(v: tuple) -> str:
    v2 = (v[0], v[1])
    for (maj, mn), img in sorted(_DB_IMAGES, reverse=True):
        if v2 >= (maj, mn):
            return img
    return _DB_IMAGES[-1][1]


def _ces_host(v: tuple) -> str:
    if v >= (23, 4, 0, 0):
        return "heeng-ces-08"
    if v >= (22, 3, 0, 0):
        return "heeng-ces-07"
    return "heeng-ces-06"


def apply_version_defaults(params: dict, release_version: str) -> dict:
    _PH = "staging:latest"
    v = _ver(release_version)
    updated = dict(params)
    if not updated.get("PAYOR_VERSION_PREFIX") or updated["PAYOR_VERSION_PREFIX"].lower() == _PH:
        updated["PAYOR_VERSION_PREFIX"] = _staging(release_version, trailing_dash=True)
    if not updated.get("BASE_IMAGE_NAME"):
        updated["BASE_IMAGE_NAME"] = _base_image(v)
    if not updated.get("DB_IMAGE_NAME"):
        updated["DB_IMAGE_NAME"] = _db_image(v)
    if not updated.get("CES_SERVER_HOST"):
        updated["CES_SERVER_HOST"] = _ces_host(v)
    return updated


# ── Playwright helpers ─────────────────────────────────────────────────────────

def _system_browser_path():
    import os as _os
    return next((p for p in _SYSTEM_BROWSER_PATHS if _os.path.exists(p)), None)




def trigger_job_playwright(job_url: str, params: dict, secrets: dict):
    """Trigger a parameterized Jenkins job via /build with JSON body."""
    import json as _json
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  [Playwright] Not installed. Run: pip install playwright")
        return False, ""

    username = secrets.get("jenkins_username", "")
    password = secrets.get("jenkins_password", "")
    if not username or not password:
        print("  [Playwright] jenkins_password missing in secrets.xlsx (Jenkins sheet).")
        return False, ""

    clean       = {k: v for k, v in params.items() if v is not None and str(v).strip()}
    json_params = {"parameter": [{"name": k, "value": str(v)} for k, v in clean.items()]}
    parsed      = urlparse(job_url)
    base_url    = f"{parsed.scheme}://{parsed.netloc}"
    sys_browser = _system_browser_path()

    try:
        with sync_playwright() as pw:
            launch_opts = {"headless": True}
            if sys_browser:
                launch_opts["executable_path"] = sys_browser
            browser = pw.chromium.launch(**launch_opts)
            ctx     = browser.new_context(ignore_https_errors=True)
            page    = ctx.new_page()

            page.goto(f"{base_url}/login", timeout=30000)
            page.fill("#j_username", username)
            page.fill("[name='j_password']", password)
            page.click("[name='Submit']")
            page.wait_for_load_state("networkidle", timeout=20000)
            if "/login" in page.url:
                print("  [Playwright] Login failed.")
                browser.close()
                return False, ""

            qs   = urlencode(clean)
            burl = f"{job_url.rstrip('/')}/buildWithParameters?{qs}" if qs else \
                   f"{job_url.rstrip('/')}/buildWithParameters"
            page.goto(burl, timeout=20000)
            page.wait_for_load_state("domcontentloaded", timeout=15000)

            crumb_info = page.evaluate(
                """
                () => {
                    const head  = document.head;
                    const crumb = head.getAttribute('data-crumb-value') || '';
                    const field = head.getAttribute('data-crumb-header') || 'Jenkins-Crumb';
                    return {crumb, field};
                }
                """
            )
            crumb = crumb_info.get("crumb", "")
            field = crumb_info.get("field", "Jenkins-Crumb")

            if not crumb:
                print("  [Playwright] no crumb in page head")
                browser.close()
                return False, ""

            build_url = f"{job_url.rstrip('/')}/build"
            body      = urlencode({"json": _json.dumps(json_params), "delay": "0sec"})
            resp   = None
            status = 0
            loc    = ""
            try:
                resp = ctx.request.post(
                    build_url,
                    headers={
                        field: crumb,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data=body,
                )
                status = resp.status
                loc    = resp.headers.get("location", "")
            except Exception as req_e:
                print(f"  [Playwright] ctx.request.post error: {req_e}")
                browser.close()
                return (True, "") if resp is not None else (False, "")

            print(f"  [Playwright] status={status}" + (f" loc={loc}" if loc else ""))
            browser.close()

            if status in (200, 201):
                if loc:
                    full = loc if loc.startswith("http") else f"{base_url}{loc}"
                    if "/queue/item/" in full:
                        return True, full
                final_url = getattr(resp, "url", "") or ""
                if "/queue/item/" in final_url:
                    return True, final_url.rstrip("/") + "/"
                return True, ""
            if status in (302, 303):
                full_loc = loc if loc.startswith("http") else f"{base_url}{loc}"
                if "/queue/item/" in full_loc:
                    return True, full_loc
                return True, ""  # redirect to non-queue page — triggered but no queue URL
            if status in (401, 403):
                print(f"  [Playwright] HTTP {status} — auth failure")
                return False, ""
            print(f"  [Playwright] HTTP {status} — assuming triggered to prevent double-fire")
            return True, ""
    except Exception as e:
        print(f"  [Playwright] {e}")
        return False, ""


def trigger_job(job_url: str, params: dict, secrets: dict):
    ok, queue_url = trigger_job_playwright(job_url, params, secrets)
    return ok, queue_url


# ── projects.xlsx ──────────────────────────────────────────────────────────────

def next_run_id() -> int:
    if not PROJECTS_PATH.exists():
        return 1
    with _projects_filelock():
        wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws  = wb["Payor"] if "Payor" in wb.sheetnames else wb.active
    max_id = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] is not None:
            try:
                max_id = max(max_id, int(row[0]))
            except (ValueError, TypeError):
                pass
    return max_id + 1


def append_run(run_id, release_version, runs, status, triggered_at):
    if not PROJECTS_PATH.exists():
        print("  ERROR: projects.xlsx not found. Run  setupjbaselinetool  first.")
        return
    with _projects_filelock():
        wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws  = wb["Payor"] if "Payor" in wb.sheetnames else wb.active
        row = ws.max_row + 1
        ws.cell(row, COL["project_id"],            run_id)
        ws.cell(row, COL["payor_release_version"], release_version)
        ws.cell(row, COL["runs"],                  runs)
        ws.cell(row, COL["status"],                status)
        ws.cell(row, COL["triggered_at"],          triggered_at)
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not save projects.xlsx (file may be open).")


def update_run_status(run_id, status):
    """Update the status cell for an existing run_id row in projects.xlsx."""
    if not PROJECTS_PATH.exists():
        return
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb["Payor"] if "Payor" in wb.sheetnames else wb.active
        for row_idx in range(2, ws.max_row + 1):
            if ws.cell(row_idx, COL["project_id"]).value == run_id:
                ws.cell(row_idx, COL["status"], status)
                break
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not update projects.xlsx status (file may be open).")


def _info_hdr(ws, title: str):
    from openpyxl.styles import Alignment
    ws.append([title])
    c = ws.cell(1, 1)
    c.font      = _HDR_FONT
    c.fill      = _HDR_FILL
    c.alignment = Alignment(horizontal="left", vertical="center")


def create_run_xlsx(run_id: int, release_version: str,
                    pom: dict, v: tuple, run_jobs: list) -> Path:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    safe = release_version.replace("/", "_").replace("\\", "_")
    out  = PROJECTS_DIR / f"{run_id}_payor_{safe}.xlsx"

    wb   = openpyxl.Workbook()
    ws_i = wb.active
    ws_i.title = "info"
    ws_i.column_dimensions["A"].width = 36
    ws_i.column_dimensions["B"].width = 80

    _info_hdr(ws_i, "Run Information")

    info_rows = [
        ("release_version",               release_version),
        ("triggered_at",                  datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        ("PAYOR_VERSION_PREFIX",          pom.get("payor_version_prefix", "(not fetched)")),
        ("BLUECARD_CONFIG_VERSION_PREFIX", pom.get("bluecard_config_version_prefix", "(not fetched)")),
        ("DATAUNIVERSE_VERSION_PREFIX",   pom.get("datauniverse_version_prefix", "(not fetched)")),
        ("BASE_IMAGE_NAME",               _base_image(v)),
        ("DB_IMAGE_NAME",                 _db_image(v)),
        ("CES_SERVER_HOST",               _ces_host(v)),
    ]
    for k, val in info_rows:
        ws_i.append([k, val])

    ws_j = wb.create_sheet(title="jobs")
    ws_j.column_dimensions["A"].width = 26
    ws_j.column_dimensions["B"].width = 14
    ws_j.column_dimensions["C"].width = 14
    ws_j.column_dimensions["D"].width = 10
    ws_j.column_dimensions["E"].width = 22
    ws_j.column_dimensions["F"].width = 70

    job_cols = ["job_name", "phase", "completed", "job_id", "triggered_at", "jenkins_url", "job_url"]
    ws_j.append(job_cols)
    for i, _ in enumerate(job_cols, 1):
        c = ws_j.cell(1, i)
        c.font = _HDR_FONT
        c.fill = _HDR_FILL

    for jd in run_jobs:
        ws_j.append([
            jd.get("job_name",     ""),
            jd.get("phase",        ""),
            jd.get("completed",    ""),
            jd.get("job_id",       ""),
            jd.get("triggered_at", ""),
            jd.get("jenkins_url",  ""),
            jd.get("job_url",      ""),
        ])

    wb.save(str(out))
    return out


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args() -> dict:
    argv     = sys.argv[1:]
    payor    = None
    explicit = {}
    _EXPLICIT_FLAGS = {
        "-PAYOR_VERSION_PREFIX":          "PAYOR_VERSION_PREFIX",
        "-BLUECARD_CONFIG_VERSION_PREFIX": "BLUECARD_CONFIG_VERSION_PREFIX",
        "-DATAUNIVERSE_VERSION_PREFIX":    "DATAUNIVERSE_VERSION_PREFIX",
        "-BASE_IMAGE_NAME":               "BASE_IMAGE_NAME",
        "-DB_IMAGE_NAME":                 "DB_IMAGE_NAME",
        "-CES_SERVER_HOST":               "CES_SERVER_HOST",
    }
    i = 0
    while i < len(argv):
        if argv[i] in ("-payor", "--payor") and i + 1 < len(argv):
            payor = argv[i + 1]
            i += 2
        elif argv[i] in _EXPLICIT_FLAGS and i + 1 < len(argv):
            explicit[_EXPLICIT_FLAGS[argv[i]]] = argv[i + 1].strip()
            i += 2
        elif argv[i] in ("-h", "--help"):
            print("""
  jbaseline — Jenkins IT BaseLine trigger tool

  Usage:
    jbaseline -payor <release_version>

  Workflow:
    Trigger payor-utils-certification + all baseline regression jobs.
    (payor-core-commit is exclusively run by the Jenkins Commit Job tool.)

  Credentials: secrets.xlsx → Jenkins sheet
  Run  setupjbaselinetool  to initialise.
""")
            sys.exit(0)
        else:
            i += 1

    if not payor:
        print("  ERROR: -payor <release_version> is required.")
        print("  Usage: jbaseline -payor 26.1.1.1")
        sys.exit(1)

    return {"payor": payor, "explicit": explicit}



def _save_and_exit(run_id, release_version, pom, v, run_jobs):
    out_path = create_run_xlsx(run_id, release_version, pom, v, run_jobs)
    triggered = sum(1 for rj in run_jobs if rj.get("completed") != "Trigger Failed")
    total     = len(run_jobs)
    print(f"  {triggered}/{total} jobs triggered.")
    print(f"  Run history  : projects.xlsx")
    print(f"  Run details  : projects/{out_path.name}")
    print(f"  View details : jbaselinestatus -pid {run_id}  (project_id = {run_id})")
    print()


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True)

    args            = parse_args()
    release_version = args["payor"]
    explicit        = args.get("explicit", {})
    secrets         = load_secrets()

    _EXCLUDED = {"payor_core_commit", "payor_utils_certification"}
    all_jobs = [j for j in load_job_config() if j["job_name"] not in _EXCLUDED]
    for job in all_jobs:
        job["job_url"] = job["job_url"].replace("{version}", release_version)

    regression_jobs = list(all_jobs)

    git_cfg  = load_git_config()
    repo_url = git_cfg.get("payor", "")
    gh_token = load_github_token()
    pom      = {}
    if repo_url:
        display_url = f"{repo_url.rstrip('/')}/blob/release-{release_version}/pom.xml"
        print(f"\n  Fetching pom.xml  →  {display_url}")
        pom = fetch_pom_versions(release_version, repo_url, gh_token)

    v = _ver(release_version)

    print(f"\n  Jenkins IT BaseLine")
    print(f"  Release version : {release_version}")
    print(f"  Jobs            : {len(all_jobs)}")
    print()

    # Effective value: explicit CLI override > pom value > version-derived default
    pvp  = explicit.get("PAYOR_VERSION_PREFIX") or (_staging(pom["payor_version_prefix"], trailing_dash=True) if pom.get("payor_version_prefix") else _staging(release_version, trailing_dash=True))
    bcvp = explicit.get("BLUECARD_CONFIG_VERSION_PREFIX") or (_staging(pom["bluecard_config_version_prefix"], trailing_dash=True) if pom.get("bluecard_config_version_prefix") else "(not fetched)")
    duvp = explicit.get("DATAUNIVERSE_VERSION_PREFIX") or (_staging(pom["datauniverse_version_prefix"], trailing_dash=True) if pom.get("datauniverse_version_prefix") else "(not fetched)")
    print(f"  PAYOR_VERSION_PREFIX           : {pvp}")
    print(f"  BLUECARD_CONFIG_VERSION_PREFIX : {bcvp}")
    print(f"  DATAUNIVERSE_VERSION_PREFIX    : {duvp}")
    print()

    print(f"  BASE_IMAGE_NAME  : {explicit.get('BASE_IMAGE_NAME') or _base_image(v)}")
    print(f"  DB_IMAGE_NAME    : {explicit.get('DB_IMAGE_NAME') or _db_image(v)}")
    print(f"  CES_SERVER_HOST  : {explicit.get('CES_SERVER_HOST') or _ces_host(v)}")
    print()

    run_id      = next_run_id()
    run_jobs    = []
    triggered   = 0
    start_ts    = datetime.now().isoformat(timespec="seconds")

    append_run(run_id, release_version, 1, "Running", start_ts)

    # ── Regression jobs ────────────────────────────────────────────────────────
    _POM_JENKINS_KEYS = {
        "PAYOR_VERSION_PREFIX":           "payor_version_prefix",
        "BLUECARD_CONFIG_VERSION_PREFIX":  "bluecard_config_version_prefix",
        "DATAUNIVERSE_VERSION_PREFIX":     "datauniverse_version_prefix",
    }

    for job in regression_jobs:
        print(f"  [{run_id}] {job['job_name']}  (Regression)")

        params = load_jenkins_params(job["job_name"])
        # Step 1: pom.xml overrides — if pom has a non-empty value, override unconditionally
        for jenkins_key, pom_key in _POM_JENKINS_KEYS.items():
            pom_val = pom.get(pom_key, "").strip()
            if pom_val:
                params[jenkins_key] = _staging(pom_val, trailing_dash=True)
        # Step 2: explicit CLI/UI overrides — if non-empty, override unconditionally
        for _k, _v in explicit.items():
            if _v:
                params[_k] = _v
        ok, q_url = trigger_job(job["job_url"], params, secrets)

        ts        = datetime.now().isoformat(timespec="seconds")
        completed = "Scheduled" if ok else "Trigger Failed"
        triggered += 1 if ok else 0

        run_jobs.append({"job_name": job["job_name"], "phase": "regression",
                         "completed": completed, "job_id": "", "triggered_at": ts,
                         "jenkins_url": q_url, "job_url": job["job_url"]})
        print()

    status = f"{triggered}/{len(regression_jobs)} triggered"
    update_run_status(run_id, status)
    print(f"  {triggered}/{len(regression_jobs)} jobs triggered successfully.")
    _save_and_exit(run_id, release_version, pom, v, run_jobs)


if __name__ == "__main__":
    main()
