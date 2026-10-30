#!/usr/bin/env python3
"""
update_melissa_data.py — updatemelissadatalicense / updatemdl command

Connect to a selected VM and update Melissa Data License for Payor and Classic repos.

Usage:
  updatemelissadatalicense
  updatemdl
  updatemdl --vm <vm_name> --ticket <JIRA_TICKET> --release-branch <version> --pid <pid>
"""

import sys
import re
import shlex
import threading
from pathlib import Path
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill

try:
    import paramiko
except ImportError:
    print("\n  ERROR: paramiko is required.  Install with:  pip install paramiko\n")
    sys.exit(1)

try:
    import filelock as _filelock
    _HAS_FILELOCK = True
except ImportError:
    _HAS_FILELOCK = False

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
from pathlib import Path as _DwPath
import os as _dwos
DATA_ROOT = _DwPath(_dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "Projects")) / "WorkFlows" / "Remote_Melissa_Data_Update_License"        # project data: <DWB>\Projects\WorkFlows\Remote_Melissa_Data_Update_License
DATA_ROOT.mkdir(parents=True, exist_ok=True)
VMS_PATH      = TOOL_ROOT.parent.parent / "vms.xlsx"
PROJECTS_PATH = DATA_ROOT / "projects.xlsx"
IMAGES_DIR    = DATA_ROOT / "remote_images"
STATS_DIR     = TOOL_ROOT / "stats"
SECRETS_PATH  = TOOL_ROOT.parent.parent / "secrets.xlsx"

# File lock for projects.xlsx — prevents corruption when idp_server.py reads concurrently
_projects_lock        = threading.Lock()
_PROJECTS_LEASE_SECS  = 15 * 60

def _projects_filelock():
    """Cross-process FileLock for projects.xlsx with 15-min lease eviction."""
    import time as _t
    _lp = DATA_ROOT / "projects.xlsx.lock"
    if _lp.exists():
        try:
            if _t.time() - _lp.stat().st_mtime > _PROJECTS_LEASE_SECS:
                _lp.unlink()
        except OSError:
            pass
    if _HAS_FILELOCK:
        return _filelock.FileLock(str(_lp), timeout=30)
    return _NoLock()

class _NoLock:
    def __enter__(self): return self
    def __exit__(self, *_): pass

# Ordered list of all stages — used for progress % calculation.
STAGES = [
    "ssh_connect",
    "classic_setbranch", "classic_git_pull", "classic_git_checkout", "classic_git_pull2",
    "payor_setbranch",   "payor_git_pull",   "payor_git_checkout",   "payor_git_pull2",
    "verify_script", "update_scripts", "run_melissa",
    "screenshot_melissa", "jira_comment",
    "git_status_payor", "screenshot_payor",
    "git_status_classic", "screenshot_classic",
    "pom_check",
    "payor_pr_create",
    "classic_pr_create",
]

SSH_USER      = "weblogic"
UTILITIES_DIR = "/home/weblogic/hebb/hrp.eng.utilities"
SCRIPTS_DIR   = f"{UTILITIES_DIR}/3rd_party/scripts"
EXPECTED_SCRIPT_PATH = f"{UTILITIES_DIR}/3rd_party/scripts/update_melissadata.sh"

PROJECTS_HEADERS = ["pid", "timestamp", "ticket", "release_branch", "vm_name", "vm_ip", "status",
                    "payor_melissa_updated", "classic_melissa_updated", "changes", "notes",
                    "payor_feature_branch", "payor_pr_url",
                    "classic_feature_branch", "classic_pr_url"]
PROJECTS_WIDTHS  = [6, 22, 18, 16, 24, 18, 12, 22, 24, 8, 80, 40, 80, 40, 80]

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"
def dim(s):    return f"\x1b[2m{s}{RESET}"
def hyperlink(url, label=None): return f"\x1b]8;;{url}\x1b\\{cyan(bold(label or url))}\x1b]8;;\x1b\\"

_RULER = "  " + grey("─" * 54)


# ---------------------------------------------------------------------------
# VM loading + selection
# ---------------------------------------------------------------------------

def _load_vms():
    if not VMS_PATH.exists():
        print(f"\n  ERROR: vms.xlsx not found at {VMS_PATH}")
        sys.exit(1)
    wb  = openpyxl.load_workbook(str(VMS_PATH))
    ws  = wb[wb.sheetnames[0]]
    vms = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] or (len(row) > 1 and row[1]):
            vms.append({
                "name":        str(row[0] or "").strip(),
                "ip":          str(row[1] or "").strip() if len(row) > 1 else "",
                "description": str(row[2] or "").strip() if len(row) > 2 else "",
                "password":    str(row[3] or "").strip() if len(row) > 3 else "",
                "assigned_to": str(row[4] or "").strip() if len(row) > 4 else "",
            })
    if not vms:
        print(f"\n  ERROR: No VMs found in vms.xlsx.\n")
        sys.exit(1)
    return vms


def _prompt_vm(vms):
    print(f"\n  {'─' * 56}")
    print(f"  Select VM:")
    print(f"  {'─' * 56}")
    print(f"  [0] Exit")
    for i, vm in enumerate(vms, 1):
        name_col  = bold(vm["name"].ljust(24))
        ip_col    = grey(vm["ip"].ljust(18))
        desc_col  = grey(vm["description"].ljust(14)) if vm["description"]  else " " * 14
        owner_col = cyan("→ " + vm["assigned_to"])    if vm["assigned_to"] else ""
        print(f"  [{i}] {name_col}  {ip_col}  {desc_col}  {owner_col}")
    print()
    while True:
        try:
            ans = input(f"  Enter number [0-{len(vms)}]: ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
        if ans == "0":
            print("  Exiting."); sys.exit(0)
        if ans.isdigit() and 1 <= int(ans) <= len(vms):
            return vms[int(ans) - 1]
        print(f"  Invalid — enter a number between 0 and {len(vms)}.")


# ---------------------------------------------------------------------------
# Project tracking
# ---------------------------------------------------------------------------

def _next_pid():
    if not PROJECTS_PATH.exists():
        return 1
    with _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws = wb.active
    return max((ws.cell(r, 1).value or 0 for r in range(2, ws.max_row + 1)), default=0) + 1


def _ensure_projects():
    if PROJECTS_PATH.exists():
        return
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Projects"
    for col, (title, width) in enumerate(zip(PROJECTS_HEADERS, PROJECTS_WIDTHS), start=1):
        c = ws.cell(1, col, title)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        ws.column_dimensions[c.column_letter].width = width
    wb.save(str(PROJECTS_PATH))


def _create_project(pid, vm, ticket="", release_branch=""):
    _ensure_projects()
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _projects_lock, _projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb.active
        hdrs = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
        for col_name, width in (("ticket", 18), ("release_branch", 16)):
            if col_name not in hdrs:
                col = ws.max_column + 1
                c = ws.cell(1, col, col_name)
                c.font = HEADER_FONT; c.fill = HEADER_FILL
                ws.column_dimensions[c.column_letter].width = width
        hdrs = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
        row_data = {h: "" for h in hdrs}
        row_data.update({
            "pid": pid, "timestamp": ts, "ticket": ticket,
            "release_branch": release_branch,
            "vm_name": vm["name"], "vm_ip": vm["ip"], "status": "Running",
        })
        ws.append([row_data.get(h, "") for h in hdrs])
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print(f"  Warning: Could not save projects.xlsx (file may be open).")
    return ts


def _update_project(pid, status=None, changes=None, notes=None, **extra):
    """Update the project row.  Any kwargs matching a column name are written too.
    Columns that don't exist yet are appended automatically."""
    if not PROJECTS_PATH.exists():
        return
    with _projects_lock, _projects_filelock():
        wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws      = wb.active
        headers = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]

        # Ensure any extra columns exist
        for col_name in extra:
            if col_name.lower() not in headers:
                col_idx = ws.max_column + 1
                c = ws.cell(1, col_idx, col_name)
                c.font = HEADER_FONT; c.fill = HEADER_FILL
                ws.column_dimensions[c.column_letter].width = 22
                headers.append(col_name.lower())

        col_map = {h: i for i, h in enumerate(headers, 1)}
        updates = {k: v for k, v in
                   [("status", status), ("changes", changes), ("notes", notes)]
                   if v is not None}
        updates.update({k.lower(): v for k, v in extra.items()})

        for row in ws.iter_rows(min_row=2):
            if str(row[0].value or "").strip() == str(pid).strip():
                for col_name, value in updates.items():
                    if col_name in col_map:
                        row[col_map[col_name] - 1].value = value
                break
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print(f"  Warning: Could not save projects.xlsx (file may be open).")


# ---------------------------------------------------------------------------
# SSH helpers
# ---------------------------------------------------------------------------

def _ssh_run(client, cmd, show_cmd=True, stream=False, timeout=300):
    """Run cmd in a bash interactive login shell with a PTY. Returns (output, exit_code)."""
    import time as _t, socket as _sock
    if show_cmd:
        print(f"  {grey('$')} {dim(cmd)}")
    # Prepend GIT_TERMINAL_PROMPT=0 so git never hangs waiting for credentials.
    inner = f"export GIT_TERMINAL_PROMPT=0; {cmd}"
    wrapped = f'bash -ilc {shlex.quote(inner)}'
    channel = client.get_transport().open_session()
    channel.get_pty(term='dumb', width=220, height=50)
    channel.set_combine_stderr(True)
    channel.exec_command(wrapped)
    buf = ""
    # Use a short recv timeout + deadline so a hung remote command never blocks forever.
    channel.settimeout(2.0)
    deadline = _t.time() + timeout
    if stream:
        while True:
            if _t.time() > deadline:
                channel.close()
                buf += f"\n[TIMEOUT: command exceeded {timeout}s — killed]"
                print(f"  {red('TIMEOUT')}: command exceeded {timeout}s, aborting step.")
                return buf, -1
            try:
                chunk = channel.recv(4096)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace")
                buf += text
                for line in text.split("\n"):
                    if line.strip():
                        print(f"    {line}")
            except _sock.timeout:
                # No data arrived in 2 s — check if the command finished.
                if channel.exit_status_ready() and not channel.recv_ready():
                    break
                # Otherwise keep waiting until deadline.
    else:
        try:
            raw = channel.makefile("rb").read()
            buf = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
        except _sock.timeout:
            buf = "[read timeout]"
        if buf.strip() and show_cmd:
            for line in buf.strip().split("\n"):
                print(f"    {line}")
    try:
        exit_code = channel.recv_exit_status()
    except Exception:
        exit_code = -1
    channel.close()
    return buf, exit_code


def _section(title):
    print(f"\n{_RULER}")
    print(f"  {bold(white(title))}")
    print(_RULER)


def _show_pr_link(push_out):
    urls = re.findall(r'https?://\S+', push_out)
    pr_urls = [u.rstrip(".,;)") for u in urls
               if any(k in u.lower() for k in ("pull", "compare", "merge", "request"))]
    if pr_urls:
        print(f"\n  {bold('Create PR at:')}")
        for url in pr_urls:
            print(f"  {hyperlink(url)}")
    else:
        print(f"\n  {grey('PR link not found in push output.')}")


def _pr_workflow(client, tosrc_cmd, repo_label):
    try:
        ans = input(f"\n  Create PR for {repo_label}? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); return
    if ans != "y":
        print(f"  Skipped {repo_label} PR."); return
    try:
        ticket = input(f"  JIRA Ticket ID (e.g. PAYOR-12345): ").strip()
    except (EOFError, KeyboardInterrupt):
        print(); return
    if not ticket:
        print("  No ticket ID provided — skipping PR."); return
    commit_msg = f"{ticket}:Melissa Data License and Address.dat update"
    print(f"\n  Step 1  git add .")
    try:
        ans = input("  Run? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); return
    if ans != "y":
        print("  Skipped."); return
    _ssh_run(client, f"{tosrc_cmd} && git add .", stream=True)
    print(f'\n  Step 2  git commit -m "{commit_msg}"')
    try:
        ans = input("  Run? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); return
    if ans != "y":
        print("  Skipped."); return
    _ssh_run(client, f"{tosrc_cmd} && git commit -m {shlex.quote(commit_msg)}", stream=True)
    print(f"\n  Step 3  git push")
    try:
        ans = input("  Run? [y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(); return
    if ans != "y":
        print("  Skipped."); return
    push_out, _ = _ssh_run(client, f"{tosrc_cmd} && git push 2>&1", stream=True)
    _show_pr_link(push_out)


# ---------------------------------------------------------------------------
# Screenshot helpers
# ---------------------------------------------------------------------------

_STATS_MAX_PIDS = 10  # keep stats for the last N distinct PIDs

def _stat(pid, stage, status, elapsed_s=None):
    """Write/update a stage row in stats/stats.xlsx for the given pid.
    Trims the file to _STATS_MAX_PIDS distinct PIDs, removing the oldest."""
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    path = STATS_DIR / "stats.xlsx"
    ts   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        if not path.exists():
            wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Stats"
            for col, h in enumerate(["pid", "stage", "status", "started_at",
                                     "updated_at", "elapsed_s", "stage_order"], 1):
                c = ws.cell(1, col, h)
                c.font = HEADER_FONT; c.fill = HEADER_FILL
            wb.save(str(path))
        wb  = openpyxl.load_workbook(str(path))
        ws  = wb.active
        hdrs = [str(ws.cell(1, c).value or "").strip().lower()
                for c in range(1, ws.max_column + 1)]
        col_map = {h: i + 1 for i, h in enumerate(hdrs)}
        # Find existing row for this pid+stage
        target_row = None
        for row in ws.iter_rows(min_row=2):
            if (str(row[0].value or "").strip() == str(pid) and
                    str(row[col_map.get("stage", 2) - 1].value or "").strip() == stage):
                target_row = row; break
        order = STAGES.index(stage) if stage in STAGES else 99
        if target_row is None:
            new_row = [""] * len(hdrs)
            for key, val in [("pid", pid), ("stage", stage), ("status", status),
                              ("started_at", ts), ("updated_at", ts),
                              ("elapsed_s", elapsed_s or ""), ("stage_order", order)]:
                if key in col_map:
                    new_row[col_map[key] - 1] = val
            ws.append(new_row)
        else:
            if "status"     in col_map: target_row[col_map["status"]     - 1].value = status
            if "updated_at" in col_map: target_row[col_map["updated_at"] - 1].value = ts
            if elapsed_s is not None and "elapsed_s" in col_map:
                target_row[col_map["elapsed_s"] - 1].value = elapsed_s

        # Trim to last _STATS_MAX_PIDS distinct PIDs (ordered by first appearance).
        all_rows = list(ws.iter_rows(min_row=2, values_only=False))
        seen_pids: list = []
        for r in all_rows:
            p = str(r[0].value or "").strip()
            if p and p not in seen_pids:
                seen_pids.append(p)
        if len(seen_pids) > _STATS_MAX_PIDS:
            pids_to_remove = set(seen_pids[: len(seen_pids) - _STATS_MAX_PIDS])
            rows_to_delete = [
                r[0].row for r in all_rows
                if str(r[0].value or "").strip() in pids_to_remove
            ]
            for row_idx in sorted(rows_to_delete, reverse=True):
                ws.delete_rows(row_idx)

        try:
            wb.save(str(path))
        except PermissionError:
            pass
    except Exception:
        pass


def _pom_changed(git_status_output):
    """Return True if pom.xml appears as a modified/untracked file in git status output."""
    for line in _strip_ansi(git_status_output).splitlines():
        stripped = line.strip()
        if stripped and "pom.xml" in stripped.lower():
            return True
    return False


def _strip_ansi(text):
    return re.sub(r'\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])', '', text)


def _text_to_png(text, dest_path):
    """Render terminal text output as a PNG image (dark terminal style)."""
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    clean = _strip_ansi(text)
    lines = clean.splitlines()
    try:
        from PIL import Image, ImageDraw, ImageFont
        FONT_SIZE = 14
        PAD       = 16
        LINE_H    = FONT_SIZE + 4
        # Try to load a monospace font; fall back to default
        font = None
        for fname in ("DejaVuSansMono.ttf", "Consolas.ttf", "cour.ttf", "LiberationMono-Regular.ttf"):
            try:
                font = ImageFont.truetype(fname, FONT_SIZE); break
            except Exception:
                pass
        if font is None:
            font = ImageFont.load_default()
        # Measure width using the longest line
        max_chars = max((len(l) for l in lines), default=80)
        char_w    = FONT_SIZE * 0.62          # approximate mono char width
        img_w     = max(800, int(max_chars * char_w) + PAD * 2)
        img_h     = max(400, LINE_H * max(len(lines), 1) + PAD * 2)
        img  = Image.new("RGB", (img_w, img_h), color=(18, 18, 18))
        draw = ImageDraw.Draw(img)
        for i, line in enumerate(lines):
            draw.text((PAD, PAD + i * LINE_H), line, font=font, fill=(204, 204, 204))
        img.save(str(dest_path))
        print(f"  {green('✓')} Screenshot saved → {dest_path.name}")
        return True
    except ImportError:
        # PIL not available — save as .txt instead
        txt_path = dest_path.with_suffix(".txt")
        txt_path.write_text(clean, encoding="utf-8")
        print(f"  {yellow('!')} PIL not installed; output saved as text → {txt_path.name}")
        return False
    except Exception as exc:
        print(f"  {yellow('!')} Screenshot failed ({exc}); skipping.")
        return False


# ---------------------------------------------------------------------------
# JIRA helpers
# ---------------------------------------------------------------------------

def _load_jira_creds():
    if not SECRETS_PATH.exists():
        return None
    try:
        wb = openpyxl.load_workbook(str(SECRETS_PATH), data_only=True)
        sec = {}
        for sn in ("Atlassian", "atlassian"):
            if sn in wb.sheetnames:
                for r in wb[sn].iter_rows(min_row=2, values_only=True):
                    if r and r[0] and r[1]:
                        sec[str(r[0]).strip()] = str(r[1]).strip()
                break
        wb.close()
        bu = sec.get("jira_base_url", "").rstrip("/")
        em = sec.get("jira_email", "")
        tk = sec.get("jira_api_token", "")
        if bu and em and tk:
            return {"base_url": bu, "email": em, "api_token": tk}
    except Exception:
        pass
    return None


def _jira_add_comment_with_image(ticket, image_path, context_label="Melissa Data Update"):
    """Upload image_path as attachment to the JIRA ticket then add a comment."""
    creds = _load_jira_creds()
    if not creds:
        print(f"  {yellow('!')} JIRA creds not found in secrets.xlsx — skipping JIRA comment.")
        return
    image_path = Path(image_path)
    if not image_path.exists():
        # Try .txt fallback
        txt = image_path.with_suffix(".txt")
        if txt.exists():
            _jira_add_text_comment(ticket, txt.read_text(encoding="utf-8"), context_label, creds)
        return
    try:
        import requests
        from requests.auth import HTTPBasicAuth
        import urllib3
        urllib3.disable_warnings()
        base = creds["base_url"]
        auth = HTTPBasicAuth(creds["email"], creds["api_token"])
        headers_no_ct = {"Accept": "application/json", "X-Atlassian-Token": "no-check"}
        with open(str(image_path), "rb") as fh:
            r = requests.post(
                f"{base}/rest/api/2/issue/{ticket}/attachments",
                headers=headers_no_ct,
                files={"file": (image_path.name, fh, "image/png")},
                auth=auth, verify=False, timeout=30)
        if r.status_code in (200, 201):
            att_name = r.json()[0]["filename"] if r.json() else image_path.name
            comment_body = f"*{context_label}*\n\n!{att_name}!"
            r2 = requests.post(
                f"{base}/rest/api/2/issue/{ticket}/comment",
                json={"body": comment_body},
                auth=auth, headers={"Accept": "application/json",
                                    "Content-Type": "application/json"},
                verify=False, timeout=30)
            if r2.status_code in (200, 201):
                print(f"  {green('✓')} JIRA comment added to {ticket}")
            else:
                print(f"  {yellow('!')} JIRA comment failed: {r2.status_code}")
        else:
            print(f"  {yellow('!')} JIRA attachment upload failed: {r.status_code} — {r.text[:200]}")
    except Exception as exc:
        print(f"  {yellow('!')} JIRA update error: {exc}")


def _jira_add_text_comment(ticket, text, context_label, creds):
    try:
        import requests
        from requests.auth import HTTPBasicAuth
        import urllib3
        urllib3.disable_warnings()
        base = creds["base_url"]
        auth = HTTPBasicAuth(creds["email"], creds["api_token"])
        body = f"*{context_label}*\n\n{{noformat}}\n{text[:8000]}\n{{noformat}}\n"
        r = requests.post(
            f"{base}/rest/api/2/issue/{ticket}/comment",
            json={"body": body},
            auth=auth,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            verify=False, timeout=30)
        if r.status_code in (200, 201):
            print(f"  {green('✓')} JIRA comment added to {ticket} (text)")
    except Exception as exc:
        print(f"  {yellow('!')} JIRA text comment error: {exc}")


# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------

def _load_github_token():
    """Load github_token from secrets.xlsx → GitHub sheet."""
    if not SECRETS_PATH.exists():
        return ""
    try:
        wb = openpyxl.load_workbook(str(SECRETS_PATH))
        if "GitHub" in wb.sheetnames:
            for r in wb["GitHub"].iter_rows(min_row=2, values_only=True):
                if r and r[0] and str(r[0]).strip() == "github_token" and r[1]:
                    return str(r[1]).strip()
    except Exception:
        pass
    return ""


def _git_remote_url(client, nav_cmd):
    """Return the git remote origin URL from the VM (empty string on failure)."""
    out, _ = _ssh_run(client, f"{nav_cmd} && git remote get-url origin",
                      stream=False, show_cmd=False)
    lines = _strip_ansi(out).strip().splitlines()
    url = lines[0].strip() if lines else ""
    return url.rstrip("/")


def _parse_github_owner_repo(remote_url):
    """Extract (owner, repo) from a GitHub remote URL, or (None, None)."""
    m = re.search(r'github\.com[:/]([^/]+)/([^\s/]+?)(?:\.git)?$', remote_url)
    if m:
        return m.group(1), m.group(2)
    return None, None


def _create_github_pr(owner, repo, gh_token, head, base, title, body):
    """POST to GitHub API to create a PR. Returns (pr_url, error_msg)."""
    try:
        import requests
        resp = requests.post(
            f"https://api.github.com/repos/{owner}/{repo}/pulls",
            json={"title": title, "body": body, "head": head, "base": base},
            headers={"Authorization": f"token {gh_token}",
                     "Accept": "application/vnd.github+json"},
            timeout=30)
        if resp.status_code in (200, 201):
            return resp.json().get("html_url", ""), None
        if resp.status_code == 422:
            detail = resp.json().get("errors", [{}])
            if detail and "already exists" in str(detail[0].get("message", "")):
                return "", "PR already exists for this branch"
        return "", f"HTTP {resp.status_code}: {resp.text[:300]}"
    except Exception as exc:
        return "", str(exc)


def _raise_repo_pr(client, pid, nav_cmd, ticket, feature_branch, rb_full, gh_token, stage_key):
    """
    On VM: checkout feature branch, stage pom.xml, commit, push.
    Locally: create GitHub PR.
    Returns (feature_branch, pr_url, error_msg).
    """
    commit_msg = f"{ticket}:Melissa Data License and Address Data Update"

    _stat(pid, stage_key, "running")
    t0 = __import__("time").time()

    # Get remote URL from VM to derive GitHub org/repo
    remote_url = _git_remote_url(client, nav_cmd)
    owner, repo = _parse_github_owner_repo(remote_url)
    if not owner or not repo:
        elapsed = round(__import__("time").time() - t0, 1)
        _stat(pid, stage_key, "failed", elapsed_s=elapsed)
        return feature_branch, "", f"Could not parse GitHub org/repo from: '{remote_url}'"

    # Create feature branch
    _, code = _ssh_run(client, f"{nav_cmd} && git checkout -b {feature_branch}", stream=True)
    if code != 0:
        elapsed = round(__import__("time").time() - t0, 1)
        _stat(pid, stage_key, "failed", elapsed_s=elapsed)
        return feature_branch, "", f"git checkout -b {feature_branch} failed (exit {code})"

    # Stage pom.xml and commit
    _, code = _ssh_run(client,
        f'{nav_cmd} && git add pom.xml && git commit -m "{commit_msg}"',
        stream=True)
    if code != 0:
        elapsed = round(__import__("time").time() - t0, 1)
        _stat(pid, stage_key, "failed", elapsed_s=elapsed)
        return feature_branch, "", f"git commit failed (exit {code})"

    # Push feature branch to origin
    _, code = _ssh_run(client, f"{nav_cmd} && git push origin {feature_branch}", stream=True)
    if code != 0:
        elapsed = round(__import__("time").time() - t0, 1)
        _stat(pid, stage_key, "failed", elapsed_s=elapsed)
        return feature_branch, "", f"git push failed (exit {code})"

    # Create GitHub PR
    pr_url, err = _create_github_pr(owner, repo, gh_token,
                                     head=feature_branch, base=rb_full,
                                     title=commit_msg, body=commit_msg)
    elapsed = round(__import__("time").time() - t0, 1)
    if err:
        _stat(pid, stage_key, "failed", elapsed_s=elapsed)
        return feature_branch, "", err

    _stat(pid, stage_key, "done", elapsed_s=elapsed)
    return feature_branch, pr_url, None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import argparse
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--vm",             "-vm",  dest="vm_name",        default="")
    parser.add_argument("--ticket",         "-t",   dest="ticket",         default="")
    parser.add_argument("--release-branch", "-rb",  dest="release_branch", default="")
    parser.add_argument("--pid",                    dest="pid",   type=int, default=None)
    parser.add_argument("-h", "--help", action="store_true")
    args, _ = parser.parse_known_args()

    if args.help:
        print(__doc__); sys.exit(0)

    headless = bool(args.vm_name)
    vms = _load_vms()

    if headless:
        vm = next((v for v in vms if v["name"].strip() == args.vm_name.strip()), None)
        if not vm:
            print(f"  {red('ERROR')}: VM '{args.vm_name}' not found in vms.xlsx\n")
            sys.exit(1)
        pid    = args.pid if args.pid else _next_pid()
        ticket = args.ticket
        rb     = args.release_branch
    else:
        vm     = _prompt_vm(vms)
        pid    = _next_pid()
        ticket = ""
        rb     = ""

    # rb_full is used for git checkout/pull (needs "release-" prefix).
    # rb is passed to setbranch/setc3branch which manage their own directory naming.
    rb_full = (f"release-{rb}" if rb and not rb.startswith("release") else rb) if rb else ""

    print(f"\n  Connecting to {bold(vm['name'])}  {grey(vm['ip'])}  as {SSH_USER}...")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    _stat(pid, "ssh_connect", "running")
    try:
        client.connect(vm["ip"], username=SSH_USER,
                       password=vm["password"] or None, timeout=30)
    except Exception as e:
        _stat(pid, "ssh_connect", "failed")
        print(f"  {red('ERROR')}: Could not connect — {e}\n")
        sys.exit(1)

    _stat(pid, "ssh_connect", "done", elapsed_s=0)
    print(f"  {green('Connected')}\n")

    if not headless or not args.pid:
        _create_project(pid, vm, ticket=ticket, release_branch=rb)
    print(f"  Project #{pid} created")

    final_status = "Failed"
    changes_val  = ""

    import time as _tm
    def _timed(stage_key, fn, *a, **kw):
        _stat(pid, stage_key, "running")
        t0 = _tm.time()
        result = fn(*a, **kw)
        _stat(pid, stage_key, "done", elapsed_s=round(_tm.time() - t0, 1))
        return result

    try:
        # ── Steps 2a–6a: Classic repo branch setup ────────────────────────
        if rb_full:
            _section("Classic repo — branch setup")
            # Classic dir uses "release-" prefix; Payor dir uses bare version (e.g. 26.2.1.0.1).
            _timed("classic_setbranch",  _ssh_run, client, f"yes | setc3branch {rb_full}", stream=True)
            _timed("classic_git_pull",   _ssh_run, client, "toc3src && git pull", stream=True)
            _timed("classic_git_checkout",_ssh_run, client, f"toc3src && git checkout {rb_full}", stream=True)
            _timed("classic_git_pull2",  _ssh_run, client, "toc3src && git pull", stream=True)

            # ── Steps 2b–6b: Payor repo branch setup ──────────────────────
            _section("Payor repo — branch setup")
            _timed("payor_setbranch",    _ssh_run, client, f"yes | setbranch {rb}", stream=True)
            _timed("payor_git_pull",     _ssh_run, client, "tosrc && git pull", stream=True)
            _timed("payor_git_checkout", _ssh_run, client, f"tosrc && git checkout {rb_full}", stream=True)
            _timed("payor_git_pull2",    _ssh_run, client, "tosrc && git pull", stream=True)

        # ── Step 7: Verify update_melissadata.sh is on PATH ───────────────
        _section("Verifying update_melissadata.sh")
        _stat(pid, "verify_script", "running")
        type_out, _ = _ssh_run(client, "type update_melissadata.sh 2>&1", stream=True)
        if EXPECTED_SCRIPT_PATH not in type_out:
            _stat(pid, "verify_script", "failed")
            print(f"\n  {red('ABORT')}: update_melissadata.sh not found at expected path.")
            print(f"  Expected : {EXPECTED_SCRIPT_PATH}")
            _update_project(pid, "Aborted", notes="update_melissadata.sh not at expected path")
            sys.exit(1)
        _stat(pid, "verify_script", "done", elapsed_s=0)
        print(f"  {green('✓')} Script found at expected path")

        # ── Steps 8–9: Update scripts directory ───────────────────────────
        _section("Updating 3rd_party/scripts")
        _timed("update_scripts", _ssh_run, client,
               f"pushd {SCRIPTS_DIR} && git pull && popd", stream=True)

        # ── Step 10: tosrc + Step 11: Run update_melissadata.sh ──────────
        _ssh_run(client, "tosrc", stream=True)
        _section("Running update_melissadata.sh")
        _stat(pid, "run_melissa", "running")
        t0_mel = _tm.time()
        out_melissa, code = _ssh_run(client, "yes | update_melissadata.sh",
                                     stream=True, timeout=600)
        _stat(pid, "run_melissa", "done" if code == 0 else "failed",
              elapsed_s=round(_tm.time() - t0_mel, 1))
        if code != 0:
            _update_project(pid, "Failed", notes="update_melissadata.sh exited non-zero")
            sys.exit(1)

        # ── Step 12: Screenshot of melissa update output ──────────────────
        img1 = IMAGES_DIR / f"{pid}_{ticket}_Update_MelissaData.png"
        _stat(pid, "screenshot_melissa", "running")
        _text_to_png(out_melissa, img1)
        _stat(pid, "screenshot_melissa", "done", elapsed_s=0)

        # ── Step 13: JIRA comment ─────────────────────────────────────────
        if ticket:
            _stat(pid, "jira_comment", "running")
            _jira_add_comment_with_image(ticket, img1, "Melissa Data License Update")
            _stat(pid, "jira_comment", "done", elapsed_s=0)

        # ── Steps 14–15: git status Payor + screenshot ────────────────────
        _section("Git status — Payor")
        _stat(pid, "git_status_payor", "running")
        t0_gp = _tm.time()
        out_status_p, _ = _ssh_run(client, "tosrc && git status", stream=True)
        _stat(pid, "git_status_payor", "done", elapsed_s=round(_tm.time() - t0_gp, 1))
        _stat(pid, "screenshot_payor", "running")
        img2 = IMAGES_DIR / f"{pid}_{ticket}_Melissa_Data_Git_Status.png"
        _text_to_png(out_status_p, img2)
        _stat(pid, "screenshot_payor", "done", elapsed_s=0)

        # ── Steps 16–18: toc3src git status Classic + screenshot ──────────
        _section("Git status — Classic")
        _stat(pid, "git_status_classic", "running")
        t0_gc = _tm.time()
        out_status_c, _ = _ssh_run(client, "toc3src && git status", stream=True)
        _stat(pid, "git_status_classic", "done", elapsed_s=round(_tm.time() - t0_gc, 1))
        _stat(pid, "screenshot_classic", "running")
        img3 = IMAGES_DIR / f"{pid}_{ticket}_Melissa_Data_Git_Status_Classic.png"
        _text_to_png(out_status_c, img3)
        _stat(pid, "screenshot_classic", "done", elapsed_s=0)

        # ── Check pom.xml changes ─────────────────────────────────────────
        payor_pom   = _pom_changed(out_status_p)
        classic_pom = _pom_changed(out_status_c)
        _stat(pid, "pom_check", "done", elapsed_s=0)

        if payor_pom or classic_pom:
            _section("Updating pom.xml change flags")
            _update_project(
                pid,
                payor_melissa_updated   = "Yes" if payor_pom   else "No",
                classic_melissa_updated = "Yes" if classic_pom else "No",
            )
            if payor_pom:   print(f"  {green('✓')} Payor   pom.xml changed — payor_melissa_updated = Yes")
            if classic_pom: print(f"  {green('✓')} Classic pom.xml changed — classic_melissa_updated = Yes")
            if not payor_pom:   print(f"  {grey('–')} Payor   pom.xml unchanged")
            if not classic_pom: print(f"  {grey('–')} Classic pom.xml unchanged")

        changes_val  = "Yes" if any(
            "nothing to commit" not in o.lower() and o.strip()
            for o in (out_status_p, out_status_c)
        ) else "No"

        # ── Raise Pull Requests ───────────────────────────────────────────────
        # Version-segment rule:
        #   rb has 5+ segments (4+ dots, e.g. 26.2.1.0.4) → only Payor PR
        #   rb has <5 segments (e.g. 26.2.1.3 / 26.2.1 / 26.2)  → both Payor + Classic
        rb_parts      = rb.split(".") if rb else []
        only_payor_pr = len(rb_parts) >= 5

        gh_token            = _load_github_token()
        feature_branch_base = f"feature-{ticket}-melissa-data-update" if ticket else "feature-melissa-data-update"
        payor_feature_branch   = ""
        payor_pr_url           = ""
        classic_feature_branch = ""
        classic_pr_url         = ""

        if payor_pom:
            _section("Creating Payor Pull Request")
            if not gh_token:
                print(f"  {yellow('!')} GitHub token not found in secrets.xlsx — skipping Payor PR.")
            else:
                payor_fb, payor_pr, err = _raise_repo_pr(
                    client, pid,
                    nav_cmd="tosrc",
                    ticket=ticket,
                    feature_branch=feature_branch_base,
                    rb_full=rb_full,
                    gh_token=gh_token,
                    stage_key="payor_pr_create",
                )
                payor_feature_branch = payor_fb
                if err:
                    print(f"  {yellow('!')} Payor PR failed: {err}")
                else:
                    payor_pr_url = payor_pr
                    print(f"  {green('✓')} Payor PR created: {hyperlink(payor_pr, payor_pr)}")
        else:
            print(f"  {grey('–')} Payor pom.xml unchanged — no Payor PR needed.")

        if classic_pom and not only_payor_pr:
            _section("Creating Classic Pull Request")
            if not gh_token:
                print(f"  {yellow('!')} GitHub token not found in secrets.xlsx — skipping Classic PR.")
            else:
                classic_fb, classic_pr, err = _raise_repo_pr(
                    client, pid,
                    nav_cmd="toc3src",
                    ticket=ticket,
                    feature_branch=feature_branch_base,
                    rb_full=rb_full,
                    gh_token=gh_token,
                    stage_key="classic_pr_create",
                )
                classic_feature_branch = classic_fb
                if err:
                    print(f"  {yellow('!')} Classic PR failed: {err}")
                else:
                    classic_pr_url = classic_pr
                    print(f"  {green('✓')} Classic PR created: {hyperlink(classic_pr, classic_pr)}")
        elif classic_pom and only_payor_pr:
            print(f"  {grey('–')} Version has 4+ dots ({rb}) — Classic PR skipped (Payor-only release).")
        else:
            print(f"  {grey('–')} Classic pom.xml unchanged — no Classic PR needed.")

        # Save PR info to projects.xlsx
        _update_project(pid,
                        payor_feature_branch=payor_feature_branch,
                        payor_pr_url=payor_pr_url,
                        classic_feature_branch=classic_feature_branch,
                        classic_pr_url=classic_pr_url)

        final_status = "Passed"

    except KeyboardInterrupt:
        final_status = "Aborted"
        print("\n\n  Interrupted.\n")
    finally:
        client.close()

    _update_project(pid, final_status, changes_val)

    color = green if final_status == "Passed" else (yellow if final_status == "Aborted" else red)
    print(f"\n  Project #{pid}  {color(final_status)}\n")


if __name__ == "__main__":
    main()
