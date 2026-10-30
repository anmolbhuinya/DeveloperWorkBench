// ============================================================
// run_all.js — Master orchestrator
//
// DEFAULT:  node run_all.js
//   Runs all 4 steps end-to-end (fetch → remote run → update → email).
//
// START FROM A SPECIFIC STEP:
//   rprt --step1   Run from Step 1 onwards (same as default)
//   rprt --step2   Run from Step 2 onwards (skip Jenkins fetch)
//   rprt --step3   Run from Step 3 onwards (update Excel + email)
//   rprt --step4   Run Step 4 only (regenerate email draft)
//
// RERUN MODES (skip fetch; rerun a subset → update Excel → email):
//   rprt -rfits [--timeout <s>]   Rerun Local Failure = Yes ITs
//   rprt -rtits [--timeout <s>]   Rerun Timeout = Yes ITs
//   rprt -rits  [--timeout <s>]   Rerun col G (Rerun = Yes/Y/1/True) ITs
// ============================================================

const { execSync } = require('child_process');
const path = require('path');
const cfg  = require('./config');
const { resolveOutputDir, resolveOutputFile, makeReportSubdir } = require('./utils');

// ── Argument parsing ────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const lcArgs  = rawArgs.map(a => a.toLowerCase());

// --help / -h
if (lcArgs.includes('--help') || lcArgs.includes('-h')) {
  console.log('');
  console.log('Usage:');
  console.log('  remotepayorregression  [options]');
  console.log('  rprt                   [options]');
  console.log('');
  console.log('Default — full 4-step regression report:');
  console.log('  Step 1  Fetch failed IT tests from each Jenkins job → Excel');
  console.log('  Step 2  SSH into the remote server and run all non-Known-Failure IT classes');
  console.log('  Step 3  Update Excel with Local Failure / Timeout / Baseline results');
  console.log('  Step 4  Generate the regression email draft (.docx)');
  console.log('');
  console.log('Start from a specific step (runs that step and all steps after it):');
  console.log('  --step1               Start from Step 1 (same as default)');
  console.log('  --step2               Start from Step 2 (skip Jenkins fetch)');
  console.log('  --step3               Start from Step 3 (update Excel + email only)');
  console.log('  --step4               Run Step 4 only (regenerate email draft)');
  console.log('');
  console.log('Rerun modes (skip Step 1 & 2; rerun a subset → update Excel → email):');
  console.log('  -rfits, --rerun-failed-its     Rerun ITs where Local Failure = Yes');
  console.log('  -rtits, --rerun-timedout-its   Rerun ITs where Timeout = Yes');
  console.log('  -rits,  --rerun-its            Rerun ITs where Rerun column = Yes/Y/1/True');
  console.log('');
  console.log('Options:');
  console.log('  --timeout <seconds>   Override per-test Maven timeout for this run only');
  console.log('                        (default from config.xlsx → General → testTimeout: ' + cfg.testTimeout + 's)');
  console.log('  -h, --help            Show this message');
  console.log('');
  console.log('Examples:');
  console.log('  rprt                          Full 4-step run');
  console.log('  rprt --step3                  Re-apply baseline + regenerate email (Excel already run)');
  console.log('  rprt --step4                  Regenerate email only');
  console.log('  rprt -rfits                   Rerun failed ITs → update Excel → email');
  console.log('  rprt -rtits --timeout 300     Rerun timed-out ITs with 5-min timeout');
  console.log('  rprt -rits                    Rerun ITs flagged in the Rerun column');
  console.log('');
  console.log('Configuration (edit Payor/config.xlsx — Overridden Value column):');
  console.log('  General tab:');
  console.log('    version          Release version, e.g. 26.1.5');
  console.log('    testTimeout      Per-test Maven timeout in seconds (default: 600)');
  console.log('    outputFileName   Output Excel name (blank = ' + path.basename(resolveOutputFile()) + ')');
  console.log('    outputDir        Output folder (blank = output/ next to scripts/)');
  console.log('    baselineVersion  Previous release version, e.g. 26.0.9');
  console.log('  JenkinsJobs tab:  Overridden Email per value stream (URLs are in per-project xlsx)');
  console.log('  Remote server:    stored per-project in projects/<pid>_<version>.xlsx → remote_server sheet');
  console.log('');
  console.log('Output (check output/ folder):');
  console.log('  ' + path.basename(resolveOutputFile()));
  console.log('  it_results_raw_' + cfg.version + '.txt');
  console.log('  Regression_Email_' + cfg.version + '.docx');
  console.log('');
  process.exit(0);
}

// ── Step-from flag: --step1 / --step2 / --step3 / --step4 ──
const stepFromArg = lcArgs.find(a => /^--step[1-4]$/.test(a));
const startFromStep = stepFromArg ? parseInt(stepFromArg.slice(-1), 10) : 1;  // 1-based

// ── Rerun flag detection ────────────────────────────────────
const RERUN_FLAG_MAP = {
  '-rfits':               '--failed',
  '--rerun-failed-its':   '--failed',
  '-rtits':               '--timedout',
  '--rerun-timedout-its': '--timedout',
  '-rits':                '',
  '--rerun-its':          '',
};

const rerunArg   = lcArgs.find(a => a in RERUN_FLAG_MAP);
const isRerun    = !!rerunArg;

// --timeout override
const tIdx         = lcArgs.indexOf('--timeout');
const timeoutValue = (tIdx >= 0 && rawArgs[tIdx + 1]) ? rawArgs[tIdx + 1] : null;

// ── Report subdir: new folder only for fresh runs (step 1, no rerun) ────────
// --step2/3/4 and rerun modes continue into the most recent existing folder.
if (!isRerun && startFromStep === 1) {
  process.env.RPRT_REPORT_SUBDIR = makeReportSubdir();
}

// ── Helpers ─────────────────────────────────────────────────
function banner(text) {
  const line = '='.repeat(60);
  console.log('\n' + line);
  console.log(' ' + text);
  console.log(line);
}

function runStep(name, cmd) {
  banner(name);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e) {
    console.error(`\nFAILED at: ${name}`);
    console.error('Fix the issue and re-run the individual step, or re-run rprt');
    process.exit(1);
  }
}

// ── Rerun mode ───────────────────────────────────────────────
if (isRerun) {
  const modeFlag    = RERUN_FLAG_MAP[rerunArg];
  const rerunParts  = [`node "${path.join(__dirname, 'rerun_its.js')}"`];
  if (modeFlag)     rerunParts.push(modeFlag);
  if (timeoutValue) rerunParts.push('--timeout', timeoutValue);

  runStep('Rerun: Run IT tests on remote server', rerunParts.join(' '));
  runStep('Step 4: Generate regression email draft', `node "${path.join(__dirname, 'step4_generate_email.js')}"`);

  banner('RERUN COMPLETE');
  console.log('Output folder: ' + resolveOutputDir());
  console.log('  - ' + path.basename(resolveOutputFile()));
  console.log('  - rerun_results_raw_' + cfg.version + '.txt');
  console.log('  - Regression_Email_' + cfg.version + '.docx');
  process.exit(0);
}

// ── Run steps (full or from a specific step) ─────────────────
const STEPS = [
  { num: 1, name: 'Step 1: Fetch Jenkins failures → Excel',       file: 'step1_fetch_jenkins_failures.js' },
  { num: 2, name: 'Step 2: Run IT tests on remote server',        file: 'step2_run_remote_its.js'         },
  { num: 3, name: 'Step 3: Update Excel with local results',      file: 'step3_update_excel.js'           },
  { num: 4, name: 'Step 4: Generate regression email draft',      file: 'step4_generate_email.js'         },
];

const stepsToRun = STEPS.filter(s => s.num >= startFromStep);

if (startFromStep > 1) {
  banner(`STARTING FROM STEP ${startFromStep}`);
}

for (const { name, file } of stepsToRun) {
  runStep(name, `node "${path.join(__dirname, file)}"`);
}

banner('ALL STEPS COMPLETE');
console.log('Output folder: ' + resolveOutputDir());
console.log('  - ' + path.basename(resolveOutputFile()));
console.log('  - it_results_raw_' + cfg.version + '.txt');
console.log('  - Regression_Email_' + cfg.version + '.docx');
