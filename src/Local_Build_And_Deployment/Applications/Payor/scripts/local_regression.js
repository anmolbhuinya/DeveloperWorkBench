// ============================================================
// local_regression.js — Re-run Jenkins failed tests locally,
//                       or run a specific test class / method.
//
// USAGE:
//   node scripts/local_regression.js <target> [options]
//
// TARGET forms:
//   Jenkins URL   http://central-gp:6060/job/.../241/
//   FQN class     com.healthedge.cvc.auditlog.test.AuditLogUserIdTest
//   Simple class  AuditLogUserIdTest
//   FQN + method  com.healthedge.cvc.auditlog.test.AuditLogUserIdTest.methodName
//   FQN + method  com.healthedge.cvc.auditlog.test.AuditLogUserIdTest#methodName
//   Class.method  AuditLogUserIdTest.methodName
//   Class#method  AuditLogUserIdTest#methodName
//
// OPTIONS:
//   --timeout <seconds>   Per-test timeout in seconds (default: 300)
//   --parallel <n>        Run N tests concurrently (default: 1, Jenkins mode only)
//   --module <name>       Force Maven module (skips filesystem search)
//   --dry-run             Print what would run without running it
//   -h / --help           Show this message
// ============================================================

'use strict';

const http       = require('http');
const https      = require('https');
const { spawnSync } = require('child_process');
const path       = require('path');
const fs         = require('fs');
const { resolveSrcDir } = require('./jar_resolver');

// ── Helpers ───────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  process.stdout.write(`[${ts}] ${msg}\n`);
}

function elapsedSince(startMs) {
  const s = Math.round((Date.now() - startMs) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function pad(str, n) {
  str = String(str);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

// ── Test input parsing ────────────────────────────────────────

// Accepts any of:
//   ClassName
//   pkg.pkg.ClassName
//   pkg.pkg.ClassName.methodName
//   pkg.pkg.ClassName#methodName
//   ClassName.methodName
//   ClassName#methodName
//
// Returns { className, methodName, fqn }
//   className  — simple class name  (e.g. AuditLogUserIdTest)
//   methodName — method or ''       (e.g. amendSubAuditLog...)
//   fqn        — full package+class or '' if not provided
function parseTestInput(input) {
  // Handle # separator first — unambiguously separates class from method
  if (input.includes('#')) {
    const hashIdx  = input.indexOf('#');
    const classOrFqn = input.slice(0, hashIdx);
    const method     = input.slice(hashIdx + 1);
    const parts      = classOrFqn.split('.');
    const classIdx   = parts.findIndex(function(p) { return /^[A-Z]/.test(p); });
    const className  = classIdx >= 0 ? parts[classIdx] : parts[parts.length - 1];
    const fqn        = classIdx > 0 ? classOrFqn : (classIdx === 0 ? '' : classOrFqn);
    return { className, methodName: method, fqn: classIdx > 0 ? classOrFqn : '' };
  }

  const parts    = input.split('.');
  const classIdx = parts.findIndex(function(p) { return /^[A-Z]/.test(p); });

  if (classIdx === -1) {
    // No uppercase component — treat whole string as a simple class name
    return { className: input, methodName: '', fqn: '' };
  }

  const className = parts[classIdx];
  const fqn       = classIdx > 0 ? parts.slice(0, classIdx + 1).join('.') : '';

  // Anything after the class-name component and starting with lowercase = method
  const after      = parts.slice(classIdx + 1);
  const methodName = after.length > 0 && /^[a-z_$]/.test(after[0]) ? after.join('.') : '';

  return { className, methodName, fqn };
}

// Build the string that goes after -Dtest=
// Maven Surefire uses ClassName#method (preferred) or ClassName.method (also accepted)
// We normalise to ClassName#methodName to be explicit.
function buildTestSpec(className, methodName) {
  if (!methodName) return className;
  return `${className}#${methodName}`;
}

// ── Filesystem module search ──────────────────────────────────

// Recursively find a file by name under a directory.
// Returns the first match or null.
function findFileRecursive(dir, filename) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return null; }

  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) {
      return path.join(dir, entry.name);
    }
    if (entry.isDirectory()) {
      const found = findFileRecursive(path.join(dir, entry.name), filename);
      if (found) return found;
    }
  }
  return null;
}

// Search all *-st modules under srcdir for <className>.java in src/test/java.
// Returns the first module name that contains the class, or null.
function findModuleForClass(className, srcdir) {
  let entries;
  try { entries = fs.readdirSync(srcdir, { withFileTypes: true }); }
  catch (_) { return null; }

  const stModules = entries
    .filter(function(e) { return e.isDirectory() && e.name.endsWith('-st'); })
    .map(function(e) { return e.name; });

  for (const mod of stModules) {
    const testRoot = path.join(srcdir, mod, 'src', 'test', 'java');
    if (!fs.existsSync(testRoot)) continue;
    const found = findFileRecursive(testRoot, `${className}.java`);
    if (found) return mod;
  }
  return null;
}

// ── Jenkins API ───────────────────────────────────────────────

function normaliseUrl(url) {
  return url.replace(/\/+$/, '');
}

function fetchJson(url) {
  return new Promise(function(resolve, reject) {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 30000 }, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    }).on('error', reject).on('timeout', function() { reject(new Error(`Timeout fetching ${url}`)); });
  });
}

async function fetchFailedTests(buildUrl) {
  const base      = normaliseUrl(buildUrl);
  const buildInfo = await fetchJson(`${base}/api/json?tree=result,building`);
  if (buildInfo.building) {
    log('WARNING: Build is still running — results may be incomplete.');
  }

  const reportUrl = `${base}/testReport/api/json?tree=suites[cases[className,name,status,duration]]&depth=2`;
  let report;
  try {
    report = await fetchJson(reportUrl);
  } catch (e) {
    throw new Error(
      `Could not fetch test report from Jenkins.\n` +
      `  URL tried: ${reportUrl}\n` +
      `  Error: ${e.message}\n` +
      `  Make sure the build has test results and is accessible.`
    );
  }

  const all = [];
  for (const suite of (report.suites || [])) {
    for (const c of (suite.cases || [])) {
      all.push({
        className: c.className || '',
        name:      c.name      || '',
        status:    (c.status   || '').toUpperCase(),
        duration:  c.duration  || 0,
      });
    }
  }
  return all;
}

// ── Module detection (package-prefix fallback) ────────────────

const MODULE_PATTERNS = [
  { pattern: /^com\.healthedge\.claims/i,     module: 'claims-st'     },
  { pattern: /^com\.healthedge\.core/i,       module: 'core-st'       },
  { pattern: /^com\.healthedge\.enrollment/i, module: 'enrollment-st' },
  { pattern: /^com\.healthedge\./i,           module: 'core-st'       },
];

function detectModuleByPackage(fqn) {
  for (const { pattern, module } of MODULE_PATTERNS) {
    if (pattern.test(fqn)) return module;
  }
  return 'core-st';
}

// ── Usage ─────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage:
  node scripts/local_regression.js <target> [options]

Target (one of):
  Jenkins URL     http://central-gp:6060/job/stormtroopers/job/payor-end-to-end/241/
  FQN class       com.healthedge.cvc.auditlog.test.AuditLogUserIdTest
  Simple class    AuditLogUserIdTest
  FQN + method    com.healthedge.cvc.auditlog.test.AuditLogUserIdTest.methodName
  FQN + method    com.healthedge.cvc.auditlog.test.AuditLogUserIdTest#methodName
  Class.method    AuditLogUserIdTest.methodName
  Class#method    AuditLogUserIdTest#methodName

Options:
  --timeout <sec>   Per-test Maven timeout in seconds (default: 300)
  --parallel <n>    Concurrent tests — Jenkins mode only (default: 1)
  --module <name>   Force Maven module, e.g. core-st  (skips filesystem search)
  --dry-run         Print planned mvn commands without running
  -h / --help       Show this message
`);
}

// ── Arg parsing ───────────────────────────────────────────────

const cliArgs  = process.argv.slice(2);
let target      = '';
let timeoutSecs = 300;
let parallelism = 1;
let forceModule = '';
let dryRun      = false;

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];
  switch (arg) {
    case '--timeout':
      timeoutSecs = parseInt(cliArgs[++i], 10);
      if (isNaN(timeoutSecs) || timeoutSecs <= 0) { console.error('--timeout must be a positive integer'); process.exit(1); }
      break;
    case '--parallel':
      parallelism = parseInt(cliArgs[++i], 10);
      if (isNaN(parallelism) || parallelism <= 0) { console.error('--parallel must be a positive integer'); process.exit(1); }
      break;
    case '--module':
      forceModule = cliArgs[++i] || '';
      if (!forceModule) { console.error('--module requires a module name'); process.exit(1); }
      break;
    case '--dry-run':
      dryRun = true;
      break;
    case '-h': case '--help':
      printUsage(); process.exit(0); break;
    default:
      if (arg.startsWith('-')) { console.error(`Unknown flag: ${arg}`); printUsage(); process.exit(1); }
      if (target) { console.error(`Unexpected argument: ${arg}`); printUsage(); process.exit(1); }
      target = arg;
  }
}

if (!target) {
  console.error('ERROR: A Jenkins URL or test class name is required.');
  printUsage();
  process.exit(1);
}

const isJenkinsUrl = /^https?:\/\//i.test(target);

// ── Run a single test ─────────────────────────────────────────

// testSpec is what goes after -Dtest= (e.g. ClassName or ClassName#method)
function runTest(testSpec, module, srcdir) {
  const moduleDir = path.join(srcdir, module);
  if (!fs.existsSync(moduleDir)) {
    return { status: 'ERROR', durationMs: 0, output: `Module directory not found: ${moduleDir}` };
  }

  const mvnArgs = ['test', `-Dtest=${testSpec}`, '-nsu', '-pl', module];
  const start   = Date.now();

  const result = spawnSync('mvn', mvnArgs, {
    cwd:       srcdir,
    shell:     true,
    timeout:   timeoutSecs * 1000,
    encoding:  'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const durationMs = Date.now() - start;

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return { status: 'TIMEOUT', durationMs, output: `Timed out after ${timeoutSecs}s` };
    }
    return { status: 'ERROR', durationMs, output: result.error.message };
  }

  const output = (result.stdout || '') + (result.stderr || '');
  return { status: result.status === 0 ? 'PASS' : 'FAIL', durationMs, output };
}

// ── Progress display ──────────────────────────────────────────

function renderProgress(results, testRuns, total, startMs) {
  const pass    = results.filter(function(r) { return r.status === 'PASS'; }).length;
  const failRes = results.filter(function(r) { return r.status === 'FAIL'; });
  const timeout = results.filter(function(r) { return r.status === 'TIMEOUT'; }).length;
  const error   = results.filter(function(r) { return r.status === 'ERROR'; }).length;
  const done    = results.length;
  const pending = total - done;

  // Count failed methods across all failed classes
  const failMethodCount = failRes.reduce(function(sum, r) {
    const idx = results.indexOf(r);
    const t   = testRuns[idx];
    return sum + (t && t.failedMethods ? t.failedMethods.length : 0);
  }, 0);
  const failLabel = failMethodCount > 0
    ? `${failRes.length}c/${failMethodCount}m`
    : failRes.length;

  let eta = 'calculating...';
  if (done > 0 && pending > 0) {
    const avgMs   = (Date.now() - startMs) / done;
    const etaSecs = Math.round((avgMs * pending) / parallelism / 1000);
    const em = Math.floor(etaSecs / 60);
    const es = etaSecs % 60;
    eta = em > 0 ? `~${em}m ${es}s` : `~${es}s`;
  } else if (pending === 0) {
    eta = 'done';
  }

  const line = [
    `Progress: ${done}/${total}`,
    `Pass: ${pass}`,
    `Fail: ${failLabel}`,
    timeout > 0 ? `Timeout: ${timeout}` : null,
    error   > 0 ? `Error: ${error}`     : null,
    `ETA: ${eta}`,
    `Elapsed: ${elapsedSince(startMs)}`,
  ].filter(Boolean).join('  |  ');

  process.stdout.write(`\r${line}  `);
}

// ── Error line extraction ─────────────────────────────────────

// Filter Maven output to only the lines that matter — skip the noisy
// INFO log lines the test framework emits (timestamps + INFO: prefix).
function extractErrorLines(output) {
  const lines = (output || '').split('\n');

  const isNoise = function(l) {
    // "Jul 16, 2026 9:03:30 AM  | 1 |  | com.healthedge..." timestamp lines
    return /^\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d{4}\s+\d+:\d+:\d+\s+(AM|PM)/i.test(l)
        || /^\s*INFO:/.test(l)
        || l.trim() === '';
  };

  const meaningful = lines.filter(function(l) { return !isNoise(l); });

  // Prefer lines that look like errors / failures
  const errorLines = meaningful.filter(function(l) {
    return /\[ERROR\]/.test(l)
        || /BUILD FAILURE/.test(l)
        || /Tests run:.*(?:Failures|Errors): [1-9]/.test(l)
        || /Exception/.test(l)
        || /AssertionError/.test(l)
        || /FAILED/.test(l);
  });

  return errorLines.length > 0 ? errorLines.slice(-30) : meaningful.slice(-20);
}

// ── Final report ──────────────────────────────────────────────

function printReport(testRuns, results, startMs) {
  const LINE = '─'.repeat(80);
  console.log('\n\n' + LINE);
  console.log(' LOCAL REGRESSION REPORT');
  console.log(LINE);

  const pass    = results.filter(function(r) { return r.status === 'PASS'; });
  const fail    = results.filter(function(r) { return r.status === 'FAIL'; });
  const timeout = results.filter(function(r) { return r.status === 'TIMEOUT'; });
  const error   = results.filter(function(r) { return r.status === 'ERROR'; });

  const failMethodCount = fail.reduce(function(sum, r, i) {
    const t = testRuns[results.indexOf(r)];
    return sum + (t && t.failedMethods ? t.failedMethods.length : 0);
  }, 0);
  const failDisplay = failMethodCount > 0
    ? `${fail.length} classes  (${failMethodCount} methods)`
    : fail.length;

  console.log(`  Total:    ${testRuns.length}`);
  console.log(`  Pass:     ${pass.length}`);
  console.log(`  Fail:     ${failDisplay}`);
  console.log(`  Timeout:  ${timeout.length}  (limit: ${timeoutSecs}s each)`);
  console.log(`  Error:    ${error.length}`);
  console.log(`  Elapsed:  ${elapsedSince(startMs)}`);
  console.log(LINE);

  const colW = [46, 12, 8, 10];
  console.log(
    pad('Test Class', colW[0]) +
    pad('Module',    colW[1]) +
    pad('Result',    colW[2]) +
    'Duration'
  );
  console.log('─'.repeat(colW[0] + colW[1] + colW[2] + 10));

  for (let i = 0; i < testRuns.length; i++) {
    const t = testRuns[i];
    const r = results[i];
    const dur    = r ? `${(r.durationMs / 1000).toFixed(1)}s` : '-';
    const status = r ? r.status : 'PENDING';
    console.log(
      pad(t.testSpec, colW[0]) +
      pad(t.module,   colW[1]) +
      pad(status,     colW[2]) +
      dur
    );
    // Show failing method names from Jenkins (if known), prefixed with class name
    if (t.failedMethods && t.failedMethods.length > 0) {
      t.failedMethods.forEach(function(m) {
        console.log('      ↳ ' + t.testSpec + '#' + m);
      });
    }
  }

  if (fail.length > 0) {
    console.log('\n' + LINE);
    console.log(' FAILED TESTS');
    console.log(LINE);
    fail.forEach(function(r, i) {
      const t = testRuns[results.indexOf(r)];
      console.log(`\n  [${i + 1}] ${t.testSpec}  (${t.module})`);
      if (t.failedMethods && t.failedMethods.length > 0) {
        console.log('       Failed methods: ' + t.failedMethods.map(function(m) { return t.testSpec + '#' + m; }).join(', '));
      }
      const errorLines = extractErrorLines(r.output);
      errorLines.forEach(function(l) { console.log('    ' + l); });
    });
  }

  if (timeout.length > 0) {
    console.log('\n' + LINE);
    console.log(' TIMED-OUT TESTS  (consider increasing --timeout)');
    console.log(LINE);
    timeout.forEach(function(r) {
      const t = testRuns[results.indexOf(r)];
      console.log(`  ${t.testSpec}  (${t.module})`);
    });
  }

  console.log('\n' + LINE);
}

// ── Resolve module for a class ────────────────────────────────

function resolveModule(className, fqn, srcdir) {
  if (forceModule) return forceModule;

  // Search the filesystem first — most accurate, handles any package
  log(`Searching for ${className}.java in *-st modules...`);
  const found = findModuleForClass(className, srcdir);
  if (found) {
    log(`Found in module: ${found}`);
    return found;
  }

  // Fall back to package prefix heuristic if class not found on disk
  if (fqn) {
    const byPkg = detectModuleByPackage(fqn);
    log(`Class not found on disk — using package heuristic: ${byPkg}`);
    return byPkg;
  }

  log(`Could not determine module — defaulting to core-st`);
  return 'core-st';
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const globalStart = Date.now();

  // Resolve SRCDIR
  let srcdir;
  try {
    const resolved = resolveSrcDir();
    srcdir = resolved.srcdir;
    log(`Payor repo: ${srcdir}  (via ${resolved.source})`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }

  let testRuns = [];

  // ── Direct test mode ────────────────────────────────────────
  if (!isJenkinsUrl) {
    const { className, methodName, fqn } = parseTestInput(target);
    const testSpec = buildTestSpec(className, methodName);
    const module   = resolveModule(className, fqn, srcdir);

    log(`Test spec  : ${testSpec}`);
    log(`Module     : ${module}`);
    log(`Maven cmd  : mvn test -Dtest=${testSpec} -pl ${module} -nsu`);

    if (dryRun) {
      console.log(`\nDRY RUN — would execute:`);
      console.log(`  cd ${srcdir}`);
      console.log(`  mvn test -Dtest=${testSpec} -pl ${module} -nsu`);
      process.exit(0);
    }

    // Stream Maven output directly to the terminal — no buffering, no report
    const result = spawnSync('mvn', ['test', `-Dtest=${testSpec}`, '-nsu', '-pl', module], {
      cwd:     srcdir,
      shell:   true,
      stdio:   'inherit',
      timeout: timeoutSecs * 1000,
    });

    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') {
        console.error(`\nERROR: Test timed out after ${timeoutSecs}s`);
        process.exit(2);
      }
      console.error('\nERROR:', result.error.message);
      process.exit(2);
    }
    process.exit(result.status || 0);

  // ── Jenkins mode ────────────────────────────────────────────
  } else {
    log(`Fetching test results from: ${target}`);
    let allTests;
    try {
      allTests = await fetchFailedTests(target);
    } catch (e) {
      console.error('\nERROR:', e.message);
      process.exit(1);
    }

    const failed          = allTests.filter(function(t) { return t.status === 'FAILED' || t.status === 'REGRESSION'; });
    const passedInJenkins = allTests.filter(function(t) { return t.status === 'PASSED'; }).length;
    const skippedInJenkins = allTests.filter(function(t) { return t.status === 'SKIPPED'; }).length;

    log(`Jenkins results — Total: ${allTests.length}  Failed: ${failed.length}  Passed: ${passedInJenkins}  Skipped: ${skippedInJenkins}`);

    if (failed.length === 0) {
      log('No failed tests found in Jenkins build. Nothing to run locally.');
      process.exit(0);
    }

    // Deduplicate by className; collect failing method names per class
    const seen = new Map();  // className → index in testRuns
    for (const t of failed) {
      const { className, fqn } = parseTestInput(t.className);
      if (seen.has(className)) {
        // Add method to existing entry
        if (t.name) testRuns[seen.get(className)].failedMethods.push(t.name);
        continue;
      }
      const module   = resolveModule(className, fqn || t.className, srcdir);
      const testSpec = className;
      const idx      = testRuns.length;
      testRuns.push({ testSpec, module, failedMethods: t.name ? [t.name] : [] });
      seen.set(className, idx);
    }

    const totalMethods = testRuns.reduce(function(s, t) { return s + (t.failedMethods ? t.failedMethods.length : 0); }, 0);
    const methodSuffix = totalMethods > 0 ? `  (${totalMethods} methods across ${testRuns.length} classes)` : `  (${testRuns.length} classes)`;
    log(`Test cases to run:${methodSuffix}  |  parallel: ${parallelism}, timeout: ${timeoutSecs}s each`);

    if (dryRun) {
      console.log('\nDRY RUN — would execute:\n');
      const colW = [52, 14];
      console.log(pad('Test Spec', colW[0]) + 'Module');
      console.log('─'.repeat(colW[0] + colW[1]));
      for (const t of testRuns) {
        console.log(pad(t.testSpec, colW[0]) + t.module);
      }
      console.log(`\nmvn test -Dtest=<TestSpec> -pl <module> -nsu  (run from ${srcdir})`);
      process.exit(0);
    }
  }

  // ── Execute ─────────────────────────────────────────────────
  const results  = new Array(testRuns.length).fill(null);
  const runStart = Date.now();
  let nextIdx    = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= testRuns.length) return;
      const t = testRuns[idx];
      results[idx] = runTest(t.testSpec, t.module, srcdir);
      renderProgress(results.filter(Boolean), testRuns, testRuns.length, runStart);
    }
  }

  const workers = [];
  for (let i = 0; i < parallelism; i++) workers.push(worker());
  await Promise.all(workers);

  printReport(testRuns, results, globalStart);

  const anyFail = results.some(function(r) { return r && (r.status === 'FAIL' || r.status === 'TIMEOUT' || r.status === 'ERROR'); });
  process.exit(anyFail ? 1 : 0);
}

main().catch(function(e) {
  console.error('\nUnhandled error:', e.message);
  process.exit(1);
});
