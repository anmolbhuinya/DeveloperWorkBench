#!/usr/bin/env python3
"""
puc_tool.py — payorutilscertification / puc command

Trigger the payor-utils-certification Jenkins job for a given release version.

Usage:
  puc -payor <release_version>
  payorutilscertification -payor <release_version>
"""

import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import io
import os
import re
import time
import subprocess
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
try:
    import filelock as _filelock
    _FILELOCK_AVAILABLE = True
except ImportError:
    _FILELOCK_AVAILABLE = False

_PUC_LEASE_SECONDS = 15 * 60

def _puc_projects_filelock():
    _lp = PROJECTS_PATH.with_suffix(".xlsx.lock")
    if _lp.exists():
        try:
            if time.time() - _lp.stat().st_mtime > _PUC_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30)

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
WORKFLOWS_ROOT = TOOL_ROOT.parent
SECRETS_PATH   = WORKFLOWS_ROOT.parent / "secrets.xlsx"
CONFIG_PATH    = TOOL_ROOT / "puc_config.xlsx"
PROJECTS_PATH  = TOOL_ROOT / "projects.xlsx"

PROJ_HEADERS = ["pid", "payor_version", "baseline_url", "job_name", "status",
                "triggered_at", "build_url", "queue_url", "notes",
                "certification_status", "jenkins_it_failures", "baseline_it_failures"]
PROJ_WIDTHS  = [6, 14, 100, 28, 14, 22, 100, 100, 60, 20, 20, 20]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"

_SYSTEM_BROWSER_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


# ── Secrets ───────────────────────────────────────────────────────────────────

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


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if not CONFIG_PATH.exists():
        print("  ERROR: puc_config.xlsx not found. Run  setuppuc  first.")
        sys.exit(1)
    wb = openpyxl.load_workbook(str(CONFIG_PATH))
    if "config" not in wb.sheetnames:
        print("  ERROR: puc_config.xlsx has no 'config' sheet.")
        sys.exit(1)
    for row in wb["config"].iter_rows(min_row=2, values_only=True):
        if row[0]:
            return {"job_name": str(row[0]).strip(),
                    "job_url":  str(row[1]).strip() if row[1] else ""}
    print("  ERROR: puc_config.xlsx has no job rows.")
    sys.exit(1)


# ── Project tracking ──────────────────────────────────────────────────────────

def _ensure_projects():
    if PROJECTS_PATH.exists():
        return
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Projects"
    for col, (h, w) in enumerate(zip(PROJ_HEADERS, PROJ_WIDTHS), 1):
        c = ws.cell(1, col, h)
        c.font = HEADER_FONT; c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="left")
        ws.column_dimensions[c.column_letter].width = w
    wb.save(str(PROJECTS_PATH))


def _next_pid() -> int:
    if not PROJECTS_PATH.exists():
        return 1
    _lock = _puc_projects_filelock() if _FILELOCK_AVAILABLE else None
    with (_lock if _lock else open(os.devnull)):
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb.active
        return max((ws.cell(r, 1).value or 0 for r in range(2, ws.max_row + 1)), default=0) + 1


def _create_project(pid, version, baseline_url, job_name, status, triggered_at, queue_url):
    _ensure_projects()
    _lock = _puc_projects_filelock() if _FILELOCK_AVAILABLE else None
    with (_lock if _lock else open(os.devnull)):
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb.active
        headers = [str(ws.cell(1, c).value or "").strip().lower()
                   for c in range(1, ws.max_column + 1)]
        row_vals = {h: "" for h in headers}
        row_vals.update({
            "pid": pid, "payor_version": version, "baseline_url": baseline_url,
            "job_name": job_name, "status": status, "triggered_at": triggered_at,
            "queue_url": queue_url,
        })
        ws.append([row_vals.get(h, "") for h in headers])
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not save projects.xlsx (file may be open).")


def _update_project(pid, status, build_url="", notes=""):
    if not PROJECTS_PATH.exists():
        return
    _lock = _puc_projects_filelock() if _FILELOCK_AVAILABLE else None
    with (_lock if _lock else open(os.devnull)):
        wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws      = wb.active
        headers = [str(ws.cell(1, c).value or "").strip().lower()
                   for c in range(1, ws.max_column + 1)]
        col_map = {h: i for i, h in enumerate(headers, 1)}
        for row in ws.iter_rows(min_row=2):
            if str(row[0].value or "").strip() == str(pid).strip():
                if "status"    in col_map: row[col_map["status"]    - 1].value = status
                if "build_url" in col_map: row[col_map["build_url"] - 1].value = build_url
                if "notes"     in col_map: row[col_map["notes"]     - 1].value = notes
                break
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not save projects.xlsx (file may be open).")


# ── Jenkins helpers ───────────────────────────────────────────────────────────

def _system_browser_path():
    import os
    return next((p for p in _SYSTEM_BROWSER_PATHS if os.path.exists(p)), None)


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


def wait_for_build_result(queue_url, auth, timeout_s=1800):
    """Poll queue → build URL → final result. Returns (build_url, result_str)."""
    if not queue_url:
        return "", "NO_QUEUE_URL"
    start     = time.time()
    build_url = ""
    while True:
        elapsed = int(time.time() - start)
        if elapsed > timeout_s:
            print()
            return build_url, "TIMEOUT"
        if not build_url:
            resolved = _resolve_queue_item(queue_url, auth)
            if resolved is None:
                print()
                return "", "QUEUE_EXPIRED"
            if resolved:
                build_url = resolved
        if build_url:
            status = _poll_build_status(build_url, auth)
            if status in ("SUCCESS", "FAILURE", "ABORTED", "UNSTABLE"):
                print()
                return build_url, status
        m, s = elapsed // 60, elapsed % 60
        print(f"\r    [{m:02d}:{s:02d}] waiting for build to complete...", end="", flush=True)
        time.sleep(20)


def trigger_noparams_job_playwright(job_url, secrets):
    """Trigger a no-parameter Jenkins job. Returns (ok: bool, queue_url: str)."""
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

    parsed   = urlparse(job_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
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
                print("  [Playwright] Login failed - check jenkins_password in secrets.xlsx.")
                browser.close()
                return False, ""

            page.goto(job_url, timeout=20000)
            page.wait_for_load_state("domcontentloaded", timeout=15000)
            crumb_info = page.evaluate(
                "() => ({ crumb: document.head.getAttribute('data-crumb-value') || '',"
                "         field: document.head.getAttribute('data-crumb-header') || 'Jenkins-Crumb' })"
            )
            crumb = crumb_info.get("crumb", "")
            field = crumb_info.get("field", "Jenkins-Crumb")
            if not crumb:
                print("  [Playwright] no crumb in page head")
                browser.close()
                return False, ""

            # Enable job if disabled
            try:
                check = ctx.request.get(
                    f"{job_url.rstrip('/')}/api/json?tree=disabled",
                    headers={"Accept": "application/json"},
                )
                if check.status == 200 and check.json().get("disabled", False):
                    print("  [Playwright] job is disabled - enabling...")
                    ctx.request.post(
                        f"{job_url.rstrip('/')}/enable",
                        headers={field: crumb,
                                 "Content-Type": "application/x-www-form-urlencoded"},
                    )
                    page.goto(job_url, timeout=20000)
                    page.wait_for_load_state("domcontentloaded", timeout=15000)
                    ci2 = page.evaluate(
                        "() => ({ crumb: document.head.getAttribute('data-crumb-value') || '',"
                        "         field: document.head.getAttribute('data-crumb-header') || 'Jenkins-Crumb' })"
                    )
                    if ci2.get("crumb"):
                        crumb = ci2["crumb"]; field = ci2.get("field", field)
            except Exception as e:
                print(f"  [Playwright] disabled check: {e}")

            resp   = ctx.request.post(
                f"{job_url.rstrip('/')}/build",
                headers={field: crumb,
                         "Content-Type": "application/x-www-form-urlencoded"},
                data={"delay": "0sec"},
            )
            status = resp.status
            loc    = resp.headers.get("location", "")
            browser.close()

            if status in (200, 201, 302):
                if loc:
                    queue_url = loc if loc.startswith("http") else f"{base_url}{loc}"
                    return True, queue_url
                return True, ""
            return False, ""
    except Exception as e:
        print(f"  [Playwright] {e}")
        return False, ""


# ── CLI ────────────────────────────────────────────────────────────────────────

def _bg_poll(pid, queue_url):
    """Run in background: poll Jenkins until done, update projects.xlsx."""
    secrets  = load_secrets()
    username = secrets.get("jenkins_username", "")
    password = secrets.get("jenkins_password", "") or secrets.get("jenkins_api_token", "")
    auth     = (username, password) if username and password else None
    build_url, result = wait_for_build_result(queue_url, auth)
    _update_project(pid, result, build_url)


def parse_args():
    argv = sys.argv[1:]
    payor, baseline, mode = None, None, None
    i = 0
    while i < len(argv):
        if argv[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif argv[i] == "--bg-poll" and i + 2 < len(argv):
            _bg_poll(argv[i + 1], argv[i + 2])
            sys.exit(0)
        elif argv[i] in ("-payor", "--payor") and i + 1 < len(argv):
            payor = argv[i + 1]; i += 2
        elif argv[i] in ("-baseline", "--baseline") and i + 1 < len(argv):
            baseline = argv[i + 1]; i += 2
        elif argv[i] in ("-mode", "--mode") and i + 1 < len(argv):
            mode = argv[i + 1]; i += 2
        else:
            i += 1
    return payor, baseline, mode


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    payor, baseline, mode = parse_args()
    if not payor:
        try:
            payor = input("  Payor version (e.g. 26.1.1.1): ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
    if not payor:
        print("  ERROR: payor version is required.")
        sys.exit(1)
    if baseline is None:
        try:
            baseline = input("  Baseline build URL (leave blank to skip): ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)

    config  = load_config()
    secrets = load_secrets()

    job_name = config["job_name"]
    job_url  = config["job_url"].replace("{version}", payor)
    if mode == "baseline":
        job_label = job_name + " [Baseline]"
    elif mode == "certify":
        job_label = job_name + " [Certify]"
    else:
        job_label = job_name

    pid = _next_pid()
    ts  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    run_title = "Payor Utils Baseline" if mode == "baseline" else "Payor Utils Certification"
    print(f"\n  {run_title}")
    print(f"  {'-' * 54}")
    print(f"  Version    : {bold(payor)}")
    if baseline:
        print(f"  Baseline   : {grey(baseline)}")
    print(f"  Job        : {job_label}")
    print(f"  URL        : {grey(job_url)}")
    print(f"  Project #  : {pid}")
    print()

    print("  Triggering...")
    ok, queue_url = trigger_noparams_job_playwright(job_url, secrets)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not ok:
        print(f"\n  {red('Trigger failed.')}  Check jenkins credentials and VPN.\n")
        _create_project(pid, payor, baseline or "", job_label, "Trigger Failed", ts, "")
        sys.exit(1)

    print(f"  {green('Triggered')}  Queue: {grey(queue_url)}")
    _create_project(pid, payor, baseline or "", job_label, "Triggered", ts, queue_url)

    # Spawn detached background poller — returns control to user immediately
    subprocess.Popen(
        [sys.executable, __file__, "--bg-poll", str(pid), queue_url],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )

    print(f"\n  Polling in background (up to 30 min).")
    print(f"  Run  {bold(f'pucstatus -pid {pid}')}  to check progress.")
    if baseline:
        print(f"  Run  {bold(f'puccertify -pid {pid}')}  after build completes to certify.")
    print()


if __name__ == "__main__":
    main()
