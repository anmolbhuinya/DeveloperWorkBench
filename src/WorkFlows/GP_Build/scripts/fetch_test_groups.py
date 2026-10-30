#!/usr/bin/env python3
"""
Parses INTEG_TEST_GROUP_CATEGORY and INTEG_TEST_GROUP choices from the
Jenkins job config XML and writes them to gp_job_config.xlsx:

  Sheet "INTEG_TEST_GROUP_CATEGORY":
    Column A — category name
    Column B — all test groups for that category (comma-separated)

Also updates BuildParameters defaults:
  INTEG_TEST_GROUP_CATEGORY → Platform
  INTEG_TEST_GROUP          → all Platform groups comma-separated
"""

import os, re, html, sys, requests, openpyxl
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
BOLD        = Font(bold=True)
DEFAULT_CAT = "Platform"


# ---------------------------------------------------------------------------
# Config
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


# ---------------------------------------------------------------------------
# Jenkins / XML helpers
# ---------------------------------------------------------------------------

def fetch_config_xml(job_url, auth):
    r = http.get(f"{job_url}/config.xml", auth=auth, timeout=20)
    r.raise_for_status()
    return r.text


def extract_script(xml, param_name):
    idx = xml.find(f"<name>{param_name}</name>")
    if idx < 0:
        return ""
    chunk = xml[idx: idx + 60000]
    m = re.search(r"<secureScript[^>]*>.*?<script>(.*?)</script>", chunk, re.DOTALL)
    return html.unescape(m.group(1)) if m else ""


def parse_categories(cat_script):
    """Return list of category names (without :selected suffix)."""
    cats = re.findall(r"'([^']+)'", cat_script)
    result = []
    for c in cats:
        name = c.replace(":selected", "").strip()
        if name and name != "Select Test Group Category":
            result.append(name)
    return result


def parse_groups_for_categories(grp_script, categories):
    """
    Returns dict: category → [group, group, ...]
    Parses blocks like:
      if (INTEG_TEST_GROUP_CATEGORY.contains("Cat")) {
          options += ['g1:selected', 'g2', ...]
      }
    """
    mapping = {}

    # Find all contains(...) blocks
    blocks = re.findall(
        r'contains\("([^"]+)"\)\s*\)\s*\{(.*?)\}',
        grp_script, re.DOTALL
    )
    # Also handle single-condition: if (X.contains("Cat")) {
    blocks += re.findall(
        r'contains\("([^"]+)"\)\s*\{(.*?)\}',
        grp_script, re.DOTALL
    )

    for cat, block in blocks:
        cat = cat.strip()
        groups = [g.replace(":selected", "").strip()
                  for g in re.findall(r"'([^']+)'", block)]
        groups = [g for g in groups if g]
        if cat in mapping:
            mapping[cat] = list(dict.fromkeys(mapping[cat] + groups))
        else:
            mapping[cat] = groups

    # Fill in any categories that had no match
    for cat in categories:
        if cat not in mapping:
            mapping[cat] = []

    return mapping


# ---------------------------------------------------------------------------
# Write to gp_job_config.xlsx
# ---------------------------------------------------------------------------

def write_category_sheet(mapping, categories, gp_params_path=None):
    if gp_params_path is None:
        gp_params_path = GP_PARAMS_PATH
    os.makedirs(os.path.dirname(gp_params_path), exist_ok=True)
    if os.path.exists(gp_params_path):
        wb = openpyxl.load_workbook(gp_params_path)
    else:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)

    sheet_name = "INTEG_TEST_GROUP_CATEGORY"
    if sheet_name in wb.sheetnames:
        del wb[sheet_name]
    ws = wb.create_sheet(sheet_name)

    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 120

    for col, title in enumerate(("category", "integ_test_groups (comma-separated)"), start=1):
        cell = ws.cell(1, col, title)
        cell.font      = HEADER_FONT
        cell.fill      = HEADER_FILL
        cell.alignment = Alignment(horizontal="center")

    for cat in categories:
        if cat == "Select Test Group Category":
            continue
        row = ws.max_row + 1
        groups_str = ",".join(mapping.get(cat, []))

        name_cell = ws.cell(row, 1, cat)
        name_cell.font = Font(
            bold=True,
            color="1F497D" if cat == DEFAULT_CAT else "000000"
        )

        grp_cell = ws.cell(row, 2, groups_str)
        grp_cell.alignment = Alignment(wrap_text=False)
        if cat == DEFAULT_CAT:
            grp_cell.font = Font(color="1F497D")

    wb.save(gp_params_path)
    print(f"  Sheet '{sheet_name}' written ({len(categories)} categories).")


def update_build_params_defaults(platform_groups_str, gp_params_path=None):
    """Set default values for INTEG_TEST_GROUP_CATEGORY and INTEG_TEST_GROUP."""
    if gp_params_path is None:
        gp_params_path = GP_PARAMS_PATH
    if not os.path.exists(gp_params_path):
        print(f"  Warning: {os.path.basename(gp_params_path)} not found — run fetch_build_params.py first.")
        return

    wb = openpyxl.load_workbook(gp_params_path)

    if "BuildParameters" not in wb.sheetnames:
        print(f"  Warning: BuildParameters sheet not found in {os.path.basename(gp_params_path)} — skipping default update.")
        wb.save(gp_params_path)
        return

    ws = wb["BuildParameters"]
    for row in ws.iter_rows(min_row=2):
        name = row[0].value
        if name == "INTEG_TEST_GROUP_CATEGORY":
            row[1].value = DEFAULT_CAT
        elif name == "INTEG_TEST_GROUP":
            row[1].value = platform_groups_str

    wb.save(gp_params_path)
    print(f"  BuildParameters defaults updated:")
    print(f"    INTEG_TEST_GROUP_CATEGORY = {DEFAULT_CAT}")
    print(f"    INTEG_TEST_GROUP          = (all {DEFAULT_CAT} groups, comma-separated)")


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

    settings = load_settings(app_name)
    secrets  = load_secrets()
    job_url  = settings.get("url", "").rstrip("/")
    base_url = "/".join(job_url.split("/")[:3]) if job_url else ""

    resolved_app   = app_name or settings.get("application", "Payor")
    gp_params_path = _gp_params_path_for_app(resolved_app)

    username = secrets.get("jenkins_username") or settings.get("jenkins_username", "")
    token    = secrets.get("jenkins_api_token") or settings.get("jenkins_api_token", "")
    password = secrets.get("jenkins_password") or settings.get("jenkins_password", "")
    auth     = (username, token if token else password)

    print(f"Fetching job config from:\n  {job_url}\n")

    try:
        xml = fetch_config_xml(job_url, auth)
    except requests.exceptions.HTTPError as e:
        print(jenkins_error(e.response.status_code, base_url=base_url, username=username))
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print(connection_error("Jenkins"))
        sys.exit(1)

    print("Parsing INTEG_TEST_GROUP_CATEGORY choices...")
    cat_script  = extract_script(xml, "INTEG_TEST_GROUP_CATEGORY")
    categories  = parse_categories(cat_script)
    print(f"  Found {len(categories)} categories.")

    print("Parsing INTEG_TEST_GROUP mapping...")
    grp_script  = extract_script(xml, "INTEG_TEST_GROUP")
    mapping     = parse_groups_for_categories(grp_script, categories)

    platform_groups = mapping.get(DEFAULT_CAT, [])
    print(f"  '{DEFAULT_CAT}' has {len(platform_groups)} test groups.")

    slug = os.path.basename(gp_params_path)
    print(f"\nWriting to gp_params/{slug}...")
    write_category_sheet(mapping, categories, gp_params_path)
    update_build_params_defaults(",".join(platform_groups), gp_params_path)

    print("\nDone.")
    print(f"  Open gp_params/{slug} -> INTEG_TEST_GROUP_CATEGORY to see all categories and groups.")
    print(f"  Platform groups are pre-filled as the default for INTEG_TEST_GROUP in BuildParameters.")


if __name__ == "__main__":
    main()
