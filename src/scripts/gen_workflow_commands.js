// ============================================================
// gen_workflow_commands.js — Generate WorkFlowCommands.docx
//
// USAGE:  node gen_workflow_commands.js
// OUTPUT: WorkFlowCommands.docx  (workflows root, one level up)
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

const OUT = path.join(__dirname, '..', 'WorkFlowCommands.docx');

// ── Colour palette ────────────────────────────────────────────
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
  red:        'C0392B',
  redLight:   'FDECEA',
  grey:       'F2F4F6',
  greyMid:    'D0D7DE',
  greyDark:   '5A6370',
  white:      'FFFFFF',
  black:      '000000',
};

// ── Typography helpers ────────────────────────────────────────

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
  return new TextRun({ text, font: 'Courier New', size: 20, color: '2E4057',
    shading: { type: ShadingType.CLEAR, fill: 'F0F0F0' } });
}

function blank(spaceAfter) {
  spaceAfter = spaceAfter || 60;
  return new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: spaceAfter } });
}

function titlePara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 52, bold: true,
      color: C.white, characterSpacing: 20 })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.navy },
    spacing: { before: 200, after: 200 },
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

function thinBorders() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0' };
  return new TableBorders({ top: b, bottom: b, left: b, right: b, insideH: b, insideV: b });
}

function hCell(text, fill, textColor, w) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Calibri', size: 20, bold: true, color: textColor || C.white })],
      spacing: { before: 80, after: 80 },
      indent: { left: convertInchesToTwip(0.1) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.navy },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: w, type: WidthType.PERCENTAGE },
  });
}

function cCell(text, fill, w) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Courier New', size: 20, bold: true, color: C.navy })],
      spacing: { before: 80, after: 80 },
      indent: { left: convertInchesToTwip(0.1) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.white },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: w, type: WidthType.PERCENTAGE },
  });
}

function bCell(text, fill, w, color) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Calibri', size: 20, color: color || C.black })],
      spacing: { before: 80, after: 80 },
      indent: { left: convertInchesToTwip(0.1) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.white },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: w, type: WidthType.PERCENTAGE },
  });
}

function aliasCell(alias, fill, w) {
  if (!alias) {
    return new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: '—', font: 'Calibri', size: 20, color: C.greyDark })],
        spacing: { before: 80, after: 80 }, indent: { left: convertInchesToTwip(0.1) } })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.white },
      verticalAlign: VerticalAlign.CENTER,
      width: { size: w, type: WidthType.PERCENTAGE },
    });
  }
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: alias, font: 'Courier New', size: 20, color: C.purple, bold: true })],
      spacing: { before: 80, after: 80 },
      indent: { left: convertInchesToTwip(0.1) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.white },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: w, type: WidthType.PERCENTAGE },
  });
}

// Build a command table: columns = Command | Alias | Description
// rows = [ [command, alias, description], ... ]
function commandTable(rows, accentFill) {
  accentFill = accentFill || C.navy;
  return new Table({
    rows: [
      new TableRow({
        children: [
          hCell('Command',     accentFill, C.white, 26),
          hCell('Alias',       accentFill, C.white, 12),
          hCell('Description', accentFill, C.white, 62),
        ],
        tableHeader: true,
      }),
      ...rows.map(function(r, ri) {
        const fill = ri % 2 === 0 ? C.grey : C.white;
        return new TableRow({
          children: [
            cCell(r[0], fill, 26),
            aliasCell(r[1], fill, 12),
            bCell(r[2], fill, 62),
          ],
        });
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
  });
}

function divider() {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' } },
    spacing: { before: 120, after: 120 },
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

// ─────────────────────────────────────────────────────────────
// DOCUMENT CONTENT
// ─────────────────────────────────────────────────────────────

function buildDoc() {
  const children = [];

  // ── Cover ──────────────────────────────────────────────────
  children.push(titlePara('Workflow Commands'));
  children.push(subtitlePara('All global commands and aliases — Windows  (' + require('os').homedir() + '\\.local\\bin)'));
  children.push(blank(120));

  // ── Overview ───────────────────────────────────────────────
  children.push(new Paragraph({
    children: [
      run('All commands below are '),
      run('CMD wrappers', { bold: true }),
      run(' in '),
      code('' + require('os').homedir() + '\\.local\\bin'),
      run(' which is on the user PATH. Run them from any PowerShell or Command Prompt window. '),
      run('Aliases', { bold: true }),
      run(' are shorter synonyms for the same command — they call the same script with the same arguments.'),
    ],
    spacing: { before: 0, after: 100, line: 276 },
  }));
  children.push(blank(80));
  children.push(...callout('💡', 'listwfc:', [
    'Run  listwfc  at any time to print this command list in the terminal.',
    'Run  listwfc <section>  to filter to a specific section (e.g.  listwfc docker  or  listwfc payor).',
  ]));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 1 — Local_Build_And_Deployment / Payor
  // ══════════════════════════════════════════════════════════
  children.push(h1('Local_Build_And_Deployment  —  Payor', C.navy));
  children.push(new Paragraph({
    children: [
      run('Scripts: '),
      code('Local_Build_And_Deployment/Payor/scripts/'),
      run('   Docs: '),
      code('DeployPayorModules.docx'),
      run(', '),
      code('RefreshPayorReadme.docx'),
      run(', '),
      code('RegressionReadme.docx'),
    ],
    spacing: { before: 0, after: 100 },
  }));
  children.push(blank(40));

  children.push(h2('Module Management'));
  children.push(commandTable([
    ['listpayormodules', 'lpm',  'List all Payor Maven modules — shows which are ready to deploy (jar in target/) and which need a build first'],
    ['buildpayormodule', 'bpm',  'Build a Payor module (and optionally all transitive dependents). Auto-detects stale modules via git when run with no module name'],
    ['deploypayormodule','dpm',  'Stop the payor server, copy a built jar into the container, then start the server again'],
  ]));
  children.push(blank());

  children.push(h2('Full Refresh'));
  children.push(commandTable([
    ['refresh-payor', '', 'Full build + deploy of the Payor stack. Supports -os (only start servers), -sdu (skip DB upgrade), -st (skip tests) and more. See RefreshPayorReadme.docx'],
  ]));
  children.push(blank());

  children.push(h2('Regression Testing'));
  children.push(commandTable([
    ['localpayorregression', 'lprt', 'Run Payor system tests locally. Accepts a Jenkins build URL (re-runs all failed tests with progress/ETA/report) or a direct test class/method in any format (streams Maven output live). See RegressionReadme.docx'],
  ]));
  children.push(blank());

  children.push(...callout('📄', 'Reference docs:', [
    'DeployPayorModules.docx  — listpayormodules, buildpayormodule, deploypayormodule',
    'RefreshPayorReadme.docx  — refresh-payor (full options)',
    'RegressionReadme.docx   — localpayorregression / lprt (Jenkins URL + direct class/method)',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 2 — Remote Regression  —  Payor
  // ══════════════════════════════════════════════════════════
  children.push(h1('Remote Regression  —  Payor', C.green));
  children.push(new Paragraph({
    children: [
      run('Scripts: '),
      code('Remote_Regression_Jenkins_IT_Failure/Payor/scripts/'),
      run('   Docs: '),
      code('WORKFLOW.md'),
      run(',  '),
      code('ReadMe.docx'),
    ],
    spacing: { before: 0, after: 100 },
  }));
  children.push(blank(40));

  children.push(commandTable([
    ['remotepayorregression',       'rprt', 'Full 4-step Payor regression report: fetch Jenkins IT failures → run tests on remote server → update Excel results → generate regression email draft. See WORKFLOW.md in Remote_Regression_Jenkins_IT_Failure/Payor/'],
    ['remotepopulatepayorbaseline', 'rpb',  'Fetch IT failures from baseline Jenkins builds and write Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx. Sets Local Failure=Yes for all entries; mark Known Failure=Yes manually. Configure URLs in config.xlsx → Baseline tab.'],
    ['gpregressionresult',          'gpr',  'Fetch GP Jenkins test results and mark GP Failure = Yes in the output Excel. Reflects in Summary; treated as Local Failure in email draft. Configure GP Jenkins build URL in config.xlsx → GPServer tab. Optional: --url <url> to override for one run. Run  gpr --help  for all options.'],
  ], C.green));
  children.push(blank());

  children.push(...callout('📄', 'Reference docs:', [
    'WORKFLOW.md (Remote_Regression_Jenkins_IT_Failure/Payor/)  — full workflow, config guide, rerun flags, troubleshooting',
    'ReadMe.docx (same folder)  — end-user guide generated by  node scripts/gen_readme.js',
  ], C.greenLight, C.green));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 3 — GP_Build Tool
  // ══════════════════════════════════════════════════════════
  children.push(h1('GP_Build Tool', C.teal));
  children.push(new Paragraph({
    children: [
      run('Scripts: '),
      code('GP_Build/scripts/'),
      run('   Docs: '),
      code('GP_Build/ReadMe.docx'),
      run('   Config: '),
      code('GP_Build/config.xlsx'),
      run('   Tickets: '),
      code('GP_Build/tickets/'),
    ],
    spacing: { before: 0, after: 100 },
  }));
  children.push(blank(40));

  children.push(commandTable([
    ['setupgptool', '', 'Set up the GP Build Tool skeleton — creates config.xlsx, projects.xlsx, gp_params.xlsx, and tickets/ folder. Run  setupgptool -fetchparams  after filling in config.xlsx to fetch Jenkins build parameters and test groups into gp_params.xlsx.  Run  setupgptool --help  for the full workflow.'],
    ['gpstatus', '', 'Show GP Build project run history from projects.xlsx. Lists latest 10 projects (newest first) with project ID, ticket, branch, dest branch, build status and PR status. Navigate with  n  (next 10),  p  (previous 10),  q  (quit).  gpstatus -rf  refreshes Jenkins + GitHub PR status for active projects (skips Passed/Failed/Cancelled).  gpstatus -s <status>  filters by status (e.g.  gpstatus -s running).'],
    ['gpdelete', '', 'Delete a project entry from projects.xlsx by project ID. Confirms before deleting. Also removes the per-ticket config file.  gpdelete -pid <project_id>'],
    ['gprun', '', 'Trigger a GP Jenkins build for a ticket. Creates a per-ticket config file and triggers the Jenkins multi-branch pipeline. Ticket ID is auto-extracted from branch name when -fb is used. PR is resolved from Atlassian dev-status; if multiple PRs for the same branch + dest, prompts for selection. Captures Jenkins job ID and records status (Scheduled / Running) in projects.xlsx.  gprun -t PAYOR-208267 -db main  or  gprun -fb feature-PAYOR-208267-fix -db main.  -db is required; -am optional (default: no).'],
  ], C.teal));
  children.push(blank());

  children.push(...callout('💡', 'How it works:', [
    '0. Run  setupgptool  to create config.xlsx, projects.xlsx, gp_params.xlsx and tickets/. Fill in config.xlsx and secrets.xlsx, then run  setupgptool -fetchparams  to fetch Jenkins parameters.',
    '1. If -t is given (no -fb): queries Atlassian dev-status API for all branches linked to the ticket, filters to those with a PR targeting the destination branch. Prompts if multiple qualify; errors if none.',
    '2. If -fb is given: uses the specified branch directly with no JIRA lookup.',
    '3. Looks up or creates an entry in GP_Build/projects.xlsx for the ticket + branch.',
    '4. Copies BuildParameters and INTEG_TEST_GROUP_CATEGORY from gp_params.xlsx into GP_Build/tickets/<project_id>_<ticket_id>_config.xlsx.',
    '3. Pre-fills FEATURE_BRANCH, DESTINATION_BRANCH, and AUTO_MERGE. Edit the ticket config file to adjust other parameters before submitting.',
    '4. Credentials are read from the shared secrets.xlsx (Jenkins sheet).',
  ], C.tealLight, C.teal));
  children.push(blank());

  children.push(...callout('📄', 'Reference docs:', [
    'GP_Build/ReadMe.docx  — setup, config.xlsx keys, Jenkins credentials, fetch_build_params.py, fetch_test_groups.py',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 4 — Local_Docker_Setup
  // ══════════════════════════════════════════════════════════
  children.push(h1('Local_Docker_Setup', C.teal));
  children.push(new Paragraph({
    children: [
      run('Scripts: '),
      code('Local_Docker_Setup/scripts/'),
      run('   Docs: '),
      code('DockerReadme.docx'),
    ],
    spacing: { before: 0, after: 100 },
  }));
  children.push(blank(40));

  children.push(h2('Docker Desktop'));
  children.push(commandTable([
    ['startdocker', '', 'Restart the vmcompute service, launch Docker Desktop elevated, and wait until the daemon is ready (polls docker info every 5 s for up to 300 s)'],
  ], C.teal));
  children.push(blank());

  children.push(h2('Container Lifecycle'));
  children.push(commandTable([
    ['setupservers',   '', 'Start the full container stack via docker compose up (creates containers if they do not exist). Supports -Detach, -Build, -ForceRecreate'],
    ['startservers',   '', 'Start all stopped containers (docker compose start). Automatically runs setupservers if no containers exist yet'],
    ['stopservers',    '', 'Stop running containers (docker compose stop). Supports -Down to also remove containers, -Volumes to also wipe named volumes'],
    ['deleteservers',  '', 'Stop then remove all containers (docker compose stop + down). Supports -Volumes'],
    ['restartservers', '', 'Full cycle: stop + remove + recreate + start (docker compose stop + down + up -d). Supports -Volumes'],
  ], C.teal));
  children.push(blank());

  children.push(h2('State Snapshot & Restore'));
  children.push(commandTable([
    ['savedockerstate',   'saveds',   'Commit each container filesystem + export named volumes into docker_state/<name>/. Usage: saveds <state_name>'],
    ['loaddockerstate',   'loadds',   'Restore a saved snapshot: loads committed images, restores volumes, starts containers + Artemis + Tomcat. Prompts if containers are running. Usage: loadds <state_name>'],
    ['removedockerstate', 'removeds', 'Delete a saved state folder (shows size + confirmation prompt). Usage: removeds <state_name>'],
    ['listdockerstate',   'listds',   'List all saved states — shows name, saved date, size on disk, and container names'],
  ], C.teal));
  children.push(blank());

  children.push(...callout('📄', 'Reference docs:', [
    'DockerReadme.docx  — all Docker commands, flows, troubleshooting, known config',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 5 — Local Clone Tool
  // ══════════════════════════════════════════════════════════
  children.push(h1('Local Clone Tool', C.gold));
  children.push(new Paragraph({
    children: [
      run('Scripts: '),
      code('Local_Clone_Tool/scripts/'),
      run('   Docs: '),
      code('Local_Clone_Tool/ReadMe.docx'),
      run('   Config: '),
      code('config.xlsx'),
      run(', '),
      code('projects.xlsx'),
    ],
    spacing: { before: 0, after: 100 },
  }));
  children.push(blank(40));

  children.push(commandTable([
    ['setuplclonetool', '', 'Create all skeleton files: config.xlsx, project_types/project_types.xlsx, project_config/<type>_config.xlsx, projects/<type>_projects.xlsx (two-sheet: Projects + PRs). Migrates existing CloneLog-only format automatically.'],
    ['lclone',          '', 'Create local fix branches from a JIRA clone ticket. Resolves release branch from fix versions via GitHub, sets up master + release branch, finds all merged PRs on the original ticket, cherry-picks each onto a separate clone branch, prompts push + PR creation per PR.  Usage: lclone -ticket PAYOR-208264'],
    ['lclonestatus',    '', 'List clone projects (newest 10 first). -p <n> for paging, -r for oldest-first.  lclonestatus -pid <id>  shows detail for a project and lets you interactively update individual PR statuses (Cloned / Branch Created / PR Raised / Merged).'],
    ['lclonedelete',    '', 'Delete a clone project entry by project ID. Removes per-project xlsx and clears rows from the shared index.  lclonedelete -pid <project_id>'],
  ], C.gold));
  children.push(blank());

  children.push(...callout('💡', 'How it works:', [
    '1. setuplclonetool: creates config.xlsx, project type registry, per-project config + tracking logs.',
    '2. lclone -ticket <ID>: fetches fix versions from JIRA, resolves release branch from GitHub (26.1.1.4 → 26.1.1.3 → … → 26.1.1.1), sets up master + release branch in local repo.',
    '3. Traverses "is cloned by" link chain to the true original ticket, finds all merged PRs targeting feature_branch.',
    '4. For each PR: creates clone branch (bug-PAYOR-208264_<suffix>), cherry-picks commits, prompts push + PR creation.',
    '5. lclonestatus tracks each PR independently (Cloned / Branch Created / PR Raised / Merged). Project = Complete only when all PRs are Merged.',
  ], C.goldLight, C.gold));
  children.push(blank());

  children.push(...callout('📄', 'Reference docs:', [
    'Local_Clone_Tool/ReadMe.docx  — setup, config.xlsx keys, projects.xlsx, token creation guide, troubleshooting',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 6 — Jenkins IT BaseLine Tool
  // ══════════════════════════════════════════════════════════
  children.push(h1('Jenkins IT BaseLine Tool  —  Payor', C.green));
  children.push(new Paragraph({
    children: [
      run('Scripts: '),
      code('Jenkins_BaseLine/scripts/'),
      run('   Docs: '),
      code('Jenkins_BaseLine/ReadMe.docx'),
      run('   Config: '),
      code('baseline_job_config.xlsx'),
    ],
    spacing: { before: 0, after: 100 },
  }));
  children.push(blank(40));

  children.push(commandTable([
    ['setupjbaselinetool',    '', 'Create skeleton config files (baseline_job_config.xlsx, projects.xlsx, jenkins_params/, git_config.xlsx). Run  setupjbaselinetool -fetchparams  after filling in URLs to fetch Jenkins build parameter definitions.'],
    ['jbaseline',         '', 'Run the full payor baseline. Phase 1 enables and triggers payor-core-commit, waits for a successful build. Phase 2 triggers payor-utils-certification + all 6 regression jobs. -payor <version> required.  --phase2-only skips Phase 1.'],
    ['jbaselinestatus',   '', 'Show run history from projects.xlsx. Jobs are grouped by phase (Pre-Build / Certification / Regression). Use -pid <id> for live Jenkins status, -p <n> for pagination, -r for oldest-first order.'],
    ['jbaselinedelete',   '', 'Delete a run entry from projects.xlsx and its per-run xlsx file.  jbaselinedelete -pid <project_id>'],
  ], C.green));
  children.push(blank());

  children.push(...callout('💡', 'Two-phase workflow:', [
    'Phase 1 (pre_build): enables payor-core-commit if disabled, triggers it, and waits for SUCCESS.',
    'Phase 2 (certification + regression): triggered automatically after Phase 1.',
    'URL templates in baseline_job_config.xlsx use {version} which is substituted at runtime.',
  ], C.greenLight, C.green));
  children.push(blank());

  children.push(...callout('📄', 'Reference docs:', [
    'Jenkins_BaseLine/ReadMe.docx  — setup, phases, config file reference, first-time setup steps',
  ], C.greenLight, C.green));
  children.push(blank());

  // ══════════════════════════════════════════════════════════
  // SECTION 7 — This document / listwfc
  // ══════════════════════════════════════════════════════════
  children.push(h1('Workflow Utilities', C.purple));
  children.push(commandTable([
    ['listwfc', '', 'Print all workflow commands grouped by section in the terminal. Run  listwfc <section>  to filter (e.g. listwfc docker, listwfc payor, listwfc regression)'],
  ], C.purple));
  children.push(blank());

  // ── Quick-reference summary ────────────────────────────────
  children.push(h1('Quick Reference — All Commands', C.navy));
  children.push(new Table({
    rows: [
      new TableRow({
        children: [
          hCell('Command',     C.navy, C.white, 24),
          hCell('Alias',       C.navy, C.white, 10),
          hCell('Section',     C.navy, C.white, 20),
          hCell('One-liner',   C.navy, C.white, 46),
        ],
        tableHeader: true,
      }),
      ...[
        // Payor
        ['listpayormodules',  'lpm',  'Payor / Modules',     'List all Payor modules — ready vs needs-build'],
        ['buildpayormodule',  'bpm',  'Payor / Modules',     'Build a module (+ dependents). Auto-detect stale via git'],
        ['deploypayormodule', 'dpm',  'Payor / Modules',     'Deploy a jar into the container (stop → copy → start)'],
        ['refresh-payor',     '',     'Payor / Refresh',     'Full build + deploy of the Payor stack'],
        ['localpayorregression',        'lprt', 'Payor / Regression',  'Run failed tests locally (Jenkins URL or class/method)'],
        ['remotepayorregression',        'rprt', 'Payor / Remote Regression',  'Fetch Jenkins failures → remote run → Excel → email draft'],
        ['remotepopulatepayorbaseline',  'rpb',  'Payor / Remote Regression',  'Fetch baseline Jenkins failures → write Baseline_Jenkins_IT_Status.xlsx'],
        ['gpregressionresult',           'gpr',  'Payor / Remote Regression',  'Fetch GP Jenkins results → mark GP Failure in Excel → regenerate email'],
        // Docker
        ['startdocker',       '',     'Docker',              'Restart vmcompute + start Docker Desktop + wait'],
        ['setupservers',      '',     'Docker',              'docker compose up (creates + starts containers)'],
        ['startservers',      '',     'Docker',              'docker compose start (starts stopped containers)'],
        ['stopservers',       '',     'Docker',              'docker compose stop [+ down + volumes]'],
        ['deleteservers',     '',     'Docker',              'docker compose stop + down'],
        ['restartservers',    '',     'Docker',              'docker compose stop + down + up -d'],
        ['savedockerstate',   'saveds',   'Docker / State',  'Commit container filesystems + volumes to docker_state/'],
        ['loaddockerstate',   'loadds',   'Docker / State',  'Restore snapshot (warns if containers are running)'],
        ['removedockerstate', 'removeds', 'Docker / State',  'Delete a saved state folder (with confirmation)'],
        ['listdockerstate',   'listds',   'Docker / State',  'List all saved states with date, size, containers'],
        // GP Build Tool
        ['setupgptool',       '',     'GP_Build Tool',       'Create skeleton files. Add -fetchparams to fetch Jenkins params into gp_params.xlsx'],
        ['gpstatus',          '',     'GP_Build Tool',       'List projects with build + PR status. -rf refresh active. -s <status> filter'],
        ['gpdelete',          '',     'GP_Build Tool',       'Delete project entry by ID.  gpdelete -pid <project_id>'],
        ['gprun',             '',     'GP_Build Tool',       'Trigger GP Jenkins build. Extracts ticket from branch, resolves PR, captures job ID'],
        // Local Clone Tool
        ['setuplclonetool',   '',     'Local Clone Tool',    'Create skeleton files. Migrates CloneLog to Projects + PRs sheets'],
        ['lclone',            '',     'Local Clone Tool',    'Branch + cherry-pick from JIRA clone ticket.  -ticket PAYOR-208264'],
        ['lclonestatus',      '',     'Local Clone Tool',    'List projects + PR statuses. -pid <id> for detail + interactive update'],
        ['lclonedelete',      '',     'Local Clone Tool',    'Delete project entry by ID. -pid <project_id>'],
        // Jenkins IT BaseLine Tool
        ['setupjbaselinetool',    '',     'Jenkins BaseLine',    'Create skeleton files. Add -fetchparams to fetch Jenkins params'],
        ['jbaseline',         '',     'Jenkins BaseLine',    'Phase 1 (payor-core-commit) then Phase 2 (cert + regression). -payor required'],
        ['jbaselinestatus',   '',     'Jenkins BaseLine',    'Run history grouped by phase. -pid <id> for live status'],
        ['jbaselinedelete',   '',     'Jenkins BaseLine',    'Delete run entry by ID.  -pid <project_id>'],
        ['jbaselineschedule', '',     'Jenkins BaseLine',    'Scheduler: poll payor-core-commit, auto-trigger Phase 2 on new builds'],
        // Utilities
        ['listwfc',           '',     'Utilities',           'Print this command list in the terminal'],
      ].map(function(r, ri) {
        const fill = ri % 2 === 0 ? C.grey : C.white;
        return new TableRow({
          children: [
            cCell(r[0], fill, 24),
            aliasCell(r[1], fill, 10),
            bCell(r[2], fill, 20, C.greyDark),
            bCell(r[3], fill, 46),
          ],
        });
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
  }));
  children.push(blank());

  // ── Footer ─────────────────────────────────────────────────
  children.push(divider());
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Workflow Commands', font: 'Calibri', size: 18, bold: true, color: C.greyDark }),
      new TextRun({ text: '   |   ', font: 'Calibri', size: 18, color: C.greyDark }),
      new TextRun({ text: 'HealthEdge Software, Inc', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
      new TextRun({ text: '   |   Run  listwfc  to see this list in the terminal', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
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
        document: { run: { font: 'Calibri', size: 22, color: C.black } },
      },
    },
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log('WorkFlowCommands.docx written to:', OUT);
}

main().catch(function(e) { console.error(e); process.exit(1); });
