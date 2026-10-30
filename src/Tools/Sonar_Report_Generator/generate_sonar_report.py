#!/usr/bin/env python3
"""
Sonar Report Generator
Pulls SonarQube data for a Pull Request and exports a formatted Excel report.

Usage:
  python generate_sonar_report.py --id com.healthedge.core:core-parent --pullRequest 13123

Credentials are read from the 'Sonar' sheet of secrets.xlsx in the parent directory.
"""

import argparse
import sys
import os
from datetime import datetime
from pathlib import Path
from collections import Counter

try:
    import requests
    import urllib3
except ImportError:
    sys.exit("requests is required: pip install requests")

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
SECRETS_PATH = SCRIPT_DIR.parent / 'secrets.xlsx'
REPORT_DIR   = SCRIPT_DIR / 'Sonar_Report'

# ── Read secrets ──────────────────────────────────────────────────────────────
def read_sonar_secrets(secrets_path: Path):
    wb = openpyxl.load_workbook(str(secrets_path), read_only=True, data_only=True)
    if 'Sonar' not in wb.sheetnames:
        sys.exit(f"No 'Sonar' sheet in {secrets_path}")
    ws = wb['Sonar']
    data = {}
    for row in ws.iter_rows(values_only=True):
        if row and str(row[0] or '').strip().lower() == 'key':      # header row: key | value | notes
            continue
        if row and row[0] and len(row) >= 2 and row[1]:
            data[str(row[0]).strip()] = str(row[1]).strip()
    wb.close()
    base_url = data.get('Base URL', '').rstrip('/')
    login    = data.get('Login', '')
    password = data.get('Password', '')
    token    = data.get('Token', '')
    proxy    = data.get('Proxy', '')
    if not base_url:
        sys.exit("'Base URL' not found in Sonar sheet of secrets.xlsx")
    return base_url, login, password, token, proxy

# ── SonarQube client ──────────────────────────────────────────────────────────
class SonarClient:
    def __init__(self, base_url, login, password, token='', proxy=''):
        self.base_url = base_url
        self.session  = requests.Session()
        self.session.verify = False
        if token:
            self.session.auth = (token, '')
        else:
            self.session.auth = (login, password)
        # Proxy: explicit > system (Windows registry / env vars)
        if proxy:
            self.session.proxies = {'http': proxy, 'https': proxy}
        else:
            import urllib.request as _ur
            sys_proxies = _ur.getproxies()
            if sys_proxies:
                self.session.proxies = sys_proxies

    def get(self, path, params=None):
        url = f"{self.base_url}{path}"
        r = self.session.get(url, params=params, timeout=120, verify=False)
        r.raise_for_status()
        return r.json()

    def quality_gate(self, component, pr):
        return self.get('/api/qualitygates/project_status', {
            'projectKey': component, 'pullRequest': pr,
        })

    def measures(self, component, pr):
        keys = ','.join([
            'alert_status', 'bugs', 'vulnerabilities', 'code_smells',
            'coverage', 'duplicated_lines_density', 'security_hotspots',
            'reliability_rating', 'security_rating', 'sqale_rating',
            'new_bugs', 'new_vulnerabilities', 'new_code_smells',
            'new_coverage', 'new_duplicated_lines_density', 'new_security_hotspots',
            'lines', 'ncloc', 'statements', 'functions', 'classes',
            'comment_lines_density', 'complexity', 'cognitive_complexity',
        ])
        return self.get('/api/measures/component', {
            'component': component, 'pullRequest': pr, 'metricKeys': keys,
        })

    def issues(self, component, pr):
        all_issues = []
        page = 1
        while True:
            data = self.get('/api/issues/search', {
                'componentKeys': component, 'pullRequest': pr,
                'ps': 500, 'p': page,
                'statuses': 'OPEN,CONFIRMED,REOPENED',   # exclude CLOSED/RESOLVED issues
            })
            batch = data.get('issues', [])
            all_issues.extend(batch)
            total = data.get('total', 0)
            if len(all_issues) >= total or not batch:
                break
            page += 1
        return all_issues

    def hotspots(self, component, pr):
        """Open (TO_REVIEW) security hotspots, shaped like issues so they flow through the same report/AI-resolve path.
        issues/search never returns hotspots; they live on /api/hotspots/search."""
        prob_to_sev = {'HIGH': 'CRITICAL', 'MEDIUM': 'MAJOR', 'LOW': 'MINOR'}
        out, page = [], 1
        while True:
            data = self.get('/api/hotspots/search', {
                'projectKey': component, 'pullRequest': pr, 'status': 'TO_REVIEW',
                'ps': 500, 'p': page,
            })
            batch = data.get('hotspots', [])
            for h in batch:
                out.append({
                    'type': 'SECURITY_HOTSPOT',
                    'severity': prob_to_sev.get(h.get('vulnerabilityProbability', ''), 'MAJOR'),
                    'component': h.get('component', ''),
                    'line': h.get('line', ''),
                    'message': h.get('message', ''),
                    'rule': h.get('ruleKey') or h.get('securityCategory', ''),
                    'status': h.get('status', 'TO_REVIEW'),
                    'author': h.get('author', ''),
                    'effort': '',
                })
            total = data.get('paging', {}).get('total', 0)
            if len(out) >= total or not batch:
                break
            page += 1
        return out

    def pull_request_info(self, component, pr):
        try:
            data = self.get('/api/project_pull_requests/list', {'project': component})
            for p in data.get('pullRequests', []):
                if str(p.get('key')) == str(pr):
                    return p
        except Exception:
            pass
        return {}

# ── Excel style helpers ───────────────────────────────────────────────────────
def _fill(hex_color):
    return PatternFill(fill_type='solid', fgColor=hex_color.lstrip('#'))

def _border(color='CCCCCC'):
    s = Side(style='thin', color=color)
    return Border(left=s, right=s, top=s, bottom=s)

def _align(h='center', wrap=False):
    return Alignment(horizontal=h, vertical='center', wrap_text=wrap)

FILLS = {
    'header':    _fill('1565C0'),
    'section':   _fill('E3F2FD'),
    'pass':      _fill('E8F5E9'),
    'fail':      _fill('FFEBEE'),
    'warn':      _fill('FFF3E0'),
    'alt':       _fill('F5F8FF'),
    'white':     _fill('FFFFFF'),
    'title':     _fill('BBDEFB'),
    'sub':       _fill('FAFAFA'),
}

SEV_FILL = {
    'BLOCKER':  ('FFFFFF', 'B71C1C'),
    'CRITICAL': ('FFFFFF', 'C62828'),
    'MAJOR':    ('000000', 'FFE0B2'),
    'MINOR':    ('000000', 'E8F5E9'),
    'INFO':     ('555555', 'F5F5F5'),
}

TYPE_LABEL = {
    'BUG':               'Bug',
    'VULNERABILITY':     'Vulnerability',
    'CODE_SMELL':        'Code Smell',
    'SECURITY_HOTSPOT':  'Hotspot',
}

RATING = {'1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E'}

def write_header_row(ws, headers, row=1, height=22):
    for ci, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=ci, value=h)
        c.font      = Font(bold=True, color='FFFFFF', size=10)
        c.fill      = FILLS['header']
        c.alignment = _align('center')
        c.border    = _border()
    ws.row_dimensions[row].height = height

def write_section_title(ws, title, row, span_cols=6, height=20):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span_cols)
    c = ws.cell(row=row, column=1, value=title)
    c.font      = Font(bold=True, size=11, color='FFFFFF')
    c.fill      = FILLS['header']
    c.alignment = _align('left')
    ws.row_dimensions[row].height = height

# ── Summary sheet ─────────────────────────────────────────────────────────────
def build_summary(wb, component, pr, qg_data, measures_data, pr_info):
    ws = wb.active
    ws.title = 'Summary'
    ws.sheet_view.showGridLines = False

    raw_measures = measures_data.get('component', {}).get('measures', [])
    mmap = {m['metric']: m for m in raw_measures}

    def mv(key, fmt=None):
        m = mmap.get(key)
        if not m:
            return '—'
        periods = m.get('periods', [])
        val = periods[0].get('value', m.get('value', '—')) if periods else m.get('value', '—')
        if val is None or val == '':
            return '—'
        if fmt == 'pct' and val != '—':
            try:
                return f"{float(val):.1f}%"
            except Exception:
                return val
        if fmt == 'rating':
            return RATING.get(str(val), str(val))
        return str(val)

    qg      = qg_data.get('projectStatus', {})
    qg_stat = qg.get('status', 'NONE')

    COLS = 6
    r = 1

    # Title
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=COLS)
    c = ws.cell(row=r, column=1, value='SonarQube Pull Request Analysis Report')
    c.font = Font(bold=True, size=14, color='0D47A1')
    c.fill = FILLS['title']
    c.alignment = _align('center')
    ws.row_dimensions[r].height = 30
    r += 1

    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=COLS)
    c = ws.cell(row=r, column=1,
        value=f'Component: {component}   |   Pull Request: #{pr}   |   Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    c.font = Font(size=10, color='546E7A')
    c.fill = FILLS['sub']
    c.alignment = _align('center')
    ws.row_dimensions[r].height = 16
    r += 2  # blank row

    # ── Quality Gate ──────────────────────────────────────────────────────────
    write_section_title(ws, '  ⚙  QUALITY GATE', r, COLS)
    r += 1

    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=COLS)
    qg_label = '✅   PASSED' if qg_stat == 'OK' else ('❌   FAILED' if qg_stat == 'ERROR' else f'⚠   {qg_stat}')
    c = ws.cell(row=r, column=1, value=qg_label)
    c.font = Font(bold=True, size=14, color='1B5E20' if qg_stat == 'OK' else 'B71C1C')
    c.fill = FILLS['pass'] if qg_stat == 'OK' else FILLS['fail']
    c.alignment = _align('center')
    ws.row_dimensions[r].height = 28
    r += 1

    conditions = qg.get('conditions', [])
    if conditions:
        write_header_row(ws, ['Metric', 'Status', 'Actual', 'Threshold', 'Comparator', 'Level'], row=r)
        r += 1
        for cond in conditions:
            st = cond.get('status', '')
            fill = FILLS['pass'] if st == 'OK' else (FILLS['fail'] if st == 'ERROR' else FILLS['warn'])
            row_vals = [
                cond.get('metricKey', ''),
                '✅ OK' if st == 'OK' else ('❌ FAIL' if st == 'ERROR' else f'⚠ {st}'),
                cond.get('actualValue', ''),
                cond.get('errorThreshold', cond.get('warningThreshold', '')),
                cond.get('comparator', ''),
                cond.get('level', ''),
            ]
            for ci, v in enumerate(row_vals, 1):
                c = ws.cell(row=r, column=ci, value=v)
                c.fill = fill
                c.alignment = _align('center')
                c.border = _border()
            ws.row_dimensions[r].height = 16
            r += 1

    r += 1  # spacer

    # ── Key Metrics ───────────────────────────────────────────────────────────
    write_section_title(ws, '  📊  KEY METRICS', r, COLS)
    r += 1

    write_header_row(ws, ['Metric', 'Overall', 'New Code', 'Metric', 'Overall', 'New Code'], row=r)
    r += 1

    metric_rows = [
        ('🐛  Bugs',              mv('bugs'),                    mv('new_bugs'),
         '🔐  Vulnerabilities',   mv('vulnerabilities'),          mv('new_vulnerabilities')),
        ('🔧  Code Smells',       mv('code_smells'),             mv('new_code_smells'),
         '🔥  Security Hotspots', mv('security_hotspots'),       mv('new_security_hotspots')),
        ('📈  Coverage',          mv('coverage', 'pct'),         mv('new_coverage', 'pct'),
         '📋  Duplicated Lines',  mv('duplicated_lines_density', 'pct'), mv('new_duplicated_lines_density', 'pct')),
        ('🛡  Reliability',       mv('reliability_rating', 'rating'), '',
         '🔒  Security',          mv('security_rating', 'rating'),    ''),
        ('🧹  Maintainability',   mv('sqale_rating', 'rating'),  '',
         '📏  Lines of Code',     mv('ncloc'),                   mv('lines')),
    ]

    for i, row_vals in enumerate(metric_rows):
        bg = FILLS['alt'] if i % 2 == 0 else FILLS['white']
        l_key, l_ov, l_new, r_key, r_ov, r_new = row_vals
        for ci, (v, is_label) in enumerate([(l_key, True), (l_ov, False), (l_new, False),
                                             (r_key, True), (r_ov, False), (r_new, False)], 1):
            c = ws.cell(row=r, column=ci, value=v)
            c.fill      = FILLS['section'] if is_label else bg
            c.border    = _border()
            c.alignment = _align('left' if is_label else 'center')
            if is_label:
                c.font = Font(bold=True, size=10)
            else:
                c.font = Font(bold=True, size=11, color='1565C0')
        ws.row_dimensions[r].height = 20
        r += 1

    r += 1  # spacer

    # ── PR Info ───────────────────────────────────────────────────────────────
    if pr_info:
        write_section_title(ws, '  🔀  PULL REQUEST INFO', r, COLS)
        r += 1

        def safe(v):
            if isinstance(v, dict):
                return v.get('name', str(v))
            return str(v) if v else '—'

        info_rows = [
            ('Title',         safe(pr_info.get('title'))),
            ('Branch',        safe((pr_info.get('branch', {}) or {}).get('name') if isinstance(pr_info.get('branch'), dict) else pr_info.get('branch') or pr_info.get('branchLong'))),
            ('Base Branch',   safe(pr_info.get('base'))),
            ('Author',        safe(pr_info.get('author'))),
            ('Analysis Date', safe(pr_info.get('analysisDate'))),
            ('QG Status',     safe(pr_info.get('status', {}).get('qualityGateStatus') if isinstance(pr_info.get('status'), dict) else pr_info.get('status'))),
        ]
        for k, v in info_rows:
            c = ws.cell(row=r, column=1, value=k)
            c.font = Font(bold=True, size=10)
            c.fill = FILLS['section']
            c.border = _border()
            c.alignment = _align('left')
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=COLS)
            c2 = ws.cell(row=r, column=2, value=v)
            c2.alignment = _align('left', wrap=True)
            c2.border = _border()
            ws.row_dimensions[r].height = 18
            r += 1

    # ── Issue Summary ─────────────────────────────────────────────────────────
    # (populated externally after issues are fetched)
    ws._sonar_summary_next_row = r

    # Column widths
    ws.column_dimensions['A'].width = 28
    ws.column_dimensions['B'].width = 16
    ws.column_dimensions['C'].width = 14
    ws.column_dimensions['D'].width = 28
    ws.column_dimensions['E'].width = 16
    ws.column_dimensions['F'].width = 14
    ws.freeze_panes = 'A3'

def add_issue_summary(wb, issues):
    ws = wb['Summary']
    r = getattr(ws, '_sonar_summary_next_row', ws.max_row + 2)
    r += 1

    COLS = 6
    write_section_title(ws, '  🐞  ISSUE SUMMARY', r, COLS)
    r += 1

    sev_order  = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']
    type_order = ['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT']

    sev_counts  = Counter(i.get('severity', 'INFO') for i in issues)
    type_counts = Counter(i.get('type', '') for i in issues)

    write_header_row(ws, ['By Severity', 'Count', '', 'By Type', 'Count', ''], row=r)
    r += 1

    max_rows = max(len(sev_order), len(type_order))
    for i in range(max_rows):
        # left — severity
        if i < len(sev_order):
            sev = sev_order[i]
            cnt = sev_counts.get(sev, 0)
            txt_c, bg_c = SEV_FILL.get(sev, ('000000', 'FFFFFF'))
            c1 = ws.cell(row=r, column=1, value=sev)
            c1.fill = _fill(bg_c)
            c1.font = Font(bold=True, color=txt_c, size=10)
            c1.alignment = _align('center')
            c1.border = _border()
            c2 = ws.cell(row=r, column=2, value=cnt)
            c2.fill = _fill(bg_c)
            c2.font = Font(bold=True, size=11, color=txt_c)
            c2.alignment = _align('center')
            c2.border = _border()
        # right — type
        if i < len(type_order):
            tp  = type_order[i]
            cnt = type_counts.get(tp, 0)
            c4 = ws.cell(row=r, column=4, value=TYPE_LABEL.get(tp, tp))
            c4.fill = FILLS['section']
            c4.font = Font(bold=True, size=10)
            c4.alignment = _align('center')
            c4.border = _border()
            c5 = ws.cell(row=r, column=5, value=cnt)
            c5.fill = FILLS['section']
            c5.font = Font(bold=True, size=11, color='1565C0')
            c5.alignment = _align('center')
            c5.border = _border()
        ws.row_dimensions[r].height = 18
        r += 1

# ── Issues sheet ──────────────────────────────────────────────────────────────
def build_issues(wb, issues):
    ws = wb.create_sheet('Issues')
    ws.sheet_view.showGridLines = False

    headers = ['#', 'Type', 'Severity', 'File / Component', 'Line', 'Message', 'Rule', 'Status', 'Author', 'Effort']
    write_header_row(ws, headers)
    ws.freeze_panes = 'A2'

    sev_order = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']
    sorted_issues = sorted(
        issues,
        key=lambda x: (
            sev_order.index(x.get('severity', 'INFO')) if x.get('severity') in sev_order else 99,
            x.get('component', ''),
            int(x.get('line') or 0),
        )
    )

    for ri, issue in enumerate(sorted_issues, 2):
        sev   = issue.get('severity', 'INFO')
        txt_c, bg_c = SEV_FILL.get(sev, ('000000', 'FFFFFF'))
        fill  = _fill(bg_c)

        component = issue.get('component', '')
        short_comp = component.split(':')[-1] if ':' in component else component

        vals = [
            ri - 1,
            TYPE_LABEL.get(issue.get('type', ''), issue.get('type', '')),
            sev,
            short_comp,
            issue.get('line', ''),
            issue.get('message', ''),
            issue.get('rule', ''),
            issue.get('status', ''),
            issue.get('author', ''),
            issue.get('effort', ''),
        ]
        for ci, v in enumerate(vals, 1):
            c = ws.cell(row=ri, column=ci, value=v)
            c.fill   = fill
            c.border = _border()
            if ci == 3:
                c.font      = Font(bold=True, color=txt_c, size=10)
                c.alignment = _align('center')
            elif ci == 6:
                c.alignment = _align('left', wrap=True)
                c.font      = Font(color=txt_c, size=10)
            elif ci in (4, 5):
                c.alignment = _align('left')
                c.font      = Font(color=txt_c, size=10)
            else:
                c.alignment = _align('center')
                c.font      = Font(color=txt_c, size=10)
        ws.row_dimensions[ri].height = 16

    col_widths = [5, 14, 11, 50, 7, 80, 35, 12, 22, 8]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

# ── Metrics detail sheet ──────────────────────────────────────────────────────
def build_metrics(wb, measures_data):
    ws = wb.create_sheet('Metrics')
    ws.sheet_view.showGridLines = False

    write_header_row(ws, ['Metric Key', 'Value', 'Best Value', 'New Code Value', 'Best Value (New)'])
    ws.freeze_panes = 'A2'

    measures = sorted(
        measures_data.get('component', {}).get('measures', []),
        key=lambda x: x['metric']
    )

    for ri, m in enumerate(measures, 2):
        periods = m.get('periods', [])
        p_val   = periods[0].get('value', '') if periods else ''
        p_best  = periods[0].get('bestValue', '') if periods else ''
        fill = FILLS['alt'] if ri % 2 == 0 else FILLS['white']
        vals = [m['metric'], m.get('value', ''), str(m.get('bestValue', '')), p_val, str(p_best)]
        for ci, v in enumerate(vals, 1):
            c = ws.cell(row=ri, column=ci, value=v)
            c.fill      = fill
            c.border    = _border()
            c.alignment = _align('left' if ci == 1 else 'center')
            if ci == 1:
                c.font = Font(size=10, color='37474F')
            else:
                c.font = Font(size=10, color='1565C0' if v and v not in ('', 'False', 'None') else '9E9E9E')
        ws.row_dimensions[ri].height = 15

    ws.column_dimensions['A'].width = 42
    ws.column_dimensions['B'].width = 14
    ws.column_dimensions['C'].width = 14
    ws.column_dimensions['D'].width = 16
    ws.column_dimensions['E'].width = 16

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description='Generate a SonarQube Pull Request report as Excel',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate_sonar_report.py --id com.healthedge.core:core-parent --pullRequest 13123
  python generate_sonar_report.py --id com.healthedge.core%3Acore-parent --pullRequest 20
        """
    )
    parser.add_argument('--id',          required=True, metavar='COMPONENT_KEY',
                        help='SonarQube component key, e.g. com.healthedge.core:core-parent')
    parser.add_argument('--pullRequest', required=True, metavar='PR_NUMBER',
                        help='Pull request number, e.g. 13123')
    parser.add_argument('--secrets',     default=str(SECRETS_PATH), metavar='PATH',
                        help=f'Path to secrets.xlsx (default: {SECRETS_PATH})')
    parser.add_argument('--json', action='store_true',
                        help='Print SONAR_JSON:<json> line to stdout for machine parsing')
    args = parser.parse_args()

    component = args.id.replace('%3A', ':').replace('%3a', ':')
    pr        = str(args.pullRequest)
    secrets   = Path(args.secrets)

    if not secrets.exists():
        sys.exit(f"secrets.xlsx not found: {secrets}")

    print(f"[1/5] Reading credentials from {secrets}")
    base_url, login, password, token, proxy = read_sonar_secrets(secrets)
    print(f"      Base URL : {base_url}")
    print(f"      Login    : {login}")

    client = SonarClient(base_url, login, password, token, proxy)

    print(f"[2/5] Quality gate  — {component}  PR#{pr}")
    qg_data = client.quality_gate(component, pr)
    qg_stat = qg_data.get('projectStatus', {}).get('status', 'UNKNOWN')
    print(f"      Status: {qg_stat}")

    print(f"[3/5] Measures")
    measures_data = client.measures(component, pr)
    print(f"      Metrics fetched: {len(measures_data.get('component', {}).get('measures', []))}")

    print(f"[4/5] Issues")
    issues = client.issues(component, pr)
    try:
        hotspots = client.hotspots(component, pr)
    except Exception as e:
        hotspots = []
        print(f"      WARNING: could not fetch security hotspots: {e}")
    print(f"      Security hotspots (to review): {len(hotspots)}")
    issues = issues + hotspots
    sev_cnt = Counter(i.get('severity') for i in issues)
    print(f"      Total: {len(issues)}  "
          f"  BLOCKER:{sev_cnt.get('BLOCKER',0)}"
          f"  CRITICAL:{sev_cnt.get('CRITICAL',0)}"
          f"  MAJOR:{sev_cnt.get('MAJOR',0)}"
          f"  MINOR:{sev_cnt.get('MINOR',0)}"
          f"  INFO:{sev_cnt.get('INFO',0)}")

    print(f"[5/5] PR info")
    pr_info = client.pull_request_info(component, pr)
    if pr_info:
        print(f"      Title : {pr_info.get('title', '—')}")
        print(f"      Branch: {pr_info.get('branch', {}).get('name', '—') if isinstance(pr_info.get('branch'), dict) else pr_info.get('branchLong', '—')}")

    # ── Build workbook ────────────────────────────────────────────────────────
    print("\nBuilding Excel report…")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORT_DIR / f'{pr}_Sonar_Report.xlsx'

    wb = openpyxl.Workbook()
    build_summary(wb, component, pr, qg_data, measures_data, pr_info)
    add_issue_summary(wb, issues)
    build_issues(wb, issues)
    build_metrics(wb, measures_data)

    wb.save(str(out_path))

    print(f"\n{'='*60}")
    print(f"  Report : {out_path}")
    print(f"  QG     : {qg_stat}")
    print(f"  Issues : {len(issues)}")
    print(f"  Sheets : Summary | Issues | Metrics")
    print(f"{'='*60}")

    if args.json:
        import json as _json
        print("SONAR_JSON:" + _json.dumps({
            "ok":           True,
            "file":         out_path.name,
            "qg_status":    qg_stat,
            "total_issues": len(issues),
            "blocker":      sev_cnt.get("BLOCKER", 0),
            "critical":     sev_cnt.get("CRITICAL", 0),
            "major":        sev_cnt.get("MAJOR", 0),
            "minor":        sev_cnt.get("MINOR", 0),
            "info":         sev_cnt.get("INFO", 0),
        }))

if __name__ == '__main__':
    main()
