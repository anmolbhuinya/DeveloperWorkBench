#!/usr/bin/env python3
"""
remote_setup.py — remotevmsetup / rvmsetup command

Select a VM and trigger a remote server setup via Jenkins.

Usage:
  remotevmsetup
  rvmsetup
"""

import sys
import time
import requests
import filelock as _filelock
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
import openpyxl
from openpyxl.styles import Font, PatternFill

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
SECRETS_PATH  = TOOL_ROOT.parent / "secrets.xlsx"

_RS_LEASE_SECONDS = 15 * 60

def _rs_projects_filelock():
    """Cross-process FileLock for projects.xlsx with 15-min lease eviction."""
    _lp = TOOL_ROOT / "projects.xlsx.lock"
    if _lp.exists():
        try:
            if time.time() - _lp.stat().st_mtime > _RS_LEASE_SECONDS:
                _lp.unlink()
        except OSError:
            pass
    return _filelock.FileLock(str(_lp), timeout=30)


def _load_secrets():
    if not SECRETS_PATH.exists():
        return {}
    wb   = openpyxl.load_workbook(str(SECRETS_PATH))
    data = {}
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                data[str(row[0]).strip()] = str(row[1]).strip()
    return data

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def cyan(s):   return f"\x1b[36m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def yellow(s): return f"\x1b[33m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def white(s):  return f"\x1b[97m{s}{RESET}"

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")


# ---------------------------------------------------------------------------
# Load config and parameters
# ---------------------------------------------------------------------------

def _load_config_and_params():
    cfg_path    = TOOL_ROOT / "config.xlsx"
    params_path = TOOL_ROOT / "katalon_params.xlsx"

    if not cfg_path.exists():
        print(f"\n  ERROR: config.xlsx not found in {TOOL_ROOT}")
        print(f"  Run  setupremotesetuptool  first.\n")
        sys.exit(1)
    if not params_path.exists():
        print(f"\n  ERROR: katalon_params.xlsx not found in {TOOL_ROOT}")
        print(f"  Run  setupremotesetuptool -fetchparams  first.\n")
        sys.exit(1)

    # Load config (jenkins_build_url etc.) from config.xlsx
    config = {}
    wb_cfg = openpyxl.load_workbook(str(cfg_path))
    if "Config" in wb_cfg.sheetnames:
        for row in wb_cfg["Config"].iter_rows(min_row=2, values_only=True):
            if row[0]:
                config[str(row[0]).strip()] = str(row[1] or "").strip()

    # Load build parameters from katalon_params.xlsx
    params = []
    wb_p = openpyxl.load_workbook(str(params_path))
    if "Parameters" in wb_p.sheetnames:
        for row in wb_p["Parameters"].iter_rows(min_row=2, values_only=True):
            if row[0]:
                raw_choices = str(row[2] or "").strip()
                choices     = [c.strip() for c in raw_choices.split(",") if c.strip()]
                params.append({
                    "key":         str(row[0] or "").strip(),
                    "type":        str(row[1] or "").strip(),
                    "choices":     choices,
                    "default":     str(row[3] or "").strip(),
                    "description": str(row[4] or "").strip(),
                })

    return config, params


def _load_vms():
    path = TOOL_ROOT.parent / "vms.xlsx"
    if not path.exists():
        print(f"\n  ERROR: vms.xlsx not found at:\n  {path}")
        print(f"  Run  setupremotesetuptool  first.\n")
        sys.exit(1)
    wb  = openpyxl.load_workbook(str(path))
    ws  = wb[wb.sheetnames[0]]   # use first sheet regardless of name
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
        print(f"\n  ERROR: No VMs found in vms.xlsx")
        print(f"  File path : {path}")
        print(f"  Sheet     : {ws.title}  ({ws.max_row - 1} data row(s))")
        print(f"  Add VM entries (name, ip, description) and retry.\n")
        sys.exit(1)
    return vms


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_VM_IP_KEYS       = {"vm_ip", "vm", "ip", "host", "hostname", "target_ip", "target"}
_VM_PASSWORD_KEYS = {"password", "vm_password", "server_password", "host_password", "target_password",
                     "gh_pass", "github_pass", "github_password", "git_password", "git_pass"}
_GH_PASS_KEYS = _VM_PASSWORD_KEYS   # alias — used for GitHub token auto-fill check
_RUN_ALL_KEY               = "run_all"
_RUN_ALL_SUBKEYS           = {"run_payor", "run_classic", "run_connector", "run_enrollment"}
_RUN_WITHOUT_BUILD_KEY     = "run_without_build"
_RUN_WITHOUT_BUILD_SUBKEYS = {"nbld_repos"}
_RUN_UPGRADE_KEY           = "run_upgrade"
_RUN_UPGRADE_SUBKEYS       = {
    "customer_name",
    "source_payer_version",
    "source_payer_feature_branch",
    "target_payer_version",
    "target_payer_feature_branch",
    "upgrade_resume_step",
}


def _prompt_vm(vms):
    print(f"\n  {'─' * 56}")
    print(f"  Select VM to set up:")
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
            print("  Exiting.")
            sys.exit(0)
        if ans.isdigit() and 1 <= int(ans) <= len(vms):
            return vms[int(ans) - 1]
        print(f"  Invalid — enter a number between 0 and {len(vms)}.")


def _prompt_params(params, vm, secrets=None, auto_defaults=False):
    values            = {}
    secrets           = secrets or {}
    run_all           = False   # set True once RUN_ALL=true chosen
    run_without_build = False   # set True once RUN_WITHOUT_BUILD=true chosen
    run_upgrade       = False   # set True once RUN_UPGRADE=true chosen
    if not params:
        print(f"\n  {yellow('No parameters found.')} Run  setupremotesetuptool -fetchparams  to load them.")
        return values

    print(f"\n  {'─' * 56}")
    print(f"  Configure parameters:  (Enter = keep default)")
    print(f"  {'─' * 56}")

    for p in params:
        key     = p["key"]
        choices = p["choices"]
        default = p["default"]
        desc    = p["description"]

        # Auto-fill VM IP from selected VM — skip prompting
        if key.lower() in _VM_IP_KEYS:
            values[key] = vm["ip"]
            print(f"\n  {bold(key)} : {vm['ip']}  {grey('(auto-filled from selected VM)')}")
            continue

        # Auto-fill VM password from selected VM — skip prompting
        if key.lower() in _VM_PASSWORD_KEYS and vm.get("password"):
            values[key] = vm["password"]
            print(f"\n  {bold(key)} : {'*' * len(vm['password'])}  {grey('(auto-filled from vms.xlsx)')}")
            continue

        # Auto-fill GitHub token from secrets.xlsx
        if key.lower() in _GH_PASS_KEYS:
            gh_token = secrets.get("github_token_for_web_ui", "")
            if gh_token:
                values[key] = gh_token
                print(f"\n  {bold(key)} : {'*' * len(gh_token)}  {grey('(auto-filled from secrets.xlsx)')}")
                continue

        # Skip individual run flags when RUN_ALL=true was already chosen
        if run_all and key.lower() in _RUN_ALL_SUBKEYS:
            print(f"\n  {bold(key)} : {grey('skipped (RUN_ALL = true)')}")
            continue

        # Skip NBLD_REPOS when RUN_WITHOUT_BUILD=false
        if not run_without_build and key.lower() in _RUN_WITHOUT_BUILD_SUBKEYS:
            print(f"\n  {bold(key)} : {grey('skipped (RUN_WITHOUT_BUILD = false)')}")
            continue

        # Skip CUSTOMER_NAME when RUN_UPGRADE=false
        if not run_upgrade and key.lower() in _RUN_UPGRADE_SUBKEYS:
            print(f"\n  {bold(key)} : {grey('skipped (RUN_UPGRADE = false)')}")
            continue

        # Non-interactive mode: use default values without prompting
        if auto_defaults:
            if choices:
                val = default if default in choices else (choices[0] if choices else default)
            else:
                val = default
            values[key] = val
            print(f"  {bold(key)} : {val or '(empty)'}  {grey('(default)')}")
            if key.lower() == _RUN_ALL_KEY and val.lower() == "true":
                run_all = True
            if key.lower() == _RUN_WITHOUT_BUILD_KEY and val.lower() == "true":
                run_without_build = True
            if key.lower() == _RUN_UPGRADE_KEY and val.lower() == "true":
                run_upgrade = True
            continue

        if desc:
            print(f"\n  {grey(desc)}")

        # Boolean params have no choices but a true/false default — treat as two-choice
        if not choices and p.get("type", "").lower() in ("booleanparameterdefinition", "boolean"):
            choices = ["true", "false"]

        if choices:
            default_idx = next(
                (i + 1 for i, c in enumerate(choices) if c.lower() == default.lower()),
                None
            ) if default else None
            print(f"  {bold(key)}:")
            for i, c in enumerate(choices, 1):
                marker = grey("  ← default") if default and c.lower() == default.lower() else ""
                print(f"    [{i}] {c}{marker}")
            prompt = f"  Select [1-{len(choices)}]"
            if default_idx:
                prompt += f" (Enter = {default_idx})"
            prompt += ": "
            while True:
                try:
                    ans = input(prompt).strip()
                except (EOFError, KeyboardInterrupt):
                    print(); sys.exit(0)
                if not ans and default_idx:
                    values[key] = choices[default_idx - 1]
                    break
                if ans.isdigit() and 1 <= int(ans) <= len(choices):
                    values[key] = choices[int(ans) - 1]
                    break
                print(f"  Invalid — enter a number between 1 and {len(choices)}.")
        else:
            hint = f" [{default}]" if default else ""
            try:
                ans = input(f"  {bold(key)}{hint}: ").strip()
            except (EOFError, KeyboardInterrupt):
                print(); sys.exit(0)
            values[key] = ans if ans else default

        # Track conditional flags
        if key.lower() == _RUN_ALL_KEY and values.get(key, "").lower() == "true":
            run_all = True
        if key.lower() == _RUN_WITHOUT_BUILD_KEY and values.get(key, "").lower() == "true":
            run_without_build = True
        if key.lower() == _RUN_UPGRADE_KEY and values.get(key, "").lower() == "true":
            run_upgrade = True

    return values


# ---------------------------------------------------------------------------
# Jenkins
# ---------------------------------------------------------------------------

def _trigger_build(config, param_values):
    build_url = config.get("jenkins_build_url", "")
    secrets   = _load_secrets()
    username  = secrets.get("jenkins_username", "")
    api_token = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")

    if not username or not api_token:
        print(f"  {yellow('Warning: jenkins_username / jenkins_api_token not found in secrets.xlsx (Jenkins sheet).')}")

    if not build_url:
        print(f"\n  ERROR: jenkins_build_url not set in config.xlsx")
        return False, ""

    auth     = (username, api_token) if username and api_token else None
    parsed   = urlparse(build_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    print(f"\n  Triggering Jenkins build...")
    print(f"  {grey(build_url)}")

    session = requests.Session()
    if auth:
        session.auth = auth

    # Fetch crumb using the same session so cookies are shared
    crumb_headers = {}
    try:
        r = session.get(f"{base_url}/crumbIssuer/api/json", timeout=10)
        if r.status_code == 200:
            data = r.json()
            crumb_headers = {data["crumbRequestField"]: data["crumb"]}
    except Exception:
        pass

    try:
        # allow_redirects=False: Jenkins returns 302 with Location: <queue_item_url>.
        # With redirect-following on (default), requests consumes the 302 and the
        # Location header is gone from the final 200 response.
        resp = session.post(build_url, headers=crumb_headers,
                            data=param_values, timeout=30, allow_redirects=False)
        if resp.status_code in (200, 201, 302):
            location = (resp.headers.get("Location") or "").strip()
            print(f"  {green('Build queued successfully.')}")
            if location:
                print(f"  Queue URL : {location}")
            return True, location
        else:
            print(f"  {red(f'Jenkins returned HTTP {resp.status_code}')}")
            try:
                print(f"  {grey(resp.text[:300])}")
            except Exception:
                pass
            return False, ""
    except Exception as e:
        print(f"  {red(f'ERROR: {e}')}")
        return False, ""


# ---------------------------------------------------------------------------
# Resolve actual build URL from queue item
# ---------------------------------------------------------------------------

def _resolve_build_url(queue_url, secrets, max_wait=20, poll_interval=4):
    """Poll queue item until Jenkins assigns a build number; return the build URL."""
    if not queue_url:
        return ""
    username  = secrets.get("jenkins_username", "")
    api_token = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth      = (username, api_token) if username and api_token else None

    print(f"  Waiting for Jenkins to assign a build number", end="", flush=True)
    deadline = time.time() + max_wait
    while time.time() < deadline:
        print(".", end="", flush=True)
        time.sleep(poll_interval)
        try:
            r = requests.get(queue_url.rstrip("/") + "/api/json", auth=auth, timeout=10)
            if r.status_code == 200:
                exe = (r.json().get("executable") or {})
                url = exe.get("url")
                if url:
                    print()
                    return url.rstrip("/") + "/"
        except Exception:
            pass
    print()
    return ""


# ---------------------------------------------------------------------------
# Projects log (projects.xlsx) + per-server config (configured_servers/)
# ---------------------------------------------------------------------------

PROJECTS_PATH      = TOOL_ROOT / "projects.xlsx"
SERVERS_DIR        = TOOL_ROOT / "configured_servers"
PROJECTS_HEADERS   = ["pid", "timestamp", "vm_name", "vm_ip", "status", "jenkins_url", "queue_url", "config_file"]
PROJECTS_WIDTHS    = [6, 20, 22, 18, 12, 80, 60, 40]


def _ip_to_filename(ip):
    return f"server_{ip.replace('.', '_')}_conf.xlsx"


def _next_pid():
    with _rs_projects_filelock():
        if not PROJECTS_PATH.exists():
            return 1
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


def _update_project(idp_pid, status, jenkins_url, queue_url):
    """Update an existing IDP-created project row by its pid."""
    if not PROJECTS_PATH.exists():
        return
    with _rs_projects_filelock():
        wb   = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws   = wb.active
        hdrs = [str(ws.cell(1, c).value or "").strip().lower() for c in range(1, ws.max_column + 1)]
        cmap = {h: i for i, h in enumerate(hdrs, 1)}
        pid_col = cmap.get("pid", 1)
        for row in ws.iter_rows(min_row=2):
            if str(row[pid_col - 1].value or "").strip() == str(idp_pid).strip():
                if "status"      in cmap: row[cmap["status"]      - 1].value = status
                if "jenkins_url" in cmap: row[cmap["jenkins_url"] - 1].value = jenkins_url
                if "queue_url"   in cmap: row[cmap["queue_url"]   - 1].value = queue_url
                break
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print(f"  Warning: Could not update projects.xlsx (file may be open).")


def _append_project(pid, ts, vm, status, jenkins_url, queue_url, config_file):
    _ensure_projects()
    with _rs_projects_filelock():
        wb = openpyxl.load_workbook(str(PROJECTS_PATH))
        ws = wb.active
        ws.append([pid, ts, vm["name"], vm["ip"], status, jenkins_url, queue_url, config_file])
        try:
            wb.save(str(PROJECTS_PATH))
        except PermissionError:
            print(f"  Warning: Could not save projects.xlsx (file may be open).")


def _record_run(pid, vm, param_values, success, jenkins_url, queue_url, idp_pid=None):
    ts     = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    status = "Triggered" if success else "Failed"

    SERVERS_DIR.mkdir(parents=True, exist_ok=True)
    path = SERVERS_DIR / _ip_to_filename(vm["ip"])

    param_keys = list(param_values.keys())
    std_cols   = ["pid", "timestamp", "vm_name", "vm_ip", "status", "queue_url"]
    all_cols   = std_cols + param_keys

    if path.exists():
        wb = openpyxl.load_workbook(str(path))
    else:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Setups"
        for i, col in enumerate(all_cols, 1):
            c = ws.cell(1, i, col)
            c.font = HEADER_FONT
            c.fill = HEADER_FILL
            ws.column_dimensions[c.column_letter].width = 24
        wb.save(str(path))
        wb = openpyxl.load_workbook(str(path))

    ws = wb["Setups"]

    # Ensure any new param columns exist in the header row
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    for k in param_keys:
        if k not in headers:
            col = ws.max_column + 1
            c   = ws.cell(1, col, k)
            c.font = HEADER_FONT
            c.fill = HEADER_FILL
            ws.column_dimensions[c.column_letter].width = 24
            headers.append(k)

    row  = [pid, ts, vm["name"], vm["ip"], status, queue_url]
    row += [param_values.get(k, "") for k in param_keys]
    ws.append(row)

    try:
        wb.save(str(path))
    except PermissionError:
        print(f"  Warning: Could not save {path.name} (file may be open).")

    if idp_pid:
        # Intermediate status (queued/building) was already written in main(); skip
        # overwriting with "Triggered" here — Jenkins poller will write the final result.
        print(f"\n  Project #{idp_pid} updated  →  projects.xlsx")
    else:
        _append_project(pid, ts, vm, status, jenkins_url, queue_url, path.name)
        print(f"\n  Project #{pid} saved  →  projects.xlsx")
    print(f"  Server config        →  configured_servers/{path.name}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import io as _io
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True)
    args = sys.argv[1:]
    vm_arg         = None
    use_defaults   = False
    idp_pid        = None
    param_overrides = {}
    i = 0
    while i < len(args):
        if args[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif args[i] in ("-vm", "--vm") and i + 1 < len(args):
            vm_arg = args[i + 1]; i += 2
        elif args[i] in ("-defaults", "--defaults"):
            use_defaults = True; i += 1
        elif args[i] in ("-idp-pid", "--idp-pid") and i + 1 < len(args):
            idp_pid = args[i + 1]; i += 2
        elif args[i] in ("-param", "--param") and i + 2 < len(args):
            param_overrides[args[i + 1]] = args[i + 2]; i += 3
        else:
            i += 1

    print()
    config, params = _load_config_and_params()
    vms            = _load_vms()

    if not vms:
        print("  ERROR: No VMs in vms.xlsx. Add entries and retry.")
        sys.exit(1)

    if vm_arg:
        vm = next((v for v in vms if v["name"].lower() == vm_arg.lower()), None)
        if not vm:
            available = ", ".join(v["name"] for v in vms)
            print(f"  ERROR: VM '{vm_arg}' not found. Available: {available}")
            sys.exit(1)
        print(f"  VM selected: {bold(vm['name'])}  {grey(vm['ip'])}")
    else:
        vm = _prompt_vm(vms)

    secrets      = _load_secrets()
    param_values = _prompt_params(params, vm, secrets, auto_defaults=use_defaults)
    # Apply explicit overrides (-param KEY VALUE) — these take precedence over defaults
    if param_overrides:
        param_values.update(param_overrides)

    print(f"\n  {'─' * 56}")
    print(f"  VM         : {bold(vm['name'])}  {grey(vm['ip'])}")
    print(f"  Parameters :")
    for k, v in param_values.items():
        display = "*" * len(str(v)) if k.lower() in _VM_PASSWORD_KEYS else v
        print(f"    {k:<30} = {display}")
    print()

    if not use_defaults:
        try:
            confirm = input("  Proceed? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
        if confirm != "y":
            print("  Cancelled.")
            return

    pid                = _next_pid()
    success, queue_url = _trigger_build(config, param_values)

    if idp_pid and success:
        if queue_url:
            # Jenkins returned a queue item URL — write it immediately
            _update_project(idp_pid, "queued", "", queue_url)
        else:
            # Triggered successfully but no queue URL (Jenkins didn't return Location).
            # At minimum persist the job URL so the status endpoint can query Jenkins.
            _update_project(idp_pid, "building", config.get("jenkins_build_url", ""), "")

    build_url   = _resolve_build_url(queue_url, secrets) if success and queue_url else ""
    jenkins_url = build_url or config.get("jenkins_build_url", "")
    if build_url:
        print(f"  Build URL    : {build_url}")
        # Write resolved build URL so the status endpoint can query Jenkins directly
        if idp_pid:
            _update_project(idp_pid, "building", build_url, queue_url)

    _record_run(pid, vm, param_values, success, jenkins_url, queue_url, idp_pid=idp_pid)
    print()


if __name__ == "__main__":
    main()
