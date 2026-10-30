// ============================================================
// gen_docker_readme.js — Generate DockerReadme.docx
//
// USAGE:  node scripts/gen_docker_readme.js
// OUTPUT: DockerReadme.docx  (sibling of scripts/)
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

const OUT = path.join(__dirname, '..', 'DockerReadme.docx');

const C = {
  navy:       '1F3864',
  teal:       '1F7A8C',
  tealLight:  'D6EEF2',
  gold:       'C9A227',
  goldLight:  'FFF8E1',
  green:      '1E6B3C',
  greenLight: 'E8F5E9',
  red:        'C0392B',
  redLight:   'FDECEA',
  grey:       'F2F4F6',
  greyDark:   '5A6370',
  white:      'FFFFFF',
  black:      '000000',
};

function run(text, opts) {
  opts = opts || {};
  return new TextRun({
    text, font: 'Calibri', size: opts.size || 22,
    bold: opts.bold || false, italics: opts.italics || false,
    color: opts.color || C.black,
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
    children: [new TextRun({ text, font: 'Calibri', size: 22, color: C.tealLight, italics: true })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.navy },
    spacing: { before: 0, after: 300 },
    alignment: AlignmentType.CENTER,
  });
}

function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text: '  ' + text, font: 'Calibri', size: 32,
      bold: true, color: C.white })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.teal },
    spacing: { before: 300, after: 160 },
    border: { left: { style: BorderStyle.THICK, size: 24, color: C.gold } },
  });
}

function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 26, bold: true, color: C.teal })],
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.teal } },
  });
}

function body(children) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: 0, after: 100, line: 276 },
  });
}

function bullet(children, level) {
  level = level || 0;
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    bullet: { level },
    indent: { left: convertInchesToTwip(level === 0 ? 0.25 : 0.5), hanging: convertInchesToTwip(0.25) },
    spacing: { before: 0, after: 60, line: 276 },
  });
}

function codeBlock(lines) {
  return lines.map(function(line, i) {
    return new Paragraph({
      children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 18, color: '2E4057' })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
      spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0, line: 240 },
      border: i === 0
        ? { top:   { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            left:  { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } }
        : i === lines.length - 1
        ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            left:   { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            right:  { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } }
        : { left:  { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
      indent: { left: convertInchesToTwip(0.15) },
    });
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
      spacing: { before: 60, after: 60 },
      indent: { left: convertInchesToTwip(0.08) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.navy },
    verticalAlign: VerticalAlign.CENTER,
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
  });
}

function bCell(children, fill, w, opts) {
  fill = fill || C.white; opts = opts || {};
  const runs = typeof children === 'string'
    ? [new TextRun({ text: children, font: 'Calibri', size: 20, color: C.black, bold: opts.bold || false })]
    : Array.isArray(children) ? children : [children];
  return new TableCell({
    children: [new Paragraph({
      children: runs,
      spacing: { before: 60, after: 60 },
      indent: { left: convertInchesToTwip(0.08) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    verticalAlign: VerticalAlign.CENTER,
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
  });
}

function cCell(text, fill, w) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Courier New', size: 18, color: '2E4057' })],
      spacing: { before: 60, after: 60 },
      indent: { left: convertInchesToTwip(0.08) },
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: fill || C.white },
    verticalAlign: VerticalAlign.CENTER,
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
  });
}

function kvTable(headers, rows, widths) {
  widths = widths || [30, 70];
  return new Table({
    rows: [
      new TableRow({
        children: headers.map(function(h, i) { return hCell(h, C.navy, C.white, widths[i]); }),
        tableHeader: true,
      }),
      ...rows.map(function(r, ri) {
        return new TableRow({
          children: r.map(function(cell, ci) {
            const fill = ri % 2 === 0 ? C.grey : C.white;
            const w    = widths[ci] || null;
            if (typeof cell === 'object' && cell.code) return cCell(cell.text, fill, w);
            if (typeof cell === 'object' && cell.bold) return bCell(cell.text, fill, w, { bold: true });
            return bCell(typeof cell === 'object' ? cell.text : cell, fill, w);
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

function step(num, titleText, bodyRuns) {
  return [
    new Paragraph({
      children: [
        new TextRun({ text: num + '.  ', font: 'Calibri', size: 24, bold: true, color: C.teal }),
        new TextRun({ text: titleText,   font: 'Calibri', size: 24, bold: true, color: C.navy }),
      ],
      spacing: { before: 160, after: 60 },
      indent: { left: convertInchesToTwip(0.1) },
    }),
    new Paragraph({
      children: bodyRuns,
      spacing: { before: 0, after: 80 },
      indent: { left: convertInchesToTwip(0.35) },
    }),
  ];
}

function flowDiagram(lines) {
  return lines.map(function(line, i) {
    return new Paragraph({
      children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 18, color: '2E4057' })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF3F8' },
      spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0, line: 240 },
      alignment: AlignmentType.LEFT,
      indent: { left: convertInchesToTwip(0.3) },
      border: i === 0
        ? { top:   { style: BorderStyle.SINGLE, size: 6, color: C.teal },
            left:  { style: BorderStyle.THICK,  size: 16, color: C.teal },
            right: { style: BorderStyle.SINGLE, size: 6, color: C.teal } }
        : i === lines.length - 1
        ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.teal },
            left:   { style: BorderStyle.THICK,  size: 16, color: C.teal },
            right:  { style: BorderStyle.SINGLE, size: 6, color: C.teal } }
        : { left:  { style: BorderStyle.THICK,  size: 16, color: C.teal },
            right: { style: BorderStyle.SINGLE, size: 6, color: C.teal } },
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

// ─────────────────────────────────────────────────────────────
// DOCUMENT CONTENT
// ─────────────────────────────────────────────────────────────

function buildDoc() {
  const children = [];

  // ── Cover ──────────────────────────────────────────────────
  children.push(titlePara('Local Docker Setup'));
  children.push(subtitlePara(
    'startdocker  |  setupservers  |  startservers  |  stopservers  |  deleteservers  |  restartservers' +
    '  |  savedockerstate  |  loaddockerstate  |  removedockerstate  |  listdockerstate  —  Windows'
  ));
  children.push(blank(120));

  // ── Overview ───────────────────────────────────────────────
  children.push(h1('Overview'));
  children.push(body([run('Global commands manage the local Docker environment on Windows:')]));
  children.push(blank(60));

  children.push(bullet([run('startdocker', { bold: true }),
    run(' — restarts '), code('vmcompute'), run(', launches Docker Desktop elevated, waits for daemon ready.')]));
  children.push(bullet([run('setupservers', { bold: true }),
    run(' — '), code('docker compose up'), run('. Default: Tomcat stack. Use '), code('-weblogic'), run(' for the WebLogic stack.')]));
  children.push(bullet([run('startservers', { bold: true }),
    run(' — '), code('docker compose start'), run('. Starts stopped containers; auto-creates if none exist.')]));
  children.push(bullet([run('stopservers', { bold: true }),
    run(' — '), code('docker compose stop'), run('. Use '), code('-Down'), run(' to also remove containers.')]));
  children.push(bullet([run('deleteservers', { bold: true }),
    run(' — '), code('docker compose stop'), run(' + '), code('down'), run('. Use '), code('-volumes'), run(' to also remove named volumes.')]));
  children.push(bullet([run('restartservers', { bold: true }),
    run(' — full cycle: '), code('stop'), run(' + '), code('down'), run(' + '), code('up -d'),
    run('. Use '), code('-weblogic'), run(' for WebLogic stack, '), code('-volumes'), run(' to wipe named volumes.')]));
  children.push(bullet([run('savedockerstate  /  saveds', { bold: true }),
    run(' — snapshot compose file + inspect JSON + named volume tars into '), code('docker_state/<name>/'), run('.')]));
  children.push(bullet([run('loaddockerstate  /  loadds', { bold: true }),
    run(' — restore a saved state. Warns + confirms before stopping containers, restoring volumes, restarting.')]));
  children.push(bullet([run('removedockerstate  /  removeds', { bold: true }),
    run(' — delete a saved state folder (shows size + red confirmation prompt).')]));
  children.push(bullet([run('listdockerstate  /  listds', { bold: true }),
    run(' — list all saved states: name, saved date, size on disk, containers.')]));
  children.push(blank());
  children.push(body([
    run('All commands are available from any PowerShell or Command Prompt window via CMD wrappers in '),
    code('' + require('os').homedir() + '\\.local\\bin'), run(' (already on PATH).'),
  ]));
  children.push(blank());

  // ── Command Reference ──────────────────────────────────────
  children.push(h1('Command Reference'));
  children.push(new Table({
    rows: [
      new TableRow({
        children: [hCell('Command', C.navy, C.white, 24), hCell('Runs', C.navy, C.white, 36), hCell('When to use', C.navy, C.white, 40)],
        tableHeader: true,
      }),
      ...[
        ['startdocker',                    'Restart-Service vmcompute + Docker Desktop.exe',              'Docker Desktop is not running yet'],
        ['setupservers [-weblogic]',        'docker compose up  (tomcat or weblogic compose file)',        'First run or after deleteservers — creates and starts containers'],
        ['startservers',                    'docker compose start  (or up -d if no containers exist)',     'Start stopped containers; auto-runs setup if no containers exist'],
        ['stopservers',                     'docker compose stop',                                         'Stop containers but keep them for quick restart'],
        ['deleteservers [-volumes]',        'docker compose stop then down [--volumes]',                   'Stop and fully remove containers (and optionally volumes)'],
        ['restartservers [-weblogic] [-volumes]', 'docker compose stop + down + up -d',                   'Full cycle: delete then recreate and start all containers'],
        ['savedockerstate / saveds',        'Saves compose file + docker inspect + volume tars',           'Checkpoint current state before risky changes'],
        ['loaddockerstate / loadds',        'Stops containers (with confirmation), restores volumes, starts containers', 'Restore a previously saved checkpoint'],
        ['removedockerstate / removeds',    'Removes state folder from docker_state/ (with confirmation)','Delete a state you no longer need'],
        ['listdockerstate / listds',        'Lists all folders in docker_state/ with metadata',            'See all saved states at a glance'],
      ].map(function(r, ri) {
        const fill = ri % 2 === 0 ? C.grey : C.white;
        return new TableRow({ children: [cCell(r[0], fill, 24), cCell(r[1], fill, 36), bCell(r[2], fill, 40)] });
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
  }));
  children.push(blank());

  children.push(...callout('>', 'Typical workflow:', [
    '1. startdocker                     -- bring up Docker Desktop',
    '2. startservers                    -- start containers; auto-creates them if needed',
    '3. saveds <name>                   -- (optional) checkpoint state before risky work',
    '4. <do your work>',
    '5. loadds <name>                   -- (optional) restore checkpoint if something broke',
    '6. stopservers                     -- stop containers at end of day (quick to restart)',
    '   deleteservers                   -- remove containers entirely (clean slate)',
    '   restartservers                  -- full reset: delete + recreate + start in one step',
  ], C.greenLight, C.green));
  children.push(blank());

  // ── startdocker Flow ──────────────────────────────────────
  children.push(h1('startdocker — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  startdocker  (CMD wrapper  ->  startdocker.ps1)',
    '          |',
    '          v',
    '  [1]  Check if running as Administrator',
    '          |   If NOT admin: re-launch script elevated via Start-Process -Verb RunAs',
    '          |   Terminal returns immediately; elevated window handles steps 2-4',
    '          v',
    '  [2]  Restart-Service vmcompute -Force',
    '          |   Restarts the Windows Container compute service',
    '          |   Continues with a warning if the service cannot be restarted',
    '          v',
    '  [3]  Check if "Docker Desktop" process is already running',
    '          |   If already running: skip launch',
    '          |   If not running:',
    '          |       Start-Process "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" -Verb RunAs',
    '          v',
    '  [4]  Poll: docker version  (every 5 s, up to 300 s)',
    '          |   If exit 0  -> daemon is ready',
    '          |   If 300 s elapsed without response -> warning, exit 1',
    '          v',
    '  Done — Docker daemon is ready',
    '',
  ]));
  children.push(blank());
  children.push(...callout('!', 'UAC prompt expected:', [
    'Because vmcompute requires Administrator, you will see a Windows UAC elevation prompt.',
    'Click Yes to allow. The elevated window handles vmcompute + Docker Desktop startup.',
    'Your original terminal returns immediately after opening the elevated window.',
  ], C.goldLight, C.gold));
  children.push(blank());

  // ── startdocker Usage ─────────────────────────────────────
  children.push(h1('startdocker — Usage'));
  children.push(h2('Start Docker Desktop'));
  children.push(...codeBlock(['startdocker']));
  children.push(body([run('Restarts vmcompute, starts Docker Desktop, waits for daemon.')]));
  children.push(blank());
  children.push(h2('Verify Docker is ready'));
  children.push(...codeBlock(['docker info', 'docker ps']));
  children.push(blank());

  // ── setupservers Flow ──────────────────────────────────────
  children.push(h1('setupservers — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  setupservers [-weblogic]  (CMD wrapper  ->  setupservers.ps1)',
    '          |',
    '          v',
    '  [1]  Resolve compose file',
    '          |   Default (no flag):  compose_with_tomcat.yaml',
    '          |   With -weblogic:     compose_with_weblogic.yaml',
    '          v',
    '  [2]  Verify compose file exists on disk',
    '          |   Aborts with error if not found',
    '          v',
    '  [3]  Verify docker daemon is running  (docker version)',
    '          |   If not running: error -- run startdocker first',
    '          v',
    '  [4]  docker compose -f <file> up  [flags]',
    '          |   -Detach        -> adds -d  (background)',
    '          |   -Build         -> adds --build  (rebuild images)',
    '          |   -ForceRecreate -> adds --force-recreate',
    '          v',
    '  Done — all containers in the stack are running',
    '',
  ]));
  children.push(blank());

  // ── setupservers Usage ─────────────────────────────────────
  children.push(h1('setupservers — Usage'));
  children.push(h2('Start Tomcat stack (default)'));
  children.push(...codeBlock(['setupservers']));
  children.push(body([run('Runs '), code('docker compose -f compose_with_tomcat.yaml up'), run(' in the foreground.')]));
  children.push(blank());
  children.push(h2('Start WebLogic stack'));
  children.push(...codeBlock(['setupservers -weblogic']));
  children.push(body([run('Runs '), code('docker compose -f compose_with_weblogic.yaml up'), run('.')]));
  children.push(blank());
  children.push(h2('Start in detached (background) mode'));
  children.push(...codeBlock(['setupservers -Detach', 'setupservers -weblogic -Detach']));
  children.push(blank());
  children.push(h2('Other flags'));
  children.push(...codeBlock(['setupservers -Build', 'setupservers -ForceRecreate', 'setupservers -Detach -Build']));
  children.push(blank());
  children.push(h2('Options'));
  children.push(kvTable(['Flag', 'docker compose equivalent', 'Description'], [
    [{ text: '-weblogic',      code: true }, { text: '(selects compose file)',  code: true }, 'Use compose_with_weblogic.yaml instead of tomcat'],
    [{ text: '-Detach',        code: true }, { text: '-d',                      code: true }, 'Run containers in background'],
    [{ text: '-Build',         code: true }, { text: '--build',                 code: true }, 'Rebuild images before starting'],
    [{ text: '-ForceRecreate', code: true }, { text: '--force-recreate',        code: true }, 'Recreate containers even if config unchanged'],
  ], [22, 30, 48]));
  children.push(blank());

  // ── startservers Flow ──────────────────────────────────────
  children.push(h1('startservers — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  startservers  (CMD wrapper  ->  startservers.ps1)',
    '          |',
    '          v',
    '  [1]  Verify compose file exists  (compose_with_tomcat.yaml)',
    '          v',
    '  [2]  Verify docker daemon is running',
    '          v',
    '  [3]  Check: do containers exist?  (docker compose ps -q)',
    '          |',
    '          +-- NO  -> docker compose up -d',
    '          |         Creates and starts all containers (first run / after deleteservers)',
    '          |',
    '          +-- YES -> docker compose start',
    '                    Starts stopped containers; skips already-running ones',
    '          v',
    '  Done — all containers are running',
    '',
  ]));
  children.push(blank());
  children.push(...callout('i', 'startservers is all you need:', [
    '  Containers exist (stopped or mixed)  ->  docker compose start',
    '  No containers yet (first run / after deleteservers)  ->  docker compose up -d',
    'You no longer need to decide between startservers and setupservers for the first run.',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ── startservers Usage ─────────────────────────────────────
  children.push(h1('startservers — Usage'));
  children.push(...codeBlock(['startservers']));
  children.push(body([run('Starts every stopped container. Already-running containers are untouched.')]));
  children.push(blank());

  // ── stopservers Flow ───────────────────────────────────────
  children.push(h1('stopservers — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  stopservers  (CMD wrapper  ->  stopservers.ps1)',
    '          |',
    '          v',
    '  [1]  Verify compose file exists',
    '          v',
    '  [2]  Verify docker daemon is running',
    '          v',
    '  [3a] Default -- docker compose stop',
    '          |   Stops containers, preserves them (restartable with startservers)',
    '          |',
    '  [3b] With -Down -- docker compose down  [--volumes]',
    '          |   Stops + removes containers',
    '          |   -volumes also removes named volumes',
    '          v',
    '  Done — containers stopped',
    '',
  ]));
  children.push(blank());

  // ── stopservers Usage ──────────────────────────────────────
  children.push(h1('stopservers — Usage'));
  children.push(h2('Stop all containers (preserve for restart)'));
  children.push(...codeBlock(['stopservers']));
  children.push(blank());
  children.push(h2('Stop and remove containers'));
  children.push(...codeBlock(['stopservers -Down']));
  children.push(blank());
  children.push(h2('Stop, remove containers and named volumes'));
  children.push(...codeBlock(['stopservers -Down -volumes']));
  children.push(blank());
  children.push(h2('Options'));
  children.push(kvTable(['Flag', 'docker compose equivalent', 'Description'], [
    [{ text: '(none)',    code: true }, { text: 'stop',           code: true }, 'Stop containers, keep them for restart'],
    [{ text: '-Down',    code: true }, { text: 'down',           code: true }, 'Stop and remove containers'],
    [{ text: '-volumes', code: true }, { text: 'down --volumes', code: true }, 'Also remove named volumes (use with -Down)'],
  ], [22, 30, 48]));
  children.push(blank());

  // ── deleteservers Flow ─────────────────────────────────────
  children.push(h1('deleteservers — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  deleteservers  (CMD wrapper  ->  deleteservers.ps1)',
    '          |',
    '          v',
    '  [1]  Verify compose file exists',
    '          v',
    '  [2]  Verify docker daemon is running',
    '          v',
    '  [3]  docker compose stop',
    '          |   Gracefully stops all running containers',
    '          v',
    '  [4]  docker compose down  [--volumes]',
    '          |   Removes stopped containers + networks',
    '          |   -volumes also removes named volumes',
    '          v',
    '  Done — containers stopped and removed',
    '',
  ]));
  children.push(blank());

  // ── deleteservers Usage ────────────────────────────────────
  children.push(h1('deleteservers — Usage'));
  children.push(h2('Stop and delete containers'));
  children.push(...codeBlock(['deleteservers']));
  children.push(blank());
  children.push(h2('Stop, delete containers and named volumes'));
  children.push(...codeBlock(['deleteservers -volumes']));
  children.push(blank());
  children.push(h2('Options'));
  children.push(kvTable(['Flag', 'Description'], [
    [{ text: '(none)',    code: true }, 'stop -> down (remove containers + networks)'],
    [{ text: '-volumes', code: true }, 'stop -> down --volumes (also remove named volumes)'],
  ], [22, 78]));
  children.push(blank());

  // ── restartservers Flow ────────────────────────────────────
  children.push(h1('restartservers — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  restartservers [-weblogic] [-volumes]  (CMD wrapper  ->  restartservers.ps1)',
    '          |',
    '          v',
    '  [1]  Resolve compose file',
    '          |   With -weblogic:      compose_with_weblogic.yaml',
    '          |   Without -weblogic:   auto-detect',
    '          |     compose_with_tomcat.yaml exists  ->  use tomcat',
    '          |     only weblogic exists             ->  use weblogic',
    '          v',
    '  [2]  Verify compose file exists; verify docker daemon running',
    '          v',
    '  [3]  docker compose stop',
    '          |   Gracefully stops all running containers',
    '          v',
    '  [4]  docker compose down  [--volumes]',
    '          |   Removes stopped containers + networks',
    '          |   -volumes also removes named volumes',
    '          v',
    '  [5]  docker compose up -d',
    '          |   Recreates and starts all containers in background',
    '          v',
    '  Done -- all containers recreated and running',
    '',
  ]));
  children.push(blank());

  // ── restartservers Usage ───────────────────────────────────
  children.push(h1('restartservers — Usage'));
  children.push(h2('Full restart — Tomcat stack (auto-detected)'));
  children.push(...codeBlock(['restartservers']));
  children.push(blank());
  children.push(h2('Full restart — WebLogic stack'));
  children.push(...codeBlock(['restartservers -weblogic']));
  children.push(blank());
  children.push(h2('Full restart including named volumes'));
  children.push(...codeBlock(['restartservers -volumes', 'restartservers -weblogic -volumes']));
  children.push(blank());
  children.push(h2('Options'));
  children.push(kvTable(['Flag', 'Description'], [
    [{ text: '-weblogic', code: true }, 'Use compose_with_weblogic.yaml (default: auto-detect tomcat vs weblogic)'],
    [{ text: '-volumes',  code: true }, 'stop -> down --volumes -> up -d  (also wipe named volumes)'],
  ], [22, 78]));
  children.push(blank());

  // ── savedockerstate Flow ───────────────────────────────────
  children.push(h1('savedockerstate / saveds — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  savedockerstate <state_name>   (or  saveds <state_name>)',
    '          |',
    '          v',
    '  [1]  Validate -- state folder must not already exist',
    '          v',
    '  [2]  Create  docker_state/<state_name>/  +  volumes/  subfolder',
    '          v',
    '  [3]  Copy active compose file  ->  docker-compose.yaml',
    '          |   Source: dockerVM/.../compose_with_tomcat.yaml',
    '          |   Fallback: dockercompose/ folder',
    '          v',
    '  [4]  For each running container:',
    '          |   docker inspect <name>  ->  inspect_<name>.json',
    '          |   For each named volume attached:',
    '          |       docker run alpine  tar -czf  ->  volumes/<cname>__<vol>.tar',
    '          v',
    '  [5]  Write metadata.json  (images, volume map, timestamp)',
    '          v',
    '  Done — state saved to  docker_state/<state_name>/',
    '',
  ]));
  children.push(blank());

  // ── savedockerstate Usage ──────────────────────────────────
  children.push(h1('savedockerstate / saveds — Usage'));
  children.push(h2('Save current state'));
  children.push(...codeBlock([
    'savedockerstate baseline-26.1',
    'saveds          baseline-26.1   # short alias',
  ]));
  children.push(blank());
  children.push(h2('What gets saved'));
  children.push(kvTable(['File', 'Contents'], [
    [{ text: 'docker-compose.yaml',       code: true }, 'Active compose file at time of save'],
    [{ text: 'inspect_<container>.json',  code: true }, 'Full docker inspect output for each running container'],
    [{ text: 'volumes/<c>__<vol>.tar',    code: true }, 'tar.gz export of each named volume via a temporary alpine container'],
    [{ text: 'metadata.json',             code: true }, 'Images, container names, volume map, save timestamp'],
  ], [42, 58]));
  children.push(blank());
  children.push(...callout('i', 'Tip:', [
    'Save a checkpoint before any risky operation -- schema migration, image upgrade, -c refresh.',
    'State names are just folder names; use descriptive names like  before-upgrade  or  26.1-clean.',
    'Use  listds  to see all saved states at any time.',
  ]));
  children.push(blank());

  // ── loaddockerstate Flow ───────────────────────────────────
  children.push(h1('loaddockerstate / loadds — Execution Flow'));
  children.push(...flowDiagram([
    '',
    '  loaddockerstate <state_name>   (or  loadds <state_name>)',
    '          |',
    '          v',
    '  [1]  Validate -- state folder and metadata.json must exist',
    '          |   Lists available states if the name is not found',
    '          v',
    '  [2]  Check for running containers  (docker ps)',
    '          |',
    '          +-- Containers ARE running:',
    '          |     Show WARNING box listing each container + status',
    '          |     Prompt: "Proceed? [y/N]"',
    '          |       N / Enter  ->  Aborted, no changes made',
    '          |       Y          ->  continue',
    '          |',
    '          +-- No containers running  ->  continue silently',
    '          v',
    '  [3]  Stop + remove containers',
    '          |   docker compose down --remove-orphans',
    '          v',
    '  [4]  Restore compose file',
    '          |   Back up current compose  ->  compose_with_tomcat_bkp.yaml',
    '          |   Copy saved docker-compose.yaml  ->  compose_with_tomcat.yaml',
    '          v',
    '  [5]  For each named volume in metadata:',
    '          |   docker volume rm + create; docker run alpine tar -xzf',
    '          v',
    '  [6]  docker compose up -d',
    '          v',
    '  [7]  Start Artemis + Tomcat inside payer-tc-261',
    '          v',
    '  Done — state restored, containers + servers running',
    '',
  ]));
  children.push(blank());
  children.push(...callout('!', 'Destructive operation:', [
    'Loading a state WIPES the current named volumes and replaces them with the saved data.',
    'The running-containers warning and [y/N] prompt are your last chance to abort.',
    'Save your current state first with  saveds <name>  if you may need to go back.',
  ], C.redLight, C.red));
  children.push(blank());

  // ── loaddockerstate Usage ──────────────────────────────────
  children.push(h1('loaddockerstate / loadds — Usage'));
  children.push(h2('Restore a saved state'));
  children.push(...codeBlock([
    'loaddockerstate baseline-26.1',
    'loadds          baseline-26.1   # short alias',
  ]));
  children.push(blank());
  children.push(h2('Sample interaction when containers are running'));
  children.push(...codeBlock([
    '> loadds baseline-26.1',
    '[2026-07-16 10:00:01] Loading Docker state \'baseline-26.1\'  (saved: 2026-07-14 09:30:00)',
    '',
    '  +--------------------------------------------------------------+',
    '  |  WARNING: The following containers are currently running:    |',
    '  +--------------------------------------------------------------+',
    '  |    payer-tc-261   [running]                                  |',
    '  |    payer-db-261   [running]                                  |',
    '  |    connector-261  [running]                                  |',
    '  +--------------------------------------------------------------+',
    '  |  Loading state will:                                         |',
    '  |    1. Stop and remove all running containers                 |',
    '  |    2. Restore named volumes from saved state                 |',
    '  |    3. Start containers from the saved compose file           |',
    '  |    4. Start Artemis + Tomcat inside payer-tc-261             |',
    '  +--------------------------------------------------------------+',
    '',
    '  Proceed? [y/N]: y',
    '',
    '[2026-07-16 10:00:05] Stopping and removing running containers...',
    '[2026-07-16 10:00:15] Restoring compose file...',
    '[2026-07-16 10:00:15] No named volumes to restore.',
    '[2026-07-16 10:00:45] Starting containers via docker compose...',
    '[2026-07-16 10:01:10] Starting Artemis inside payer-tc-261...',
    '[2026-07-16 10:01:30] Starting Tomcat inside payer-tc-261...',
    '[2026-07-16 10:01:35] State \'baseline-26.1\' loaded successfully.',
  ]));
  children.push(blank());

  // ── removedockerstate ──────────────────────────────────────
  children.push(h1('removedockerstate / removeds — Usage'));
  children.push(...flowDiagram([
    '',
    '  removedockerstate <state_name>   (or  removeds <state_name>)',
    '          |',
    '          v',
    '  [1]  Validate -- state folder must exist',
    '          |   Lists available states if the name is not found',
    '          v',
    '  [2]  Show state path + size (MB)',
    '          |   Red confirmation box: "Delete? [y/N]"',
    '          |   N / Enter  ->  Aborted, nothing deleted',
    '          |   Y          ->  Remove-Item -Recurse -Force <state_dir>',
    '          v',
    '  Done -- state folder deleted',
    '',
  ]));
  children.push(blank());
  children.push(h2('Delete a saved state'));
  children.push(...codeBlock([
    'removedockerstate old-baseline',
    'removeds          old-baseline   # short alias',
  ]));
  children.push(blank());

  // ── listdockerstate ────────────────────────────────────────
  children.push(h1('listdockerstate / listds — Usage'));
  children.push(h2('List all saved states'));
  children.push(...codeBlock([
    'listdockerstate',
    'listds           # short alias',
  ]));
  children.push(blank());
  children.push(h2('Sample output'));
  children.push(...codeBlock([
    '  Saved Docker states  (...\\Local_Docker_Setup\\docker_state)',
    '  ------------------------------------------------------------------------',
    '  NAME                  SAVED AT                SIZE      CONTAINERS',
    '  ------------------------------------------------------------------------',
    '  baseline-26.1         2026-07-14 09:30:00     0.2 MB    payer-tc-261, payer-db-261, connector-261',
    '  before-upgrade        2026-07-16 08:15:00     0.1 MB    payer-tc-261, payer-db-261, connector-261',
    '  ------------------------------------------------------------------------',
    '  2 state(s) total',
  ]));
  children.push(blank());

  // ── File Structure ─────────────────────────────────────────
  children.push(h1('File Structure'));
  children.push(...codeBlock([
    'Local_Docker_Setup/',
    '  scripts/',
    '    startdocker.ps1            Restart vmcompute + launch Docker Desktop',
    '    setupservers.ps1           docker compose up  (-weblogic for WebLogic stack)',
    '    startservers.ps1           docker compose start (start stopped containers)',
    '    stopservers.ps1            docker compose stop / down',
    '    deleteservers.ps1          docker compose stop then down',
    '    restartservers.ps1         docker compose stop + down + up -d  (-weblogic supported)',
    '    save_docker_state.ps1      Snapshot containers + volumes to docker_state/<name>/',
    '    load_docker_state.ps1      Restore snapshot; warns + confirms if containers running',
    '    remove_docker_state.ps1    Delete a saved state folder (with confirmation)',
    '    list_docker_states.ps1     List all saved states with metadata',
    '    gen_docker_readme.js       Generates this DockerReadme.docx',
    '  docker_state/                Saved state folders (one per saveds invocation)',
    '    <state_name>/',
    '      docker-compose.yaml',
    '      inspect_<container>.json',
    '      metadata.json',
    '      volumes/',
    '        <container>__<volume>.tar',
    '  dockercompose/               Compose file source / reference copies',
    '  DockerReadme.docx            This document',
    '',
    '' + require('os').homedir() + '\\.local\\bin\\',
    '  startdocker.cmd              Global CMD wrapper (on PATH)',
    '  setupservers.cmd             Global CMD wrapper (on PATH)',
    '  startservers.cmd             Global CMD wrapper (on PATH)',
    '  stopservers.cmd              Global CMD wrapper (on PATH)',
    '  deleteservers.cmd            Global CMD wrapper (on PATH)',
    '  restartservers.cmd           Global CMD wrapper (on PATH)',
    '  savedockerstate.cmd          Global CMD wrapper (on PATH)',
    '  saveds.cmd                   Alias for savedockerstate (on PATH)',
    '  loaddockerstate.cmd          Global CMD wrapper (on PATH)',
    '  loadds.cmd                   Alias for loaddockerstate (on PATH)',
    '  removedockerstate.cmd        Global CMD wrapper (on PATH)',
    '  removeds.cmd                 Alias for removedockerstate (on PATH)',
    '  listdockerstate.cmd          Global CMD wrapper (on PATH)',
    '  listds.cmd                   Alias for listdockerstate (on PATH)',
    '',
    '' + require('os').homedir() + '\\dockerVM\\dockerPOCArtifacts\\dockerCompose\\',
    '  compose_with_tomcat.yaml     Active Tomcat compose file',
    '  compose_with_weblogic.yaml   WebLogic compose file (used with -weblogic)',
  ]));
  children.push(blank());

  // ── Known configuration ────────────────────────────────────
  children.push(h1('Known Configuration (this machine)'));
  children.push(kvTable(['Setting', 'Value'], [
    ['Docker Desktop path',             { text: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', code: true }],
    ['Tomcat compose file',             { text: '' + require('os').homedir() + '\\dockerVM\\dockerPOCArtifacts\\dockerCompose\\compose_with_tomcat.yaml', code: true }],
    ['WebLogic compose file',           { text: '' + require('os').homedir() + '\\dockerVM\\dockerPOCArtifacts\\dockerCompose\\compose_with_weblogic.yaml', code: true }],
    ['savedockerstate / saveds wrappers', { text: '' + require('os').homedir() + '\\.local\\bin\\savedockerstate.cmd  /  saveds.cmd', code: true }],
    ['loaddockerstate / loadds wrappers', { text: '' + require('os').homedir() + '\\.local\\bin\\loaddockerstate.cmd  /  loadds.cmd', code: true }],
    ['removedockerstate / removeds wrappers', { text: '' + require('os').homedir() + '\\.local\\bin\\removedockerstate.cmd  /  removeds.cmd', code: true }],
    ['listdockerstate / listds wrappers', { text: '' + require('os').homedir() + '\\.local\\bin\\listdockerstate.cmd  /  listds.cmd', code: true }],
    ['State storage root',              { text: 'Local_Docker_Setup\\docker_state\\', code: true }],
    ['Active compose file',             { text: '' + require('os').homedir() + '\\dockerVM\\dockerPOCArtifacts\\dockerCompose\\compose_with_tomcat.yaml', code: true }],
  ]));
  children.push(blank());

  // ── Global Command Locations ───────────────────────────────
  children.push(h1('Global Command Locations (CMD Wrappers)'));
  children.push(new Table({
    rows: [
      new TableRow({
        children: [hCell('Command', C.navy, C.white, 26), hCell('Wrapper file', C.navy, C.white, 74)],
        tableHeader: true,
      }),
      ...[
        ['startdocker',                      '' + require('os').homedir() + '\\.local\\bin\\startdocker.cmd'],
        ['setupservers',                     '' + require('os').homedir() + '\\.local\\bin\\setupservers.cmd'],
        ['startservers',                     '' + require('os').homedir() + '\\.local\\bin\\startservers.cmd'],
        ['stopservers',                      '' + require('os').homedir() + '\\.local\\bin\\stopservers.cmd'],
        ['deleteservers',                    '' + require('os').homedir() + '\\.local\\bin\\deleteservers.cmd'],
        ['restartservers',                   '' + require('os').homedir() + '\\.local\\bin\\restartservers.cmd'],
        ['savedockerstate  /  saveds',       '' + require('os').homedir() + '\\.local\\bin\\savedockerstate.cmd  /  saveds.cmd'],
        ['loaddockerstate  /  loadds',       '' + require('os').homedir() + '\\.local\\bin\\loaddockerstate.cmd  /  loadds.cmd'],
        ['removedockerstate  /  removeds',   '' + require('os').homedir() + '\\.local\\bin\\removedockerstate.cmd  /  removeds.cmd'],
        ['listdockerstate  /  listds',       '' + require('os').homedir() + '\\.local\\bin\\listdockerstate.cmd  /  listds.cmd'],
      ].map(function(r, ri) {
        const fill = ri % 2 === 0 ? C.grey : C.white;
        return new TableRow({ children: [cCell(r[0], fill, 26), cCell(r[1], fill, 74)] });
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
  }));
  children.push(blank());
  children.push(...callout('i', 'To verify wrappers are on PATH:', [
    'Open any PowerShell or Command Prompt and run:',
    '  where startdocker   where setupservers   where startservers   where stopservers',
    '  where deleteservers  where restartservers',
    '  where savedockerstate  where saveds   where loaddockerstate  where loadds',
    '  where removedockerstate  where removeds   where listdockerstate  where listds',
    'Each should resolve to ' + require('os').homedir() + '\\.local\\bin\\<command>.cmd',
  ], C.tealLight, C.teal));
  children.push(blank());

  // ── Footer ─────────────────────────────────────────────────
  children.push(divider());
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Local Docker Setup', font: 'Calibri', size: 18, bold: true, color: C.greyDark }),
      new TextRun({ text: '   |   ', font: 'Calibri', size: 18, color: C.greyDark }),
      new TextRun({ text: 'HealthEdge Software, Inc', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
      new TextRun({ text: '   |   listwfc for full command list', font: 'Calibri', size: 18, italics: true, color: C.greyDark }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
  }));

  return children;
}

async function main() {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(0.9),
            bottom: convertInchesToTwip(0.9),
            left:   convertInchesToTwip(0.9),
            right:  convertInchesToTwip(0.9),
          },
        },
      },
      children: buildDoc(),
    }],
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: C.black } } } },
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log('DockerReadme.docx written to:', OUT);
}

main().catch(function(e) { console.error(e); process.exit(1); });
