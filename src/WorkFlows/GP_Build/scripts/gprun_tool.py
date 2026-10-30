#!/usr/bin/env python3
"""
gprun — GP Build Tool
Creates a per-ticket build config, triggers the Jenkins GP pipeline, and
records the run in projects.xlsx.

Usage:
  gprun -t <ticket_id> -db <dest_branch> [-am yes|no]
  gprun -fb <feature_branch> -db <dest_branch> [-am yes|no]
  gprun --help
"""

import os, sys, re, time, textwrap, openpyxl, requests
try:
    import filelock as _filelock
    _FILELOCK_AVAILABLE = True
except ImportError:
    _FILELOCK_AVAILABLE = False

def hyperlink(url, text=None):
    """Return a terminal-clickable OSC 8 hyperlink (supported in Windows Terminal, iTerm2, etc.)."""
    label = text or url
    return f"\x1b]8;;{url}\x1b\\{label}\x1b]8;;\x1b\\"
from urllib.parse import urlencode
from pathlib import Path
from openpyxl.styles import Font, PatternFill, Alignment
from api_errors import atlassian_error, jenkins_error, connection_error, http

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "GP_Build"        # project data: <DWB>\Projects\WorkFlows\GP_Build
DATA_ROOT.mkdir(parents=True, exist_ok=True)
WORKFLOWS_ROOT = TOOL_ROOT.parent

CONFIG_PATH    = TOOL_ROOT / "gp_job_config.xlsx"
GP_PARAMS_PATH = TOOL_ROOT / "gp_params" / "payor_gp_params.xlsx"
SECRETS_PATH   = WORKFLOWS_ROOT.parent / "secrets.xlsx"
PROJECTS_PATH  = DATA_ROOT / "projects.xlsx"
PROJECTS_DIR   = DATA_ROOT / "projects"

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

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)
LINK_FONT   = Font(color="0563C1", underline="single")
BOLD        = Font(bold=True)

# Projects.xlsx column layout (1-based)
PROJECTS_COLUMNS = [
    ("project_id",     12),
    ("ticket_id",      20),
    ("feature_branch", 48),
    ("dest_branch",    30),
    ("auto_merge",     14),
    ("config_file",    60),
    ("status",         18),
    ("pr_url",         60),
    ("pr_status",      14),
    ("job_id",         10),
    ("sonar",           8),
    ("triggered_at",   20),
]
_COL = {name: idx for idx, (name, _) in enumerate(PROJECTS_COLUMNS, start=1)}

ALL_APPS = ["Payor", "Classic", "Connector", "Enrollment", "PIK", "Custom Code"]


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_secrets():
    if not SECRETS_PATH.exists():
        raise FileNotFoundError(
            f"secrets.xlsx not found at:\n  {SECRETS_PATH}\n"
            f"  Run 'python scripts/create_secrets.py' at the workflows root."
        )
    wb = openpyxl.load_workbook(str(SECRETS_PATH))
    data = {}
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                data[str(row[0]).strip()] = str(row[1]).strip()
    return data


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
        headers = [cell.value for cell in ws[1]]
        rows = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            pid = row[0] if row else None
            if pid is not None and str(pid).strip():
                rows.append(dict(zip(headers, row)))
    return rows


def next_project_id(projects):
    max_id = 0
    for p in projects:
        try:
            max_id = max(max_id, int(p.get("project_id") or 0))
        except (ValueError, TypeError):
            pass
    return max_id + 1


# ---------------------------------------------------------------------------
# Ticket extraction from branch name
# ---------------------------------------------------------------------------

_JIRA_RE = re.compile(r'([A-Z][A-Z0-9]+-\d+)')

def extract_ticket_from_branch(branch):
    """Extract a JIRA ticket ID (e.g. PAYOR-208524) from a branch name."""
    m = _JIRA_RE.search(branch.upper())
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# JIRA branch / PR resolution
# ---------------------------------------------------------------------------

def _jira_auth(secrets):
    email = secrets.get("jira_email", "")
    token = secrets.get("jira_api_token", "")
    if not email or not token:
        raise ValueError(
            "jira_email and jira_api_token are required in secrets.xlsx "
            "(Atlassian sheet) to resolve branches from a ticket ID."
        )
    return (email, token)


def _get_issue_id(jira_base, auth, ticket_key):
    resp = http.get(
        f"{jira_base}/rest/api/3/issue/{ticket_key}",
        auth=auth, params={"fields": "id"}, timeout=15
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _discover_app_types(jira_base, auth, issue_id):
    """
    Call dev-status summary to discover applicationType keys for this issue
    (e.g. 'oAuth-com.github.integration.production').
    Falls back to ['github'] if the summary call fails or returns nothing.
    """
    try:
        resp = http.get(
            f"{jira_base}/rest/dev-status/1.0/issue/summary",
            auth=auth, params={"issueId": issue_id}, timeout=15
        )
        resp.raise_for_status()
        summary = resp.json().get("summary", {})
        types = set()
        for section in ("branch", "pullrequest", "repository"):
            by_type = summary.get(section, {}).get("byInstanceType", {})
            types.update(by_type.keys())
        if types:
            return list(types)
    except Exception:
        pass
    return ["github"]


def fetch_branches_for_ticket(ticket_id, dest_branch, secrets):
    """
    Query JIRA dev-status API for PRs linked to ticket_id.
    Returns only open PRs targeting dest_branch:
      [{"branch": name, "pr_url": url, "pr_status": status}, ...]

    The applicationType is discovered dynamically from the summary endpoint
    because JIRA Cloud uses instance-specific types like
    'oAuth-com.github.integration.production' rather than the generic 'github'.
    """
    jira_base = secrets.get("jira_base_url", "").rstrip("/")
    if not jira_base:
        raise ValueError("jira_base_url is required in secrets.xlsx (Atlassian sheet).")

    auth      = _jira_auth(secrets)
    issue_id  = _get_issue_id(jira_base, auth, ticket_id)
    app_types = _discover_app_types(jira_base, auth, issue_id)

    matches   = []
    seen_urls = set()

    for app_type in app_types:
        resp = http.get(
            f"{jira_base}/rest/dev-status/1.0/issue/detail",
            auth=auth,
            params={"issueId": issue_id, "applicationType": app_type, "dataType": "branch"},
            timeout=20
        )
        resp.raise_for_status()

        for detail in resp.json().get("detail", []):
            for pr in detail.get("pullRequests", []):
                pr_status     = str(pr.get("status", "")).upper()
                if pr_status in ("MERGED", "DECLINED"):
                    continue
                source_branch = (pr.get("source") or {}).get("branch", "")
                pr_dest       = (pr.get("destination") or {}).get("branch", "")
                pr_url        = pr.get("url", "")
                if pr_dest.lower() != dest_branch.lower():
                    continue
                if pr_url in seen_urls:
                    continue
                seen_urls.add(pr_url)
                matches.append({
                    "branch":    source_branch,
                    "pr_url":    pr_url,
                    "pr_status": pr_status.capitalize(),
                })

    return matches


def _jira_lookup_safe(ticket_id, dest_branch, secrets):
    """
    Wrapper that catches all JIRA errors and returns [] on failure.
    Never raises — callers always continue with empty PR info.
    """
    try:
        return fetch_branches_for_ticket(ticket_id, dest_branch, secrets)
    except requests.exceptions.ConnectionError:
        print("  [warning] JIRA unreachable — skipping PR lookup.")
    except requests.exceptions.HTTPError as e:
        print(atlassian_error(e.response.status_code, "warning"))
    except ValueError as e:
        print(f"  [warning] JIRA not configured ({e}) — skipping PR lookup.")
    except Exception as e:
        print(f"  [warning] JIRA lookup skipped ({type(e).__name__}: {e})")
    return []


def _prompt_pr_choice(entries, context_label):
    """
    Ask user to pick from a list of PR entries.
    entries: [{branch, pr_url, pr_status}, ...]
    Returns chosen entry dict.
    """
    print(f"\n  Multiple PRs found for {context_label}:\n")
    for i, e in enumerate(entries, start=1):
        print(f"    [{i}] branch : {e['branch']}")
        print(f"         PR     : {hyperlink(e['pr_url'])}  [{e['pr_status']}]")
    print()
    while True:
        choice = input("  Select a PR [1-N]: ").strip()
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(entries):
                return entries[idx]
        except ValueError:
            pass
        print("  Invalid choice — enter a number.")


def resolve_branch(ticket_id, dest_branch, secrets):
    """
    When only -t is given: find branches with PRs to dest_branch via JIRA.
    Returns (branch_name, pr_url, pr_status).
    """
    print(f"  Looking up branches for {ticket_id} with a PR targeting '{dest_branch}'...")
    try:
        matches = fetch_branches_for_ticket(ticket_id, dest_branch, secrets)
    except requests.exceptions.ConnectionError:
        print(connection_error("JIRA"))
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        code = e.response.status_code
        if code == 404:
            print(f"  ERROR: Ticket '{ticket_id}' not found in JIRA — check the ticket ID.")
        else:
            print(atlassian_error(code))
        sys.exit(1)
    except ValueError as e:
        print(f"  ERROR: {e}")
        sys.exit(1)

    if not matches:
        print(f"\n  ERROR: No branches found for {ticket_id} with a PR targeting '{dest_branch}'.")
        print("  Branches without a PR to the destination branch are not considered.")
        print("  Use -fb <branch> to specify a branch manually.")
        sys.exit(1)

    if len(matches) == 1:
        m = matches[0]
        print(f"  Branch found : {m['branch']}")
        print(f"  PR           : {hyperlink(m['pr_url'])}  [{m['pr_status']}]")
        return m["branch"], m["pr_url"], m["pr_status"]

    chosen = _prompt_pr_choice(matches, f"{ticket_id} targeting '{dest_branch}'")
    return chosen["branch"], chosen["pr_url"], chosen["pr_status"]


def resolve_pr_for_branch(feature_branch, dest_branch, ticket_id, secrets):
    """
    When -fb is given: look up PRs for this specific branch targeting dest_branch.
    PR is mandatory — exits if JIRA is unreachable or no PR found.
    Returns (pr_url, pr_status).
    """
    if not ticket_id:
        print("  ERROR: Could not extract a ticket ID from the branch name.")
        print("  Use -t <TICKET_ID> to provide it explicitly.")
        sys.exit(1)

    print(f"  Looking up PRs for '{feature_branch}' targeting '{dest_branch}'...")
    try:
        matches = fetch_branches_for_ticket(ticket_id, dest_branch, secrets)
    except requests.exceptions.ConnectionError as e:
        print(f"  ERROR: JIRA connection failed ({type(e).__name__}: {e})")
        print("  PR is required to proceed. Check VPN / network and retry.")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(atlassian_error(e.response.status_code))
        sys.exit(1)
    except ValueError as e:
        print(f"  ERROR: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"  ERROR: JIRA lookup failed ({type(e).__name__}: {e})")
        sys.exit(1)

    branch_prs = [m for m in matches if m["branch"] == feature_branch]

    if not branch_prs:
        print(f"  ERROR: No open PR found for '{feature_branch}' targeting '{dest_branch}'.")
        print("  Ensure an open PR exists for this branch targeting the correct destination branch.")
        sys.exit(1)

    if len(branch_prs) == 1:
        p = branch_prs[0]
        print(f"  PR found: {hyperlink(p['pr_url'])}  [{p['pr_status']}]")
        return p["pr_url"], p["pr_status"]

    chosen = _prompt_pr_choice(branch_prs, f"'{feature_branch}' targeting '{dest_branch}'")
    return chosen["pr_url"], chosen["pr_status"]


# ---------------------------------------------------------------------------
# Ticket config creation
# ---------------------------------------------------------------------------

def _set_header(ws, col, title):
    cell = ws.cell(1, col, title)
    cell.font      = HEADER_FONT
    cell.fill      = HEADER_FILL
    cell.alignment = Alignment(horizontal="center")


def copy_build_parameters(src_wb, dst_wb, feature_branch, dest_branch, auto_merge, run_sonar="yes",
                           run_integ_tests="no", integ_category="", integ_custom="", integ_groups=""):
    src_ws = src_wb["BuildParameters"] if "BuildParameters" in src_wb.sheetnames else None
    if src_ws is None:
        print("  Note: BuildParameters not in gp_params.xlsx — run  setupgptool -fetchparams  to populate it.")

    dst_ws = dst_wb.create_sheet("BuildParameters")
    dst_ws.column_dimensions["A"].width = 28
    dst_ws.column_dimensions["B"].width = 60

    if src_ws is not None:
        for col_letter, dim in src_ws.column_dimensions.items():
            dst_ws.column_dimensions[col_letter].width = dim.width
        for col in range(1, 6):
            cell = src_ws.cell(1, col)
            _set_header(dst_ws, col, cell.value)
    else:
        for col, title in enumerate(("parameter", "value", "type", "default", "description"), start=1):
            _set_header(dst_ws, col, title)

    # Resolve INTEG defaults from INTEG_TEST_GROUP_CATEGORY sheet if present
    _DEFAULT_CAT = "Platform"
    cat = (integ_category or _DEFAULT_CAT).strip()
    _integ_group = ""
    if "INTEG_TEST_GROUP_CATEGORY" in src_wb.sheetnames:
        for _row in src_wb["INTEG_TEST_GROUP_CATEGORY"].iter_rows(min_row=2, values_only=True):
            if str(_row[0] or "").strip() == cat and len(_row) > 1:
                _integ_group = str(_row[1] or "").strip()
                break
    if integ_groups:  # explicit selection from the UI overrides the category's full list
        _integ_group = integ_groups

    # Write mandatory params FIRST — guaranteed to be present with correct values
    _MANDATORY = {
        "FEATURE_BRANCH":            feature_branch,
        "DESTINATION_BRANCH":        dest_branch,
        "AUTO_MERGE":                auto_merge,
        "RUN_SONAR_ANALYSIS":        run_sonar,
        "RUN_INTEG_TESTS":           run_integ_tests,
        "INTEG_TEST_GROUP_CATEGORY": cat,
        "INTEG_TEST_GROUP":          _integ_group,
        "INTEG_TEST_GROUP_CUSTOM":   integ_custom or "",
    }
    for key, val in _MANDATORY.items():
        r = dst_ws.max_row + 1
        dst_ws.cell(r, 1, key).font = BOLD
        dst_ws.cell(r, 2, val)

    # Copy remaining template params (skip mandatory ones already written)
    src_rows = src_ws.iter_rows(min_row=2, values_only=True) if src_ws is not None else []
    for row in src_rows:
        if not row[0] or row[0] in _MANDATORY:
            continue
        r = dst_ws.max_row + 1
        dst_ws.cell(r, 1, row[0]).font = BOLD
        user_val        = str(row[1] or "").strip()
        jenkins_default = str(row[3] or "").strip() if len(row) > 3 else ""
        dst_ws.cell(r, 2, user_val or jenkins_default)
        for col_idx, val in enumerate(row[2:], start=3):
            if val:
                dst_ws.cell(r, col_idx, val).font = NOTE_FONT


def copy_integ_category(src_wb, dst_wb):
    sheet_name = "INTEG_TEST_GROUP_CATEGORY"
    if sheet_name not in src_wb.sheetnames:
        print(f"  Warning: {sheet_name} not found in gp_params.xlsx — skipping.")
        return

    src_ws = src_wb[sheet_name]
    dst_ws = dst_wb.create_sheet(sheet_name)

    for col_letter, dim in src_ws.column_dimensions.items():
        dst_ws.column_dimensions[col_letter].width = dim.width

    for row in src_ws.iter_rows(min_row=1):
        for cell in row:
            dst_cell = dst_ws.cell(row=cell.row, column=cell.column)
            dst_cell.value = cell.value
            if cell.row == 1:
                dst_cell.font      = HEADER_FONT
                dst_cell.fill      = HEADER_FILL
                dst_cell.alignment = Alignment(horizontal="center")
            elif cell.column == 1:
                dst_cell.font = Font(bold=True,
                                     color="1F497D" if cell.font and cell.font.color
                                           and cell.font.color.rgb == "FF1F497D" else "000000")
            else:
                dst_cell.alignment = Alignment(wrap_text=False)


def create_ticket_config(project_id, ticket_id, feature_branch, dest_branch, auto_merge, run_sonar="yes",
                          run_integ_tests="no", integ_category="", integ_custom="", app_name="Payor", integ_groups=""):
    cfg_dir = PROJECTS_DIR / app_name
    cfg_dir.mkdir(parents=True, exist_ok=True)
    label = ticket_id or feature_branch.replace("/", "-")
    ticket_file = cfg_dir / f"{project_id}_{label}_config.xlsx"

    src_wb = openpyxl.load_workbook(str(GP_PARAMS_PATH))
    dst_wb = openpyxl.Workbook()
    dst_wb.remove(dst_wb.active)

    copy_build_parameters(src_wb, dst_wb, feature_branch, dest_branch, auto_merge, run_sonar,
                          run_integ_tests, integ_category, integ_custom, integ_groups)
    copy_integ_category(src_wb, dst_wb)

    dst_wb.save(str(ticket_file))
    return ticket_file


# ---------------------------------------------------------------------------
# Jenkins build trigger
# ---------------------------------------------------------------------------

def read_build_params(ticket_config_path):
    """Read BuildParameters sheet → dict of name: value (empty values excluded)."""
    wb = openpyxl.load_workbook(str(ticket_config_path))
    if "BuildParameters" not in wb.sheetnames:
        return {}
    ws = wb["BuildParameters"]
    params = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] and row[1] is not None and str(row[1]).strip():
            params[str(row[0]).strip()] = str(row[1]).strip()
    return params


def poll_queue_for_job_id(queue_url, auth, max_wait=60):
    """Poll Jenkins queue item until build starts. Returns build number (int) or None."""
    api_url = queue_url.rstrip("/") + "/api/json"
    deadline = time.time() + max_wait
    while time.time() < deadline:
        try:
            resp = http.get(api_url, auth=auth, timeout=10)
            if resp.status_code == 404:
                return None
            if resp.status_code == 200:
                data = resp.json()
                executable = data.get("executable") or {}
                if executable.get("number"):
                    return executable["number"]
                if data.get("cancelled"):
                    return None
        except Exception:
            pass
        time.sleep(3)
    return None


def _get_jenkins_crumb(base, auth):
    """
    Fetch a Jenkins CSRF crumb.
    Returns (crumb_field, crumb_value) or (None, None) if crumb issuer is disabled.
    Jenkins requires this for all POST requests unless CSRF protection is disabled.
    """
    try:
        resp = http.get(f"{base}/crumbIssuer/api/json", auth=auth, timeout=10)
        if resp.status_code == 404:
            return None, None   # CSRF protection disabled
        resp.raise_for_status()
        data = resp.json()
        return data.get("crumbRequestField"), data.get("crumb")
    except Exception:
        return None, None


def trigger_jenkins_build_via_ui(feature_branch, ticket_config_path, settings, secrets):
    """
    Trigger Jenkins build via headless Chromium (Playwright).
    Used as fallback when the REST API returns 403.

    Requires:
      pip install playwright
      playwright install chromium

    Uses jenkins_password (actual login password) from secrets.xlsx, not the API token.
    Returns (status_str, job_id_or_None).
    """
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        print("\n  Playwright not installed. To enable UI-based build trigger, run:")
        print("    pip install playwright")
        print("    playwright install chromium\n")
        return "Created", None

    job_url = settings.get("url", "").rstrip("/")
    if not job_url:
        return "Created", None

    username = secrets.get("jenkins_username", "")
    # UI login requires the real password, not an API token
    password = secrets.get("jenkins_password", "")
    if not username or not password:
        print("  WARNING: 'jenkins_password' missing in secrets.xlsx (Jenkins sheet).")
        print("           UI-based trigger needs the real login password, not an API token.")
        return "Created", None

    base = "/".join(job_url.split("/")[:3])  # extract scheme+host for login page
    params  = read_build_params(ticket_config_path)

    print(f"  [1/2] Trying Jenkins UI (headless browser) on '{feature_branch}'...")

    build_error = [None]
    queue_url   = [None]

    # Prefer system Chrome/Edge — avoids needing to download Playwright's Chromium
    _CHROME_PATHS = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    chrome_exe = next((p for p in _CHROME_PATHS if os.path.exists(p)), None)
    if chrome_exe:
        print(f"    [UI] Using system browser: {os.path.basename(chrome_exe)}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=chrome_exe)
        ctx     = browser.new_context(ignore_https_errors=True)
        page    = ctx.new_page()

        try:
            # ── Login ─────────────────────────────────────────────────────────
            print("    [UI] Logging in...")
            page.goto(f"{base}/login", timeout=20_000)
            page.fill("#j_username", username)
            page.fill("[name='j_password']", password)
            page.click("[name='Submit']")
            page.wait_for_load_state("networkidle", timeout=15_000)

            if "/login" in page.url or "login?from" in page.url:
                build_error[0] = (
                    "Jenkins login failed — check 'jenkins_password' in secrets.xlsx (Jenkins sheet)."
                )
                return "Created", None

            # Navigate to /buildWithParameters to get the session crumb from the
            # rendered page head, then POST via ctx.request (shares browser cookies).
            build_pg = (f"{job_url}/buildWithParameters?{urlencode(params)}"
                        if params else f"{job_url}/buildWithParameters")
            print(f"    [UI] Loading build page...")
            page.goto(build_pg, timeout=20_000)
            page.wait_for_load_state("domcontentloaded", timeout=15_000)

            crumb_info = page.evaluate(
                "() => ({ crumb: document.head.getAttribute('data-crumb-value') || '',"
                "         field: document.head.getAttribute('data-crumb-header') || 'Jenkins-Crumb' })"
            )
            crumb = crumb_info.get("crumb", "")
            field = crumb_info.get("field", "Jenkins-Crumb")

            if not crumb:
                build_error[0] = "Could not read crumb from Jenkins page."
                return "Created", None

            print("    [UI] Submitting build request...")
            resp = ctx.request.post(
                f"{job_url}/buildWithParameters",
                headers={field: crumb},
                form={"delay": "0sec", **params},
            )
            status = resp.status
            loc    = resp.headers.get("location", "")
            print(f"    [UI] POST status={status}" + (f" loc={loc}" if loc else ""))

            if status in (200, 201, 302, 303) and loc and "/queue/item/" in loc:
                queue_url[0] = loc if loc.startswith("http") else f"{base}{loc}"
            elif status not in (200, 201, 302, 303):
                build_error[0] = f"Jenkins returned HTTP {status}."

        except PWTimeout:
            build_error[0] = "Jenkins UI timed out — check VPN / URL in gp_job_config.xlsx."
        except Exception as exc:
            build_error[0] = f"Jenkins UI error: {exc}"
        finally:
            browser.close()

    if build_error[0]:
        print(f"  ERROR: {build_error[0]}")
        return "Created", None

    # ── Poll queue for job ID (same as API path) ──────────────────────────────
    auth = (username, password)
    if queue_url[0]:
        print("    [UI] Build queued. Waiting for job ID (up to 60s)...")
        job_id = poll_queue_for_job_id(queue_url[0], auth, max_wait=60)
        if job_id:
            print(f"    Jenkins job ID : {hyperlink(f'{job_url}/{job_id}', f'#{job_id}')}")
            return "Running", job_id

    # Fallback: check lastBuild directly
    try:
        resp = http.get(f"{job_url}/lastBuild/api/json", auth=auth, timeout=15,
                        params={"tree": "number,building"})
        if resp.status_code == 200:
            data   = resp.json()
            job_id = data.get("number")
            if job_id:
                print(f"    Jenkins job ID : {hyperlink(f'{job_url}/{job_id}', f'#{job_id}')}")
                return ("Running" if data.get("building") else "Scheduled"), job_id
    except Exception:
        pass

    print("    Build submitted (job ID not yet available) — status: Scheduled.")
    return "Scheduled", None


def trigger_jenkins_build(feature_branch, ticket_config_path, settings, secrets):
    """
    POST to Jenkins multi-branch pipeline buildWithParameters.
    Returns (status_str, job_id_or_None).
    status_str: "Scheduled" | "Running" | "Created" (when trigger skipped/failed)
    """
    job_base = settings.get("url", "").rstrip("/")
    if not job_base:
        print("  Warning: url not set in gp_job_config.xlsx Settings — skipping Jenkins trigger.")
        return "Created", None

    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    if not username or not token:
        print("  Warning: Jenkins credentials not found in secrets.xlsx — skipping Jenkins trigger.")
        return "Created", None

    base      = "/".join(job_base.split("/")[:3])  # scheme+host for crumb endpoint
    auth      = (username, token)
    build_url = f"{job_base}/buildWithParameters"
    params    = read_build_params(ticket_config_path)

    # Validate mandatory build parameters before firing
    missing = [p for p in ("FEATURE_BRANCH", "DESTINATION_BRANCH") if not params.get(p)]
    if missing:
        print(f"  ERROR: Cannot trigger build — mandatory parameter(s) missing from config file:")
        for m in missing:
            print(f"    - {m}")
        print(f"  Check the BuildParameters sheet in: {ticket_config_path.name}")
        return "Created", None

    # Jenkins buildWithParameters reads parameters from the URL query string.
    # Sending them only in the POST body is unreliable across Jenkins versions.
    trigger_url = f"{build_url}?{urlencode(params)}" if params else build_url

    # ── Playwright (UI) first ─────────────────────────────────────────────────
    status, job_id = trigger_jenkins_build_via_ui(feature_branch, ticket_config_path, settings, secrets)
    if status != "Created":
        return status, job_id

    # ── REST API fallback ─────────────────────────────────────────────────────
    print(f"  [2/2] Trying Jenkins REST API...")
    print(f"        URL: {build_url}")

    crumb_field, crumb_value = _get_jenkins_crumb(base, auth)
    headers = {}
    if crumb_field and crumb_value:
        headers[crumb_field] = crumb_value

    try:
        resp = http.post(trigger_url, auth=auth, headers=headers, timeout=20)
    except requests.exceptions.ConnectionError as e:
        print(f"  API failed (connection error: {e})")
        return "Created", None
    except Exception as e:
        print(f"  ERROR: Jenkins trigger failed: {e}")
        return "Created", None

    if resp.status_code not in (200, 201):
        print(f"  API returned HTTP {resp.status_code} — build trigger failed.")
        return "Created", None

    queue_url = resp.headers.get("Location", "")
    if not queue_url:
        print("  Build triggered (no queue URL in response) — status: Scheduled.")
        return "Scheduled", None

    print("  Build queued. Waiting for Jenkins job ID (up to 60s)...")
    job_id = poll_queue_for_job_id(queue_url, auth, max_wait=60)
    if job_id:
        job_base = build_url.replace("/buildWithParameters", "")
        print(f"  Jenkins job ID : {hyperlink(f'{job_base}/{job_id}', f'#{job_id}')}")
        return "Running", job_id
    else:
        print("  Build is queued (not yet started) — status: Scheduled.")
        return "Scheduled", None


# ---------------------------------------------------------------------------
# projects.xlsx update
# ---------------------------------------------------------------------------

def _ensure_projects_columns(ws):
    """
    Rewrite the header row to exactly match PROJECTS_COLUMNS.
    This is safe because data rows are always written in PROJECTS_COLUMNS order,
    so only the header labels can drift — not the data positions.
    """
    for col_idx, (name, width) in enumerate(PROJECTS_COLUMNS, start=1):
        cell = ws.cell(1, col_idx)
        if cell.value != name:
            cell.value     = name
            cell.font      = HEADER_FONT
            cell.fill      = HEADER_FILL
            cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = width


def _ensure_app_sheet(wb, app_name):
    """Get or create a sheet for the given app with proper headers."""
    if app_name in wb.sheetnames:
        ws = wb[app_name]
        _ensure_projects_columns(ws)
        return ws
    ws = wb.create_sheet(app_name)
    for col_idx, (name, width) in enumerate(PROJECTS_COLUMNS, start=1):
        cell = ws.cell(1, col_idx)
        cell.value     = name
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = width
    return ws


def _create_projects_xlsx():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for app in ALL_APPS:
        new_ws = wb.create_sheet(app)
        for col_idx, (name, width) in enumerate(PROJECTS_COLUMNS, start=1):
            cell = new_ws.cell(1, col_idx)
            cell.value     = name
            cell.font      = HEADER_FONT
            cell.fill      = HEADER_FILL
            cell.alignment = Alignment(horizontal="center")
            new_ws.column_dimensions[cell.column_letter].width = width
    wb.save(str(PROJECTS_PATH))
    print(f"  projects.xlsx created at: {PROJECTS_PATH}")


def append_project(project_id, ticket_id, feature_branch, dest_branch, auto_merge,
                   config_file, pr_url="", pr_status="", status="Scheduled", job_id="", sonar="yes",
                   app_name="Payor"):
    if not PROJECTS_PATH.exists():
        _create_projects_xlsx()

    with _projects_filelock():
        wb  = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws  = _ensure_app_sheet(wb, app_name)
        row = ws.max_row + 1

        ws.cell(row, _COL["project_id"],     project_id)
        ws.cell(row, _COL["ticket_id"],      ticket_id or "").font      = BOLD
        ws.cell(row, _COL["feature_branch"], feature_branch).font       = Font(color="1F497D")
        ws.cell(row, _COL["dest_branch"],    dest_branch).font          = Font(color="1F497D")
        ws.cell(row, _COL["auto_merge"],     auto_merge)
        link_cell           = ws.cell(row, _COL["config_file"], config_file.name)
        link_cell.hyperlink = str(config_file)
        link_cell.font      = LINK_FONT
        ws.cell(row, _COL["status"],         status)
        if pr_url:
            pr_cell           = ws.cell(row, _COL["pr_url"], pr_url)
            pr_cell.hyperlink = pr_url
            pr_cell.font      = LINK_FONT
        else:
            ws.cell(row, _COL["pr_url"], "")
        ws.cell(row, _COL["pr_status"], pr_status or ("Open" if pr_url else ""))
        ws.cell(row, _COL["job_id"],    job_id or "")
        ws.cell(row, _COL["sonar"],        sonar or "")
        ws.cell(row, _COL["triggered_at"], time.strftime("%Y-%m-%d %H:%M"))

        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not update projects.xlsx (file may be open).")


# ---------------------------------------------------------------------------
# Project status update (used by retrigger)
# ---------------------------------------------------------------------------

def update_project_status(project_id, new_status, new_job_id, app_name="Payor"):
    if not PROJECTS_PATH.exists():
        return
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = _ensure_app_sheet(wb, app_name)
        for row in ws.iter_rows(min_row=2):
            if str(row[0].value or "").strip() == str(project_id):
                row[_COL["status"]  - 1].value = new_status
                if new_job_id is not None:
                    row[_COL["job_id"] - 1].value = new_job_id
                break
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print("  Warning: Could not update projects.xlsx (file may be open).")


def clone_by_pid(source_pid, secrets, settings, app_name="Payor"):
    """Copy params from an existing project, create a new project entry, and trigger build."""
    import shutil

    projects = load_projects(app_name)
    source = next((p for p in projects if str(p.get("project_id", "")) == str(source_pid)), None)
    if source is None:
        print(f"  ERROR: Project '{source_pid}' not found in projects.xlsx.")
        sys.exit(1)

    feature_branch  = str(source.get("feature_branch") or "")
    dest_branch     = str(source.get("dest_branch")     or "")
    ticket_id       = str(source.get("ticket_id")       or "")
    auto_merge      = str(source.get("auto_merge")      or "no")
    pr_url          = str(source.get("pr_url")           or "")
    pr_status       = str(source.get("pr_status")        or "")
    config_filename = str(source.get("config_file")      or "")
    sonar           = str(source.get("sonar")            or "yes")

    source_config = PROJECTS_DIR / app_name / config_filename
    if not source_config.exists():
        print(f"  ERROR: Source config file not found: {config_filename}")
        print("  The original config may have been deleted.")
        sys.exit(1)

    jira_base  = secrets.get("jira_base_url", "").rstrip("/")
    ticket_display = (
        hyperlink(f"{jira_base}/browse/{ticket_id}", ticket_id)
        if ticket_id and jira_base else ticket_id or "(not stored)"
    )
    import re as _re
    _m = _re.match(r"(https?://[^/]+/[^/]+/[^/]+)/pull/", pr_url) if pr_url else None
    branch_display = (
        hyperlink(f"{_m.group(1)}/tree/{feature_branch}", feature_branch)
        if _m else feature_branch
    )

    print(f"\n  Cloning project {source_pid} → new project")
    print(f"  Ticket        : {ticket_display}")
    print(f"  Feature branch: {branch_display}")
    print(f"  Dest branch   : {dest_branch}")
    print(f"  Auto merge    : {auto_merge}")
    if pr_url:
        print(f"  PR            : {hyperlink(pr_url, pr_url)}  [{pr_status}]")
    print()

    new_pid    = next_project_id(projects)
    label      = ticket_id or feature_branch.replace("/", "-")
    cfg_dir    = PROJECTS_DIR / app_name
    cfg_dir.mkdir(parents=True, exist_ok=True)
    new_config = cfg_dir / f"{new_pid}_{label}_config.xlsx"

    shutil.copy2(str(source_config), str(new_config))
    print(f"  New project_id : {new_pid}")
    print(f"  Config file    : {new_config.name}")

    build_status, job_id = trigger_jenkins_build(feature_branch, new_config, settings, secrets)

    if build_status == "Created":
        print(f"\n  Build was not triggered — project NOT added to projects.xlsx.")
        if new_config.exists():
            os.remove(str(new_config))
        sys.exit(1)

    append_project(
        new_pid, ticket_id, feature_branch, dest_branch, auto_merge,
        new_config, pr_url, pr_status, build_status, job_id or "", sonar,
        app_name=app_name
    )
    print(f"  projects.xlsx : row added (project_id={new_pid}, status={build_status}"
          + (f", job_id=#{job_id}" if job_id else "") + ")")
    print(f"\n  Done.")


# ---------------------------------------------------------------------------
# Existing-entry lookup
# ---------------------------------------------------------------------------

def find_existing_entries(projects, ticket_id, feature_branch):
    if ticket_id:
        return [p for p in projects
                if str(p.get("ticket_id", "")).upper() == ticket_id.upper()]
    return [p for p in projects
            if str(p.get("feature_branch", "")) == feature_branch]


def prompt_existing(entries, feature_branch):
    print("\n  Existing entries for this ticket/branch:\n")
    for i, e in enumerate(entries, start=1):
        print(f"    [{i}] project_id={e['project_id']}  branch={e.get('feature_branch','')}  "
              f"dest={e.get('dest_branch','')}  status={e.get('status','')}")
    print(f"    [N] Create new entry")
    print()
    while True:
        choice = input("  Select an option [1-N / N for new]: ").strip().upper()
        if choice == "N":
            return None, True
        try:
            idx = int(choice) - 1
            if 0 <= idx < len(entries):
                return entries[idx]["project_id"], False
        except ValueError:
            pass
        print("  Invalid choice — enter a number or N.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args(argv):
    args = {"ticket": None, "feature_branch": None, "dest_branch": None,
            "auto_merge": "no", "run_sonar": "yes", "project_id": None,
            "run_integ_tests": "no", "integ_category": "", "integ_custom": "", "integ_groups": "",
            "app": "Payor"}
    i = 1
    while i < len(argv):
        if argv[i] in ("-pid", "--project-id") and i + 1 < len(argv):
            args["project_id"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("-t", "--ticket") and i + 1 < len(argv):
            args["ticket"] = argv[i + 1].strip().upper(); i += 2
        elif argv[i] in ("-fb", "--feature-branch") and i + 1 < len(argv):
            args["feature_branch"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("-db", "--dest-branch") and i + 1 < len(argv):
            args["dest_branch"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("-am", "--auto-merge") and i + 1 < len(argv):
            args["auto_merge"] = argv[i + 1].strip().lower(); i += 2
        elif argv[i] in ("-sonar", "--sonar") and i + 1 < len(argv):
            args["run_sonar"] = argv[i + 1].strip().lower(); i += 2
        elif argv[i] in ("-it", "--integ-test") and i + 1 < len(argv):
            args["run_integ_tests"] = argv[i + 1].strip().lower(); i += 2
        elif argv[i] in ("-itcat", "--integ-category") and i + 1 < len(argv):
            args["integ_category"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("-itgroups", "--integ-groups") and i + 1 < len(argv):
            args["integ_groups"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("-itcustom", "--integ-custom") and i + 1 < len(argv):
            args["integ_custom"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("--app",) and i + 1 < len(argv):
            args["app"] = argv[i + 1].strip(); i += 2
        elif argv[i] in ("--help", "-h"):
            print(textwrap.dedent("""
                gprun — GP Build Tool

                Creates a per-ticket Jenkins build config and triggers the pipeline.

                Usage:
                  gprun -t <ticket_id> -db <dest_branch> [-am yes|no]
                  gprun -fb <feature_branch> -db <dest_branch> [-am yes|no]
                  gprun -pid <project_id>

                Options:
                  -t,   --ticket          JIRA ticket ID.
                                          Looks up branches from Atlassian that have a PR
                                          targeting dest_branch. Prompts if multiple found.
                  -fb,  --feature-branch  Feature branch name (ticket ID auto-extracted
                                          from branch name for JIRA PR lookup).
                                          At least one of -t or -fb is required.
                  -db,  --dest-branch     Destination branch to merge into (required).
                  -am,   --auto-merge      Auto-merge after build: yes or no (default: no).
                  -sonar,--sonar           Run Sonar analysis: yes or no (default: yes).
                  -pid,  --project-id      Copy params from an existing project, create a
                                           new project entry, and trigger a new GP build.
                  -h,    --help            Show this help.

                Examples:
                  gprun -t PAYOR-208267 -db main
                  gprun -t PAYOR-208267 -db main -am yes
                  gprun -fb bug-PAYOR-208267-fix -db main
                  gprun -pid 1

                Config:
                  GP_Build/gp_job_config.xlsx             Jenkins job settings
                  GP_Build/gp_params.xlsx                Build parameters + test groups
                  GP_Build/projects.xlsx                 Run tracking log
                  GP_Build/projects/<app>/<id>_<t>_config.xlsx  Per-project build config
                  secrets.xlsx                           Shared credentials
            """))
            sys.exit(0)
        else:
            i += 1
    return args


def main():
    args = parse_args(sys.argv)

    app_name = args.get("app", "Payor")

    # ── Clone mode: gprun -pid <project_id> ──────────────────────────────────
    if args.get("project_id"):
        try:
            secrets = load_secrets()
        except FileNotFoundError as e:
            print(f"  ERROR: {e}")
            sys.exit(1)
        clone_by_pid(args["project_id"], secrets, load_settings(app_name), app_name)
        sys.exit(0)

    ticket_id       = args["ticket"] or ""
    feature_branch  = args["feature_branch"] or ""
    dest_branch     = args["dest_branch"] or ""
    auto_merge      = args["auto_merge"]
    run_sonar       = args["run_sonar"]
    run_integ_tests = args.get("run_integ_tests", "no")
    integ_category  = args.get("integ_category", "")
    integ_custom    = args.get("integ_custom", "")
    integ_groups    = args.get("integ_groups", "")

    if not ticket_id and not feature_branch:
        print("ERROR: at least one of -t <ticket_id> or -fb <feature_branch> is required.")
        print("Usage: gprun -t <ticket_id> -db <dest_branch>")
        print("       gprun -fb <feature_branch> -db <dest_branch>")
        print("       gprun --help")
        sys.exit(1)
    if not dest_branch:
        print("ERROR: -db <destination_branch> is required.")
        sys.exit(1)
    if auto_merge not in ("yes", "no"):
        print("ERROR: -am must be 'yes' or 'no'.")
        sys.exit(1)
    if run_sonar not in ("yes", "no"):
        print("ERROR: -sonar must be 'yes' or 'no'.")
        sys.exit(1)
    if run_integ_tests not in ("yes", "no"):
        print("ERROR: -it must be 'yes' or 'no'.")
        sys.exit(1)

    try:
        secrets = load_secrets()
    except FileNotFoundError as e:
        print(f"  ERROR: {e}")
        sys.exit(1)

    settings = load_settings(app_name)

    # ── Resolve feature branch and PR info ───────────────────────────────────
    pr_url    = ""
    pr_status = ""

    if ticket_id and not feature_branch:
        # -t only: look up branch + PR from JIRA
        feature_branch, pr_url, pr_status = resolve_branch(ticket_id, dest_branch, secrets)
    else:
        # -fb given: extract ticket from branch name if -t not also provided
        if not ticket_id:
            ticket_id = extract_ticket_from_branch(feature_branch)
            if ticket_id:
                print(f"  Ticket ID extracted from branch: {ticket_id}")

        # Look up PRs for this specific branch
        pr_url, pr_status = resolve_pr_for_branch(feature_branch, dest_branch, ticket_id, secrets)

    jira_base  = secrets.get("jira_base_url", "").rstrip("/")
    ticket_display = (
        hyperlink(f"{jira_base}/browse/{ticket_id}", ticket_id)
        if ticket_id and jira_base else ticket_id or "(not provided)"
    )
    # Derive GitHub repo URL from PR URL: https://github.com/org/repo/pull/N → /tree/branch
    repo_base = ""
    if pr_url:
        import re as _re
        m = _re.match(r"(https?://[^/]+/[^/]+/[^/]+)/pull/", pr_url)
        if m:
            repo_base = m.group(1)
    branch_display = (
        hyperlink(f"{repo_base}/tree/{feature_branch}", feature_branch)
        if repo_base else feature_branch
    )

    print(f"\n  Ticket        : {ticket_display}")
    print(f"  Feature branch: {branch_display}")
    print(f"  Dest branch   : {dest_branch}")
    print(f"  Auto merge    : {auto_merge}")
    print(f"  Sonar analysis: {run_sonar}")
    if pr_url:
        print(f"  PR            : {hyperlink(pr_url, pr_url)}  [{pr_status}]")
    print()

    # ── Always create a new project entry ────────────────────────────────────
    projects   = load_projects(app_name)
    existing   = find_existing_entries(projects, ticket_id, feature_branch)
    if existing:
        ids = ", ".join(str(e["project_id"]) for e in existing)
        print(f"  Note: prior entries exist for this ticket/branch (project_id={ids}).")
        print(f"  Use  gprun -pid <id>  to re-run a previous project.\n")
    project_id = next_project_id(projects)
    is_new     = True

    # ── Create ticket config file ─────────────────────────────────────────────
    print(f"  Creating ticket config  (project_id={project_id})...")
    ticket_file = create_ticket_config(project_id, ticket_id, feature_branch, dest_branch, auto_merge, run_sonar,
                                        run_integ_tests, integ_category, integ_custom, app_name=app_name,
                                        integ_groups=integ_groups)
    print(f"  Config file   : {ticket_file}")

    # ── Trigger Jenkins build ─────────────────────────────────────────────────
    build_status, job_id = trigger_jenkins_build(feature_branch, ticket_file, settings, secrets)

    # ── Abort if trigger failed — do NOT record in projects.xlsx ─────────────
    if build_status == "Created":
        print(f"\n  Build was not triggered — project NOT added to projects.xlsx.")
        print(f"  Fix the issue above, then re-run gprun.")
        if os.path.exists(str(ticket_file)):
            os.remove(str(ticket_file))
            print(f"  Config file removed: {ticket_file}")
        sys.exit(1)

    # ── Update projects.xlsx ──────────────────────────────────────────────────
    if is_new:
        append_project(
            project_id, ticket_id, feature_branch, dest_branch, auto_merge,
            ticket_file, pr_url, pr_status, build_status, job_id or "", run_sonar,
            app_name=app_name
        )
        _job_base    = settings.get("url", "").rstrip("/")
        _job_display = (
            hyperlink(f"{_job_base}/{job_id}", f"#{job_id}")
            if job_id and _job_base else (f"#{job_id}" if job_id else "")
        )
        print(f"  projects.xlsx : row added (project_id={project_id}, status={build_status}"
              + (f", job_id={_job_display}" if job_id else "") + ")")

    print(f"\n  Done.")
    print(f"  Config: {ticket_file}")


if __name__ == "__main__":
    main()
