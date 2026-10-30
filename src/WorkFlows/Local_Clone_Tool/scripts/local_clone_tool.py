#!/usr/bin/env python3
"""
Local Clone Tool
----------------
Given a JIRA clone ticket:
  1. Fetches ticket type + summary + fix versions from JIRA
  2. Resolves the payor release branch from GitHub (decrement version search)
  3. Sets up master + release branch in to_repo
  4. Creates a project entry for multi-PR tracking
  5. Traverses to the original ticket via clone link
  6. Finds all merged PRs on the original ticket
  7. For each PR: creates a clone branch and cherry-picks commits
  8. Prompts: git add -> commit -> push -> PR creation link

Usage:
  lclone -ticket PAYOR-208264
"""

import os
import sys
import re
import subprocess
import textwrap
import urllib.parse
import base64
import openpyxl
import urllib3
from openpyxl.styles import Font as XlFont, PatternFill, Alignment
import requests
from pathlib import Path
from datetime import datetime

# Corporate SSL proxy presents a CA cert that fails strict validation.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
_orig_request = requests.Session.request
def _no_verify_request(self, method, url, **kwargs):
    kwargs.setdefault("verify", False)
    return _orig_request(self, method, url, **kwargs)
requests.Session.request = _no_verify_request

_LINK_FONT   = XlFont(color="0563C1", underline="single")
_HDR_FONT    = XlFont(bold=True, color="FFFFFF", name="Calibri")
_HDR_FILL    = PatternFill("solid", fgColor="1F3864")
_HDR_ALIGN   = Alignment(horizontal="left", vertical="center")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config(config_path="config.xlsx"):
    wb = openpyxl.load_workbook(config_path)
    settings_ws = wb["Settings"]
    settings = {}
    for row in settings_ws.iter_rows(min_row=2, values_only=True):
        if row[0] and row[1] is not None:
            settings[str(row[0]).strip()] = str(row[1]).strip()
    branch_ws = wb["BranchTypes"]
    branch_types = {}
    for row in branch_ws.iter_rows(min_row=2, values_only=True):
        if row[0] and row[1]:
            branch_types[str(row[0]).strip().lower()] = str(row[1]).strip()
    return settings, branch_types


def load_secrets(secrets_path):
    secrets = {}
    if not os.path.exists(secrets_path):
        return secrets
    wb = openpyxl.load_workbook(secrets_path)
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                secrets[str(row[0]).strip()] = str(row[1]).strip()
    return secrets


def _load_kv_sheet(xlsx_path, sheet_name="Config"):
    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb[sheet_name]
    data = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] and row[1] is not None:
            data[str(row[0]).strip()] = str(row[1]).strip()
    return data


def load_project_for_ticket(tool_root, ticket_id):
    """Load the config for the project type that matches the ticket's JIRA prefix.
    Derives ptype directly from the prefix: PAYOR-208264 -> payor_config.xlsx.
    """
    prefix      = ticket_id.split("-")[0].upper()   # e.g. "PAYOR"
    ptype       = prefix.lower()                     # e.g. "payor"
    config_path = os.path.join(tool_root, "project_type_config", f"{ptype}_config.xlsx")
    if not os.path.exists(config_path):
        config_dir = os.path.join(tool_root, "project_type_config")
        available  = ", ".join(
            f[:-len("_config.xlsx")].upper()
            for f in sorted(os.listdir(config_dir))
            if f.endswith("_config.xlsx")
        ) if os.path.isdir(config_dir) else "(none)"
        raise ValueError(
            f"No config file found for JIRA prefix '{prefix}'.\n"
            f"  Expected: project_type_config/{ptype}_config.xlsx\n"
            f"  Available types: {available}\n"
            f"  Run 'setuplclonetool' to create missing config files."
        )
    try:
        data = _load_kv_sheet(config_path, sheet_name="Config")
    except Exception as e:
        raise ValueError(f"Could not read {config_path}: {e}") from e
    return {
        "name":                  ptype,
        "jira_prefix":           prefix,
        "repo_url":              str(data.get("repo_url",              "") or "").strip(),
        "release_branch_prefix": str(data.get("release_branch_prefix", "") or
                                    data.get("branch_prefix",          "") or "").strip() or "release-",
        "source_repo_branch":    str(data.get("source_repo_branch",    "") or
                                    data.get("from_branch",            "") or "").strip() or "master",
    }




# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------

def _version_candidates(version_str):
    """Yield version candidates in decreasing order for branch resolution.
    26.1.1.4.4 → 26.1.1.4.4, 26.1.1.4.3, ..., 26.1.1.4, 26.1.1.3, ..., 26.1.1, 26.1, 26
    """
    parts = [int(x) for x in version_str.split('.')]

    def _gen(pts):
        yield '.'.join(str(p) for p in pts)
        if len(pts) == 1:
            return
        curr = list(pts)
        while curr[-1] > 1:
            curr[-1] -= 1
            yield '.'.join(str(p) for p in curr)
        yield from _gen(pts[:-1])

    yield from _gen(parts)


def _parse_github_repo_url(url):
    if not url:
        return None, None
    url = url.rstrip('/').replace('.git', '')
    m = re.search(r'github\.com/([^/]+)/([^/]+)', url)
    return (m.group(1), m.group(2)) if m else (None, None)


def github_branch_exists(owner, repo, branch_name, github_token):
    encoded = urllib.parse.quote(branch_name, safe='')
    url  = f"https://api.github.com/repos/{owner}/{repo}/branches/{encoded}"
    resp = requests.get(url, headers=_github_auth_headers(github_token), timeout=15)
    return resp.status_code == 200


def get_pom_version_from_branch(owner, repo, branch_name, github_token):
    encoded = urllib.parse.quote(branch_name, safe='')
    url  = f"https://api.github.com/repos/{owner}/{repo}/contents/pom.xml?ref={encoded}"
    resp = requests.get(url, headers=_github_auth_headers(github_token), timeout=15)
    if resp.status_code != 200:
        return None
    try:
        content = base64.b64decode(resp.json().get('content', '')).decode('utf-8', errors='replace')
        m = re.search(r'<version>([^<]+)-SNAPSHOT</version>', content)
        return m.group(1) if m else None
    except Exception:
        return None


def resolve_repo_version(fix_versions, repo_url, branch_prefix, github_token):
    """Find the best matching release branch from the fix versions list.
    Returns resolved version string (e.g. '26.1.1.1') or None.
    """
    owner, repo = _parse_github_repo_url(repo_url)
    if not owner:
        return None
    fix_ver = next((v for v in fix_versions if re.match(r'^\d+\.\d+', str(v))), None)
    if not fix_ver:
        return None
    print(f"  Searching for release branch from fix version: {fix_ver}")
    for candidate in _version_candidates(str(fix_ver)):
        branch_name = f"{branch_prefix}{candidate}"
        if github_branch_exists(owner, repo, branch_name, github_token):
            branch_url  = f"https://github.com/{owner}/{repo}/tree/{branch_name}"
            branch_link = hyperlink(branch_url, branch_name)
            pom_ver = get_pom_version_from_branch(owner, repo, branch_name, github_token)
            if pom_ver and pom_ver == candidate:
                print(f"  Branch found : {branch_link}  (pom.xml confirms {pom_ver}-SNAPSHOT)")
            elif pom_ver:
                print(f"  Branch found : {branch_link}  (pom.xml version: {pom_ver}-SNAPSHOT, expected {candidate})")
            else:
                print(f"  Branch found : {branch_link}  (pom.xml not verified)")
            print(f"  Clone Payor Repo Version: {candidate}")
            return candidate
    print(f"  Warning: no release branch found for fix version {fix_ver}")
    return None


# ---------------------------------------------------------------------------
# Project log — two-sheet xlsx (Projects + PRs)
# ---------------------------------------------------------------------------

_PROJ_COLS   = ["project_id", "ticket_id", "parent_ticket", "payor_version", "created_at", "status"]
_PR_COLS     = ["project_id", "pr_index", "original_pr_url", "original_branch",
                "clone_branch", "clone_pr_url", "pr_status"]
_PROJ_WIDTHS = [12, 20, 20, 14, 22, 16]
_PR_WIDTHS   = [12, 10, 52, 36, 36, 52, 16]

# Per-project detail file columns (pid_ticket.xlsx  Project sheet)
_DETAIL_PROJ_COLS   = ["project_id", "ticket_id", "parent_ticket", "payor_version",
                       "created_at", "status", "from_repo", "to_repo"]
_DETAIL_PROJ_WIDTHS = [12, 20, 20, 14, 22, 16, 70, 70]


def _set_hdr_row(ws, cols, widths):
    ws.append(cols)
    for i, (col, w) in enumerate(zip(cols, widths), 1):
        c = ws.cell(1, i)
        c.font      = _HDR_FONT
        c.fill      = _HDR_FILL
        c.alignment = _HDR_ALIGN
        ws.column_dimensions[c.column_letter].width = w


def _get_or_create_projects_wb(path):
    """Load or create a two-sheet projects workbook. Migrates old CloneLog format."""
    path = str(path)
    if not os.path.exists(path):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        ws_proj = wb.create_sheet("Projects")
        _set_hdr_row(ws_proj, _PROJ_COLS, _PROJ_WIDTHS)
        ws_prs = wb.create_sheet("PRs")
        _set_hdr_row(ws_prs, _PR_COLS, _PR_WIDTHS)
        wb.save(path)
        return wb

    wb = openpyxl.load_workbook(path)

    # Migrate old CloneLog-only format
    if "CloneLog" in wb.sheetnames and "Projects" not in wb.sheetnames:
        old_ws = wb["CloneLog"]
        ws_proj = wb.create_sheet("Projects")
        _set_hdr_row(ws_proj, _PROJ_COLS, _PROJ_WIDTHS)
        # Map old rows: project_id, cloned_ticket, cloned_pr, parent_ticket, parent_pr, status
        for row in old_ws.iter_rows(min_row=2, values_only=True):
            if not row[0]:
                continue
            ws_proj.append([
                row[0],          # project_id
                row[1] or "",    # ticket_id (cloned_ticket)
                row[3] or "",    # parent_ticket
                "",              # payor_version (unknown)
                "",              # created_at (unknown)
                row[5] or "In Progress",  # status
            ])
        ws_prs = wb.create_sheet("PRs")
        _set_hdr_row(ws_prs, _PR_COLS, _PR_WIDTHS)
        # Migrate PRs from old rows
        for row in old_ws.iter_rows(min_row=2, values_only=True):
            if not row[0]:
                continue
            ws_prs.append([
                row[0],          # project_id
                1,               # pr_index
                row[4] or "",    # original_pr_url (parent_pr)
                "",              # original_branch
                "",              # clone_branch
                row[2] or "",    # clone_pr_url (cloned_pr)
                "Cloned",        # pr_status
            ])
        del wb["CloneLog"]
        wb.save(path)
        return wb

    # Ensure both sheets exist
    if "Projects" not in wb.sheetnames:
        ws_proj = wb.create_sheet("Projects")
        _set_hdr_row(ws_proj, _PROJ_COLS, _PROJ_WIDTHS)
    if "PRs" not in wb.sheetnames:
        ws_prs = wb.create_sheet("PRs")
        _set_hdr_row(ws_prs, _PR_COLS, _PR_WIDTHS)

    return wb


def _projects_path(tool_root, ptype):
    return os.path.join(tool_root, "projects", f"{ptype}_projects.xlsx")


def _project_detail_path(tool_root, project_id, ticket_id):
    """Path for per-project detail xlsx: projects/<pid>_<ticket_id>.xlsx"""
    safe = str(ticket_id).replace("/", "_").replace("\\", "_")
    return os.path.join(str(tool_root), "projects", f"{project_id}_{safe}.xlsx")


def _find_project_detail_file(tool_root, project_id):
    """Locate per-project detail file by scanning projects/<pid>_*.xlsx."""
    proj_dir = Path(tool_root) / "projects"
    for f in sorted(proj_dir.glob(f"{project_id}_*.xlsx")):
        if not f.name.endswith("_projects.xlsx"):
            return str(f)
    return None


def _get_or_create_project_detail_wb(path):
    """Load or create per-project workbook with 'Project' + 'PRs' sheets."""
    path = str(path)
    if not os.path.exists(path):
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        ws_proj = wb.create_sheet("Project")
        _set_hdr_row(ws_proj, _DETAIL_PROJ_COLS, _DETAIL_PROJ_WIDTHS)
        ws_prs = wb.create_sheet("PRs")
        _set_hdr_row(ws_prs, _PR_COLS, _PR_WIDTHS)
        wb.save(path)
        return wb
    wb = openpyxl.load_workbook(path)
    if "Project" not in wb.sheetnames:
        ws = wb.create_sheet("Project")
        _set_hdr_row(ws, _DETAIL_PROJ_COLS, _DETAIL_PROJ_WIDTHS)
    if "PRs" not in wb.sheetnames:
        ws = wb.create_sheet("PRs")
        _set_hdr_row(ws, _PR_COLS, _PR_WIDTHS)
    return wb


def create_project_entry(tool_root, ptype, ticket_id, parent_ticket, payor_version,
                         from_repo="", to_repo=""):
    """Create or return existing project entry. Returns project_id (int)."""
    index_path = _projects_path(tool_root, ptype)
    wb_idx     = _get_or_create_projects_wb(index_path)
    ws_idx     = wb_idx["Projects"]

    # Check if ticket_id already exists in shared index
    for row in ws_idx.iter_rows(min_row=2, values_only=True):
        if row[1] and str(row[1]).strip().upper() == ticket_id.upper():
            return int(row[0])

    # New entry — assign next project_id
    max_id = 0
    for row in ws_idx.iter_rows(min_row=2, values_only=True):
        if row[0]:
            try:
                max_id = max(max_id, int(row[0]))
            except (ValueError, TypeError):
                pass
    new_id = max_id + 1
    now    = datetime.now().strftime("%Y-%m-%d %H:%M")

    ws_idx.append([new_id, ticket_id, parent_ticket or "", payor_version or "", now, "In Progress"])
    try:
        wb_idx.save(str(index_path))
    except PermissionError:
        print(f"  Warning: Could not save project index: {index_path}")

    # Create per-project detail file  <pid>_<ticket_id>.xlsx
    detail_path = _project_detail_path(tool_root, new_id, ticket_id)
    wb_det      = _get_or_create_project_detail_wb(detail_path)
    ws_det      = wb_det["Project"]
    ws_det.append([new_id, ticket_id, parent_ticket or "", payor_version or "", now, "In Progress",
                   from_repo, to_repo])
    try:
        wb_det.save(str(detail_path))
    except PermissionError:
        print(f"  Warning: Could not save project detail file: {detail_path}")
    print(f"     Detail file: {detail_path}")

    return new_id


def upsert_pr_entry(tool_root, ptype, project_id, pr_index,
                    original_pr_url, original_branch, clone_branch,
                    clone_pr_url="", pr_status="Cloned"):
    """Create or update a PR tracking row in the per-project detail file."""
    detail_path = _find_project_detail_file(tool_root, project_id)
    if detail_path:
        wb = _get_or_create_project_detail_wb(detail_path)
    else:
        detail_path = _projects_path(tool_root, ptype)
        wb = _get_or_create_projects_wb(str(detail_path))
    ws = wb["PRs"]

    target_row = None
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if (row[0].value == project_id and
                row[1].value is not None and int(row[1].value) == pr_index):
            target_row = i
            break

    if target_row is None:
        ws.append([project_id, pr_index, original_pr_url, original_branch,
                   clone_branch, clone_pr_url, pr_status])
    else:
        ws.cell(target_row, 3, original_pr_url)
        ws.cell(target_row, 4, original_branch)
        ws.cell(target_row, 5, clone_branch)
        if clone_pr_url:
            c = ws.cell(target_row, 6, clone_pr_url)
            c.hyperlink = clone_pr_url
            c.font      = _LINK_FONT
        ws.cell(target_row, 7, pr_status)

    try:
        wb.save(str(detail_path))
    except PermissionError:
        print(f"  Warning: Could not update PR log: {detail_path}")


def update_pr_status(tool_root, ptype, project_id, pr_index,
                     clone_pr_url=None, pr_status=None):
    """Update clone_pr_url and/or pr_status in the per-project detail file."""
    detail_path = _find_project_detail_file(tool_root, project_id)
    if detail_path is None:
        detail_path = str(_projects_path(tool_root, ptype))
    if not os.path.exists(detail_path):
        return
    wb = openpyxl.load_workbook(detail_path)
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
            if pr_status is not None:
                ws.cell(i, 7, pr_status)
            break
    try:
        wb.save(detail_path)
    except PermissionError:
        print(f"  Warning: Could not update PR status: {detail_path}")


def compute_project_status(tool_root, ptype, project_id):
    """Returns 'Complete' if all PRs are Merged, else 'In Progress'."""
    detail_path = _find_project_detail_file(tool_root, project_id)
    if detail_path is None:
        detail_path = str(_projects_path(tool_root, ptype))
    if not os.path.exists(detail_path):
        return "In Progress"
    wb = openpyxl.load_workbook(detail_path)
    if "PRs" not in wb.sheetnames:
        return "In Progress"
    ws    = wb["PRs"]
    found = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] == project_id:
            found.append(str(row[6] or "").strip())
    if not found:
        return "In Progress"
    return "Complete" if all(s == "Merged" for s in found) else "In Progress"


def update_project_status(tool_root, ptype, project_id, status):
    """Update status in both per-project detail file and shared index."""
    # Update per-project detail file
    detail_path = _find_project_detail_file(tool_root, project_id)
    if detail_path and os.path.exists(detail_path):
        wb = openpyxl.load_workbook(detail_path)
        if "Project" in wb.sheetnames:
            ws = wb["Project"]
            for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
                if row[0].value == project_id:
                    ws.cell(i, 6, status)
                    break
            try:
                wb.save(detail_path)
            except PermissionError:
                pass

    # Update shared index
    index_path = _projects_path(tool_root, ptype)
    if not os.path.exists(str(index_path)):
        return
    wb = openpyxl.load_workbook(str(index_path))
    if "Projects" not in wb.sheetnames:
        return
    ws = wb["Projects"]
    for i, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if row[0].value == project_id:
            ws.cell(i, 6, status)
            break
    try:
        wb.save(str(index_path))
    except PermissionError:
        print(f"  Warning: Could not update project status: {index_path}")


def _load_existing_prs(tool_root, ptype, project_id):
    """Return sorted list of PR dicts already tracked for project_id, or []."""
    detail_path = _find_project_detail_file(tool_root, project_id)
    if detail_path is None:
        detail_path = str(_projects_path(tool_root, ptype))
    if not os.path.exists(detail_path):
        return []
    wb = openpyxl.load_workbook(detail_path)
    if "PRs" not in wb.sheetnames:
        return []
    ws = wb["PRs"]
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] == project_id:
            rows.append({
                "pr_index":        int(row[1]) if row[1] else 0,
                "original_pr_url": str(row[2] or ""),
                "original_branch": str(row[3] or ""),
                "clone_branch":    str(row[4] or ""),
                "clone_pr_url":    str(row[5] or ""),
                "pr_status":       str(row[6] or ""),
            })
    rows.sort(key=lambda r: r["pr_index"])
    return rows


# ---------------------------------------------------------------------------
# JIRA helpers
# ---------------------------------------------------------------------------

def parse_ticket_id(url_or_id):
    if re.match(r'^[A-Z]+-\d+$', url_or_id):
        return url_or_id
    match = re.search(r'/browse/([A-Z]+-\d+)', url_or_id)
    if not match:
        # try plain ticket format anywhere in string
        match = re.search(r'([A-Z]+-\d+)', url_or_id)
    if not match:
        raise ValueError(f"Cannot parse JIRA ticket ID from: {url_or_id}")
    return match.group(1)


class JiraClient:
    def __init__(self, base_url, email, token, config_path):
        self.base_url    = base_url.rstrip("/")
        self.email       = email
        self.token       = token
        self.config_path = config_path

    def get(self, path):
        url  = f"{self.base_url}/rest/api/3{path}"
        resp = requests.get(url, auth=(self.email, self.token), timeout=30)
        if resp.status_code == 401:
            self.token = self._refresh_token()
            resp = requests.get(url, auth=(self.email, self.token), timeout=30)
        if resp.status_code == 403:
            raise RuntimeError(
                f"Atlassian access denied (HTTP 403) for {url}.\n"
                f"  Your account may lack permission for this project."
            )
        resp.raise_for_status()
        return resp.json()

    def get_raw(self, url, params=None):
        resp = requests.get(url, auth=(self.email, self.token), params=params, timeout=30)
        if resp.status_code == 401:
            self.token = self._refresh_token()
            resp = requests.get(url, auth=(self.email, self.token), params=params, timeout=30)
        if resp.status_code == 403:
            raise RuntimeError(f"Atlassian access denied (HTTP 403) for {url}.")
        resp.raise_for_status()
        return resp.json()

    def _refresh_token(self):
        token_url = "https://id.atlassian.com/manage-profile/security/api-tokens"
        print()
        print("  Atlassian API token expired or invalid (HTTP 401).")
        print(f"  Generate a new token at: {token_url}")
        print("  Then update 'jira_api_token' in secrets.xlsx (Atlassian sheet).")
        new_token = input("  Enter new JIRA API token: ").strip()
        if not new_token:
            raise RuntimeError("No token entered — cannot continue.")
        wb = openpyxl.load_workbook(self.config_path)
        ws = wb["Settings"]
        for row in ws.iter_rows(min_row=2):
            if row[0].value and str(row[0].value).strip() == "jira_api_token":
                row[1].value = new_token
                break
        wb.save(self.config_path)
        print("  config.xlsx updated with new token.\n")
        return new_token


def fetch_ticket(ticket_id, jira: JiraClient):
    return jira.get(f"/issue/{ticket_id}?fields=summary,issuetype,issuelinks,fixVersions")


def _find_clone_parent(ticket_data, link_type_config):
    links  = ticket_data.get("fields", {}).get("issuelinks", [])
    target = link_type_config.lower().strip()
    for link in links:
        ltype   = link.get("type", {})
        inward  = ltype.get("inward",  "").lower().strip()
        outward = ltype.get("outward", "").lower().strip()
        name    = ltype.get("name",    "").lower().strip()
        if target in (name, inward, outward):
            if "outwardIssue" in link:
                return link["outwardIssue"]["key"]
    raise ValueError("No outward clone link found — this ticket is the original.")


def find_true_original_ticket(start_id, jira, link_type_config, jira_base_url=""):
    visited = set()
    chain   = []
    current = start_id

    def _link(tid):
        if jira_base_url:
            return hyperlink(f"{jira_base_url}/browse/{tid}", tid)
        return tid

    while True:
        if current in visited:
            print(f"  Warning: clone-link cycle detected at {current} — stopping.")
            break
        visited.add(current)
        chain.append(current)
        ticket = fetch_ticket(current, jira)
        try:
            parent = _find_clone_parent(ticket, link_type_config)
        except ValueError:
            break
        print(f"       {_link(current)}  ->  {_link(parent)}")
        current = parent
    return current, chain


def _github_pr_details(pr_url, github_token):
    try:
        owner, repo, pr_number = parse_github_pr(pr_url)
        resp = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}",
            headers=_github_auth_headers(github_token), timeout=30
        )
        if resp.status_code in (401, 403):
            return False, "", ""
        resp.raise_for_status()
        data         = resp.json()
        is_merged    = data.get("merged", False) or (
                           data.get("state") == "closed" and bool(data.get("merged_at")))
        dest_branch   = data.get("base", {}).get("ref", "")
        source_branch = data.get("head", {}).get("ref", "")
        return bool(is_merged), dest_branch, source_branch
    except Exception:
        return False, "", ""


def _branch_name(val):
    """Extract a branch name from a Jira dev-status field.
    Handles both plain string and nested dict shapes:
      "master"
      {"branch": {"name": "master"}}
      {"branch": "master"}
      {"name": "master"}
    """
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        branch = val.get("branch")
        if isinstance(branch, str):
            return branch
        if isinstance(branch, dict):
            return branch.get("name", "")
        return val.get("name", "")
    return ""


def _ticket_branch_filter(ticket_id):
    tid = ticket_id.upper()
    def _matches(name):
        return tid in name.upper()
    return _matches


def find_all_merged_prs(ticket_id, jira: JiraClient, from_branch,
                        scm_type="github", github_token=""):
    issue_data = jira.get(f"/issue/{ticket_id}?fields=id")
    issue_id   = issue_data["id"]
    matches    = _ticket_branch_filter(ticket_id)
    detail_url = f"{jira.base_url}/rest/dev-status/1.0/issue/detail"
    results    = []

    # ── Discover registered application types from summary ───────────────────
    app_types = []
    try:
        summary    = jira.get_raw(
            f"{jira.base_url}/rest/dev-status/1.0/issue/summary",
            params={"issueId": issue_id}
        )
        pr_by_type = (summary.get("summary") or {}).get("pullrequest", {}).get("byInstanceType", {})
        app_types  = list(pr_by_type.keys())
    except Exception:
        pass
    if not app_types:
        app_type_map = {"github": "GitHub", "bitbucket": "Bitbucket", "azuredevops": "AzureDevOps"}
        app_types = [app_type_map.get(scm_type.lower(), "GitHub")]

    # ── Try dataType=pullrequest for each discovered app type ─────────────────
    for app_type in app_types:
        try:
            data = jira.get_raw(detail_url, params={
                "issueId": issue_id, "applicationType": app_type, "dataType": "pullrequest"
            })
            for detail in data.get("detail", []):
                for pr in detail.get("pullRequests", []):
                    status      = pr.get("status", "")
                    dest        = _branch_name(pr.get("destination", ""))
                    source_name = _branch_name(pr.get("source", ""))
                    if status.upper() == "MERGED" and dest == from_branch and matches(source_name):
                        results.append({
                            "pr_url":    pr.get("url", ""),
                            "pr_number": str(pr.get("id", "")),
                            "branch":    source_name,
                        })
        except Exception:
            pass

    if results:
        print(f"       (found {len(results)} merged PR(s) via dev-status pullrequest API)")
        return results

    # ── Try dataType=branch for each discovered app type ─────────────────────
    for app_type in app_types:
        try:
            data = jira.get_raw(detail_url, params={
                "issueId": issue_id, "applicationType": app_type, "dataType": "branch"
            })
            for detail in data.get("detail", []):
                for branch in detail.get("branches", []):
                    branch_name = branch.get("name", "")
                    if not matches(branch_name):
                        continue
                    for pr in branch.get("pullRequests", []):
                        dest = _branch_name(pr.get("destination", ""))
                        if pr.get("status", "").upper() == "MERGED" and dest == from_branch:
                            results.append({
                                "pr_url":    pr.get("url", ""),
                                "pr_number": str(pr.get("id", "")),
                                "branch":    branch_name,
                            })
        except Exception:
            pass

    if results:
        print(f"       (found {len(results)} merged PR(s) via dev-status branch API)")
        return results

    print(f"       dev-status API returned no matching merged PRs — trying remote links fallback...")
    return _find_all_merged_prs_via_remote_links(
        ticket_id, jira, from_branch, scm_type, github_token, matches
    )


def _find_all_merged_prs_via_remote_links(ticket_id, jira: JiraClient,
                                          from_branch, scm_type, github_token,
                                          branch_filter=None):
    remote_links = jira.get(f"/issue/{ticket_id}/remotelink")
    pr_re = {
        "github":    re.compile(r'github\.com/[^/]+/[^/]+/pull/\d+'),
        "bitbucket": re.compile(r'bitbucket\.org/[^/]+/[^/]+/pull-requests/\d+'),
    }.get(scm_type.lower(), re.compile(r'github\.com/[^/]+/[^/]+/pull/\d+'))

    candidates = [
        lnk.get("object", {}).get("url", "")
        for lnk in remote_links
        if pr_re.search(lnk.get("object", {}).get("url", ""))
    ]
    if not candidates:
        raise ValueError(
            f"No merged PR to '{from_branch}' found on {ticket_id}.\n"
            f"  Attach the PR URL directly to the JIRA ticket as a remote link and retry."
        )
    results = []
    for pr_url in candidates:
        if scm_type.lower() != "github":
            results.append({"pr_url": pr_url, "pr_number": "", "branch": ""})
            continue
        merged, dest, source = _github_pr_details(pr_url, github_token)
        if merged and dest == from_branch:
            results.append({"pr_url": pr_url, "pr_number": "", "branch": source})

    if not results:
        raise ValueError(
            f"Found {len(candidates)} PR link(s) on {ticket_id} but none is "
            f"merged to '{from_branch}'.\n"
            f"  Check that the PRs target '{from_branch}' and are merged."
        )
    print(f"       (found {len(results)} merged PR(s) via remote links fallback)")
    return results


# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------

def parse_github_pr(pr_url):
    match = re.search(r'github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
    if not match:
        raise ValueError(f"Cannot parse GitHub PR URL: {pr_url}")
    return match.group(1), match.group(2), match.group(3)


def _github_auth_headers(github_token):
    h = {"Accept": "application/vnd.github.v3+json"}
    if github_token:
        h["Authorization"] = f"token {github_token}"
    return h


_GITHUB_TOKEN_URL = "https://github.com/settings/tokens"


def _raise_github_error(resp):
    code = resp.status_code
    if code == 401:
        raise RuntimeError(
            f"GitHub token expired or invalid (HTTP 401).\n"
            f"  Generate a new token: {_GITHUB_TOKEN_URL}\n"
            f"  Update 'github_token' in secrets.xlsx (GitHub sheet)"
        )
    if code == 403:
        raise RuntimeError(
            f"GitHub request denied (HTTP 403).\n"
            f"  Check token scope (needs 'repo') at {_GITHUB_TOKEN_URL}"
        )
    resp.raise_for_status()


def get_pr_commits(pr_url, github_token):
    owner, repo, pr_number = parse_github_pr(pr_url)
    url  = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/commits"
    resp = requests.get(url, headers=_github_auth_headers(github_token), timeout=30)
    if resp.status_code in (401, 403):
        _raise_github_error(resp)
    resp.raise_for_status()
    return [c["sha"] for c in resp.json()]


# ---------------------------------------------------------------------------
# Branch name helpers
# ---------------------------------------------------------------------------

def extract_branch_suffix(branch_name, original_ticket_id):
    """Extract the descriptive suffix from a PR branch name.
    bug-PAYOR-203368-fix_desc  → fix_desc
    feature_PAYOR-203368_feat  → feat
    PAYOR-203368-fix_desc      → fix_desc
    Falls back to the full branch name.
    """
    tid = re.escape(original_ticket_id)
    m = re.match(rf'(?:bug|feature)[-_]+{tid}[-_]+(.+)', branch_name, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.match(rf'{tid}[-_]+(.+)', branch_name, re.IGNORECASE)
    if m:
        return m.group(1)
    return branch_name


def build_clone_branch_name(issue_type, clone_ticket_id, branch_suffix):
    """Build: bug-PAYOR-208264_fix_desc  or  feature-PAYOR-208264_feat."""
    prefix = "bug" if issue_type.lower() == "bug" else "feature"
    suffix = branch_suffix.lstrip('-_')
    return f"{prefix}-{clone_ticket_id}_{suffix}"


def to_snake_case(text):
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s-]+', '_', text.strip())
    return text.lower()


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def git(args, cwd):
    result = subprocess.run(
        ["git"] + args, cwd=cwd,
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {result.returncode}):\n"
            f"{result.stderr.strip()}"
        )
    return result.stdout.strip()


TOOL_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent


def hyperlink(url, text=None):
    label = text or url
    return f"\x1b]8;;{url}\x1b\\{label}\x1b]8;;\x1b\\"


def _is_git_repo(path):
    p = Path(path)
    if not p.is_dir():
        return False
    if (p / ".git").exists():
        return True
    return subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=str(p), capture_output=True, text=True
    ).returncode == 0


def _update_config_value(tool_root, project_name, key, value):
    """Update a single key's value in project_type_config/<ptype>_config.xlsx."""
    path = os.path.join(tool_root, "project_type_config", f"{project_name}_config.xlsx")
    if not os.path.exists(path):
        return
    wb = openpyxl.load_workbook(path)
    if "Config" not in wb.sheetnames:
        return
    ws = wb["Config"]
    for row in ws.iter_rows(min_row=2):
        if row[0].value and str(row[0].value).strip() == key:
            row[1].value = value
            break
    else:
        # Key not found — append it
        r = ws.max_row + 1
        ws.cell(r, 1, key)
        ws.cell(r, 2, value)
    try:
        wb.save(path)
    except PermissionError:
        print(f"  Warning: Could not save {path} (file may be open).")


def _ps_branch_path(branch):
    """Run PS: setbranch <branch>; tosrc  and return the resulting directory (pwd).
    Loads $PROFILE so user-defined functions are available.
    Returns the path string, or None on failure.
    """
    ps_script = (
        "& { "
        ". $PROFILE 2>$null; "
        f"setbranch {branch}; "
        "tosrc; "
        "(Get-Location).Path"
        " }"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=60
        )
        for line in reversed(r.stdout.splitlines()):
            line = line.strip()
            if line and os.path.isdir(line):
                return line
    except Exception:
        pass
    return None


def _ps_branch_pull_path(branch):
    """Run PS: setbranch <branch>; tosrc; git pull  and return the resulting directory (pwd).
    Loads $PROFILE so user-defined functions are available.
    Returns the path string, or None on failure.
    """
    ps_script = (
        "& { "
        ". $PROFILE 2>$null; "
        f"setbranch {branch}; "
        "tosrc; "
        "git pull; "
        "(Get-Location).Path"
        " }"
    )
    try:
        r = subprocess.run(
            ["powershell", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=120
        )
        for line in reversed(r.stdout.splitlines()):
            line = line.strip()
            if line and os.path.isdir(line):
                return line
    except Exception:
        pass
    return None


def ensure_repo(tool_root, project_name, from_branch, base_branch):
    """Return (from_repo_path, to_repo_path) by running setbranch + tosrc via PowerShell.
    Paths are stored in the per-project xlsx (not in config).
    """
    print(f"  Auto-discovering repo path via setbranch + tosrc...")

    from_path = _ps_branch_path(from_branch)
    to_path   = _ps_branch_path(base_branch)

    if not from_path and not to_path:
        raise RuntimeError(
            f"Could not auto-discover repo path.\n"
            f"  setbranch/tosrc did not return a valid directory.\n"
            f"  Ensure your PowerShell profile defines setbranch and tosrc."
        )

    resolved = to_path or from_path
    if from_path:
        print(f"  Auto-detected from_repo : {from_path}")
    if to_path:
        print(f"  Auto-detected to_repo   : {to_path}")

    return from_path or resolved, to_path or resolved


def setup_release_branch(source_repo_branch, resolved_version):
    """Set up from_repo (source branch) and to_repo (release version) via PS setbranch+tosrc+git pull.
    source_repo_branch: e.g. 'master'
    resolved_version:   e.g. '26.1.1.1'  (version number, NOT the full branch name)
    Returns (from_repo, to_repo).
    """
    print(f"  setbranch {source_repo_branch} → tosrc → git pull...")
    from_repo = _ps_branch_pull_path(source_repo_branch)
    if not from_repo:
        raise RuntimeError(
            f"setbranch '{source_repo_branch}' did not return a valid directory.\n"
            f"  Ensure your PowerShell profile defines setbranch and tosrc."
        )
    print(f"  from_repo: {from_repo}")

    print(f"  setbranch {resolved_version} → tosrc → git pull...")
    to_repo = _ps_branch_pull_path(resolved_version)
    if not to_repo:
        raise RuntimeError(
            f"setbranch '{resolved_version}' did not return a valid directory.\n"
            f"  Ensure your PowerShell profile defines setbranch and tosrc."
        )
    print(f"  to_repo  : {to_repo}")

    return from_repo, to_repo


def branch_exists(repo_path, branch_name):
    result = subprocess.run(
        ["git", "branch", "--list", branch_name],
        cwd=repo_path, capture_output=True, text=True
    )
    return bool(result.stdout.strip())


def create_branch_and_apply(repo_path, from_branch, new_branch, commit_shas):
    if branch_exists(repo_path, new_branch):
        raise ValueError(
            f"Branch '{new_branch}' already exists in '{repo_path}'.\n"
            f"  Delete it first with:  git branch -D {new_branch}"
        )
    print(f"  Fetching latest refs...")
    git(["fetch", "--all"], cwd=repo_path)

    print(f"  Checking out '{from_branch}'...")
    git(["checkout", from_branch], cwd=repo_path)
    try:
        git(["pull", "origin", from_branch], cwd=repo_path)
    except RuntimeError:
        pass

    print(f"  Creating branch '{new_branch}'...")
    git(["checkout", "-b", new_branch], cwd=repo_path)

    for i, sha in enumerate(commit_shas, 1):
        print(f"  Cherry-picking {sha[:10]} ({i}/{len(commit_shas)})...")
        try:
            git(["cherry-pick", sha], cwd=repo_path)
        except RuntimeError as e:
            git(["cherry-pick", "--abort"], cwd=repo_path)
            raise RuntimeError(
                f"Cherry-pick of {sha[:10]} failed — conflict detected.\n"
                f"  The cherry-pick has been aborted.\n"
                f"  To resolve manually:\n"
                f"    git checkout {new_branch}\n"
                f"    git cherry-pick {sha}\n"
                f"    # resolve conflicts, then: git cherry-pick --continue\n"
                f"\n  Original error:\n{e}"
            ) from None

    print(f"  Done — {len(commit_shas)} commit(s) applied.")
    return repo_path


# ---------------------------------------------------------------------------
# Local deploy helpers
# ---------------------------------------------------------------------------

_DONE_STATUSES = {"PR Raised", "Merged"}


def _run_local_deploy():
    """Run restartservers then refresh-payor -ncs -st to deploy to local Docker."""
    print()
    print("  ── Deploying to local Docker ──────────────────────────────────────")
    for cmd, label in [
        ("restartservers",          "restartservers"),
        ("refresh-payor -ncs -st",  "refresh-payor -ncs -st"),
    ]:
        print(f"  Running: {label}")
        try:
            result = subprocess.run(cmd, shell=True, check=False)
            if result.returncode != 0:
                print(f"  Warning: '{label}' exited with code {result.returncode}.")
        except Exception as e:
            print(f"  Warning: '{label}' failed: {e}")
    print("  Deploy commands issued.")
    print("  Once testing is complete, use  lclonestatus  to track PR progress.")


# ---------------------------------------------------------------------------
# Post cherry-pick workflow — returns clone_pr_url or None
# ---------------------------------------------------------------------------

def post_cherry_pick_workflow(repo_path, branch_name, clone_id, original_id,
                               base_branch, pr_url, jira_base_url):
    commit_msg = f"{clone_id}: Cloned from {original_id}"

    print()
    print("─" * 60)
    print("  Post cherry-pick options")
    print("─" * 60)

    answer = input(f"  [1/3] Stage all changes? (git add .)  [Y/n]: ").strip().lower()
    if answer in ("", "y", "yes"):
        git(["add", "."], cwd=repo_path)
        print("        Changes staged.")
    else:
        print("        Skipped.")

    print(f"\n  Commit message will be:\n    {commit_msg}")
    answer = input(f"  [2/3] Commit with this message?        [Y/n]: ").strip().lower()
    if answer in ("", "y", "yes"):
        git(["commit", "-m", commit_msg], cwd=repo_path)
        print("        Committed.")
    else:
        print("        Skipped.")

    answer = input(f"\n  [3/3] Push '{branch_name}' to origin?  [Y/n]: ").strip().lower()
    if answer not in ("", "y", "yes"):
        print("        Skipped.")
        return None

    git(["push", "-u", "origin", branch_name], cwd=repo_path)
    print("        Pushed.")

    clone_pr_url = None
    try:
        owner, repo, _ = parse_github_pr(pr_url)
        jira_original_url = f"{jira_base_url}/browse/{original_id}"
        pr_title = commit_msg
        pr_body  = f"{clone_id}: Cloned from [{original_id}]({jira_original_url})"
        gh_pr_url = (
            f"https://github.com/{owner}/{repo}/compare/"
            f"{base_branch}...{branch_name}"
            f"?quick_pull=1"
            f"&title={urllib.parse.quote(pr_title)}"
            f"&body={urllib.parse.quote(pr_body)}"
        )
        print()
        print("  ┌─ Create Pull Request ──────────────────────────────────────────")
        print(f"  │  Title : {pr_title}")
        print(f"  │  Body  : {clone_id}: Cloned from {hyperlink(jira_original_url, original_id)}")
        print(f"  │")
        print(f"  │  {hyperlink(gh_pr_url, '→ Open GitHub to create PR')}")
        print("  └────────────────────────────────────────────────────────────────")
        print()
        entered = input("  Enter new PR URL once created (optional, Enter to skip): ").strip()
        if entered:
            clone_pr_url = entered
    except Exception:
        pass

    # ── Local deploy ──────────────────────────────────────────────────────────
    print()
    try:
        ans = input("  Deploy to local Docker? (restartservers + refresh-payor -ncs -st)  [Y/n]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        ans = "n"
    if ans in ("", "y", "yes"):
        _run_local_deploy()

    return clone_pr_url


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]

    # Parse: accept URL, -ticket ID, or bare ID
    url_or_id = None
    i = 0
    while i < len(args):
        if args[i] in ("-ticket", "--ticket") and i + 1 < len(args):
            url_or_id = args[i + 1]
            i += 2
        elif args[i] in ("-h", "--help"):
            print(textwrap.dedent("""
              lclone — Local Clone Tool

              Creates a local fix branch from a JIRA clone ticket:
                1. Resolves payor release version from JIRA fix versions
                2. Sets up master + release branch in to_repo
                3. Traverses clone chain to find original ticket
                4. Finds all merged PRs on the original ticket
                5. Creates clone branches and cherry-picks commits
                6. Prompts: git add -> commit -> push -> PR creation link

              Usage:
                lclone -ticket PAYOR-208264

              Status:
                lclonestatus                    list projects
                lclonestatus -pid <id>          project detail + status update
            """))
            sys.exit(0)
        else:
            url_or_id = args[i]
            i += 1

    if not url_or_id:
        print("Usage: lclone -ticket <TICKET_ID>   |   lclone --help")
        sys.exit(1)

    tool_root   = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    config_path = os.path.join(tool_root, "config.xlsx")

    # ── [1] Load config + secrets ────────────────────────────────────────────
    print(f"\n[1] Loading config...")
    settings, _ = load_config(config_path)

    secrets_path = os.path.join(os.path.normpath(os.path.join(tool_root, "..", "..")), "secrets.xlsx")
    secrets      = load_secrets(secrets_path)

    jira_base_url  = secrets.get("jira_base_url",  "").rstrip("/")
    jira_email     = secrets.get("jira_email",     "")
    jira_api_token = secrets.get("jira_api_token", "")
    github_token   = secrets.get("github_token",   "")

    missing = []
    if not jira_base_url:  missing.append("jira_base_url  (Atlassian sheet)")
    if not jira_email:     missing.append("jira_email     (Atlassian sheet)")
    if not jira_api_token: missing.append("jira_api_token (Atlassian sheet)")
    if not github_token:   missing.append("github_token   (GitHub sheet)")
    if missing:
        print("\n  ERROR: The following credentials are missing from secrets.xlsx:")
        for m in missing:
            print(f"    - {m}")
        print(f"\n  Open: {secrets_path}")
        sys.exit(1)

    clone_link_type = settings.get("clone_link_type", "is cloned by")
    scm_type        = settings.get("scm_type", "github")

    jira = JiraClient(jira_base_url, jira_email, jira_api_token, config_path)

    # ── [2] Parse clone ticket ───────────────────────────────────────────────
    print(f"\n[2] Parsing clone ticket...")
    clone_id = parse_ticket_id(url_or_id)
    print(f"     Clone ticket : {clone_id}")

    try:
        project = load_project_for_ticket(tool_root, clone_id)
    except ValueError as e:
        print(f"\n  ERROR: {e}")
        sys.exit(1)

    from_branch    = project["source_repo_branch"]
    project_name   = project["name"]
    branch_prefix  = project["release_branch_prefix"]
    repo_url       = project["repo_url"]

    print(f"     Project      : {project_name}")
    print(f"     Source repo branch : {from_branch}")

    # ── [3] Fetch clone ticket details (type, summary, fix versions) ─────────
    print(f"\n[3] Fetching ticket details from JIRA...")
    clone_ticket  = fetch_ticket(clone_id, jira)
    issue_type    = clone_ticket["fields"]["issuetype"]["name"]
    summary       = clone_ticket["fields"]["summary"]
    fix_ver_field = clone_ticket["fields"].get("fixVersions", [])
    fix_versions  = [fv.get("name", "") for fv in fix_ver_field if fv.get("name")]

    print(f"     Type         : {issue_type}")
    print(f"     Summary      : {summary}")
    print(f"     Fix versions : {', '.join(fix_versions) if fix_versions else '(none)'}")

    # ── [4] Traverse clone chain to find TRUE original ───────────────────────
    print(f"\n[4] Traversing clone chain via '{clone_link_type}'...")
    original_id, chain = find_true_original_ticket(clone_id, jira, clone_link_type, jira_base_url)
    if len(chain) == 1:
        print(f"     No clone parent — treating '{hyperlink(f'{jira_base_url}/browse/{clone_id}', clone_id)}' as the source of PRs.")
    else:
        chain_links = ' -> '.join(hyperlink(f'{jira_base_url}/browse/{t}', t) for t in chain)
        print(f"     Chain   : {chain_links}")
        print(f"     Original: {hyperlink(f'{jira_base_url}/browse/{original_id}', original_id)}")

    # ── [5] Resolve payor version from GitHub ───────────────────────────────
    print(f"\n[5] Resolving release branch from fix versions...")
    if not repo_url:
        print(f"\n  ERROR: 'repo_url' is not configured for project type '{project_name}'.")
        config_file = os.path.join(tool_root, "project_type_config", f"{project_name}_config.xlsx")
        print(f"  Open: {config_file}")
        print(f"  Set 'repo_url' in that file, then re-run.")
        sys.exit(1)
    if not fix_versions:
        print(f"\n  ERROR: No fix versions found on ticket {hyperlink(f'{jira_base_url}/browse/{clone_id}', clone_id)}.")
        print(f"  Add a fix version in JIRA before running lclone.")
        sys.exit(1)

    resolved_version = resolve_repo_version(fix_versions, repo_url, branch_prefix, github_token)
    if not resolved_version:
        print(f"\n  ERROR: Could not resolve a release branch for fix versions: {', '.join(fix_versions)}")
        print(f"  Verify that a matching 'release-<version>' branch exists in the GitHub repo.")
        print(f"  repo_url: {repo_url}")
        sys.exit(1)

    base_branch = f"{branch_prefix}{resolved_version}"
    _owner, _repo = _parse_github_repo_url(repo_url)
    branch_url  = f"https://github.com/{_owner}/{_repo}/tree/{base_branch}" if _owner else ""
    branch_link = hyperlink(branch_url, base_branch) if branch_url else base_branch
    print(f"     Using base branch: {branch_link}")

    # ── [6] Setup repository branches via setbranch + tosrc + git pull ──────────
    print(f"\n[6] Setting up repository branches...")
    try:
        from_repo, to_repo = setup_release_branch(from_branch, resolved_version)
    except RuntimeError as e:
        print(f"\n  ERROR: {e}")
        sys.exit(1)

    # ── [7] Create / resume project entry ───────────────────────────────────
    print(f"\n[7] Creating project entry...")
    project_id    = create_project_entry(tool_root, project_name, clone_id, original_id,
                                         resolved_version, from_repo, to_repo)
    existing_prs  = _load_existing_prs(tool_root, project_name, project_id)
    is_rerun      = bool(existing_prs)
    print(f"     Project ID : {project_id}")

    if is_rerun:
        print(f"\n  Resuming existing project #{project_id} — {len(existing_prs)} PR(s) tracked:")
        for ep in existing_prs:
            mark = "✓" if ep["pr_status"] in _DONE_STATUSES else "…"
            print(f"    [{mark}] PR {ep['pr_index']:2d}: {ep['clone_branch']:50s}  {ep['pr_status']}")
        remaining_count = sum(1 for ep in existing_prs if ep["pr_status"] not in _DONE_STATUSES)
        if remaining_count == 0:
            print(f"\n  All {len(existing_prs)} PR(s) already raised or merged — nothing left to clone.")
            print(f"  Use  lclonestatus -pid {project_id}  to update PR statuses.")
            sys.exit(0)
        print(f"\n  {remaining_count} PR(s) still need processing (others will be skipped).")

    # ── [8] Find all merged PRs on original ticket → source_repo_branch ─────
    print(f"\n[8] Finding all merged PRs on {original_id} -> '{from_branch}'...")
    try:
        all_prs = find_all_merged_prs(original_id, jira, from_branch, scm_type, github_token)
    except ValueError as e:
        print(f"\n  ERROR: {e}")
        sys.exit(1)

    print(f"\n     Found {len(all_prs)} merged PR(s):")
    for i, pr in enumerate(all_prs, 1):
        suffix       = extract_branch_suffix(pr["branch"], original_id)
        clone_branch = build_clone_branch_name(issue_type, clone_id, suffix)
        print(f"       [{i}] source branch : {pr['branch']}")
        print(f"            clone branch  : {clone_branch}")
        print(f"            PR            : {hyperlink(pr['pr_url'], pr['pr_url'])}")

    if not all_prs:
        print("\n  No merged PRs found. Nothing to clone.")
        sys.exit(0)

    # ── [9] Process each PR ───────────────────────────────────────────────────
    print(f"\n[9] Processing {len(all_prs)} PR(s) onto '{base_branch}'...")

    for idx, pr in enumerate(all_prs, 1):
        pr_url       = pr["pr_url"]
        orig_branch  = pr["branch"]
        suffix       = extract_branch_suffix(orig_branch, original_id)
        clone_branch = build_clone_branch_name(issue_type, clone_id, suffix)

        # Skip PRs that are already raised or merged
        existing = next((ep for ep in existing_prs if ep["pr_index"] == idx), None)
        if existing and existing["pr_status"] in _DONE_STATUSES:
            print(f"\n  PR {idx}/{len(all_prs)}: {clone_branch}  [{existing['pr_status']}] — already done, skipping.")
            continue

        print(f"\n{'─'*60}")
        print(f"  PR {idx}/{len(all_prs)}")
        print(f"  Original PR URL : {pr_url}")
        print(f"  Source branch   : {orig_branch}")
        print(f"  Clone branch    : {clone_branch}")
        print(f"{'─'*60}")

        # Register PR in tracking (status: Cloned)
        upsert_pr_entry(tool_root, project_name, project_id, idx,
                        pr_url, orig_branch, clone_branch, pr_status="Cloned")

        # Fetch commits
        print(f"\n  Fetching commits from PR...")
        try:
            commit_shas = get_pr_commits(pr_url, github_token)
        except Exception as e:
            print(f"  ERROR fetching commits: {e}")
            continue
        print(f"  {len(commit_shas)} commit(s): {', '.join(s[:8] for s in commit_shas)}")

        # Create branch and cherry-pick
        try:
            create_branch_and_apply(to_repo, base_branch, clone_branch, commit_shas)
        except Exception as e:
            print(f"  ERROR creating branch: {e}")
            continue

        update_pr_status(tool_root, project_name, project_id, idx, pr_status="Branch Created")
        print(f"\n  Branch '{clone_branch}' ready.")

        # Interactive: push + PR link
        clone_pr_url = post_cherry_pick_workflow(
            to_repo, clone_branch, clone_id, original_id,
            base_branch, pr_url, jira_base_url
        )
        if clone_pr_url:
            update_pr_status(tool_root, project_name, project_id, idx,
                             clone_pr_url=clone_pr_url, pr_status="PR Raised")

    # ── [10] Update project status ───────────────────────────────────────────
    final_status = compute_project_status(tool_root, project_name, project_id)
    update_project_status(tool_root, project_name, project_id, final_status)

    print(f"\n{'═'*60}")
    print(f"  Done.  Project #{project_id} — {clone_id}")
    print(f"  Status : {final_status}")
    print(f"  Use  lclonestatus -pid {project_id}  to view details and update PR statuses.")
    print(f"{'═'*60}\n")


if __name__ == "__main__":
    main()
