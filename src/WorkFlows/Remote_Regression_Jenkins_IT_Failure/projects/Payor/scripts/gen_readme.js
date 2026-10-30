// ============================================================
// gen_readme.js — Generate ReadMe.docx for the Payor/ folder
//
// USAGE:  node gen_readme.js
// OUTPUT: ../ReadMe.docx  (Payor/ folder)
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const NM = '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, TableBorders,
  ShadingType, VerticalAlign, UnderlineType, convertInchesToTwip,
} = require(path.join(NM, 'docx'));

const OUT = path.join(__dirname, '..', 'ReadMe.docx');

// ── Colour palette ─────────────────────────────────────────
const C = {
  navy:       '1F3864',
  teal:       '1F7A8C',
  tealLight:  'D6EEF2',
  gold:       'C9A227',
  goldLight:  'FFF8E1',
  green:      '1E6B3C',
  greenLight: 'E8F5E9',
  purple:     '5B2C8D',
  purpleLight:'F0EAF8',
  grey:       'F2F4F6',
  greyMid:    'D0D7DE',
  greyDark:   '5A6370',
  white:      'FFFFFF',
  black:      '000000',
  code:       '2E4057',
  codeBg:     'F0F0F0',
};

// ── Typography helpers ────────────────────────────────────
function run(text, opts) {
  opts = opts || {};
  return new TextRun({
    text,
    font:    'Calibri',
    size:    opts.size    || 22,
    bold:    opts.bold    || false,
    italics: opts.italics || false,
    color:   opts.color   || C.black,
    underline: opts.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function code(text) {
  return new TextRun({ text, font: 'Courier New', size: 20, color: C.code,
    shading: { type: ShadingType.CLEAR, fill: C.codeBg } });
}

function blank(spaceAfter) {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    spacing: { after: spaceAfter || 60 },
  });
}

function titlePara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 52, bold: true,
      color: C.white, characterSpacing: 20 })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.navy },
    spacing: { before: 200, after: 0 },
    alignment: AlignmentType.CENTER,
    indent: { left: convertInchesToTwip(0.3), right: convertInchesToTwip(0.3) },
  });
}

function subtitlePara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 24, color: C.tealLight, italics: true })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.navy },
    spacing: { before: 0, after: 300 },
    alignment: AlignmentType.CENTER,
  });
}

function h1(text, fill) {
  fill = fill || C.teal;
  return new Paragraph({
    children: [new TextRun({ text: '  ' + text, font: 'Calibri', size: 30,
      bold: true, color: C.white })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    spacing: { before: 320, after: 160 },
    border: { left: { style: BorderStyle.THICK, size: 24, color: C.gold } },
  });
}

function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 24, bold: true, color: C.navy })],
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.teal } },
  });
}

function bodyPara(runs, spacing) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [run(runs)],
    spacing: { after: spacing || 80, line: 276 },
  });
}

function bullet(text) {
  return new Paragraph({
    children: [run(text)],
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

function thinBorders() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0' };
  return new TableBorders({ top: b, bottom: b, left: b, right: b, insideH: b, insideV: b });
}

function hCell(text, fill, w) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Calibri', size: 20, bold: true, color: C.white })],
      spacing: { before: 80, after: 80 },
      indent: { left: convertInchesToTwip(0.1) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.navy },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: w, type: WidthType.PERCENTAGE },
  });
}

function tCell(text, fill, w, opts) {
  opts = opts || {};
  return new TableCell({
    children: [new Paragraph({
      children: [opts.isCode
        ? new TextRun({ text, font: 'Courier New', size: 20, bold: opts.bold || false, color: C.navy })
        : new TextRun({ text, font: 'Calibri', size: 20, bold: opts.bold || false, color: opts.color || C.black })],
      spacing: { before: 80, after: 80 },
      indent: { left: convertInchesToTwip(0.1) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.white },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: w, type: WidthType.PERCENTAGE },
  });
}

function simpleTable(headers, rows, widths, accentFill) {
  accentFill = accentFill || C.navy;
  return new Table({
    rows: [
      new TableRow({
        children: headers.map(function(h, i) { return hCell(h, accentFill, widths[i]); }),
        tableHeader: true,
      }),
      ...rows.map(function(r, ri) {
        const fill = ri % 2 === 0 ? C.grey : C.white;
        return new TableRow({
          children: r.map(function(cell, i) {
            if (typeof cell === 'object') {
              return tCell(cell.text, fill, widths[i], cell);
            }
            return tCell(cell, fill, widths[i]);
          }),
        });
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
  });
}

function callout(icon, label, lines, fill, borderColor) {
  fill        = fill        || C.goldLight;
  borderColor = borderColor || C.gold;
  return lines.flatMap(function(line, i) {
    return [new Paragraph({
      children: [
        ...(i === 0 ? [
          new TextRun({ text: icon + '  ', font: 'Calibri', size: 22, bold: true, color: borderColor }),
          new TextRun({ text: label + '  ', font: 'Calibri', size: 22, bold: true, color: borderColor }),
        ] : []),
        new TextRun({ text: line, font: 'Calibri', size: 20, color: C.black }),
      ],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill },
      spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0, line: 276 },
      indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
      border: i === 0
        ? { top:   { style: BorderStyle.SINGLE, size: 4, color: borderColor },
            left:  { style: BorderStyle.THICK,  size: 16, color: borderColor },
            right: { style: BorderStyle.SINGLE, size: 4, color: borderColor } }
        : i === lines.length - 1
        ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
            left:   { style: BorderStyle.THICK,  size: 16, color: borderColor },
            right:  { style: BorderStyle.SINGLE, size: 4, color: borderColor } }
        : { left:  { style: BorderStyle.THICK,  size: 16, color: borderColor },
            right: { style: BorderStyle.SINGLE, size: 4, color: borderColor } },
    })];
  });
}

function codeBlock(lines) {
  return lines.map(function(line, i) {
    return new Paragraph({
      children: [new TextRun({ text: line, font: 'Courier New', size: 20, color: C.code })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.codeBg },
      spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0 },
      indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
      border: i === 0
        ? { top:  { style: BorderStyle.SINGLE, size: 4, color: C.greyMid },
            left: { style: BorderStyle.SINGLE, size: 4, color: C.greyMid },
            right:{ style: BorderStyle.SINGLE, size: 4, color: C.greyMid } }
        : i === lines.length - 1
        ? { bottom:{ style: BorderStyle.SINGLE, size: 4, color: C.greyMid },
            left:  { style: BorderStyle.SINGLE, size: 4, color: C.greyMid },
            right: { style: BorderStyle.SINGLE, size: 4, color: C.greyMid } }
        : { left:  { style: BorderStyle.SINGLE, size: 4, color: C.greyMid },
            right: { style: BorderStyle.SINGLE, size: 4, color: C.greyMid } },
    });
  });
}

function divider() {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' } },
    spacing: { before: 120, after: 120 },
  });
}

// ── Document content ─────────────────────────────────────
function buildDoc() {
  const ch = [];

  // Cover
  ch.push(titlePara('Payor IT Failure Remote Regression'));
  ch.push(subtitlePara('Workflow Guide  —  Jenkins IT_Failure_Remote_Regression / Payor'));
  ch.push(blank(120));

  // ── Overview ─────────────────────────────────────────────
  ch.push(h1('Overview', C.navy));
  ch.push(bodyPara([
    run('This workflow automates the full Payor regression analysis cycle for each release — from fetching Jenkins IT failures, through running integration tests on a remote server, to generating a formatted regression email draft. '),
    run('Everything runs from the command line; no manual steps are needed.', { bold: true }),
  ]));
  ch.push(blank(60));
  ch.push(simpleTable(
    ['Stage', 'Command', 'Action', 'Output'],
    [
      ['0 — Baseline', { text: 'rpb', isCode: true }, 'Fetch baseline Jenkins failures → baseline Excel', 'baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx'],
      ['Step 1', { text: 'rprt', isCode: true }, 'Fetch failures from Jenkins API', 'Jenkins_Payor_IT_Failures_Local_<version>.xlsx'],
      ['Step 2', { text: 'rprt', isCode: true }, 'SSH into remote server and run IT classes', 'it_results_raw_<version>.txt'],
      ['Step 3', { text: 'rprt', isCode: true }, 'Update Excel with Local + Baseline results', 'Excel updated in-place'],
      ['Step 4', { text: 'rprt', isCode: true }, 'Generate regression email draft', 'Regression_Email_<version>.docx'],
      ['Rerun',  { text: 'rerun_its.js', isCode: true }, 'Re-run selected / failed / all ITs', 'Excel updated in-place'],
    ],
    [14, 16, 42, 28]
  ));
  ch.push(blank());

  // ── Prerequisites ─────────────────────────────────────────
  ch.push(h1('Prerequisites', C.teal));
  ch.push(simpleTable(
    ['Requirement', 'Details'],
    [
      ['Node.js v16+', 'Must be installed on the local machine'],
      ['npm packages', 'xlsx, docx — path in config.xlsx → General → nodeModules'],
      ['sshpass', 'Required for password-based SSH (Step 2). Must be in Git Bash / WSL PATH.'],
      ['Jenkins network', 'VPN or office network access to engsvc-engjen1.headquarters.healthedge.com:8080'],
      ['Remote server', 'SSH access to the VM selected when creating the project (stored in per-project xlsx → remote_server sheet)'],
      ['Remote repo', 'Branch already compiled; repo path resolved at runtime via tosrc on the VM'],
      ['Baseline file', 'baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx — optional; run rpb to populate it'],
    ],
    [24, 76], C.teal
  ));
  ch.push(blank());

  // ── Folder Structure ──────────────────────────────────────
  ch.push(h1('Folder Structure', C.teal));
  ch.push(...codeBlock([
    'Remote_Regression_Jenkins_IT_Failure/',
    '└── Payor/',
    '    ├── config.xlsx                         ← Edit each release (5 tabs)',
    '    ├── Regression_Email_Format_V2.docx     ← Email section format reference',
    '    ├── ReadMe.docx                         ← This document',
    '    ├── baseline/',
    '    │   └── Baseline_Jenkins_IT_Status.xlsx ← Baseline IT status (run rpb to populate)',
    '    ├── scripts/',
    '    │   ├── config.js                       ← Reads config.xlsx (do not edit)',
    '    │   ├── utils.js                        ← Shared helpers',
    '    │   ├── create_config_xlsx.js           ← One-time: generate config.xlsx',
    '    │   ├── gen_readme.js                   ← Regenerate this document',
    '    │   ├── populate_baseline.js            ← Fetch baseline Jenkins failures',
    '    │   ├── step1_fetch_jenkins_failures.js',
    '    │   ├── step2_run_remote_its.js',
    '    │   ├── step3_update_excel.js',
    '    │   ├── step4_generate_email.js',
    '    │   ├── run_all.js                      ← Runs all 4 steps end-to-end',
    '    │   ├── rerun_its.js                    ← Reruns selected / failed / all ITs',
    '    │   └── known_failures.json             ← (optional) pre-known failures',
    '    └── <output>/                           ← Defaults to cwd; override in config.xlsx',
    '        ├── Jenkins_Payor_IT_Failures_Local_<version>.xlsx',
    '        ├── it_results_raw_<version>.txt',
    '        └── Regression_Email_<version>.docx',
  ]));
  ch.push(blank());

  // ── Configuration ─────────────────────────────────────────
  ch.push(h1('Configuration — config.xlsx', C.navy));
  ch.push(bodyPara([
    run('All configuration lives in '),
    code('config.xlsx'),
    run(' — never in .js files. Each tab has a '),
    run('Default Value', { bold: true }),
    run(' column (pre-filled) and an '),
    run('Overridden Value', { bold: true }),
    run(' column (blank). Fill Overridden Value for anything you want to change; leave blank to keep the default.'),
  ]));
  ch.push(blank(60));

  ch.push(h2('General Tab'));
  ch.push(simpleTable(
    ['Key', 'Default Value', 'What to Change'],
    [
      [{ text: 'version',       isCode: true }, '26.1.5',                              'New release version, e.g. 26.1.6'],
      [{ text: 'nodeModules',   isCode: true }, '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules',      'Only if npm packages are installed elsewhere'],
      [{ text: 'outputFileName',isCode: true }, '(blank = Jenkins_Payor_IT_Failures_Local_<version>.xlsx)', 'Set a fixed filename if preferred'],
      [{ text: 'testTimeout',   isCode: true }, '600',                                 'Per-test Maven timeout in seconds on the remote server'],
      [{ text: 'outputDir',     isCode: true }, '(blank = cwd)',                       'Absolute path to redirect output files'],
      [{ text: 'baselineVersion',isCode: true }, '(blank)',                             'Previous release version appended to baseline filename, e.g. 26.0.9 → Baseline_Jenkins_Payor_IT_Status_26.0.9.xlsx'],
      [{ text: 'baselineFile',    isCode: true }, 'Baseline_Jenkins_Payor_IT_Status.xlsx', 'Base filename without version suffix. Any existing version suffix is stripped; baselineVersion is appended automatically.'],
      [{ text: 'baselineDir',   isCode: true }, '.../Payor/baseline',                  'Change if baseline file lives elsewhere'],
      [{ text: 'emailFormat',   isCode: true }, '.../Regression_Email_Format_V2.docx', 'Rarely changes'],
    ],
    [20, 38, 42]
  ));
  ch.push(blank());

  ch.push(h2('JenkinsJobs Tab — set Overridden Email per value stream'));
  ch.push(simpleTable(
    ['Value Stream', 'Default Email', 'Overridden Email'],
    [
      ['billing',      '@billings-financial-value-stream@healthedge.com', ''],
      ['claims',       '@claims-value-stream@healthedge.com',             ''],
      ['enrollment',   '@enrollment-value-stream@healthedge.com',         ''],
      ['integrations', '@he-integrations-value-stream@healthedge.com',    ''],
      ['platform',     '@platform-value-stream@healthedge.com',           ''],
      ['provider',     '@provider-value-stream@healthedge.com',           ''],
    ],
    [14, 48, 48]
  ));
  ch.push(blank());

  ch.push(h2('Baseline URLs — set once per release cycle before running rpb'));
  ch.push(bodyPara([
    run('Open the per-project xlsx ('),
    code('projects/<pid>_<version>.xlsx'),
    run(' → '),
    code('baseline_urls'),
    run(' sheet) and fill in a stable Jenkins build URL from the '),
    run('previous release', { bold: true }),
    run(' for each value stream. Run '),
    code('rpb'),
    run(' after filling in these URLs. The baseline Excel will be written with:'),
  ]));
  ch.push(simpleTable(
    ['Column', 'Populated by', 'Description'],
    [
      ['Known Failure', 'User (manual)', 'Set Yes for pre-existing issues — promoted to Known Failure in output and excluded from email'],
      ['Local Failure', 'rpb',           'Yes for every test that failed in the baseline Jenkins build — used to flag Baseline Failure in current run'],
    ],
    [18, 22, 60]
  ));
  ch.push(blank(40));
  ch.push(blank(60));
  ch.push(simpleTable(
    ['Category', 'Baseline Jenkins URL'],
    [
      ['billing',      'http://engsvc-engjen1.../job/.../42/  ← fill in'],
      ['claims',       ''],
      ['enrollment',   ''],
      ['integrations', ''],
      ['platform',     ''],
      ['provider',     ''],
    ],
    [14, 20, 66]
  ));
  ch.push(blank());

  ch.push(h2('Remote Server — Per-Project xlsx'));
  ch.push(bodyPara([
    run('Remote server details are stored per-project in '),
    code('projects/<pid>_<version>.xlsx → remote_server'),
    run(' sheet (key|value format). VM is selected from '),
    code('vms.xlsx'),
    run(' when creating a project. The host, user, and password are looked up from '),
    code('vms.xlsx'),
    run(' by VM name at runtime.'),
  ]));
  ch.push(simpleTable(
    ['Key', 'Description'],
    [
      [{ text: 'vm_name', isCode: true }, 'VM name from vms.xlsx (e.g. heeng-haproxy2) — host/user/password resolved at runtime'],
    ],
    [14, 76]
  ));
  ch.push(bodyPara([
    run('The repo path is resolved at runtime on the remote VM via '),
    code('tosrc'),
    run(' — no manual configuration needed.'),
  ]));
  ch.push(blank());

  ch.push(h2('Monitoring Tab'));
  ch.push(simpleTable(
    ['Key', 'Default', 'Notes'],
    [
      [{ text: 'intervalMinutes', isCode: true }, '2', 'How often (minutes) to poll the remote server during Step 2 or Rerun'],
    ],
    [22, 12, 66]
  ));
  ch.push(blank());

  // ── Commands ───────────────────────────────────────────────
  ch.push(h1('Commands', C.purple));
  ch.push(simpleTable(
    ['Command', 'Alias', 'Description'],
    [
      [{ text: 'remotepopulatepayorbaseline', isCode: true, bold: true }, { text: 'rpb',  isCode: true }, 'Fetch IT failures from baseline Jenkins builds → write baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx'],
      [{ text: 'remotepayorregression',       isCode: true, bold: true }, { text: 'rprt', isCode: true }, 'Run the full 4-step regression report (Steps 1-4)'],
    ],
    [34, 10, 56], C.purple
  ));
  ch.push(blank(60));
  ch.push(...callout('💡', 'Help:', [
    'rpb  --help    Show rpb usage and baseline URL configuration details',
    'rprt --help    Show rprt usage and all config.xlsx settings',
  ], C.tealLight, C.teal));
  ch.push(blank());

  // ── First-Time Setup ──────────────────────────────────────
  ch.push(h1('First-Time Setup', C.teal));
  ch.push(bodyPara('Only needed once — skip if config.xlsx already exists in the Payor folder.'));
  ch.push(...codeBlock([
    'cd "...\\Remote_Regression_Jenkins_IT_Failure\\Payor\\scripts"',
    'node create_config_xlsx.js',
  ]));
  ch.push(bodyPara('Then open config.xlsx and fill in the Overridden Value column for your environment.'));
  ch.push(blank());

  // ── Running the Workflow ──────────────────────────────────
  ch.push(h1('Running the Workflow', C.navy));

  ch.push(h2('Phase 0 — Populate Baseline (once per release cycle)'));
  ch.push(bodyPara([
    run('Before running the regression report, populate the baseline file so Step 3 can cross-check current failures against the previous release. Open the per-project xlsx ('),
    code('projects/<pid>_<version>.xlsx → baseline_urls'),
    run(' sheet), enter a stable previous-release Jenkins build URL for each value stream, then run:'),
  ]));
  ch.push(...codeBlock(['rpb      (or:  remotepopulatepayorbaseline)']));
  ch.push(bodyPara([
    run('Output: '),
    code('baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx'),
    run(' — 4 columns: IT Class | Test Method | Known Failure | Local Failure.'),
  ]));
  ch.push(bodyPara([
    run('Local Failure = Yes', { bold: true }),
    run(' is set for every test that failed in those builds. '),
    run('Known Failure', { bold: true }),
    run(' is left blank — set it to '),
    code('Yes'),
    run(' manually for any test you want to pre-classify as a known issue (it will be promoted in the output Excel and excluded from reporting).'),
  ]));
  ch.push(blank());

  ch.push(h2('Option A — Full Automated Run (recommended)'));
  ch.push(...codeBlock(['rprt     (or:  remotepayorregression)']));
  ch.push(bodyPara('Runs all 4 steps sequentially. Step 2 typically takes 2–4 hours.'));
  ch.push(blank(60));

  ch.push(h2('Option B — Individual Steps'));
  ch.push(simpleTable(
    ['Command', 'Description', 'Approx. Time'],
    [
      [{ text: 'node step1_fetch_jenkins_failures.js', isCode: true }, 'Fetch Jenkins failures → Excel',              '~1 min'],
      [{ text: 'node step2_run_remote_its.js',         isCode: true }, 'Run ITs on remote server with live monitor',  '2–4 hrs'],
      [{ text: 'node step3_update_excel.js',           isCode: true }, 'Update Excel with Local + Baseline results',  '~10 sec'],
      [{ text: 'node step4_generate_email.js',         isCode: true }, 'Generate regression email .docx',            '~10 sec'],
    ],
    [46, 38, 16]
  ));
  ch.push(blank());

  ch.push(h2('Option C — Rerun Specific Test Cases'));
  ch.push(bodyPara('After a full run, rerun a subset of ITs and refresh Excel + email without re-fetching from Jenkins.'));
  ch.push(blank(40));
  ch.push(simpleTable(
    ['Command', 'What Runs'],
    [
      [{ text: 'rprt -rfits',                    isCode: true }, 'ITs where Local Failure = Yes'],
      [{ text: 'rprt -rtits',                    isCode: true }, 'ITs where Timeout = Yes'],
      [{ text: 'rprt -rits',                     isCode: true }, 'ITs where Rerun col (G) = Yes / Y / 1 / True'],
      [{ text: 'rprt -rfits --timeout 300',       isCode: true }, 'Rerun failed ITs, override timeout to 300 s'],
      [{ text: 'rprt -rtits --timeout 900',       isCode: true }, 'Rerun timed-out ITs, override timeout to 900 s'],
      [{ text: 'node rerun_its.js --failed',     isCode: true }, 'Same as -rfits but run directly'],
      [{ text: 'node rerun_its.js --timedout',   isCode: true }, 'Same as -rtits but run directly'],
      [{ text: 'node rerun_its.js --all',        isCode: true }, 'All classes (excluding Known Failures)'],
    ],
    [46, 54]
  ));
  ch.push(blank(60));
  ch.push(bodyPara([
    run('To flag specific rows for '),
    code('rprt -rits'),
    run(': open the Excel output, set column G (Rerun) to '),
    code('Yes'),
    run(', '),
    code('Y'),
    run(', '),
    code('1'),
    run(', or '),
    code('True'),
    run(' for the rows you want, save, then run '),
    code('rprt -rits'),
    run('. After any rerun: col D (Local Failure) and col E (Timeout) are updated, col G (Rerun) is cleared for executed rows, Summary sheet is refreshed, and a new email draft is generated.'),
  ]));
  ch.push(blank());

  // ── Step-by-Step Details ──────────────────────────────────
  ch.push(h1('Step-by-Step Details', C.navy));

  ch.push(h2('STEP 1 — Fetch Jenkins Failures'));
  ch.push(bullet('Calls /testReport/api/json for each of the 6 Jenkins job URLs'));
  ch.push(bullet('Collects FAILED, REGRESSION, and ERROR test cases'));
  ch.push(bullet('Groups tests by value stream into separate Excel tabs'));
  ch.push(bullet('Pre-marks tests in known_failures.json with Known Failure = Yes'));
  ch.push(blank(60));
  ch.push(simpleTable(
    ['Excel Tab', 'Jenkins Job'],
    [
      ['Billing',      'MR-payer-billing-ora-container'],
      ['Claims',       'MR-payer-claims-ora-container'],
      ['Enrollment',   'MR-payer-enrollment-ora-container'],
      ['Integrations', 'MR-payer-he-integrations-ora-container'],
      ['Platform',     'MR-payer-platform-ora-container'],
      ['Provider',     'MR-payer-provider-ora-container'],
    ],
    [30, 70]
  ));
  ch.push(blank());

  ch.push(h2('STEP 2 — Run IT Tests on Remote Server'));
  ch.push(bullet('Reads all test classes from Excel, skipping Known Failure = Yes rows'));
  ch.push(bullet('Scans remote repo to map each class to its Maven module (core-st or claims-st)'));
  ch.push(bullet('Uploads a bash runner script via SSH and launches it in the background'));
  ch.push(bullet('Polls at the configured interval, printing a live monitor panel each cycle'));
  ch.push(blank(60));
  ch.push(h2('Exit Code Classification'));
  ch.push(simpleTable(
    ['Exit Code', 'Classification'],
    [
      ['0',                    'PASS'],
      ['124',                  'TIMEOUT'],
      ['non-zero + test output', 'FAIL'],
      ['non-zero + no output', 'BUILD_ERROR'],
    ],
    [40, 60]
  ));
  ch.push(blank());

  ch.push(h2('STEP 3 — Update Excel with Local + Baseline Results'));
  ch.push(bodyPara('Column layout after Step 3 (A–G):'));
  ch.push(simpleTable(
    ['Col', 'Header', 'Values', 'Set By'],
    [
      ['A', 'IT Class',         'Fully-qualified class name',         'Step 1'],
      ['B', 'Test Method',      'Method name',                        'Step 1'],
      ['C', 'Known Failure',    'Yes / blank',                        'Step 1 or Step 3 (promoted)'],
      ['D', 'Local Failure',    'Yes / blank',                        'Step 3'],
      ['E', 'Timeout',          'Yes / blank',                        'Step 3'],
      ['F', 'Baseline Failure', 'Yes / blank',                        'Step 3'],
      ['G', 'Rerun',            'Yes / True / blank',                 'User-filled'],
    ],
    [6, 20, 36, 38]
  ));
  ch.push(blank(60));
  ch.push(bodyPara([run('Baseline cross-check logic:', { bold: true })]));
  ch.push(bullet('Locally failing + in baseline as Known Failure → promote col C to Yes, clear Local Failure'));
  ch.push(bullet('Locally failing + in baseline as Local Failure → set col F = Yes (Baseline Failure)'));
  ch.push(bullet('Locally failing + not in baseline at all → col F stays blank (New Local Failure)'));
  ch.push(blank());

  ch.push(h2('STEP 4 — Generate Regression Email'));
  ch.push(simpleTable(
    ['Col C Known', 'Col D Local Fail', 'Col F Baseline', 'Email Section'],
    [
      ['Yes',   '—',    '—',   'Known Failures'],
      ['blank', 'blank','—',   'Locally Passing'],
      ['blank', 'Yes',  'Yes', 'Baseline Failure'],
      ['blank', 'Yes',  'blank','New Local Failure'],
    ],
    [20, 20, 20, 40]
  ));
  ch.push(blank(60));
  ch.push(bodyPara([
    run('Email format is controlled by '),
    code('config.xlsx → General → emailFormat'),
    run(' (path to Regression_Email_Format_V2.docx). The output file is written to the output folder as '),
    code('Regression_Email_<version>.docx'),
    run('.'),
  ]));
  ch.push(blank());

  // ── Footer ────────────────────────────────────────────────
  ch.push(divider());
  ch.push(new Paragraph({
    children: [
      new TextRun({ text: 'Payor IT Failure Remote Regression', font: 'Calibri', size: 18, bold: true, color: C.greyDark }),
      new TextRun({ text: '   |   ', font: 'Calibri', size: 18, color: C.greyDark }),
      new TextRun({ text: 'HealthEdge Software, Inc', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
      new TextRun({ text: '   |   Run  rprt --help  or  rpb --help  for CLI usage', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
  }));

  return ch;
}

// ── Write ─────────────────────────────────────────────────
async function main() {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(0.9),
            bottom: convertInchesToTwip(0.9),
            left:   convertInchesToTwip(0.85),
            right:  convertInchesToTwip(0.85),
          },
        },
      },
      children: buildDoc(),
    }],
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: C.black } },
      },
    },
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log('ReadMe.docx written to:', OUT);
}

main().catch(function(e) { console.error(e); process.exit(1); });
