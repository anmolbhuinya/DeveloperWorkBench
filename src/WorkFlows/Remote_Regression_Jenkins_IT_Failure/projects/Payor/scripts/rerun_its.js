// ============================================================
// rerun_its.js
//
// PURPOSE: Re-run IT test classes on the remote server and
//          update the Excel sheet (Local Failure + Rerun cols).
//
// MODES (pass as CLI argument):
//   (no arg)     → run classes where col G (Rerun) = Yes/Y/1/True
//   --failed     → run classes where col D (Local Failure) = Yes
//   --timedout   → run classes where col E (Timeout) = Yes
//   --all        → run every class (excluding Known Failure = Yes)
//
// OPTIONS:
//   --timeout <seconds>   Override per-test Maven timeout for this run only
//
// USAGE:
//   node rerun_its.js                        ← rerun flagged rows
//   node rerun_its.js --failed               ← rerun all failed
//   node rerun_its.js --timedout             ← rerun all timed-out classes
//   node rerun_its.js --all                  ← rerun everything
//   node rerun_its.js --failed --timeout 300 ← rerun failed, 5-min timeout
//
// COLUMN LAYOUT (A–H):
//   A: IT Class   B: Test Method   C: Known Failure
//   D: Local Failure  E: GP Failure  F: Timeout  G: Baseline Failure  H: Rerun
//
// After the run, col D (Local Failure) and F (Timeout) are updated
// and col H (Rerun) is cleared for rows that were executed.
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');
const { resolveOutputDir, resolveOutputFile, nm, loadBaseline, writeFailuresTxt } = require('./utils');
const { injectPieChart } = require('./chart_helper');
const { sshExec, scpTo, scpFrom } = require('./ssh_helpers');
const XLSX = nm('xlsx');

const OUTPUT_EXCEL   = resolveOutputFile();
const RAW_RESULTS    = path.join(resolveOutputDir(), `rerun_results_raw_${cfg.version}.txt`);
const REMOTE_RESULTS = '/tmp/rerun_results_raw.txt';
const REMOTE_SCRIPT  = '/tmp/rerun_all_its.sh';
const REMOTE_CLASSES = '/tmp/rerun_classes.txt';
const REMOTE_MODMAP  = '/tmp/class_module.txt';

// ── CLI args ─────────────────────────────────────────────────
const cliArgs = process.argv.slice(2).map(a => a.toLowerCase());

const MODE = cliArgs.includes('--all')      ? 'all'
           : cliArgs.includes('--failed')   ? 'failed'
           : cliArgs.includes('--timedout') ? 'timeout'
           : 'rerun';
const MODE_LABEL = {
  all:     'all (excluding Known Failures)',
  failed:  'all failed (Local Failure=Yes)',
  timeout: 'all timed-out (Timeout=Yes)',
  rerun:   'rerun-flagged (Rerun=Yes/Y/1/True)',
};
console.log(`Mode: ${MODE_LABEL[MODE]}`);

// --timeout <seconds> overrides config testTimeout for this run only
let effectiveTimeout = cfg.testTimeout;
const tIdx = cliArgs.indexOf('--timeout');
if (tIdx >= 0 && process.argv[tIdx + 2]) {
  const parsed = parseInt(process.argv[tIdx + 2]);
  if (!isNaN(parsed) && parsed > 0) {
    effectiveTimeout = parsed;
    console.log(`Timeout override: ${effectiveTimeout}s (config default: ${cfg.testTimeout}s)`);
  }
}

// ── Helpers ──────────────────────────────────────────────────
function isYes(val) {
  if (val === undefined || val === null) return false;
  return ['yes', 'true', '1', 'y'].includes(String(val).trim().toLowerCase());
}

// ── Read classes from Excel based on mode ───────────────────
function readClasses() {
  if (!fs.existsSync(OUTPUT_EXCEL)) {
    console.error('ERROR: Excel not found:', OUTPUT_EXCEL);
    console.error('Run step1_fetch_jenkins_failures.js first.');
    process.exit(1);
  }
  const wb = XLSX.readFile(OUTPUT_EXCEL);
  const classSet = new Set();

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = row[0];
      if (!currentClass) continue;
      const known       = row[2];   // C: Known Failure
      const localFail   = row[3];   // D: Local Failure
      const timeoutFlag = row[5];   // F: Timeout
      const rerunFlag   = row[7];   // H: Rerun

      if (isYes(known)) continue;  // always skip Known Failures

      if (MODE === 'all')     { classSet.add(currentClass); continue; }
      if (MODE === 'failed'   && isYes(localFail))   { classSet.add(currentClass); continue; }
      if (MODE === 'timeout'  && isYes(timeoutFlag)) { classSet.add(currentClass); continue; }
      if (MODE === 'rerun'    && isYes(rerunFlag))   { classSet.add(currentClass); continue; }
    }
  }
  return [...classSet];
}

// ── Remote runner script ─────────────────────────────────────
function buildRunnerScript(timeoutSec) {
  return `#!/bin/bash
RESULTS=${REMOTE_RESULTS}
CLASSES=${REMOTE_CLASSES}
MODULE_MAP=${REMOTE_MODMAP}
REPO=$(tosrc 2>/dev/null; pwd)

> $RESULTS

while IFS='|' read -r classname; do
  simple=$(echo "$classname" | awk -F'.' '{print $NF}')
  module=$(grep "^$classname " $MODULE_MAP | head -1 | awk '{print $2}')
  if [ -z "$module" ]; then
    echo "NOMODULE|$classname" >> $RESULTS
    continue
  fi
  echo "Running $simple in $module ..."
  cd $REPO
  timeout ${timeoutSec} mvn -pl $module test -Dtest="$simple" -DfailIfNoTests=false > /tmp/mvn_out.txt 2>&1
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "TIMEOUT|$classname" >> $RESULTS
  elif [ $exit_code -eq 0 ]; then
    echo "PASS|$classname" >> $RESULTS
  else
    if grep -q "Tests run:.*Failures:\\|Tests run:.*Errors:" /tmp/mvn_out.txt 2>/dev/null; then
      failed_methods=$(grep "FAILED\\|<<<" /tmp/mvn_out.txt | head -5 | tr '\\n' ';')
      echo "FAIL|$classname|$failed_methods" >> $RESULTS
    else
      echo "BUILD_ERROR|$classname" >> $RESULTS
    fi
  fi
done < $CLASSES
echo "=== DONE ===" >> $RESULTS
`;
}

// ── Monitoring helpers ───────────────────────────────────────
function parseStatusFromResults(raw) {
  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, BUILD_ERROR: 0, NOMODULE: 0 };
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
  const sep       = '─'.repeat(58);
  console.log('\n┌' + sep + '┐');
  console.log('│  IT Rerun Monitor'.padEnd(59) + '│');
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
  console.log(`│  NOMODULE         : ${String(counts.NOMODULE).padEnd(36)}│`);
  console.log('├' + sep + '┤');
  console.log(`│  Elapsed          : ${formatDuration(elapsed).padEnd(36)}│`);
  console.log(`│  ETA              : ${(etaMs !== null ? formatDuration(etaMs) : 'calculating...').padEnd(36)}│`);
  console.log('├' + sep + '┤');
  console.log(`│  Last observed    : ${observationTime.padEnd(36)}│`);
  console.log(`│  Next observation : ${nextObservationTime.padEnd(36)}│`);
  console.log('└' + sep + '┘');
}

const HEARTBEAT_MS = 60 * 1000;

async function waitForCompletion(pid, total) {
  const panelIntervalMs = cfg.monitoring.intervalMinutes * 60 * 1000;
  const startTime       = Date.now();
  let lastPanelTime     = 0;
  console.log(`\nScript running with PID ${pid}. Heartbeat every 1 min, full panel every ${cfg.monitoring.intervalMinutes} min...`);
  while (true) {
    await new Promise(r => setTimeout(r, HEARTBEAT_MS));
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
        console.log(`  [${now.toLocaleTimeString()}] ${done}/${total} done | PASS=${counts.PASS} FAIL=${counts.FAIL} TIMEOUT=${counts.TIMEOUT} NOMODULE=${counts.NOMODULE} | ${elapsed} elapsed | next panel in ${next}`);
      }

      if (doneFlag || !isRunning) { console.log('\nRun complete.'); break; }
    } catch (e) {
      console.log(`[${now.toLocaleString()}] Could not check status: ${e.message}`);
    }
  }
}

// ── Parse raw results → class-level map ─────────────────────
function parseResults(file) {
  const classResults = new Map();
  const lines = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.includes('=== DONE ==='));
  for (const line of lines) {
    const parts  = line.split('|');
    const status = parts[0];
    const className = parts[1];
    if (!className) continue;
    const failedMethods = new Set();
    let allFailed = false;
    if (status === 'FAIL') {
      const errorText = parts.slice(2).join('|');
      const countMatch = errorText.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/);
      if (countMatch) {
        const total = parseInt(countMatch[1]);
        const fails = parseInt(countMatch[2]) + parseInt(countMatch[3]);
        if (fails >= total && total > 0) allFailed = true;
      }
      const regex = /(\w+)\([^)]+\)\s+Time elapsed:[^<]*<<<\s+(?:FAILURE!|ERROR!)/g;
      let m;
      while ((m = regex.exec(errorText)) !== null) failedMethods.add(m[1]);
      if (failedMethods.size === 0) allFailed = true;
    }
    classResults.set(className, { status, failedMethods, allFailed });
  }
  return classResults;
}

// ── Update Excel with rerun results ─────────────────────────
function updateExcel(classResults, ranClasses) {
  const wb = XLSX.readFile(OUTPUT_EXCEL);

  console.log('\nLoading baseline...');
  const { baselineKnown, baselineLocalFail } = loadBaseline();

  let totalLocalFail = 0, totalBaselineFail = 0, totalPromoted = 0;

  const TAB_KEYS = {
    Billing: 'billing', Claims: 'claims', Enrollment: 'enrollment',
    Integrations: 'integrations', Platform: 'platform', Provider: 'provider',
  };

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const ws   = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (data.length === 0) continue;

    // Ensure headers: A=IT Class B=Test Method C=Known D=Local Failure E=GP Failure F=Timeout G=Baseline Failure H=Rerun
    data[0][3] = 'Local Failure';
    data[0][4] = 'GP Failure';
    data[0][5] = 'Timeout';
    data[0][6] = 'Baseline Failure';
    data[0][7] = 'Rerun';

    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = String(row[0]).trim();
      if (!ranClasses.has(currentClass)) continue;

      const method = (row[1] || '').toString().trim();
      const entry  = method ? `${currentClass}.${method}` : currentClass;
      const result = classResults.get(currentClass);

      // Mode gate: only update rows directly targeted by the rerun mode.
      // Capture original values before row[5] (Timeout) is cleared below.
      const origTimeout   = row[5];
      const origLocalFail = row[3];
      const origRerun     = row[7];
      let modeMatch;
      if      (MODE === 'all')     modeMatch = true;
      else if (MODE === 'timeout') modeMatch = isYes(origTimeout);
      else if (MODE === 'failed')  modeMatch = isYes(origLocalFail);
      else if (MODE === 'rerun')   modeMatch = isYes(origRerun);
      else                         modeMatch = false;
      if (!modeMatch) continue;

      // ── Set Local Failure (col D) and Timeout (col F) ────
      let localFail = false;
      row[5] = '';
      if (!result) {
        // no result — leave unchanged
      } else if (result.status === 'PASS') {
        row[3] = '';
      } else if (result.status === 'TIMEOUT') {
        row[3] = 'Yes'; row[5] = 'Yes'; localFail = true; totalLocalFail++;
      } else if (result.status === 'FAIL') {
        if (!method || result.allFailed || result.failedMethods.size === 0 || result.failedMethods.has(method)) {
          row[3] = 'Yes'; localFail = true; totalLocalFail++;
        } else {
          row[3] = '';
        }
      }
      // BUILD_ERROR / NOMODULE — leave existing values unchanged

      // ── Baseline cross-check ──────────────────────────────
      if (localFail) {
        if (baselineKnown.has(entry)) {
          row[2] = 'Yes';
          row[3] = '';
          row[5] = '';
          row[6] = '';
          totalLocalFail--;
          totalPromoted++;
        } else if (baselineLocalFail.has(entry)) {
          row[6] = 'Yes';
          totalBaselineFail++;
        } else {
          row[6] = '';
        }
      } else {
        if (result) row[6] = '';  // test passed / method passed — clear stale Baseline Failure
      }

      // Clear Rerun flag (col H)
      row[7] = '';
    }

    const newWs = XLSX.utils.aoa_to_sheet(data);
    newWs['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }];
    wb.Sheets[sheetName] = newWs;
    console.log(`  Sheet "${sheetName}": updated`);
  }

  // Refresh Summary
  const summaryRows = [
    ['Value Stream', 'Jenkins Job', 'Total Failures', 'Known Failures',
     'Locally Passing', 'Timeout', 'Matching Baseline', 'New Local Failure', 'GP Failure'],
  ];
  const localFailsByCat = [];   // → local_it_failures_<version>.txt
  for (const [tabName, jobKey] of Object.entries(TAB_KEYS)) {
    const ws = wb.Sheets[tabName];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    let known = 0, localPass = 0, gpFail = 0, timeout = 0, baselineFail = 0, newLocalFail = 0;
    let currentClass = '';
    const localEntries = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = row[0];
      if (!currentClass) continue;
      const method      = (row[1] || '').toString().trim();
      // col C=Known(2) D=LocalFail(3) E=GPFail(4) F=Timeout(5) G=Baseline(6)
      const isKnown     = isYes(row[2]);
      const isLocalFail = isYes(row[3]);
      const isGpFail    = isYes(row[4]);
      const isTimeout   = isYes(row[5]);
      const isBaseline  = isYes(row[6]);
      if (isKnown)                    known++;
      else if (!isLocalFail)          localPass++;
      else if (isBaseline)            baselineFail++;
      else if (isTimeout)             timeout++;
      else                            newLocalFail++;
      if (!isKnown && isGpFail)       gpFail++;
      if (!isKnown && isLocalFail && method) localEntries.push(`${currentClass}#${method}`);
    }
    localFailsByCat.push({ name: tabName, entries: localEntries });
    const total = known + localPass + timeout + baselineFail + newLocalFail;
    const jobUrlsRr = cfg.jenkinsJobs[jobKey] || [];
    summaryRows.push([tabName, jobUrlsRr[0] || '', total, known, localPass, timeout, baselineFail, newLocalFail, gpFail]);
    for (let ui = 1; ui < jobUrlsRr.length; ui++) {
      summaryRows.push(['', jobUrlsRr[ui], '', '', '', '', '', '', '']);
    }
  }
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [
    { wch: 16 }, { wch: 90 }, { wch: 16 }, { wch: 16 },
    { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
  ];
  wb.Sheets['Summary'] = summaryWs;
  wb.SheetNames = ['Summary', ...wb.SheetNames.filter(n => n !== 'Summary')];

  XLSX.writeFile(wb, OUTPUT_EXCEL);
  console.log(`\nExcel updated.`);
  console.log(`  Local Failure = Yes  : ${totalLocalFail}`);
  console.log(`  Baseline Failure=Yes : ${totalBaselineFail}`);
  console.log(`  Promoted to Known    : ${totalPromoted}`);
  console.log('Summary sheet refreshed.');

  const localFailuresTxt = path.join(path.dirname(OUTPUT_EXCEL), `local_it_failures_${cfg.version}.txt`);
  writeFailuresTxt(localFailuresTxt, localFailsByCat);

  return summaryRows;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('\n=== RERUN ITs ===\n');

  const classes = readClasses();
  if (classes.length === 0) {
    console.log('No test classes matched the selected mode. Nothing to run.');
    if (MODE === 'rerun') console.log('Tip: set col G (Rerun) to "Yes" for the rows you want to rerun.');
    process.exit(0);
  }
  console.log(`Classes to run: ${classes.length}`);
  classes.forEach(c => console.log('  ' + c));

  // Upload class list
  const tmpClasses = path.join(resolveOutputDir(), '_rerun_classes_tmp.txt');
  fs.writeFileSync(tmpClasses, classes.join('\n') + '\n');
  await scpTo(tmpClasses, REMOTE_CLASSES);
  fs.unlinkSync(tmpClasses);
  console.log(`\nUploaded class list to ${REMOTE_CLASSES}`);

  // Build module map on remote
  console.log('Refreshing module map on remote...');
  await sshExec(
    `REPO=$(tosrc 2>/dev/null; pwd); find $REPO -name "*.java" -path "*/test*" | while read f; do
      cls=$(grep -m1 "^package " "$f" | sed 's/package //;s/;//')
      base=$(basename "$f" .java)
      fqcn="$cls.$base"
      mod=$(echo "$f" | sed "s|$REPO/||" | cut -d/ -f1)
      echo "$fqcn $mod"
    done > ${REMOTE_MODMAP}`,
    180000
  );
  console.log('Module map ready.');

  // Upload and launch runner
  const tmpScript = path.join(resolveOutputDir(), '_rerun_script_tmp.sh');
  fs.writeFileSync(tmpScript, buildRunnerScript(effectiveTimeout));
  await scpTo(tmpScript, REMOTE_SCRIPT);
  fs.unlinkSync(tmpScript);
  await sshExec(`chmod +x ${REMOTE_SCRIPT}`);
  console.log('Runner script uploaded.');

  const pid = (await sshExec(`nohup bash ${REMOTE_SCRIPT} </dev/null >/dev/null 2>&1 & echo $!`)).trim();
  console.log(`Started remote run, PID: ${pid}`);

  await waitForCompletion(pid, classes.length);

  // Download results
  await scpFrom(REMOTE_RESULTS, RAW_RESULTS);
  console.log(`\nResults downloaded to: ${RAW_RESULTS}`);

  const raw = fs.readFileSync(RAW_RESULTS, 'utf8');
  const counts = parseStatusFromResults(raw);
  console.log('\n=== RERUN RESULTS ===');
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\nUpdating Excel...');
  const classResults = parseResults(RAW_RESULTS);
  const summaryRows  = updateExcel(classResults, new Set(classes));

  // ── Pie chart ─────────────────────────────────────────────
  const totals = summaryRows.slice(1).reduce((acc, row) => ({
    known:    acc.known    + (row[3] || 0),
    passing:  acc.passing  + (row[4] || 0),
    timeout:  acc.timeout  + (row[5] || 0),
    baseline: acc.baseline + (row[6] || 0),
    newLocal: acc.newLocal + (row[7] || 0),
  }), { known: 0, passing: 0, timeout: 0, baseline: 0, newLocal: 0 });

  await injectPieChart(OUTPUT_EXCEL, {
    sheetName:  'Summary',
    title:      'Test Results Breakdown',
    categories: ['Known Failures', 'Locally Passing', 'Timeout', 'Baseline Failure', 'New Local Failure'],
    values:     [totals.known, totals.passing, totals.timeout, totals.baseline, totals.newLocal],
    fromCol: 0, fromRow: 8,
    toCol:   7, toRow:   28,
  });
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
