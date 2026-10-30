#!/usr/bin/env python3
"""
fetch_job_params.py — Fetch build parameters from Jenkins jobs.
Called by setupjenkinsregression to populate jenkins_params/ xlsx files.
"""

import sys
from pathlib import Path
from urllib.parse import urlparse
import openpyxl
from openpyxl.styles import Alignment

SCRIPT_DIR     = Path(__file__).resolve().parent
TOOL_ROOT      = SCRIPT_DIR.parent
WORKFLOWS_ROOT = TOOL_ROOT.parent
GP_SCRIPTS     = WORKFLOWS_ROOT / "GP_Build" / "scripts"

if str(GP_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(GP_SCRIPTS))

from api_errors import session, jenkins_error, connection_error
import requests

SECRETS_PATH = WORKFLOWS_ROOT.parent / "secrets.xlsx"


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
    """Normalise choices — Jenkins returns either a list or a newline-delimited string."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(c) for c in raw if str(c).strip()]
    # newline-separated string
    return [c for c in str(raw).splitlines() if c.strip()]


def fetch_params_for_job(job_name, job_url, secrets, app_name="Payor"):
    """Fetch parameter definitions from Jenkins and write to jenkins_params/{app}/{app_lower}_{job_name}_jenkins_params.xlsx."""
    username = secrets.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token", "") or secrets.get("jenkins_password", "")
    auth     = (username, token) if username and token else None

    # depth=2 returns all nested fields reliably; tree-based choices can be missing in some Jenkins versions
    api_url = f"{job_url.rstrip('/')}/api/json?depth=2"
    _s = session()
    try:
        resp = _s.get(api_url, auth=auth, timeout=30)
        if resp.status_code in (401, 403):
            print(f"  [error] HTTP {resp.status_code} for {job_name} — check credentials.")
            return False
        if resp.status_code == 404:
            print(f"  [error] Job not found (404) for {job_name} — check URL in reg_job_config.xlsx.")
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
    # Jenkins <2.x puts ParametersDefinitionProperty in 'actions'; newer versions use 'property'
    for container in [*data.get("actions", []), *data.get("property", [])]:
        for p in container.get("parameterDefinitions", []):
            param_defs.append(p)

    if not param_defs:
        print(f"  [warning] No parameters found for {job_name} — job may have no parameters or API returned empty.")
        # still write empty file so the job is tracked
    else:
        print(f"  [found] {len(param_defs)} parameters for {job_name}")

    params_dir = TOOL_ROOT / "jenkins_params" / app_name
    params_dir.mkdir(parents=True, exist_ok=True)
    out_path = params_dir / f"{app_name.lower()}_{job_name}_jenkins_params.xlsx"
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


def main(jobs=None, app_name="Payor"):
    """jobs: list of (job_name, job_url) or None to load from reg_job_config.xlsx."""
    sheet_name = app_name.lower()
    if jobs is None:
        reg_config = TOOL_ROOT / "reg_job_config.xlsx"
        if not reg_config.exists():
            print("  ERROR: reg_job_config.xlsx not found.")
            return False
        wb = openpyxl.load_workbook(str(reg_config))
        if sheet_name not in wb.sheetnames:
            # fallback: try exact app_name casing
            if app_name not in wb.sheetnames:
                print(f"  ERROR: '{sheet_name}' sheet not found in reg_job_config.xlsx.")
                return False
            sheet_name = app_name
        jobs = []
        for row in wb[sheet_name].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1]:
                jobs.append((str(row[0]).strip(), str(row[1]).strip()))

    secrets = load_secrets()
    print(f"\n  Fetching build parameters for {len(jobs)} {app_name} jobs...\n")
    ok = 0
    for job_name, job_url in jobs:
        print(f"  {job_name}")
        if fetch_params_for_job(job_name, job_url, secrets, app_name=app_name):
            ok += 1
    print(f"\n  {ok}/{len(jobs)} param files written to jenkins_params/{app_name}/\n")
    return ok == len(jobs)


if __name__ == "__main__":
    import argparse as _ap
    _parser = _ap.ArgumentParser()
    _parser.add_argument("--app", "-app", default="Payor")
    _args = _parser.parse_args()
    main(app_name=_args.app)
