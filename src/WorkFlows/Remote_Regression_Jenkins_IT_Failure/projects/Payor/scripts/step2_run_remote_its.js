// ============================================================
// step2_run_remote_its.js
//
// PURPOSE: SSH into the remote server, run all non-Known-Failure
//          IT test classes, and download the raw results.
//
// INPUT:   output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx
// OUTPUT:  output/it_results_raw_<version>.txt
//
// USAGE:   node step2_run_remote_its.js
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');
const { resolveOutputDir, resolveOutputFile, nm } = require('./utils');
const { sshExec, scpTo, scpFrom } = require('./ssh_helpers');
const XLSX = nm('xlsx');

const OUTPUT_EXCEL   = resolveOutputFile();
const RAW_RESULTS    = path.join(resolveOutputDir(), `it_results_raw_${cfg.version}.txt`);
const REMOTE_RESULTS = '/tmp/payor_it_results_raw.txt';
const APP_DIR        = process.env.RPB_APP_DIR ? path.resolve(process.env.RPB_APP_DIR) : path.join(__dirname, '..');
const LOGS_DIR       = path.join(cfg.paths.dataAppDir || APP_DIR, 'logs');
const RECOVERY_FILE  = path.join(LOGS_DIR, `${cfg.pid}_recovery.json`);
const REMOTE_SCRIPT  = '/tmp/payor_run_all_its.sh';
const REMOTE_CLASSES = '/tmp/payor_it_classes.txt';
const REMOTE_MODMAP  = '/tmp/payor_class_module.txt';

// Read classes+methods from Excel — only the methods that actually need retesting.
// Skips: Known Failures (col C=Yes), Baseline Failures (col G=Yes), rows with no method name.
// Returns: [{ fqcn, methods }]  where methods = 'method1+method2+...'
function readClassMethods() {
  const wb = XLSX.readFile(OUTPUT_EXCEL);
  const classMap = new Map();  // FQCN → Set<method>
  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = String(row[0]).trim();
      if (!currentClass) continue;
      if (row[2] === 'Yes') continue;  // skip Known Failures
      if (row[6] === 'Yes') continue;  // skip Baseline Failures
      const method = (row[1] || '').toString().trim();
      if (!method) continue;           // skip class-header rows with no method
      if (!classMap.has(currentClass)) classMap.set(currentClass, new Set());
      classMap.get(currentClass).add(method);
    }
  }
  return [...classMap.entries()].map(([fqcn, methodSet]) => ({
    fqcn,
    methods: [...methodSet].join('+'),
  }));
}

// Build the remote runner script
function buildRunnerScript() {
  return `#!/bin/bash
RESULTS=${REMOTE_RESULTS}
CLASSES=${REMOTE_CLASSES}
MODULE_MAP=${REMOTE_MODMAP}
# srcDirEnv is exported by the shell profile; srcDirCmd is an alias only available in
# interactive sessions — use the env var directly, fall back to the alias as last resort.
REPO=\${${cfg.srcDirEnv}:-$(${cfg.srcDirCmd} 2>/dev/null; pwd)}

> $RESULTS

while IFS='|' read -r classname methods; do
  simple=$(echo "$classname" | awk -F'.' '{print $NF}')
  module=$(grep "^$classname " $MODULE_MAP | head -1 | awk '{print $2}')
  if [ -z "$module" ]; then
    echo "NOMODULE|$classname" >> $RESULTS
    continue
  fi
  if [ -n "$methods" ]; then
    dtest="\${simple}#\${methods}"
  else
    dtest="$simple"
  fi
  echo "Running $dtest in $module ..."
  cd $REPO
  timeout ${cfg.testTimeout} mvn -pl $module test -Dtest="$dtest" -DfailIfNoTests=false > /tmp/mvn_out.txt 2>&1
  exit_code=$?
  tests_run=$(grep -o "Tests run: [0-9]*" /tmp/mvn_out.txt 2>/dev/null | tail -1 | grep -o "[0-9]*$")
  if [ $exit_code -eq 124 ]; then
    echo "TIMEOUT|$classname" >> $RESULTS
  elif [ -z "$tests_run" ]; then
    echo "BUILD_ERROR|$classname" >> $RESULTS
  elif [ "$tests_run" -eq 0 ]; then
    echo "NOT_RUN|$classname" >> $RESULTS
  elif [ $exit_code -eq 0 ]; then
    echo "PASS|$classname" >> $RESULTS
  else
    failed_methods=$(grep "FAILED\\|<<<" /tmp/mvn_out.txt | head -5 | tr '\\n' ';')
    echo "FAIL|$classname|$failed_methods" >> $RESULTS
  fi
done < $CLASSES
echo "=== DONE ===" >> $RESULTS
`;
}

function parseStatusFromResults(raw) {
  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, BUILD_ERROR: 0, NOMODULE: 0, NOT_RUN: 0 };
  for (const line of raw.split('\n').filter(l => l.trim() && !l.includes('=== DONE ==='))) {
    const s = line.split('|')[0];
    if (counts[s] !== undefined) counts[s]++;
  }
  return counts;
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function printMonitorStatus({ pid, total, counts, startTime, observationTime, nextObservationTime, isRunning }) {
  const done      = Object.values(counts).reduce((a, b) => a + b, 0);
  const elapsed   = Date.now() - startTime;
  const avgMs     = done > 0 ? elapsed / done : 0;
  const remaining = total - done;
  const etaMs     = avgMs > 0 ? remaining * avgMs : null;
  const sep = '─'.repeat(58);
  console.log('\n┌' + sep + '┐');
  console.log('│  IT Run Monitor'.padEnd(59) + '│');
  console.log('├' + sep + '┤');
  console.log(`│  Remote PID       : ${String(pid).padEnd(36)}│`);
  console.log(`│  Process status   : ${(isRunning ? 'RUNNING' : 'FINISHED').padEnd(36)}│`);
  console.log('├' + sep + '┤');
  console.log(`│  Total classes    : ${String(total).padEnd(36)}│`);
  console.log(`│  Completed        : ${String(done).padEnd(36)}│`);
  console.log(`│  Remaining        : ${String(remaining).padEnd(36)}│`);
  console.log('├' + sep + '┤');
  console.log(`│  PASS             : ${String(counts.PASS).padEnd(36)}│`);
  console.log(`│  FAIL             : ${String(counts.FAIL).padEnd(36)}│`);
  console.log(`│  TIMEOUT          : ${String(counts.TIMEOUT).padEnd(36)}│`);
  console.log(`│  BUILD_ERROR      : ${String(counts.BUILD_ERROR).padEnd(36)}│`);
  console.log(`│  NOT_RUN          : ${String(counts.NOT_RUN).padEnd(36)}│`);
  console.log(`│  NOMODULE         : ${String(counts.NOMODULE).padEnd(36)}│`);
  console.log('├' + sep + '┤');
  console.log(`│  Elapsed          : ${formatDuration(elapsed).padEnd(36)}│`);
  console.log(`│  ETA              : ${(etaMs !== null ? formatDuration(etaMs) : 'calculating...').padEnd(36)}│`);
  console.log('├' + sep + '┤');
  console.log(`│  Last observed    : ${observationTime.padEnd(36)}│`);
  console.log(`│  Next observation : ${nextObservationTime.padEnd(36)}│`);
  console.log('└' + sep + '┘');
}

async function waitForCompletion(pid, total, overrideStartTime) {
  const panelIntervalMs     = cfg.monitoring.intervalMinutes  * 60 * 1000;
  const heartbeatMs         = cfg.monitoring.heartbeatSeconds * 1000;
  const startTime           = overrideStartTime || Date.now();
  let lastPanelTime         = 0;
  console.log(`\nScript running with PID ${pid}. Heartbeat every ${cfg.monitoring.heartbeatSeconds}s, full panel every ${cfg.monitoring.intervalMinutes} min...`);

  // Persist recovery state so IDP can re-attach if restarted
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(RECOVERY_FILE, JSON.stringify({ remotePid: pid, total, startTime }));

  while (true) {
    await new Promise(r => setTimeout(r, heartbeatMs));
    const now = new Date();
    try {
      const psOut    = (await sshExec(`ps -p ${pid} -o pid= 2>/dev/null || echo dead`)).trim();
      const rawLines = await sshExec(`cat ${REMOTE_RESULTS} 2>/dev/null || echo ''`);
      const doneFlag = rawLines.includes('=== DONE ===');
      const isRunning = psOut !== 'dead' && !doneFlag;
      const counts    = parseStatusFromResults(rawLines);

      const sincePanel = Date.now() - lastPanelTime;
      if (!isRunning || sincePanel >= panelIntervalMs) {
        const nextTime = isRunning
          ? new Date(Date.now() + panelIntervalMs).toLocaleString()
          : 'N/A (run finished)';
        printMonitorStatus({
          pid, total, counts, startTime,
          observationTime:     now.toLocaleString(),
          nextObservationTime: nextTime,
          isRunning,
        });
        lastPanelTime = Date.now();
      } else {
        const done    = Object.values(counts).reduce((a, b) => a + b, 0);
        const elapsed = formatDuration(Date.now() - startTime);
        const next    = formatDuration(panelIntervalMs - sincePanel);
        console.log(`  [${now.toLocaleTimeString()}] ${done}/${total} done | PASS=${counts.PASS} FAIL=${counts.FAIL} TIMEOUT=${counts.TIMEOUT} NOT_RUN=${counts.NOT_RUN} NOMODULE=${counts.NOMODULE} | ${elapsed} elapsed | next panel in ${next}`);
      }

      if (doneFlag || !isRunning) { console.log('\nRun complete.'); break; }
    } catch (e) {
      console.log(`[${now.toLocaleString()}] Could not check status: ${e.message}`);
    }
  }

  // Remove recovery file on clean completion
  try { fs.unlinkSync(RECOVERY_FILE); } catch (_) {}
}

async function main() {
  // Recovery mode: IDP restarted while step2 was polling — re-attach to remote run
  if (process.argv[2] === '--recover') {
    console.log('=== STEP 2 RECOVERY: Re-attaching to remote run ===\n');
    if (!fs.existsSync(RECOVERY_FILE)) {
      console.log('No recovery file found — nothing to recover.');
      process.exit(1);
    }
    const state = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf8'));
    console.log(`Re-attaching to remote PID ${state.remotePid}, total=${state.total} classes`);
    await waitForCompletion(state.remotePid, state.total, state.startTime);
    await scpFrom(REMOTE_RESULTS, RAW_RESULTS);
    console.log(`\nResults downloaded to: ${RAW_RESULTS}`);
    const lines = fs.readFileSync(RAW_RESULTS, 'utf8').split('\n').filter(l => l.trim() && !l.includes('DONE'));
    const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, BUILD_ERROR: 0, NOMODULE: 0 };
    lines.forEach(l => { const s = l.split('|')[0]; if (counts[s] !== undefined) counts[s]++; });
    console.log('\n=== RESULTS SUMMARY ===');
    Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log('\nNext step: run step3_update_excel.js');
    return;
  }

  console.log('=== STEP 2: Run IT tests on remote server ===\n');

  const entries = readClassMethods();
  const totalMethods = entries.reduce((s, e) => s + e.methods.split('+').length, 0);
  console.log(`Found ${entries.length} classes with ${totalMethods} methods to run (excluding Known + Baseline Failures)`);
  if (entries.length === 0) {
    console.log('Nothing to run. Exiting.');
    return;
  }

  // Upload class+method list (one line per class: FQCN|method1+method2)
  const tmpClasses = path.join(resolveOutputDir(), '_it_classes_tmp.txt');
  fs.writeFileSync(tmpClasses, entries.map(e => `${e.fqcn}|${e.methods}`).join('\n') + '\n');
  await scpTo(tmpClasses, REMOTE_CLASSES);
  fs.unlinkSync(tmpClasses);
  console.log(`Uploaded class list (${entries.length} classes, ${totalMethods} methods) to ${REMOTE_CLASSES}`);

  // Build module map on remote — skip target/ to avoid scanning generated sources
  console.log('Building module map on remote...');
  await sshExec(
    `REPO=\${${cfg.srcDirEnv}:-$(${cfg.srcDirCmd} 2>/dev/null; pwd)}; find $REPO -name "*.java" -path "*/test*" -not -path "*/target/*" | while read f; do
      cls=$(grep -m1 "^package " "$f" | sed 's/package //;s/;//')
      base=$(basename "$f" .java)
      fqcn="$cls.$base"
      mod=$(echo "$f" | sed "s|$REPO/||" | cut -d/ -f1)
      echo "$fqcn $mod"
    done > ${REMOTE_MODMAP}`,
    600000  // 10 min — large repos need more than 3 min
  );
  console.log('Module map built.');

  // Upload and launch runner
  const tmpScript = path.join(resolveOutputDir(), '_run_its_tmp.sh');
  fs.writeFileSync(tmpScript, buildRunnerScript());
  await scpTo(tmpScript, REMOTE_SCRIPT);
  fs.unlinkSync(tmpScript);
  await sshExec(`chmod +x ${REMOTE_SCRIPT}`);
  console.log('Runner script uploaded.');

  const pid = (await sshExec(`nohup bash ${REMOTE_SCRIPT} </dev/null >/dev/null 2>&1 & echo $!`)).trim();
  console.log(`Started remote run, PID: ${pid}`);

  await waitForCompletion(pid, entries.length);

  // Download results
  await scpFrom(REMOTE_RESULTS, RAW_RESULTS);
  console.log(`\nResults downloaded to: ${RAW_RESULTS}`);

  const lines = fs.readFileSync(RAW_RESULTS, 'utf8').split('\n').filter(l => l.trim() && !l.includes('DONE'));
  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, BUILD_ERROR: 0, NOMODULE: 0 };
  lines.forEach(l => { const s = l.split('|')[0]; if (counts[s] !== undefined) counts[s]++; });
  console.log('\n=== RESULTS SUMMARY ===');
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log('\nNext step: run step3_update_excel.js');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
