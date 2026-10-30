#!/usr/bin/env python3
"""
fetch_baseline_params.py — Fetch build parameters from Jenkins baseline regression jobs.
Called by setupjbaselinetool to populate jenkins_params/ xlsx files.
Skips payor_core_commit and payor_utils_certification (no parameters).
"""

import sys
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

SECRETS_PATH    = WORKFLOWS_ROOT.parent / "secrets.xlsx"
BASELINE_CONFIG = TOOL_ROOT / "baseline_job_config.xlsx"
PARAMS_DIR      = TOOL_ROOT / "jenkins_params"

_NO_PARAMS_JOBS = set()


def load_secrets():
    if not SECRETS_PATH.exists():
        return {}
    wb = openpyxl.load_workbook(str(SECRETS_PATH))
    if "Jenkins" not in wb.sheetnames:
        return {}
    sec = {}
    for row in wb["Jenkins"].iter_rows(min_row=2, values_only=True):
        if row[0] and row[1] is not None:
            sec[str(row[0]).strip()] = str(row[1]).strip() if row[1] else ""
    return sec


def _parse_choices(raw) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(c) for c in raw if str(c).strip()]
    return [c for c in str(raw).splitlines() if c.strip()]


def fetch_params_for_job_to(job_name, job_url, secrets, out_dir=None):
    return fetch_params_for_job(job_name, job_url, secrets, out_dir=out_dir)


def fetch_params_for_job(job_name, job_url, secrets, out_dir=None):
    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth     = (username, token) if username and token else None

    api_url = f"{job_url.rstrip('/')}/api/json?depth=2"
    _s = session()
    try:
        resp = _s.get(api_url, auth=auth, timeout=30)
        if resp.status_code in (401, 403):
            print(f"  [error] HTTP {resp.status_code} for {job_name} — check credentials.")
            return False
        if resp.status_code == 404:
            print(f"  [error] Job not found (404) for {job_name} — check URL in baseline_job_config.xlsx.")
            return False
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        print(f"  [error] Cannot reach Jenkins for {job_name} — check VPN/network.")
        return False
    except Exception as e:
        print(f"  [error] {e}")
        return False

    data       = resp.json()
    param_defs = []
    for container in [*data.get("actions", []), *data.get("property", [])]:
        for p in container.get("parameterDefinitions", []):
            param_defs.append(p)

    if not param_defs:
        print(f"  [warning] No parameters found for {job_name}.")
    else:
        print(f"  [found] {len(param_defs)} parameters for {job_name}")

    save_dir = out_dir if out_dir else PARAMS_DIR
    save_dir.mkdir(parents=True, exist_ok=True)
    out_path = save_dir / f"payor_{job_name}_jenkins_params.xlsx"
    wb       = openpyxl.Workbook()
    ws       = wb.active
    ws.title = "BuildParameters"
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 40
    ws.append(["param_name", "param_value"])

    choice_sheets = {}
    for p in param_defs:
        name    = str(p.get("name", "")).strip()
        default = p.get("defaultParameterValue") or {}
        value   = str(default.get("value", "")) if default else ""
        choices = _parse_choices(p.get("choices"))
        ws.append([name, value])
        if choices:
            sheet_name = name[:31]
            cws = wb.create_sheet(title=sheet_name)
            cws.column_dimensions["A"].width = 40
            cws.append(["choice_value"])
            for c in choices:
                cws.append([c])
            choice_sheets[name] = choices

    wb.save(str(out_path))
    print(f"  [ok] {out_path.name}  ({len(param_defs)} params, {len(choice_sheets)} choice tabs)")
    return True


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="Payor")
    args = parser.parse_args()
    app_name = args.app.strip()

    if not BASELINE_CONFIG.exists():
        print("  ERROR: baseline_job_config.xlsx not found. Run  setupjbaselinetool  first.")
        return False
    wb = openpyxl.load_workbook(str(BASELINE_CONFIG))
    sheet = next((s for s in wb.sheetnames if s.lower() == app_name.lower()), None)
    if not sheet:
        print(f"  ERROR: sheet '{app_name}' not found in baseline_job_config.xlsx.")
        return False

    jobs = []
    for row in wb[sheet].iter_rows(min_row=2, values_only=True):
        if row[0] and row[1]:
            name = str(row[0]).strip()
            if name in _NO_PARAMS_JOBS:
                print(f"  [skip] {name}  (no build parameters)")
                continue
            jobs.append((name, str(row[1]).strip()))

    if not jobs:
        print("  No parametrized jobs found in baseline_job_config.xlsx (fill in regression job URLs).")
        return True

    app_params_dir = PARAMS_DIR / app_name
    app_params_dir.mkdir(parents=True, exist_ok=True)

    secrets = load_secrets()
    print(f"\n  Fetching build parameters for {len(jobs)} baseline regression job(s) [{app_name}]...\n")
    ok = 0
    for job_name, job_url in jobs:
        print(f"  {job_name}")
        if fetch_params_for_job_to(job_name, job_url, secrets, app_params_dir):
            ok += 1
    print(f"\n  {ok}/{len(jobs)} param files written to jenkins_params/{app_name}/\n")
    return ok == len(jobs)


if __name__ == "__main__":
    main()
