// ============================================================
// gen_readme.js — Generate ReadMe.docx for Jenkins_BaseLine
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
  children.push(titlePara('Jenkins IT BaseLine Tool'));
  children.push(subtitlePara('Trigger payor-core-commit then run certification + regression baseline jobs'));
  children.push(blank(120));

  // ── Overview ───────────────────────────────────────────────
  children.push(bodyPara([
    run('The Jenkins IT BaseLine Tool automates the full payor baseline workflow in two phases. '),
    run('Phase 1', { bold: true }),
    run(' enables and triggers '),
    code('payor-core-commit'),
    run(' and waits for a successful build. '),
    run('Phase 2', { bold: true }),
    run(' triggers '),
    code('payor-utils-certification'),
    run(' and all six regression jobs in parallel.'),
  ]));
  children.push(blank(40));

  children.push(...callout('💡', 'Quick start:', [
    'setupjbaselinetool                            create config files + prompt to install Playwright',
    'Fill credentials in secrets.xlsx → Jenkins sheet',
    'Fill job URLs in baseline_job_config.xlsx → payor sheet',
    'setupjbaselinetool -fetchparams               fetch build parameters from each regression job',
    'jbaseline -payor 26.1.1.1                 run Phase 1 → Phase 2 for version 26.1.1.1',
    'jbaselinestatus                           view run history',
  ]));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 1 — Commands
  // ══════════════════════════════════════════════════════════
  children.push(h1('Commands', C.green));

  children.push(simpleTable(
    ['Command', 'Description'],
    [
      [{ text: 'setupjbaselinetool',            isCode: true }, 'Create skeleton config files (baseline_job_config.xlsx, projects.xlsx, jenkins_params/, git_config.xlsx) and optionally install Playwright. Run with  -fetchparams  to fetch Jenkins build parameters.'],
      [{ text: 'jbaseline -payor <version>', isCode: true }, 'Run the full baseline: Phase 1 (enable + trigger payor-core-commit, wait for success) then Phase 2 (trigger payor-utils-certification + all 6 regression jobs). Use  --phase2-only  to skip Phase 1.'],
      [{ text: 'jbaselinestatus',            isCode: true }, 'Show run history from projects.xlsx. Grouped by phase (Pre-Build / Certification / Regression) with live Jenkins status. Supports pagination (-p <n>), reverse order (-r), and per-project detail (-pid <id>).'],
      [{ text: 'jbaselinedelete',            isCode: true }, 'Delete a run entry from projects.xlsx and its per-run xlsx file.  jbaselinedelete -pid <project_id>'],
    ],
    [34, 66],
    C.green
  ));
  children.push(blank());

  children.push(h2('jbaseline — options'));
  children.push(simpleTable(
    ['Option', 'Required', 'Default', 'Description'],
    [
      [{ text: '-payor <version>',  isCode: true }, 'Yes', '—',      'Payor release version (e.g. 26.1.1.1). Substituted into all {version} URL templates in baseline_job_config.xlsx.'],
      [{ text: '--phase2-only',     isCode: true }, 'No',  'false',  'Skip Phase 1 (payor-core-commit). Directly trigger Phase 2 (certification + regression). Used by the scheduler after a new build is detected.'],
    ],
    [28, 12, 12, 48],
    C.green
  ));
  children.push(blank());

  children.push(h2('jbaselinestatus — options'));
  children.push(simpleTable(
    ['Option', 'Description'],
    [
      [{ text: '-pid <id>',  isCode: true }, 'Show live Jenkins status for a specific run (polls queue items, resolves build URLs, groups by phase)'],
      [{ text: '-r',         isCode: true }, 'Reverse order — show oldest runs first'],
      [{ text: '-p <n>',     isCode: true }, 'Go to page n (10 projects per page)'],
    ],
    [24, 76],
    C.green
  ));
  children.push(blank());

  children.push(...callout('📋', 'Examples:', [
    'jbaseline -payor 26.1.1.1              Phase 1 then Phase 2',
    'jbaseline -payor 26.1.1.1 --phase2-only   Phase 2 only (skips payor-core-commit)',
    'jbaselinestatus                        latest 10 runs',
    'jbaselinestatus -pid 5                 live status for run #5',
    'jbaselinestatus -r -p 2               oldest-first, page 2',
  ], C.greenLight, C.green));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 2 — Phases
  // ══════════════════════════════════════════════════════════
  children.push(h1('Two-Phase Workflow', C.navy));

  children.push(h2('Phase 1 — Pre-Build  (payor-core-commit)'));
  children.push(bodyPara([
    run('The tool checks whether '),
    code('payor-core-commit'),
    run(' is disabled. If so, it enables the job, then triggers a build with no parameters. It then polls the build until it reaches '),
    run('SUCCESS', { bold: true }),
    run(' (timeout 30 minutes). Phase 2 does not start until Phase 1 completes successfully.'),
  ]));
  children.push(blank(40));

  children.push(h2('Phase 2 — Certification + Regression'));
  children.push(bodyPara([
    run('Once Phase 1 succeeds, the tool triggers two types of jobs in sequence:'),
  ]));
  children.push(bullet('payor-utils-certification — triggered first (no parameters)'));
  children.push(bullet('Six regression jobs — billing, claims, enrollment, he-integrations, platform, provider — triggered with build parameters read from jenkins_params/ xlsx files'));
  children.push(bodyPara([
    run('All Phase 2 jobs are triggered and recorded in the run xlsx file ('),
    code('projects/<run_id>_payor_<version>.xlsx'),
    run('). Each job is tracked in the '),
    code('jobs'),
    run(' sheet with its phase, queue URL, build URL, and completion status.'),
  ]));
  children.push(blank());

  children.push(...callout('💡', 'Phase column values:', [
    'pre_build      — payor-core-commit (Phase 1)',
    'certification  — payor-utils-certification (Phase 2)',
    'regression     — billing / claims / enrollment / he-integrations / platform / provider (Phase 2)',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 4 — Configuration Files
  // ══════════════════════════════════════════════════════════
  children.push(h1('Configuration Files', C.teal));

  children.push(h2('baseline_job_config.xlsx — payor sheet'));
  children.push(simpleTable(
    ['Column', 'Description'],
    [
      [{ text: 'job_name',           isCode: true }, 'Job identifier: payor_core_commit, payor_utils_certification, billing, claims, enrollment, he-integrations, platform, provider'],
      [{ text: 'job_url',            isCode: true }, 'Full Jenkins job URL. Use {version} as a placeholder for the payor release version (e.g. .../job/{version}/job/payor-core-commit). The tool substitutes the actual version at runtime.'],
      [{ text: 'version_param_name', isCode: true }, 'The Jenkins build parameter name for the release version on regression jobs. Leave empty for payor_core_commit and payor_utils_certification (they take no parameters). Populated by  setupjbaselinetool -fetchparams.'],
    ],
    [28, 72],
    C.teal
  ));
  children.push(blank());

  children.push(h2('secrets.xlsx — Jenkins sheet'));
  children.push(simpleTable(
    ['Key', 'Description'],
    [
      [{ text: 'jenkins_username',  isCode: true }, 'Jenkins login username'],
      [{ text: 'jenkins_api_token', isCode: true }, 'Jenkins API token. Go to Jenkins → your profile → Configure → Add new Token.'],
      [{ text: 'jenkins_password',  isCode: true }, 'Login password. Used by the Playwright headless browser for build triggering.'],
    ],
    [28, 72],
    C.teal
  ));
  children.push(blank());

  children.push(h2('jenkins_params/payor_<name>_jenkins_params.xlsx'));
  children.push(bodyPara([
    run('One file per regression job, created by '),
    code('setupjbaselinetool -fetchparams'),
    run('. The '),
    code('BuildParameters'),
    run(' sheet has '),
    code('param_name'),
    run(' and '),
    code('param_value'),
    run(' columns. Edit '),
    code('param_value'),
    run(' to change defaults. Choice parameters have a separate sheet listing all valid values.'),
  ]));
  children.push(blank());

  children.push(h2('projects/<run_id>_payor_<version>.xlsx'));
  children.push(bodyPara('One file per run. Contains two sheets:'));
  children.push(bullet('info — run metadata: run_id, version, triggered_at'));
  children.push(bullet('jobs — one row per job: job_name, phase, completed, job_id (build number or queue URL), triggered_at'));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 5 — First-Time Setup
  // ══════════════════════════════════════════════════════════
  children.push(h1('First-Time Setup', C.navy));
  children.push(simpleTable(
    ['Step', 'Action'],
    [
      ['1', 'Run  setupjbaselinetool  — creates baseline_job_config.xlsx, projects.xlsx, jenkins_params/, git_config.xlsx, and projects/. Prompts to install Playwright.'],
      ['2', 'Open secrets.xlsx → Jenkins sheet. Fill in jenkins_username and jenkins_api_token (and jenkins_password for the Playwright browser fallback).'],
      ['3', 'Open baseline_job_config.xlsx → payor sheet. Fill in the job_url for all 8 rows. Use {version} as the version placeholder in URLs for payor-core-commit and all regression jobs.'],
      ['4', 'Run  setupjbaselinetool -fetchparams  — connects to each regression job and populates jenkins_params/ xlsx files with current build parameter definitions.'],
      ['5', 'In baseline_job_config.xlsx, verify or fill in version_param_name for each regression job. Check the BuildParameters sheet in each jenkins_params/ file.'],
      ['6', 'Run  jbaseline -payor 26.1.1.1  to trigger the full baseline workflow.'],
    ],
    [8, 92],
    C.navy
  ));
  children.push(blank());

  // ── Footer ─────────────────────────────────────────────────
  children.push(divider());
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Jenkins IT BaseLine Tool', font: 'Calibri', size: 18, bold: true, color: C.greyDark }),
      new TextRun({ text: '   |   ', font: 'Calibri', size: 18, color: C.greyDark }),
      new TextRun({ text: 'HealthEdge Software, Inc', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
      new TextRun({ text: '   |   Run  listwfc baseline  to see commands in the terminal', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
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
  console.log('  [create] ReadMe.docx ->', OUT);
}

main().catch(function(e) { console.error(e); process.exit(1); });
