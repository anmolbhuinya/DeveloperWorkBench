#!/usr/bin/env python3
"""
jreg_tool.py — Jenkins IT Regression trigger tool

Usage:
  jenkinsregression -payor <release_version> [-runs <n>]
  jreg              -payor <release_version> [-runs <n>]

  Fetches pom.xml from GitHub (release-<version> branch) to resolve:
    PAYOR_VERSION_PREFIX, BLUECARD_CONFIG_VERSION_PREFIX, DATAUNIVERSE_VERSION_PREFIX
  BASE_IMAGE_NAME, DB_IMAGE_NAME, CES_SERVER_HOST are resolved from the version rules.
"""

import os
import sys
import re
import time
from pathlib import Path
from datetime import datetime
from urllib.parse import urlencode, urlparse
import openpyxl
from openpyxl.styles import Font, PatternFill
try:
    import filelock as _filelock
    _FILELOCK_AVAILABLE = True
except ImportError:
    _FILELOCK_AVAILABLE = False

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")) / "WorkFlows" / "Jenkins_IT_Regression"        # project data: <DWB>\DWB_Projects\WorkFlows\Jenkins_IT_Regression
DATA_ROOT.mkdir(parents=True, exist_ok=True)
WORKFLOWS_ROOT = TOOL_ROOT.parent
GP_SCRIPTS     = WORKFLOWS_ROOT / "GP_Build" / "scripts"

if str(GP_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(GP_SCRIPTS))

from api_errors import session, jenkins_error, connection_error
import requests

http = session()

SECRETS_PATH  = WORKFLOWS_ROOT.parent / "secrets.xlsx"
REG_CONFIG    = TOOL_ROOT / "reg_job_config.xlsx"
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"
PROJECTS_DIR  = DATA_ROOT / "projects"
GIT_CONFIG    = TOOL_ROOT / "git_config.xlsx"

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

APP_NAMES = ['Payor', 'Classic', 'Connector', 'Enrollment', 'PIK']

def _params_dir(app_name: str) -> Path:
    return TOOL_ROOT / "jenkins_params" / app_name

def _app_projects_dir(app_name: str) -> Path:
    return PROJECTS_DIR / app_name

PROJ_COLS = ["project_id", "payor_release_version", "runs", "status", "triggered_at"]
COL = {c: i + 1 for i, c in enumerate(PROJ_COLS)}

_HDR_FONT = Font(bold=True, color="FFFFFF", name="Calibri")
_HDR_FILL = PatternFill("solid", fgColor="1F3864")


# ── Secrets ──────────────────────────────────────────────────────────────────

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


# ── Config loading ────────────────────────────────────────────────────────────

def load_job_config() -> list:
    if not REG_CONFIG.exists():
        print("  ERROR: reg_job_config.xlsx not found. Run  setupjenkinsregtool  first.")
        sys.exit(1)
    wb = openpyxl.load_workbook(str(REG_CONFIG))
    if "payor" not in wb.sheetnames:
        print("  ERROR: reg_job_config.xlsx has no 'payor' sheet.")
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
        print("  ERROR: No jobs in reg_job_config.xlsx payor sheet. Fill in job URLs.")
        sys.exit(1)
    return jobs


def load_jenkins_params(job_name: str, app_name: str = "Payor") -> dict:
    params_file = _params_dir(app_name) / f"{app_name.lower()}_{job_name}_jenkins_params.xlsx"
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
    """Create git_config.xlsx with default payor repo URL."""
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
    wb.save(str(GIT_CONFIG))
    print(f"  [create] git_config.xlsx (default payor repo URL)")
    print(f"           Edit {GIT_CONFIG} → repos sheet if the URL is wrong.")


def load_git_config() -> dict:
    """Returns {name: repo_url} from git_config.xlsx repos sheet. Auto-creates if missing."""
    if not GIT_CONFIG.exists():
        _create_git_config()
    wb = openpyxl.load_workbook(str(GIT_CONFIG))
    if "repos" not in wb.sheetnames:
        return {}
    out = {}
    for row in wb["repos"].iter_rows(min_row=2, values_only=True):
        if row[0] and row[1]:
            out[str(row[0]).strip().lower()] = str(row[1]).strip()
    return out


# ── pom.xml fetch + parse ─────────────────────────────────────────────────────

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
    # Strip <parent> block so the first <version> we find is the project version
    clean = re.sub(r'<parent>.*?</parent>', '', content, flags=re.DOTALL)

    m  = re.search(r'<version>([^<]+)</version>', clean)
    pv = _numeric_prefix(m.group(1)) if m else ""

    m_bc = re.search(r'<bluecardConfig\.version>([^<]+)</bluecardConfig\.version>', content)
    m_du = re.search(r'<data-universe\.version>([^<]+)</data-universe\.version>', content)

    return {
        "payor_version_prefix":            pv,
        "bluecard_config_version_prefix":  _numeric_prefix(m_bc.group(1)) if m_bc else "",
        "datauniverse_version_prefix":     _numeric_prefix(m_du.group(1)) if m_du else "",
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
            print(f"  [warning] GitHub HTTP {resp.status_code} — check github_token in secrets.xlsx (GitHub sheet).")
            return {}
        resp.raise_for_status()
        data    = resp.json()
        content = _b64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return _parse_pom(content)
    except requests.exceptions.ConnectionError:
        print("  [warning] Cannot reach GitHub — pom.xml skipped. Check VPN.")
        return {}
    except Exception as e:
        print(f"  [warning] pom.xml fetch: {e}")
        return {}


# ── Param injection ───────────────────────────────────────────────────────────

def _staging(v: str, trailing_dash: bool = False) -> str:
    """Prepend 'staging:' and optionally append trailing dash."""
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


# Oracle DB images keyed by (major, minor) — best match: highest entry whose key <= release major.minor
_DB_IMAGES = [
    ((26, 1), "oracledb:19.30-26.1-ext"),
    ((25, 1), "oracledb:19.30-25.1-ext"),
    ((24, 1), "oracledb:19.22-24.1-ext"),
    ((22, 1), "oracledbee:19.22-22.1-ext"),
    ((0,  0), "oracledb:19.27-21.5-ext"),   # fallback for anything older
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


# ── Jenkins trigger ───────────────────────────────────────────────────────────

def _get_crumb(base_url: str, auth: tuple) -> dict:
    try:
        resp = http.get(f"{base_url.rstrip('/')}/crumbIssuer/api/json", auth=auth, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return {data["crumbRequestField"]: data["crumb"]}
    except Exception:
        pass
    return {}


def _crumb_from_html(html: str) -> dict:
    """Extract crumb from Jenkins HTML (data-crumb-value attribute in the <head>)."""
    m = re.search(r'data-crumb-header="([^"]+)"[^>]*data-crumb-value="([^"]+)"', html)
    if not m:
        m = re.search(r'data-crumb-value="([^"]+)"', html)
        if m:
            return {"Jenkins-Crumb": m.group(1)}
        return {}
    return {m.group(1): m.group(2)}


def trigger_job_api(job_url: str, params: dict, secrets: dict):
    """Returns (True, jenkins_url) | (None, "") | (False, "")."""
    import json as _json
    parsed   = urlparse(job_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    if not username or not token:
        print("  ERROR: Jenkins credentials missing in secrets.xlsx (Jenkins sheet).")
        return False, ""
    auth  = (username, token)
    crumb = _get_crumb(base_url, auth)

    # Use the JSON body format that Jenkins UI uses internally — most reliable across versions.
    # POST to /build with json={"parameter":[...]} URL-encoded in the body.
    clean       = {k: v for k, v in params.items() if v is not None and str(v).strip()}
    json_params = {"parameter": [{"name": k, "value": str(v)} for k, v in clean.items()]}
    body        = urlencode({"json": _json.dumps(json_params), "delay": "0sec"})
    turl        = f"{job_url.rstrip('/')}/build"

    def _attempt(crumb_hdrs):
        hdrs = {**crumb_hdrs, "Content-Type": "application/x-www-form-urlencoded"}
        return http.post(turl, auth=auth, headers=hdrs, data=body, timeout=30)

    try:
        resp = _attempt(crumb)
        if resp.status_code == 500 and "data-crumb-value" in resp.text:
            # Jenkins returned the correct crumb in the error page — retry once with it
            crumb = _crumb_from_html(resp.text)
            resp  = _attempt(crumb)
        if resp.status_code in (200, 201):
            return True, resp.headers.get("Location", "")
        if resp.status_code == 403:
            return None, ""
        print(f"  [API] HTTP {resp.status_code}")
        if resp.status_code in (401, 404):
            print(jenkins_error(resp.status_code, base_url=base_url, username=username))
        return False, ""
    except requests.exceptions.ConnectionError:
        print(connection_error("Jenkins"))
        return False, ""
    except Exception as e:
        print(f"  [API] {e}")
        return False, ""


_SYSTEM_BROWSER_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def _system_browser_path():
    import os as _os
    return next((p for p in _SYSTEM_BROWSER_PATHS if _os.path.exists(p)), None)


def trigger_job_playwright(job_url: str, params: dict, secrets: dict):
    """
    Log in to Jenkins via browser, then POST the build request using the
    authenticated browser context. Returns (True, queue_url) or (False, "").
    """
    import json as _json
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  [Playwright] Not installed. Run:  pip install playwright  then  playwright install chromium")
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
            print(f"         launching browser...", flush=True)
            browser = pw.chromium.launch(**launch_opts)
            ctx     = browser.new_context(ignore_https_errors=True)
            page    = ctx.new_page()

            # ── Log in ───────────────────────────────────────────────────────
            print(f"         logging in to Jenkins...", flush=True)
            page.goto(f"{base_url}/login", timeout=30000)
            page.fill("#j_username", username)
            page.fill("[name='j_password']", password)
            page.click("[name='Submit']")
            page.wait_for_load_state("networkidle", timeout=20000)

            if "/login" in page.url:
                print("  [Playwright] Login failed — check jenkins_password in secrets.xlsx.")
                browser.close()
                return False, ""

            # Navigate to /buildWithParameters so Jenkins sets the page-session
            # crumb in document.head, then read it before POSTing.
            print(f"         navigating to job page...", flush=True)
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
                print("  [Playwright] no crumb in page head — cannot submit")
                browser.close()
                return False, ""

            # POST via Playwright's request context (shares browser session cookies).
            # Use the same json= body format as the REST API path — more reliable
            # across Jenkins versions than individual form fields.
            print(f"         submitting build request...", flush=True)
            build_url   = f"{job_url.rstrip('/')}/build"
            json_params = {"parameter": [{"name": k, "value": str(v)} for k, v in clean.items()]}
            body        = urlencode({"json": _json.dumps(json_params), "delay": "0sec"})
            resp   = None
            status = 0
            loc    = ""
            try:
                resp   = ctx.request.post(
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
                # If resp was assigned the request reached Jenkins before the error.
                # Return True with no URL to prevent the API fallback from double-triggering.
                return (True, "") if resp is not None else (False, "")

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
            # 401/403: auth failure — job definitely not triggered, API fallback can retry
            if status in (401, 403):
                print(f"  [Playwright] HTTP {status} — auth failure, API will retry")
                return False, ""
            # Any other status (400, 500, …): Jenkins received the request.
            # Return True with no URL to prevent the API fallback from double-triggering.
            print(f"  [Playwright] HTTP {status} — assuming triggered to prevent double-fire")
            return True, ""
    except Exception as e:
        print(f"  [Playwright] {e}")
        return False, ""


def trigger_job(job_url: str, params: dict, secrets: dict):
    """Returns (success: bool, jenkins_url: str). Playwright first, API fallback."""
    if not job_url:
        print("  ERROR: No job URL. Fill in reg_job_config.xlsx payor sheet.")
        return False, ""
    # ── Playwright (browser session — bypasses CSRF / permission issues) ──────
    ok, jenkins_url = trigger_job_playwright(job_url, params, secrets)
    if ok:
        return True, jenkins_url
    # ── REST API fallback ──────────────────────────────────────────────────────
    print("  [API] Playwright failed — trying REST API...")
    ok2, jenkins_url2 = trigger_job_api(job_url, params, secrets)
    if ok2 is True:
        return True, jenkins_url2
    return False, ""


# ── projects.xlsx ─────────────────────────────────────────────────────────────

def next_run_id(app_name: str = "Payor") -> int:
    if not PROJECTS_PATH.exists():
        return 1
    with _projects_filelock():
        wb     = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws     = wb[app_name] if app_name in wb.sheetnames else wb.active
        max_id = 0
        for row in ws.iter_rows(min_row=2, values_only=True):
            if row[0] is not None:
                try:
                    max_id = max(max_id, int(row[0]))
                except (ValueError, TypeError):
                    pass
    return max_id + 1


def append_run(run_id, release_version, runs, status, triggered_at, app_name: str = "Payor"):
    """Write one row per project to projects.xlsx (header-driven)."""
    if not PROJECTS_PATH.exists():
        print("  ERROR: projects.xlsx not found. Run  setupjenkinsregtool  first.")
        return
    with _projects_filelock():
        wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws      = wb[app_name] if app_name in wb.sheetnames else wb.active
        headers = [str(ws.cell(1, c).value or "").strip().lower()
                   for c in range(1, ws.max_column + 1)]
        row_vals = {h: "" for h in headers}
        row_vals.update({
            "project_id":            run_id,
            "payor_release_version": release_version,
            "runs":                  runs,
            "status":                status,
            "triggered_at":          triggered_at,
        })
        ws.append([row_vals.get(h, "") for h in headers])
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not save projects.xlsx (file may be open).")


def update_run_status(run_id, status, app_name: str = "Payor"):
    """Update the status cell for an existing run_id row in projects.xlsx."""
    if not PROJECTS_PATH.exists():
        return
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb[app_name] if app_name in wb.sheetnames else wb.active
        headers = [str(ws.cell(1, c).value or "").strip().lower()
                   for c in range(1, ws.max_column + 1)]
        if "project_id" not in headers or "status" not in headers:
            return
        pid_col    = headers.index("project_id") + 1
        status_col = headers.index("status") + 1
        for row in ws.iter_rows(min_row=2):
            if row[pid_col - 1].value == run_id:
                row[status_col - 1].value = status
                break
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not update projects.xlsx status (file may be open).")


# ── Per-run xlsx ──────────────────────────────────────────────────────────────

def _info_row(ws, key, val):
    ws.append([key, str(val) if val is not None else ""])


def _info_hdr(ws, title):
    ws.append([title, ""])
    c = ws.cell(ws.max_row, 1)
    c.font = _HDR_FONT
    c.fill = _HDR_FILL


def create_run_xlsx(run_id: int, release_version: str,
                    pom: dict, v: tuple, run_jobs: list, app_name: str = "Payor") -> Path:
    app_dir = _app_projects_dir(app_name)
    app_dir.mkdir(parents=True, exist_ok=True)
    safe = release_version.replace("/", "_").replace("\\", "_")
    out  = app_dir / f"{run_id}_{app_name.lower()}_{safe}.xlsx"

    wb = openpyxl.Workbook()

    # info sheet
    ws_i = wb.active
    ws_i.title = "info"
    ws_i.column_dimensions["A"].width = 36
    ws_i.column_dimensions["B"].width = 80

    _info_hdr(ws_i, "Run Information")
    _info_row(ws_i, "run_id",         run_id)
    _info_row(ws_i, "release_version", release_version)
    _info_row(ws_i, "triggered_at",   datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    ws_i.append(["", ""])
    _info_hdr(ws_i, "Versions from pom.xml")
    _info_row(ws_i, "PAYOR_VERSION_PREFIX",
              pom.get("payor_version_prefix") or "(not fetched)")
    _info_row(ws_i, "BLUECARD_CONFIG_VERSION_PREFIX",
              pom.get("bluecard_config_version_prefix") or "(not fetched)")
    _info_row(ws_i, "DATAUNIVERSE_VERSION_PREFIX",
              pom.get("datauniverse_version_prefix") or "(not fetched)")

    ws_i.append(["", ""])
    _info_hdr(ws_i, "Build Image / Infrastructure")
    # Read infrastructure params from any available job's BuildParameters sheet.
    _infra = {}
    _params_base = _params_dir(app_name)
    if _params_base.exists():
        for _pf in sorted(_params_base.glob(f"{app_name.lower()}_*_jenkins_params.xlsx")):
            _loaded = load_jenkins_params(_pf.stem.replace(f"{app_name.lower()}_", "", 1).replace("_jenkins_params", ""), app_name)
            if _loaded.get("BASE_IMAGE_NAME"):
                _infra = _loaded
                break
    _info_row(ws_i, "BASE_IMAGE_NAME", _infra.get("BASE_IMAGE_NAME") or _base_image(v))
    _info_row(ws_i, "DB_IMAGE_NAME",   _infra.get("DB_IMAGE_NAME")   or _db_image(v))
    _info_row(ws_i, "CES_SERVER_HOST", _infra.get("CES_SERVER_HOST") or _ces_host(v))

    # jobs sheet
    ws_j = wb.create_sheet("jobs")
    ws_j.column_dimensions["A"].width = 30
    ws_j.column_dimensions["B"].width =  8
    ws_j.column_dimensions["C"].width = 16
    ws_j.column_dimensions["D"].width = 12
    ws_j.column_dimensions["E"].width = 22
    ws_j.column_dimensions["F"].width = 70
    ws_j.column_dimensions["G"].width = 70
    ws_j.column_dimensions["H"].width = 70

    job_cols = ["job_name", "runs", "completed", "job_id", "triggered_at", "queue_url", "build_url", "job_url"]
    ws_j.append(job_cols)
    for i, h in enumerate(job_cols, 1):
        c       = ws_j.cell(1, i)
        c.font  = _HDR_FONT
        c.fill  = _HDR_FILL

    for jd in run_jobs:
        ws_j.append([
            jd.get("job_name", ""),
            jd.get("run_number", ""),
            jd.get("completed", ""),
            jd.get("job_id", ""),
            jd.get("triggered_at", ""),
            jd.get("queue_url", ""),
            jd.get("build_url", ""),
            jd.get("job_url", ""),
        ])

    wb.save(str(out))
    return out


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> dict:
    release_version = None
    runs            = 1
    app_name        = "Payor"
    explicit        = {}
    argv            = sys.argv[1:]
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
            release_version = argv[i + 1].strip()
            i += 2
        elif argv[i] in ("-runs", "--runs") and i + 1 < len(argv):
            try:
                runs = int(argv[i + 1])
                if runs < 1:
                    raise ValueError
            except ValueError:
                print(f"  ERROR: -runs must be a positive integer, got '{argv[i + 1]}'")
                sys.exit(1)
            i += 2
        elif argv[i] in ("-app", "--app") and i + 1 < len(argv):
            app_name = argv[i + 1].strip()
            i += 2
        elif argv[i] in _EXPLICIT_FLAGS and i + 1 < len(argv):
            explicit[_EXPLICIT_FLAGS[argv[i]]] = argv[i + 1].strip()
            i += 2
        elif argv[i] in ("-h", "--help"):
            print("""
  jenkinsregression / jreg — Jenkins IT Regression trigger

  Usage:
    jreg -payor <release_version> [-runs <n>] [--app <app>]

  Options:
    -payor <release_version>   PAYOR release version (e.g. 26.1.1.1)  [required]
    -runs  <n>                 Number of times to trigger each job (default 1)
    --app  <app>               Application tab: Payor|Classic|Connector|Enrollment|PIK (default Payor)

  Fetches pom.xml from GitHub (release-<version> branch) to resolve:
    PAYOR_VERSION_PREFIX, BLUECARD_CONFIG_VERSION_PREFIX, DATAUNIVERSE_VERSION_PREFIX
  BASE_IMAGE_NAME, DB_IMAGE_NAME, CES_SERVER_HOST are resolved from the version.

  Creds   : secrets.xlsx → Jenkins sheet
  GitHub  : secrets.xlsx → GitHub sheet  (github_token)
  Git URLs: git_config.xlsx → repos sheet
  Details : projects/<app>/<run_id>_<app>_<release_version>.xlsx
  Run  setupjenkinsregtool  to initialise.
""")
            sys.exit(0)
        else:
            i += 1
    if not release_version:
        print("  ERROR: -payor <release_version> is required.")
        print("  Usage: jreg -payor 26.1.1.1 [-runs 3] [--app Payor]")
        sys.exit(1)
    return {"release_version": release_version, "runs": runs, "app_name": app_name, "explicit": explicit}


_PLAYWRIGHT_EST_S = 75   # estimated seconds per job trigger via Playwright


def _fmt_elapsed(seconds: float) -> str:
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    return f"{s // 60}m {s % 60:02d}s"


def main():
    import io as _io, time as _time
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True)

    # Print immediately so the console window shows something right away
    print(f"\n  Jenkins IT Regression — starting up...", flush=True)
    print(f"  Loading configuration...", flush=True)

    args            = parse_args()
    release_version = args["release_version"]
    runs            = args["runs"]
    app_name        = args.get("app_name", "Payor")
    explicit        = args.get("explicit", {})
    secrets         = load_secrets()
    _EXCLUDED = {"payor_core_commit", "payor_utils_certification"}
    jobs      = [j for j in load_job_config() if j["job_name"] not in _EXCLUDED]
    git_repos       = load_git_config()
    gh_token        = load_github_token()

    n_jobs     = len(jobs) * runs
    est_low_s  = n_jobs * 40
    est_high_s = n_jobs * _PLAYWRIGHT_EST_S

    print(f"\n  {'═' * 58}")
    print(f"  Jenkins IT Regression")
    print(f"  {'─' * 58}")
    print(f"  Application      : {app_name}")
    print(f"  Release version  : {release_version}")
    print(f"  Runs per job     : {runs}")
    print(f"  Jobs to trigger  : {len(jobs)} × {runs} = {n_jobs} total")
    print(f"  Estimated time   : ~{est_low_s // 60}–{est_high_s // 60} min  "
          f"({n_jobs} jobs × ~40–{_PLAYWRIGHT_EST_S}s each)", flush=True)
    print(f"  {'═' * 58}\n")

    # ── Step 1: Fetch pom.xml ─────────────────────────────────────────────────
    pom      = {}
    repo_url = git_repos.get("payor", "")
    if repo_url:
        print(f"  [1/3] Fetching pom.xml from GitHub...", end="", flush=True)
        t_pom = _time.time()
        pom   = fetch_pom_versions(release_version, repo_url, gh_token)
        elapsed_pom = _time.time() - t_pom
        if pom:
            print(f"  done  ({_fmt_elapsed(elapsed_pom)})", flush=True)
        else:
            print(f"  not found or no access  ({_fmt_elapsed(elapsed_pom)})", flush=True)
    else:
        print(f"  [1/3] pom.xml — skipped (add 'payor' entry to git_config.xlsx)", flush=True)

    v = _ver(release_version)

    # ── Step 2: Resolve build parameters ─────────────────────────────────────
    # Effective value: explicit CLI override > pom value > version-derived default
    print(f"\n  [2/3] Build parameters:")
    pv = explicit.get("PAYOR_VERSION_PREFIX") or (_staging(pom["payor_version_prefix"], trailing_dash=True) if pom.get("payor_version_prefix") else _staging(release_version, trailing_dash=True))
    bc = explicit.get("BLUECARD_CONFIG_VERSION_PREFIX") or (_staging(pom["bluecard_config_version_prefix"], trailing_dash=True) if pom.get("bluecard_config_version_prefix") else "-")
    du = explicit.get("DATAUNIVERSE_VERSION_PREFIX") or (_staging(pom["datauniverse_version_prefix"], trailing_dash=True) if pom.get("datauniverse_version_prefix") else "-")
    print(f"        PAYOR_VERSION_PREFIX           : {pv}")
    print(f"        BLUECARD_CONFIG_VERSION_PREFIX : {bc}")
    print(f"        DATAUNIVERSE_VERSION_PREFIX    : {du}")
    print(f"        BASE_IMAGE_NAME                : {explicit.get('BASE_IMAGE_NAME') or _base_image(v)}")
    print(f"        DB_IMAGE_NAME                  : {explicit.get('DB_IMAGE_NAME') or _db_image(v)}")
    print(f"        CES_SERVER_HOST                : {explicit.get('CES_SERVER_HOST') or _ces_host(v)}", flush=True)

    # ── Step 3: Trigger jobs ──────────────────────────────────────────────────
    print(f"\n  [3/3] Triggering {n_jobs} Jenkins job(s)...")
    print(f"        Each job logs in via browser — please wait (~{_PLAYWRIGHT_EST_S}s per job)\n",
          flush=True)

    run_id   = next_run_id(app_name)
    triggered = 0
    total     = len(jobs) * runs
    run_jobs  = []
    start_ts  = datetime.now().isoformat(timespec="seconds")
    t0        = _time.time()
    job_num   = 0

    append_run(run_id, release_version, runs, "RUNNING", start_ts, app_name)

    for job in jobs:
        job_name = job["job_name"]
        job_url  = job["job_url"]
        _POM_JENKINS_KEYS = {
            "PAYOR_VERSION_PREFIX":           "payor_version_prefix",
            "BLUECARD_CONFIG_VERSION_PREFIX":  "bluecard_config_version_prefix",
            "DATAUNIVERSE_VERSION_PREFIX":     "datauniverse_version_prefix",
        }
        params = load_jenkins_params(job_name, app_name)
        # Step 1: pom.xml overrides — non-empty pom value wins over stored params
        for jenkins_key, pom_key in _POM_JENKINS_KEYS.items():
            pom_val = pom.get(pom_key, "").strip()
            if pom_val:
                params[jenkins_key] = _staging(pom_val, trailing_dash=True)
        # Step 2: explicit UI/CLI overrides — non-empty explicit value wins over everything
        for _k, _v in explicit.items():
            if _v:
                params[_k] = _v

        for run_num in range(1, runs + 1):
            job_num += 1
            suffix    = f" (run {run_num}/{runs})" if runs > 1 else ""
            remaining = total - job_num
            est_left  = remaining * _PLAYWRIGHT_EST_S
            eta_str   = f"  ~{_fmt_elapsed(est_left)} remaining" if remaining > 0 else ""
            print(f"  [{job_num}/{total}]  {job_name}{suffix}  —  triggering via browser...{eta_str}",
                  flush=True)
            t_job   = _time.time()
            ok, jenkins_url = trigger_job(job_url, params, secrets)
            elapsed  = _time.time() - t_job
            completed = "Scheduled" if ok else "Trigger Failed"
            triggered += 1 if ok else 0
            result_str = f"  ✓  {completed}  ({_fmt_elapsed(elapsed)})" if ok \
                         else f"  ✗  {completed}  ({_fmt_elapsed(elapsed)})"
            print(f"         → {result_str}", flush=True)
            ts = datetime.now().isoformat(timespec="seconds")
            run_jobs.append({
                "job_name":     job_name,
                "run_number":   run_num,
                "completed":    completed,
                "job_id":       "",
                "triggered_at": ts,
                "queue_url":    jenkins_url,
                "build_url":    "",
                "job_url":      job_url,
            })
        print()

    total_elapsed = _time.time() - t0

    if triggered == total:
        overall_status = "Scheduled"
    elif triggered == 0:
        overall_status = "Trigger Failed"
    else:
        overall_status = f"Partial ({triggered}/{total})"
    update_run_status(run_id, overall_status, app_name)

    out_path = create_run_xlsx(run_id, release_version, pom, v, run_jobs, app_name)

    print(f"  {'═' * 58}")
    print(f"  Done in {_fmt_elapsed(total_elapsed)}")
    print(f"  {'─' * 58}")
    print(f"  Result        : {triggered}/{total} jobs triggered  ({overall_status})")
    print(f"  Project ID    : {run_id}")
    print(f"  Run details   : projects/{app_name}/{out_path.name}")
    print(f"  View status   : jregstatus -pid {run_id}")
    print(f"  {'═' * 58}\n")


if __name__ == "__main__":
    main()
