"""AI Analyzer backend: JIRA ticket -> working folder -> AI agent analysis / RCA.

Files (next to this module):
  config.xlsx    sheet "Config"   : key / value   (workspace_dir, agent_command, code_dirs)
  projects.xlsx  sheet "Projects" : one row per analysed ticket
  jobs/          detached agent runs: <project>_<kind>.json|.log|.code|.prompt (survive a Workbench restart)

Each project lives in  <workspace_dir>/<JIRA-ID>_<title>/  containing:
  ai_workspace/     where the agent runs
  supporting_data/  logs, stack traces and other material the user drops in for the agent
  RCA/              the generated RCA document
  ticket.md, ANALYSIS.md
"""
import json
import re
import subprocess
import time
from pathlib import Path

import openpyxl
from pathlib import Path as _DwPath
import os as _dwos
def _dwb_home():
    """<DWB> = the folder that contains DeveloperWorkBench\\ (DWB_HOME overrides)."""
    return _DwPath(_dwos.environ.get("DWB_HOME") or next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB"))


def _expand(v):
    """%VAR%  ~  {DWB_HOME} in a configured path."""
    return _dwos.path.expanduser(_dwos.path.expandvars(str(v or "").strip().replace("{DWB_HOME}", str(_dwb_home()))))


def _dwb_projects(*kind):
    """<DWB>\\Projects\\<kind>  (DWB_PROJECTS overrides the Projects folder)."""
    base = _dwos.environ.get("DWB_PROJECTS") or (next((_p.parent for _p in _DwPath(__file__).resolve().parents if _p.name.lower() == "developerworkbench"), _DwPath.home() / "DWB") / "DWB_Projects")
    return _DwPath(base).joinpath(*kind)

HERE = Path(__file__).resolve().parent
CONFIG_FILE = HERE / "config.xlsx"
PROJECTS_FILE = _dwb_projects("Tools", "AIAnalyzer") / "projects.xlsx"        # <DWB>\\Projects\\Tools\\AIAnalyzer
JOBS_DIR = HERE / "jobs"

DEFAULT_CONFIG = {
    "workspace_dir": "",   # blank = {DWB_HOME}\\AI_Workspace
    "agent_command": "claude --dangerously-skip-permissions",
    "code_dirs": "",
}
CONFIG_HELP = {
    "workspace_dir": "Folder under which one working folder per JIRA ticket is created",
    "agent_command": "Command the AI agent is started with (run inside the project's ai_workspace folder)",
    "code_dirs": "Optional ';'-separated source folders the agent may read (passed with --add-dir)",
}
COLUMNS = ["id", "jira_id", "title", "folder_name", "folder_path", "ai_workspace", "jira_url", "status", "created", "rca_file"]

JIRA_KEY = re.compile(r"[A-Za-z][A-Za-z0-9]+-\d+")


# ── config ────────────────────────────────────────────────────────────────────────
def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            wb = openpyxl.load_workbook(CONFIG_FILE, data_only=True)
            ws = wb["Config"] if "Config" in wb.sheetnames else wb.active
            for row in ws.iter_rows(min_row=1, values_only=True):
                if row and row[0] and str(row[0]).strip().lower() in cfg and row[1] is not None:
                    cfg[str(row[0]).strip().lower()] = str(row[1]).strip()
            wb.close()
        except Exception:
            pass
    if not cfg["workspace_dir"].strip():
        cfg["workspace_dir"] = str(_dwb_home() / "AI_Workspace")      # default: {DWB_HOME}\\AI_Workspace
    cfg["workspace_dir"] = _expand(cfg["workspace_dir"])
    return cfg


def save_config(values):
    cfg = load_config()
    for k in DEFAULT_CONFIG:
        if k in values and values[k] is not None:
            cfg[k] = str(values[k]).strip()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Config"
    ws.append(["key", "value", "description"])
    for k, v in cfg.items():
        ws.append([k, v, CONFIG_HELP.get(k, "")])
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 60
    ws.column_dimensions["C"].width = 80
    wb.save(CONFIG_FILE)
    return cfg


def ensure_files():
    if not CONFIG_FILE.exists() or "Config" not in openpyxl.load_workbook(CONFIG_FILE, read_only=True).sheetnames:
        save_config({})
    if not PROJECTS_FILE.exists() or "Projects" not in openpyxl.load_workbook(PROJECTS_FILE, read_only=True).sheetnames:
        _write_projects([])
    JOBS_DIR.mkdir(parents=True, exist_ok=True)


# ── projects ──────────────────────────────────────────────────────────────────────
def _write_projects(rows):
    PROJECTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Projects"
    ws.append(COLUMNS)
    for r in rows:
        ws.append([r.get(c, "") for c in COLUMNS])
    for i, w in enumerate([6, 14, 50, 50, 70, 70, 50, 12, 20, 40], start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    wb.save(PROJECTS_FILE)


def list_projects():
    if not PROJECTS_FILE.exists():
        return []
    try:
        wb = openpyxl.load_workbook(PROJECTS_FILE, data_only=True)
        ws = wb["Projects"] if "Projects" in wb.sheetnames else wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception:
        return []
    if not rows:
        return []
    head = [str(h or "").strip() for h in rows[0]]
    out = []
    for r in rows[1:]:
        if r and any(v not in (None, "") for v in r):
            d = {head[i]: ("" if v is None else v) for i, v in enumerate(r) if i < len(head)}
            if d.get("id") in ("", None):
                continue
            d["id"] = int(d["id"])
            out.append(d)
    return out


def get_project(pid):
    return next((p for p in list_projects() if p["id"] == int(pid)), None)


def update_project(pid, **fields):
    rows = list_projects()
    for r in rows:
        if r["id"] == int(pid):
            r.update(fields)
    _write_projects(rows)


def extract_key(text):
    m = JIRA_KEY.search(str(text or ""))
    return m.group(0).upper() if m else ""


def make_folder_name(jira_id, title):
    slug = re.sub(r"[^A-Za-z0-9]+", "_", str(title or "")).strip("_")
    name = f"{jira_id}_{slug}" if slug else jira_id
    return name[:80].rstrip("_")


def clean_folder_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(name or "")).strip().strip(".")
    return re.sub(r"\s+", "_", name)[:100]


def create_project(jira_id, title, folder_name, jira_url=""):
    cfg = load_config()
    ws_dir = _expand(cfg["workspace_dir"]) or str(_dwb_home() / "AI_Workspace")      # default: {DWB_HOME}\\AI_Workspace
    folder_name = clean_folder_name(folder_name)
    if not folder_name or not folder_name.upper().startswith(jira_id.upper()):
        return None, f"The folder name must start with the JIRA ID ({jira_id})."
    folder = Path(ws_dir) / folder_name
    rows = list_projects()
    if any(str(r["folder_name"]).lower() == folder_name.lower() for r in rows):
        return None, f"A project with the folder '{folder_name}' already exists."
    try:
        aiws = folder / "ai_workspace"
        aiws.mkdir(parents=True, exist_ok=True)
        (folder / "supporting_data").mkdir(exist_ok=True)
    except OSError as e:
        return None, f"Could not create the working folder: {e}"
    row = {"id": max([r["id"] for r in rows], default=0) + 1, "jira_id": jira_id, "title": title,
           "folder_name": folder_name, "folder_path": str(folder), "ai_workspace": str(aiws),
           "jira_url": jira_url, "status": "created", "created": time.strftime("%Y-%m-%d %H:%M"), "rca_file": ""}
    rows.append(row)
    _write_projects(rows)
    return row, None


# ── JIRA ──────────────────────────────────────────────────────────────────────────
def _adf_text(node):
    """Flatten Atlassian Document Format to plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    t = node.get("type")
    if t == "text":
        return node.get("text", "")
    if t == "hardBreak":
        return "\n"
    inner = "".join(_adf_text(c) for c in node.get("content", []) or [])
    if t in ("paragraph", "heading", "codeBlock", "blockquote"):
        return inner + "\n"
    if t == "listItem":
        return "- " + inner
    return inner


def fetch_ticket(creds, jira_id, full=False):
    import requests
    from requests.auth import HTTPBasicAuth
    base = creds["base_url"]
    fields = "summary,status,issuetype,priority,assignee,reporter,description,labels,components,created,updated"
    r = requests.get(f"{base}/rest/api/3/issue/{jira_id}", params={"fields": fields},
                     auth=HTTPBasicAuth(creds["email"], creds["api_token"]), headers={"Accept": "application/json"},
                     timeout=30, verify=False)
    if r.status_code == 404:
        return None, f"{jira_id} was not found in JIRA."
    if r.status_code != 200:
        return None, f"JIRA returned HTTP {r.status_code}: {r.text[:200]}"
    f = r.json().get("fields", {})
    t = {"jira_id": jira_id, "title": f.get("summary") or "", "url": f"{base}/browse/{jira_id}",
         "status": (f.get("status") or {}).get("name", ""), "type": (f.get("issuetype") or {}).get("name", ""),
         "priority": (f.get("priority") or {}).get("name", ""),
         "assignee": (f.get("assignee") or {}).get("displayName", ""), "reporter": (f.get("reporter") or {}).get("displayName", ""),
         "labels": f.get("labels") or [], "components": [c.get("name", "") for c in f.get("components") or []],
         "description": _adf_text(f.get("description")).strip(), "comments": []}
    if full:
        rc = requests.get(f"{base}/rest/api/3/issue/{jira_id}/comment", params={"maxResults": 100},
                          auth=HTTPBasicAuth(creds["email"], creds["api_token"]), headers={"Accept": "application/json"},
                          timeout=30, verify=False)
        if rc.status_code == 200:
            for c in rc.json().get("comments", []):
                t["comments"].append({"author": (c.get("author") or {}).get("displayName", ""), "created": (c.get("created") or "")[:16],
                                      "body": _adf_text(c.get("body")).strip()})
    return t, None


def write_ticket_file(project, ticket):
    lines = [f"# {ticket['jira_id']}: {ticket['title']}", "",
             f"- URL: {ticket['url']}", f"- Type: {ticket['type']}    Status: {ticket['status']}    Priority: {ticket['priority']}",
             f"- Reporter: {ticket['reporter']}    Assignee: {ticket['assignee']}",
             f"- Labels: {', '.join(ticket['labels'])}    Components: {', '.join(ticket['components'])}", "",
             "## Description", "", ticket["description"] or "(no description)", ""]
    if ticket["comments"]:
        lines += ["## Comments", ""]
        for c in ticket["comments"]:
            lines += [f"### {c['author']} - {c['created']}", "", c["body"], ""]
    p = Path(project["folder_path"]) / "ticket.md"
    p.write_text("\n".join(lines), encoding="utf-8")
    return p


# ── agent jobs (detached; survive a Workbench restart) ───────────────────────────
def _job_paths(pid, kind):
    stem = f"{pid}_{kind}"
    return JOBS_DIR / f"{stem}.json", JOBS_DIR / f"{stem}.log", JOBS_DIR / f"{stem}.code", JOBS_DIR / f"{stem}.prompt"


def _pid_alive(pid):
    for _ in range(2):
        try:
            r = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}", "/NH", "/FO", "CSV"], capture_output=True, text=True,
                               timeout=15, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode == 0:
                return f'"{int(pid)}"' in r.stdout
        except Exception:
            pass
    return True


def start_job(project, kind, prompt):
    """Run the configured agent command in the project's ai_workspace with `prompt` on stdin."""
    cfg = load_config()
    command = cfg["agent_command"].strip()
    if not command:
        return None, "Agent command is not configured."
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    jf, logf, codef, pf = _job_paths(project["id"], kind)
    for f in (codef,):
        if f.exists():
            f.unlink()
    pf.write_text(prompt, encoding="utf-8")
    dirs = [d.strip() for d in cfg["code_dirs"].split(";") if d.strip() and Path(d.strip()).exists()]
    dirs.append(project["folder_path"])
    add = "".join(f" --add-dir '{d}'" for d in dirs) if "claude" in command.lower() else ""
    ps = (f"[Console]::OutputEncoding = [Text.Encoding]::UTF8; Set-Location '{project['ai_workspace']}'; "
          f"Get-Content -Raw -Encoding UTF8 '{pf}' | {command}{add} -p --verbose --output-format stream-json; "
          f"$c = $LASTEXITCODE; if ($null -eq $c) {{ $c = 0 }}; Set-Content -Path '{codef}' -Value $c")
    header = f"$ cd {project['ai_workspace']}\n$ {command}{add} -p\n\n--- prompt ---\n{prompt}\n--------------\n"
    logf.write_text(header, encoding="utf-8")
    with open(logf, "ab") as lh:
        p = subprocess.Popen(["powershell.exe", "-NoProfile", "-Command", ps], stdout=lh, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    jf.write_text(json.dumps({"project": project["id"], "kind": kind, "pid": p.pid, "status": "running", "created": time.time()}), encoding="utf-8")
    return True, None


def read_job(pid, kind):
    jf, logf, codef, _ = _job_paths(pid, kind)
    if not jf.exists():
        return None
    try:
        job = json.loads(jf.read_text(encoding="utf-8"))
    except Exception:
        return None
    heal = job.get("status") == "failed" and job.get("rc") is None and codef.exists()
    if job.get("status") == "running" or heal:
        if codef.exists():
            try:
                rc = int(codef.read_text(encoding="utf-8-sig", errors="replace").strip() or "0")
            except ValueError:
                rc = 1
            job.update(status="done" if rc == 0 else "failed", rc=rc)
        elif not _pid_alive(job.get("pid")) and not _pid_alive(job.get("pid")):
            if codef.exists():
                return read_job(pid, kind)
            job.update(status="failed", rc=None)
        jf.write_text(json.dumps(job), encoding="utf-8")
    try:
        data = logf.read_bytes()
        raw = data[-400000:].decode("utf-8", errors="replace")
    except Exception:
        raw = ""
    job["raw"] = raw
    return job


def abort_job(pid, kind):
    jf, *_ = _job_paths(pid, kind)
    job = json.loads(jf.read_text(encoding="utf-8")) if jf.exists() else None
    if not job or job.get("status") != "running":
        return False
    job["status"] = "aborted"
    jf.write_text(json.dumps(job), encoding="utf-8")
    subprocess.run(["taskkill", "/F", "/T", "/PID", str(job["pid"])], capture_output=True,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return True


def rca_path(project):
    return Path(project["folder_path"]) / "RCA" / f"RCA_{project['jira_id']}.md"


def supporting_files(project):
    d = Path(project["folder_path"]) / "supporting_data"
    d.mkdir(exist_ok=True)
    return sorted(f.name for f in d.rglob("*") if f.is_file())


def _supporting_note(project):
    d = Path(project["folder_path"]) / "supporting_data"
    files = supporting_files(project)
    listing = ("Files there now:" + chr(10) + chr(10).join("  - " + f for f in files[:40])) if files else "It is currently empty."
    return (f"Supporting data (logs, stack traces and any other relevant information provided by the user) is in: {d}" + chr(10) +
            f"Read ALL of it - it is primary evidence. {listing}" + chr(10))


# ── prompts ───────────────────────────────────────────────────────────────────────
def analyze_prompt(project):
    return (
        f"You are analysing JIRA ticket {project['jira_id']}: {project['title']}.\n\n"
        f"The full ticket (description and comments) was saved to: {Path(project['folder_path']) / 'ticket.md'}\n"
        + _supporting_note(project) +
        "Read the ticket and the supporting data first, then analyse the problem:\n"
        "  1. Summarise what is being reported and the expected vs actual behaviour.\n"
        "  2. Correlate stack traces / log entries in the supporting data with the code; if source folders were made available, locate the relevant code and explain how it works today.\n"
        "  3. List the likely root cause(s) with evidence (file / class / method) and your confidence for each.\n"
        "  4. Propose a fix and a test plan, and list open questions or missing information.\n\n"
        f"Write your analysis to {Path(project['folder_path']) / 'ANALYSIS.md'} (Markdown) and give a short summary at the end. "
        "Do NOT modify any source code - this is analysis only."
    )


def rca_prompt(project):
    rca = rca_path(project)
    return (
        f"Create a Root Cause Analysis (RCA) document for JIRA ticket {project['jira_id']}: {project['title']}.\n\n"
        f"Inputs in {project['folder_path']}: ticket.md (the ticket) and ANALYSIS.md (earlier analysis, if present).\n"
        + _supporting_note(project) +
        "Re-check the code if source folders are available.\n\n"
        "The RCA must contain these sections: Summary, Impact, Timeline (if known), Root Cause, Contributing Factors, "
        "Detection, Resolution / Fix, Preventive Actions, Lessons Learned. Be factual and concise; cite the supporting "
        "data (file name / log line / stack frame) as evidence, and mark anything you could not verify as an assumption.\n\n"
        f"Write it to {rca} (Markdown) - the RCA folder already exists. Do NOT modify any source code."
    )
