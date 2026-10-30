#!/usr/bin/env python3
"""
puc_certify.py — puccertify command

Certify a PUC run by comparing IT test failures between the Jenkins build
and a baseline build. Saves comparison results to projects/<pid>_<version>.xlsx.

Usage:
  puccertify -pid <project_id>
  puccertify --help
"""

import sys
import io
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SCRIPT_DIR    = Path(__file__).resolve().parent
TOOL_ROOT     = SCRIPT_DIR.parent
WORKFLOWS_ROOT = TOOL_ROOT.parent
SECRETS_PATH  = WORKFLOWS_ROOT.parent / "secrets.xlsx"
PROJECTS_PATH = TOOL_ROOT / "projects.xlsx"
CERT_DIR      = TOOL_ROOT / "projects"

HEADER_FILL = PatternFill("solid", fgColor="1F3864")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri")
A_ALIGN     = Alignment(horizontal="left")

RESET  = "\x1b[0m"
def bold(s):   return f"\x1b[1m{s}{RESET}"
def green(s):  return f"\x1b[32m{s}{RESET}"
def red(s):    return f"\x1b[31m{s}{RESET}"
def grey(s):   return f"\x1b[90m{s}{RESET}"


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


def _load_projects():
    if not PROJECTS_PATH.exists():
        return []
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i - 1 for i, h in enumerate(headers, 1)}
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not any(row):
            continue
        rows.append({h: str(row[i] or "").strip() for h, i in col_map.items()})
    return rows


def _update_certification_status(pid, cert_status, jenkins_count, baseline_count):
    if not PROJECTS_PATH.exists():
        return
    wb      = openpyxl.load_workbook(str(PROJECTS_PATH))
    ws      = wb.active
    headers = [str(ws.cell(1, c).value or "").strip().lower()
               for c in range(1, ws.max_column + 1)]
    col_map = {h: i for i, h in enumerate(headers, 1)}
    for row in ws.iter_rows(min_row=2):
        if str(row[0].value or "").strip() == str(pid):
            if "certification_status"   in col_map: row[col_map["certification_status"]   - 1].value = cert_status
            if "jenkins_it_failures"    in col_map: row[col_map["jenkins_it_failures"]    - 1].value = jenkins_count
            if "baseline_it_failures"   in col_map: row[col_map["baseline_it_failures"]   - 1].value = baseline_count
            break
    try:
        wb.save(str(PROJECTS_PATH))
    except PermissionError:
        print("  Warning: Could not save projects.xlsx (file may be open).")


def _fetch_it_failures(build_url: str, auth) -> list:
    """Fetch failed test cases from Jenkins testReport endpoint."""
    try:
        import requests
        url  = build_url.rstrip('/') + "/testReport/api/json?tree=suites[cases[className,name,status]]"
        resp = requests.get(url, auth=auth, timeout=30)
        if resp.status_code == 404:
            return []
        if resp.status_code != 200:
            return []
        failures = []
        for suite in resp.json().get("suites", []):
            for case in suite.get("cases", []):
                if case.get("status") in ("FAILED", "REGRESSION"):
                    failures.append({
                        "className": case.get("className", ""),
                        "name":      case.get("name", ""),
                        "status":    case.get("status", ""),
                    })
        return failures
    except Exception:
        return []


def _save_cert_report(pid, payor_version, jenkins_failures, baseline_failures) -> str:
    """Save <TOOL_ROOT>/projects/<pid>_<payor_version>.xlsx with two sheets."""
    CERT_DIR.mkdir(exist_ok=True)
    out_path = CERT_DIR / f"{pid}_{payor_version}.xlsx"
    wb = openpyxl.Workbook()

    def _write_sheet(ws, failures):
        for i, h in enumerate(["Class Name", "Test Name", "Status"], 1):
            c = ws.cell(1, i, h)
            c.font = HEADER_FONT; c.fill = HEADER_FILL; c.alignment = A_ALIGN
        ws.column_dimensions["A"].width = 70
        ws.column_dimensions["B"].width = 60
        ws.column_dimensions["C"].width = 14
        for f in failures:
            ws.append([f["className"], f["name"], f["status"]])

    ws1 = wb.active
    ws1.title = "Jenkins IT Failures"
    _write_sheet(ws1, jenkins_failures)

    ws2 = wb.create_sheet("IT Failures from Baseline")
    _write_sheet(ws2, baseline_failures)

    ws3 = wb.create_sheet("New Failures")
    _write_sheet(ws3, _new_failures(jenkins_failures, baseline_failures))

    try:
        wb.save(str(out_path))
        return str(out_path)
    except PermissionError:
        return ""


def _key(f):
    return (f.get("className", ""), f.get("name", ""))


def _new_failures(jenkins_failures, baseline_failures) -> list:
    """Jenkins failures (by className + name) that do not also fail in the baseline."""
    base = {_key(f) for f in baseline_failures}
    return [f for f in jenkins_failures if _key(f) not in base]


def _compare(jenkins_failures, baseline_failures) -> str:
    """Return 'Passed' if Jenkins has no failures beyond the baseline's, else 'Failed'."""
    return "Failed" if _new_failures(jenkins_failures, baseline_failures) else "Passed"


def get_cert_details(pid_str: str) -> dict:
    """Stats for a certified project, read from its saved report. Importable by idp_server.py."""
    row = next((r for r in _load_projects() if r.get("pid", "") == str(pid_str)), None)
    if row is None:
        return {"ok": False, "error": f"Project #{pid_str} not found"}
    path = CERT_DIR / f"{pid_str}_{row.get('payor_version', '')}.xlsx"
    if not path.exists():
        return {"ok": False, "error": "No certification report found — run Certify first"}
    wb = openpyxl.load_workbook(str(path), read_only=True)

    def _rows(name):
        if name not in wb.sheetnames:
            return []
        return [{"className": r[0] or "", "name": r[1] or "", "status": r[2] or ""}
                for r in wb[name].iter_rows(min_row=2, values_only=True) if r and (r[0] or r[1])]

    jenkins  = _rows("Jenkins IT Failures")
    baseline = _rows("IT Failures from Baseline")
    new      = _new_failures(jenkins, baseline)
    base_keys = {_key(f) for f in baseline}
    jen_keys  = {_key(f) for f in jenkins}
    return {
        "ok": True, "pid": str(pid_str),
        "certification_status": row.get("certification_status", ""),
        "jenkins_failures":  len(jenkins),
        "baseline_failures": len(baseline),
        "common_failures":   len(jen_keys & base_keys),
        "fixed_vs_baseline": len(base_keys - jen_keys),
        "new_failures":      new,
        "report_path":       str(path),
    }


def certify_project(pid_str: str, auth) -> dict:
    """Core certification logic — importable by idp_server.py."""
    rows = _load_projects()
    row  = next((r for r in rows if r.get("pid", "") == str(pid_str)), None)
    if row is None:
        return {"ok": False, "error": f"Project #{pid_str} not found"}

    build_url     = row.get("build_url", "")
    baseline_url  = row.get("baseline_url", "")
    payor_version = row.get("payor_version", "")

    if not build_url:
        return {"ok": False, "error": "No build_url — build must complete before certifying"}
    if not baseline_url:
        return {"ok": False, "error": "No baseline_url set for this project"}

    jenkins_failures  = _fetch_it_failures(build_url, auth)
    baseline_failures = _fetch_it_failures(baseline_url, auth)

    cert_status = _compare(jenkins_failures, baseline_failures)
    report_path = _save_cert_report(pid_str, payor_version, jenkins_failures, baseline_failures)
    _update_certification_status(pid_str, cert_status, len(jenkins_failures), len(baseline_failures))

    return {
        "ok":                   True,
        "pid":                  pid_str,
        "certification_status": cert_status,
        "jenkins_failures":     len(jenkins_failures),
        "baseline_failures":    len(baseline_failures),
        "report_path":          report_path,
    }


def parse_args():
    argv = sys.argv[1:]
    pid  = None
    i    = 0
    while i < len(argv):
        if argv[i] in ("-h", "--help"):
            print(__doc__); sys.exit(0)
        elif argv[i] in ("-pid", "--pid") and i + 1 < len(argv):
            pid = argv[i + 1]; i += 2
        else:
            i += 1
    return pid


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    pid = parse_args()
    if not pid:
        try:
            pid = input("  Project ID: ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); sys.exit(0)
    if not pid:
        print("  ERROR: project ID is required."); sys.exit(1)

    secrets  = load_secrets()
    username = secrets.get("jenkins_username", "")
    password = secrets.get("jenkins_password", "") or secrets.get("jenkins_api_token", "")
    auth     = (username, password) if username and password else None

    print(f"\n  Certifying project #{pid}...\n")
    result = certify_project(pid, auth)

    if not result["ok"]:
        print(f"  {red('ERROR:')} {result['error']}\n")
        sys.exit(1)

    status = result["certification_status"]
    color  = green if status == "Passed" else red
    print(f"  Certification     : {color(bold(status))}")
    print(f"  Jenkins failures  : {result['jenkins_failures']}")
    print(f"  Baseline failures : {result['baseline_failures']}")
    if result.get("report_path"):
        print(f"  Report saved to   : {grey(result['report_path'])}")
    print()


if __name__ == "__main__":
    main()
