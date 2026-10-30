// ============================================================
// gen_readme.js — Generate ReadMe.docx for Jenkins_IT_Regression
//
// USAGE:  node gen_readme.js
// OUTPUT: ../ReadMe.docx
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
  return new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: spaceAfter || 60 } });
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
    children: [new TextRun({ text: '  ' + text, font: 'Calibri', size: 30, bold: true, color: C.white })],
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
        ? new TextRun({ text, font: 'Courier New', size: 20, color: C.code })
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
            if (typeof cell === 'object') return tCell(cell.text, fill, widths[i], cell);
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

function divider() {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' } },
    spacing: { before: 120, after: 120 },
  });
}

// ─────────────────────────────────────────────────────────────
// DOCUMENT CONTENT
// ─────────────────────────────────────────────────────────────

function buildDoc() {
  const children = [];

  // ── Cover ──────────────────────────────────────────────────
  children.push(titlePara('Jenkins IT Regression Tool'));
  children.push(subtitlePara('Trigger MR Payor regression jobs on Sustaining Jenkins'));
  children.push(blank(120));

  // ── Overview ───────────────────────────────────────────────
  children.push(bodyPara([
    run('The Jenkins IT Regression Tool triggers the six MR Payor regression jobs on the Sustaining Jenkins server ('),
    code('engsvc-engjen1'),
    run(') with a single command. Specify the PAYOR release version and optionally how many runs per job. All results are recorded in '),
    code('projects.xlsx'),
    run(' for tracking.'),
  ]));
  children.push(blank(40));
  children.push(...callout('💡', 'Quick start:', [
    'setupjenkisregtool                          create config files + prompt to install Playwright',
    'Fill credentials in secrets.xlsx → Eng Jenkins sheet',
    'setupjenkisregtool -fetchparams             fetch build parameters from each Jenkins job',
    'Fill version_param_name in reg_job_config.xlsx for each job',
    'jreg -payor 26.1.1.1                        trigger all 6 jobs once',
    'jreg -payor 26.1.1.1 -runs 3               trigger all 6 jobs 3 times each',
  ]));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 1 — Commands
  // ══════════════════════════════════════════════════════════
  children.push(h1('Commands', C.green));

  children.push(simpleTable(
    ['Command', 'Alias', 'Description'],
    [
      [{ text: 'setupjenkisregtool', isCode: true },  { text: '',     isCode: true }, 'Create skeleton config files (reg_job_config.xlsx, projects.xlsx, jenkins_params/), add Eng Jenkins sheet to secrets.xlsx, and optionally install Playwright.'],
      [{ text: 'setupjenkisregtool -fetchparams', isCode: true }, { text: '', isCode: true }, 'Fetch build parameter definitions from each Jenkins job and write to jenkins_params/ xlsx files. Requires credentials in secrets.xlsx.'],
      [{ text: 'jenkinsregression',  isCode: true },  { text: 'jreg', isCode: true }, 'Trigger all 6 MR Payor regression jobs. -payor <version> is required. -runs <n> (default 1) triggers each job n times.'],
    ],
    [38, 12, 50],
    C.green
  ));
  children.push(blank());

  children.push(h2('jenkinsregression / jreg — options'));
  children.push(simpleTable(
    ['Option', 'Required', 'Default', 'Description'],
    [
      [{ text: '-payor <version>', isCode: true }, 'Yes', '—',  'PAYOR release version prefix passed to the Jenkins version parameter (e.g. 26.1.1.1)'],
      [{ text: '-runs <n>',        isCode: true }, 'No',  '1',  'Number of times to trigger each job. All 6 jobs are triggered n times.'],
    ],
    [30, 14, 12, 44],
    C.green
  ));
  children.push(blank());

  children.push(...callout('📋', 'Examples:', [
    'jreg -payor 26.1.1.1              trigger each of the 6 jobs once',
    'jreg -payor 26.1.1.1 -runs 3      trigger each job 3 times (18 total)',
    'jreg --help                        show usage',
    'setupjenkisregtool -fetchparams    re-fetch params after job config changes',
  ], C.greenLight, C.green));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 2 — Jobs
  // ══════════════════════════════════════════════════════════
  children.push(h1('Payor Regression Jobs', C.navy));
  children.push(bodyPara('All six MR Payor regression jobs on the Sustaining Jenkins server:'));
  children.push(blank(40));

  children.push(simpleTable(
    ['Job Name', 'Jenkins Job URL'],
    [
      ['billing',         'http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-billing-ora-container/'],
      ['claims',          'http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-claims-ora-container/'],
      ['enrollment',      'http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-enrollment-ora-container/'],
      ['he-integrations', 'http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-he-integrations-ora-container/'],
      ['platform',        'http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-platform-ora-container/'],
      ['provider',        'http://engsvc-engjen1.headquarters.healthedge.com:8080/job/Sustaining/job/MR-payer-provider-ora-container/'],
    ],
    [20, 80],
    C.navy
  ));
  children.push(blank());
  children.push(bodyPara([
    run('Job URLs are stored in '),
    code('reg_job_config.xlsx'),
    run(' → '),
    code('payor'),
    run(' sheet and can be updated there if they change.'),
  ]));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 3 — Configuration Files
  // ══════════════════════════════════════════════════════════
  children.push(h1('Configuration Files', C.teal));

  children.push(h2('reg_job_config.xlsx — payor sheet'));
  children.push(simpleTable(
    ['Column', 'Description'],
    [
      [{ text: 'job_name',           isCode: true }, 'Short name: billing, claims, enrollment, he-integrations, platform, provider'],
      [{ text: 'job_url',            isCode: true }, 'Full Jenkins job URL. Pre-filled by setup; edit if URL changes.'],
      [{ text: 'version_param_name', isCode: true }, 'The Jenkins build parameter name that accepts the PAYOR version (e.g. PAYOR_VERSION). Fill this in after running  setupjenkisregtool -fetchparams  — check the BuildParameters sheet in each jenkins_params/ file to find the correct name.'],
    ],
    [28, 72],
    C.teal
  ));
  children.push(blank());

  children.push(h2('secrets.xlsx — Eng Jenkins sheet'));
  children.push(simpleTable(
    ['Key', 'Description'],
    [
      [{ text: 'jenkins_username',  isCode: true }, 'Your Sustaining Jenkins login username'],
      [{ text: 'jenkins_api_token', isCode: true }, 'API token (Jenkins → your profile → Configure → Add new Token). Preferred over password for API calls.'],
      [{ text: 'jenkins_password',  isCode: true }, 'Your login password. Used by the Playwright headless browser fallback when the API is blocked.'],
    ],
    [28, 72],
    C.teal
  ));
  children.push(blank());

  children.push(h2('jenkins_params/payor_<name>_jenkins_params.xlsx'));
  children.push(bodyPara([
    run('One file per job, created by '),
    code('setupjenkisregtool -fetchparams'),
    run('. Each file has:'),
  ]));
  children.push(bullet('BuildParameters sheet — two columns: param_name and param_value (pre-filled with Jenkins defaults). Edit param_value to change defaults for your runs.'));
  children.push(bullet('One additional sheet per choice parameter — lists all valid choice values. Read-only reference.'));
  children.push(blank());

  children.push(h2('projects.xlsx — run tracking'));
  children.push(simpleTable(
    ['Column', 'Description'],
    [
      [{ text: 'run_id',        isCode: true }, 'Sequential run identifier, auto-incremented'],
      [{ text: 'payor_version', isCode: true }, 'The -payor version value used for this run'],
      [{ text: 'job_name',      isCode: true }, 'billing / claims / enrollment / he-integrations / platform / provider'],
      [{ text: 'run_number',    isCode: true }, 'Which repetition (1 to -runs value)'],
      [{ text: 'status',        isCode: true }, 'Scheduled / Trigger Failed'],
      [{ text: 'job_id',        isCode: true }, 'Jenkins build number (populated after trigger)'],
      [{ text: 'triggered_at',  isCode: true }, 'ISO 8601 timestamp of when the trigger was sent'],
    ],
    [24, 76],
    C.teal
  ));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 4 — Jenkins Build Trigger
  // ══════════════════════════════════════════════════════════
  children.push(h1('Jenkins Build Trigger', C.teal));
  children.push(bodyPara(
    'For each job, the tool first attempts the Jenkins REST API. If the API returns 403 (CSRF or permission issue), it automatically retries via a headless Chromium browser (Playwright):'
  ));
  children.push(blank(40));
  children.push(bullet('API mode: POST {job_url}/buildWithParameters?{params} with Basic Auth + CSRF crumb'));
  children.push(bullet('Playwright fallback: logs in to Jenkins, navigates to buildWithParameters page, fills params and submits'));
  children.push(blank());

  children.push(...callout('💡', 'Playwright installation:', [
    'Playwright is prompted during  setupjenkisregtool  if not already installed.',
    'If Chrome or Edge is already installed, no Chromium download is needed.',
    'To install manually:  pip install playwright  then  playwright install chromium',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 5 — Setup Workflow
  // ══════════════════════════════════════════════════════════
  children.push(h1('First-Time Setup', C.navy));
  children.push(simpleTable(
    ['Step', 'Action'],
    [
      ['1', 'Run  setupjenkisregtool  — creates reg_job_config.xlsx, projects.xlsx, jenkins_params/ and adds Eng Jenkins sheet to secrets.xlsx. Prompts to install Playwright.'],
      ['2', 'Open secrets.xlsx → Eng Jenkins sheet. Fill in jenkins_username, jenkins_api_token (or jenkins_password for Playwright fallback).'],
      ['3', 'Open reg_job_config.xlsx → payor sheet. Verify job URLs are correct.'],
      ['4', 'Run  setupjenkisregtool -fetchparams  — connects to each Jenkins job and populates the jenkins_params/ files with current build parameter definitions.'],
      ['5', 'In reg_job_config.xlsx → payor sheet, fill in the version_param_name column for each job. Check the BuildParameters sheet in each jenkins_params/ file to find the parameter name that accepts the PAYOR version string.'],
      ['6', 'Run  jreg -payor 26.1.1.1  to trigger all 6 jobs.'],
    ],
    [8, 92],
    C.navy
  ));
  children.push(blank());

  // ── Footer ─────────────────────────────────────────────────
  children.push(divider());
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Jenkins IT Regression Tool', font: 'Calibri', size: 18, bold: true, color: C.greyDark }),
      new TextRun({ text: '   |   ', font: 'Calibri', size: 18, color: C.greyDark }),
      new TextRun({ text: 'HealthEdge Software, Inc', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
      new TextRun({ text: '   |   Run  listwfc jenkins  to see commands in the terminal', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
  }));

  return children;
}

// ── Write ─────────────────────────────────────────────────────
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
        document: { run: { font: 'Calibri', size: 22, color: '000000' } },
      },
    },
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log('  [create] ReadMe.docx →', OUT);
}

main().catch(function(e) { console.error(e); process.exit(1); });
