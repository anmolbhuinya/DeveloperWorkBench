// ============================================================
// step1_fetch_jenkins_failures.js
//
// PURPOSE: Fetch failed IT test classes from each Payor Jenkins
//          job and build the Excel sheet with tabs per VS.
//
// OUTPUT:  output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx
//          Columns: IT Class | Test Method | Known Failure
//
// HOW IT WORKS:
//   - Calls Jenkins JSON API for each job URL to get the list
//     of failed test cases.
//   - Groups tests by value stream (tab) and class.
//   - Marks Known Failures (carried from previous release's
//     known_failures.json if present).
//   - Writes the Excel file.
//
// USAGE:   node step1_fetch_jenkins_failures.js
// ============================================================

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const cfg   = require('./config');
const { resolveOutputDir, resolveOutputFile, nm, writeFailuresTxt } = require('./utils');
const XLSX  = nm('xlsx');

const OUTPUT_EXCEL = resolveOutputFile();
const KNOWN_FAILURES_FILE = path.join(__dirname, 'known_failures.json');

// Tab order and mapping
const JOB_TABS = [
  { key: 'billing',     name: 'Billing'      },
  { key: 'claims',      name: 'Claims'       },
  { key: 'enrollment',  name: 'Enrollment'   },
  { key: 'integrations',name: 'Integrations' },
  { key: 'platform',    name: 'Platform'     },
  { key: 'provider',    name: 'Provider'     },
];

// Load known failures from previous release (if file exists)
let knownFailureSet = new Set();
if (fs.existsSync(KNOWN_FAILURES_FILE)) {
  const data = JSON.parse(fs.readFileSync(KNOWN_FAILURES_FILE, 'utf8'));
  data.forEach(e => knownFailureSet.add(e));
  console.log(`Loaded ${knownFailureSet.size} known failures from known_failures.json`);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const apiUrl = url.replace(/\/?$/, '/api/json?tree=suites[cases[className,testName,status]]&depth=10');
    const lib = apiUrl.startsWith('https') ? https : http;
    lib.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error for ' + apiUrl + ': ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function fetchFailedTests(jobUrl) {
  // Jenkins testReport API
  const reportUrl = jobUrl.replace(/\/?$/, '/testReport/api/json?tree=suites[cases[className,testName,name,status]]&depth=10');
  console.log('  Fetching:', reportUrl);
  return new Promise((resolve, reject) => {
    const lib = reportUrl.startsWith('https') ? https : http;
    lib.get(reportUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const failed = [];
          (json.suites || []).forEach(suite => {
            (suite.cases || []).forEach(tc => {
              if (tc.status === 'FAILED' || tc.status === 'REGRESSION' || tc.status === 'ERROR') {
                const methodName = tc.testName || tc.name || '';
                failed.push({ className: tc.className, testName: methodName });
              }
            });
          });
          resolve(failed);
        } catch(e) {
          // If testReport not available, return empty
          console.warn('  WARNING: Could not parse test report for', jobUrl, '-', e.message);
          resolve([]);
        }
      });
    }).on('error', (e) => {
      console.warn('  WARNING: Could not reach', jobUrl, '-', e.message);
      resolve([]);
    });
  });
}

async function main() {
  // resolveOutputDir() (called at module load) already ensures the dir exists

  const wb = XLSX.utils.book_new();
  const failuresByCat = [];   // populated per tab → written to jenkins_it_failures_<version>.txt

  for (const { key, name } of JOB_TABS) {
    const urls = cfg.jenkinsJobs[key] || [];
    if (urls.length === 0) {
      console.warn(`\n[${name}] WARNING: No Jenkins URL configured for "${key}", skipping.`);
      continue;
    }

    console.log(`\n[${name}] Fetching primary failures from: ${urls[0]}`);
    let failed = await fetchFailedTests(urls[0]);
    console.log(`  Found ${failed.length} failed test cases`);

    // Subsequent URLs: remove tests that pass there (don't add new failures)
    for (let ui = 1; ui < urls.length; ui++) {
      console.log(`  Checking subsequent URL [${ui}]: ${urls[ui]}`);
      const subsequent = await fetchFailedTests(urls[ui]);
      if (subsequent.length === 0) {
        // fetch failed or no failures — skip filtering to avoid false removal
        console.log(`    No results (fetch error or no failures) — skipping filter for this URL`);
        continue;
      }
      const subsequentSet = new Set(
        subsequent.map(t => `${t.className.replace(/\([^)]*\)\s*$/, '').trim()}.${t.testName}`)
      );
      const before = failed.length;
      failed = failed.filter(t => {
        const cls = t.className.replace(/\([^)]*\)\s*$/, '').trim();
        return subsequentSet.has(`${cls}.${t.testName}`);
      });
      console.log(`    ${before - failed.length} test(s) removed (passed in subsequent build)`);
    }

    // Group by class, preserving order
    // Strip Jenkins-appended suffixes like (C4), (CORR) from class names
    const classMap = new Map();
    for (const { className, testName } of failed) {
      const cleanClass = className.replace(/\([^)]*\)\s*$/, '').trim();
      if (!classMap.has(cleanClass)) classMap.set(cleanClass, []);
      classMap.get(cleanClass).push(testName);
    }

    // Collect full-path entries for the txt file
    const entries = [];
    for (const [cls, methods] of classMap) {
      for (const method of methods) entries.push(`${cls}#${method}`);
    }
    failuresByCat.push({ name, entries });

    // Build rows  A=IT Class  B=Test Method  C=Known Failure  D=Local Failure  E=GP Failure  F=Timeout  G=Baseline Failure  H=Rerun
    const rows = [['IT Class', 'Test Method', 'Known Failure', 'Local Failure', 'GP Failure', 'Timeout', 'Baseline Failure', 'Rerun']];
    for (const [cls, methods] of classMap) {
      for (let i = 0; i < methods.length; i++) {
        const key = cls + '.' + methods[i];
        const isKnown = knownFailureSet.has(key) ? 'Yes' : '';
        rows.push([i === 0 ? cls : '', methods[i], isKnown, '', '', '', '', '']);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // Build Summary sheet (first sheet — insert at position 0)
  const summaryRows = [
    ['Value Stream', 'Jenkins Job', 'Total Failures', 'Known Failures', 'Locally Passing', 'Timeout', 'Matching Baseline', 'New Local Failure'],
  ];
  for (const { key, name } of JOB_TABS) {
    const ws   = wb.Sheets[name];
    const data = ws ? XLSX.utils.sheet_to_json(ws, { header: 1 }) : [];
    let known = 0, total = 0;
    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = row[0];
      if (!currentClass) continue;
      total++;
      if (row[2] === 'Yes') known++;
    }
    const jobUrls1 = cfg.jenkinsJobs[key] || [];
    summaryRows.push([name, jobUrls1[0] || '', total, known, '-', '-', '-', '-']);
    for (let ui = 1; ui < jobUrls1.length; ui++) {
      summaryRows.push(['', jobUrls1[ui], '', '', '', '', '', '']);
    }
  }
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 16 }, { wch: 90 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 20 }];

  // Insert Summary as the first sheet
  wb.SheetNames.unshift('Summary');
  wb.Sheets['Summary'] = summaryWs;

  XLSX.writeFile(wb, OUTPUT_EXCEL);
  console.log('\nExcel written to:', OUTPUT_EXCEL);

  writeFailuresTxt(path.dirname(OUTPUT_EXCEL), 'jenkins_it_failures', cfg.version, failuresByCat);

  console.log('\nNext step: run step2_run_remote_its.js');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
