#!/usr/bin/env python3
"""
Fetches build parameter definitions from the Jenkins job and writes them
to the BuildParameters sheet in gp_job_config.xlsx.

Run once after filling in the Settings sheet (gp_base_url, scrum_team,
application, jenkins_username, and jenkins_api_token or jenkins_password).
"""

import os
import sys
import requests
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from api_errors import jenkins_error, connection_error, http

TOOL_ROOT      = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WORKFLOWS_ROOT = os.path.normpath(os.path.join(TOOL_ROOT, ".."))
CONFIG_PATH    = os.path.join(TOOL_ROOT, "gp_job_config.xlsx")
GP_PARAMS_PATH = os.path.join(TOOL_ROOT, "gp_params", "payor_gp_params.xlsx")
SECRETS_PATH   = os.path.join(WORKFLOWS_ROOT, "..", "secrets.xlsx")


def _gp_params_path_for_app(app_name):
    slug = app_name.lower().replace(" ", "_").replace("-", "_")
    return os.path.join(TOOL_ROOT, "gp_params", f"{slug}_gp_params.xlsx")

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(color="FFFFFF", bold=True)
NOTE_FONT   = Font(color="595959", italic=True, size=9)


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def load_settings(app_name=None):
    wb = openpyxl.load_workbook(CONFIG_PATH)
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


def load_secrets():
    data = {}
    if not os.path.exists(SECRETS_PATH):
        return data
    wb = openpyxl.load_workbook(SECRETS_PATH)
    for sheet in wb.sheetnames:
        for row in wb[sheet].iter_rows(min_row=2, values_only=True):
            if row[0] and row[1] is not None:
                data[str(row[0]).strip()] = str(row[1]).strip()
    return data


def get_auth(settings, secrets):
    username = secrets.get("jenkins_username") or settings.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token") or settings.get("jenkins_api_token", "")
    password = secrets.get("jenkins_password") or settings.get("jenkins_password", "")
    secret   = token if token else password
    if not username or not secret:
        raise ValueError(
            "Fill in jenkins_username and either jenkins_api_token or "
            "jenkins_password in secrets.xlsx (Jenkins sheet) before running this script."
        )
    return (username, secret)


def build_job_url(settings):
    return settings.get("url", "").rstrip("/")


# ---------------------------------------------------------------------------
# Jenkins helpers
# ---------------------------------------------------------------------------

def get_crumb(base_url, auth):
    """Fetch Jenkins CSRF crumb — returns (header_name, value) or None."""
    try:
        resp = http.get(
            f"{base_url}/crumbIssuer/api/json",
            auth=auth, timeout=15
        )
        if resp.status_code == 200:
            data = resp.json()
            return data["crumbRequestField"], data["crumb"]
    except Exception:
        pass
    return None, None


def fetch_parameters(job_url, auth):
    """
    Returns a list of dicts:
      { name, type, default, description }
    Jenkins stores parameter definitions in the 'property' array, not 'actions'.
    """
    api_url = f"{job_url}/api/json"
    params  = {
        "tree": "property[parameterDefinitions["
                "name,type,defaultParameterValue[value],description"
                "]]"
    }
    resp = http.get(api_url, auth=auth, params=params, timeout=30)
    resp.raise_for_status()

    param_defs = []
    for prop in resp.json().get("property", []):
        for pd in prop.get("parameterDefinitions", []):
            default_val = ""
            dpv = pd.get("defaultParameterValue")
            if dpv and dpv.get("value") is not None:
                default_val = str(dpv["value"])
            param_defs.append({
                "name":        pd.get("name", ""),
                "type":        _friendly_type(pd.get("type", "")),
                "default":     default_val,
                "description": pd.get("description", ""),
            })
    return param_defs


def _friendly_type(raw):
    return {
        "StringParameterDefinition":   "String",
        "BooleanParameterDefinition":  "Boolean",
        "ChoiceParameterDefinition":   "Choice",
        "TextParameterDefinition":     "Text",
        "PasswordParameterDefinition": "Password",
        "FileParameterDefinition":     "File",
    }.get(raw, raw)


# ---------------------------------------------------------------------------
# Write to gp_job_config.xlsx
# ---------------------------------------------------------------------------

def write_parameters(param_defs, job_url, gp_params_path=None):
    if gp_params_path is None:
        gp_params_path = GP_PARAMS_PATH
    os.makedirs(os.path.dirname(gp_params_path), exist_ok=True)
    if os.path.exists(gp_params_path):
        wb = openpyxl.load_workbook(gp_params_path)
    else:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

    if "BuildParameters" in wb.sheetnames:
        del wb["BuildParameters"]
    ws = wb.create_sheet("BuildParameters")

    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 36
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 24
    ws.column_dimensions["E"].width = 50

    # Header
    for col, title in enumerate(
            ("parameter", "value", "type", "default", "description"), start=1):
        cell = ws.cell(1, col, title)
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")

    # Rows
    for pd in param_defs:
        row = ws.max_row + 1
        ws.cell(row, 1, pd["name"]).font        = Font(bold=True)
        ws.cell(row, 2, "")                      # ← user fills this in
        ws.cell(row, 3, pd["type"]).font        = NOTE_FONT
        ws.cell(row, 4, pd["default"]).font     = NOTE_FONT
        ws.cell(row, 5, pd["description"]).font = NOTE_FONT

    wb.save(gp_params_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Parse --app flag
    app_name = None
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] == "--app" and i + 1 < len(argv):
            app_name = argv[i + 1].strip()
            i += 2
        else:
            i += 1

    print("Reading gp_job_config.xlsx...")
    settings = load_settings(app_name)
    secrets  = load_secrets()

    if not settings.get("url"):
        print("ERROR: Fill in 'url' in gp_job_config.xlsx Settings first.")
        sys.exit(1)

    try:
        auth = get_auth(settings, secrets)
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    job_url        = build_job_url(settings)
    base_url       = "/".join(job_url.split("/")[:3])
    resolved_app   = app_name or settings.get("application", "Payor")
    gp_params_path = _gp_params_path_for_app(resolved_app)

    print(f"Fetching parameters from:\n  {job_url}\n")

    username = auth[0] if auth else ""
    try:
        param_defs = fetch_parameters(job_url, auth)
    except requests.exceptions.ConnectionError:
        print(connection_error("Jenkins"))
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(jenkins_error(e.response.status_code, base_url=base_url, username=username))
        sys.exit(1)

    slug = os.path.basename(gp_params_path)
    if not param_defs:
        print("  No parameters found on this job.")
        print("  The job may have no parameters, or the parameter action "
              "uses a plugin not covered by this query.")
        write_parameters([], job_url, gp_params_path)
    else:
        print(f"  Found {len(param_defs)} parameter(s):\n")
        for pd in param_defs:
            default_str = f"  (default: {pd['default']})" if pd["default"] else ""
            desc_str    = f"  — {pd['description']}"      if pd["description"] else ""
            print(f"    {pd['name']}  [{pd['type']}]{default_str}{desc_str}")

        write_parameters(param_defs, job_url, gp_params_path)
        print(f"\n  BuildParameters sheet written to gp_params/{slug}.")
        print(f"  Open gp_params/{slug} -> BuildParameters and fill in the 'value' column.")


if __name__ == "__main__":
    main()
