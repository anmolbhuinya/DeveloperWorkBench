// ============================================================
// populate_baseline.js
//
// PURPOSE: Fetch IT failures from baseline Jenkins jobs and
//          write baseline/Baseline_Jenkins_IT_Status.xlsx.
//
//          Step 3 (step3_update_excel.js) reads this file to
//          identify tests that were already failing in the
//          previous release (Baseline Failure column).
//
// READS:   projects/<pid>_<version>.xlsx → baseline_urls sheet
// OUTPUT:  baseline/Baseline_Jenkins_IT_Status.xlsx
//
// USAGE:   node populate_baseline.js
//          remotepopulatepayorbaseline
//          rpb
// ============================================================

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const cfg   = require('./config');
const { nm } = require('./utils');
const { injectPieChart } = require('./chart_helper');
const XLSX  = nm('xlsx');

const arg = (process.argv[2] || '').toLowerCase();
if (arg === '--help' || arg === '-h') {
  console.log('');
  console.log('Usage:');
  console.log('  remotepopulatepayorbaseline');
  console.log('  rpb');
  console.log('');
  console.log('Fetches IT failures from baseline Jenkins builds and writes a baseline Excel.');
  console.log('');
  console.log('Column layout in the baseline Excel:');
  console.log('  A: IT Class   B: Test Method');
  console.log('  C: Known Failure   — blank by default; set Yes manually for pre-existing failures');
  console.log('  D: Local Failure   — Yes for every test that failed in the baseline Jenkins build');
  console.log('');
  console.log('This file is read by rprt (Step 3) to cross-check current failures:');
  console.log('  Known Failure = Yes  → test is promoted to Known Failure in output Excel');
  console.log('  Local Failure = Yes  → test is marked Baseline Failure in output Excel');
  console.log('');
  console.log('Configuration (projects/<pid>_<version>.xlsx → baseline_urls sheet):');
  console.log('  Enter the baseline Jenkins build URL for each value stream.');
  console.log('');
  console.log('  Category    | Baseline Jenkins URL');
  console.log('  billing     | http://jenkins.../job/.../42/');
  console.log('  claims      | ...');
  console.log('  ...         | ...');
  console.log('');
  console.log('Output location is controlled by config.xlsx → General tab:');
  console.log('  baselineDir   Folder to write the baseline file (default: baseline/)');
  console.log('  baselineFile  Output filename (default: Baseline_Jenkins_IT_Status.xlsx)');
  console.log('');
  console.log('Options:');
  console.log('  -h / --help   Show this message');
  console.log('');
  process.exit(0);
}

const JOB_TABS = [
  { key: 'billing',      name: 'Billing'      },
  { key: 'claims',       name: 'Claims'       },
  { key: 'enrollment',   name: 'Enrollment'   },
  { key: 'integrations', name: 'Integrations' },
  { key: 'platform',     name: 'Platform'     },
  { key: 'provider',     name: 'Provider'     },
];

function fetchFailedTests(jobUrl) {
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
                failed.push({ className: tc.className, testName: tc.testName || tc.name || '' });
              }
            });
          });
          resolve(failed);
        } catch (e) {
          reject(new Error(`Could not parse test report for ${jobUrl} - ${e.message}`));
        }
      });
    }).on('error', (e) => {
      reject(new Error(`Could not reach ${jobUrl} - ${e.message}`));
    });
  });
}

async function main() {
  const baselineJobs = cfg.baselineJobs || {};
  const hasUrls = Object.values(baselineJobs).some(u => u && u.trim());
  if (!hasUrls) {
    console.error('ERROR: No baseline URLs configured.');
    console.error('Open the per-project xlsx (projects/<pid>_<version>.xlsx) → baseline_urls sheet and enter Jenkins URLs.');
    process.exit(1);
  }

  const baselineDir  = cfg.paths.baselineDir;
  const baselineFile = cfg.paths.baselineFile;
  const outputPath   = path.join(baselineDir, baselineFile);

  if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });

  const wb = XLSX.utils.book_new();
  const summaryData = [];

  for (const { key, name } of JOB_TABS) {
    const url = (baselineJobs[key] || '').trim();
    if (!url) {
      console.log(`\n[${name}] No URL configured — skipping.`);
      summaryData.push([name, '(skipped)', 0, 0, 0]);
      continue;
    }

    console.log(`\n[${name}] Fetching baseline failures from: ${url}`);
    const failed = await fetchFailedTests(url);
    console.log(`  Found ${failed.length} failed test cases`);

    // Group by class, strip Jenkins-appended suffixes like (C4), (CORR)
    const classMap = new Map();
    for (const { className, testName } of failed) {
      const cleanClass = className.replace(/\([^)]*\)\s*$/, '').trim();
      if (!classMap.has(cleanClass)) classMap.set(cleanClass, []);
      classMap.get(cleanClass).push(testName);
    }

    // Columns: IT Class | Test Method | Known Failure | Local Failure
    //   Known Failure — left blank; user marks Yes for pre-existing failures to skip in reporting
    //   Local Failure — Yes for every test that failed in the baseline Jenkins build
    const rows = [['IT Class', 'Test Method', 'Known Failure', 'Local Failure']];
    for (const [cls, methods] of classMap) {
      for (let i = 0; i < methods.length; i++) {
        rows.push([i === 0 ? cls : '', methods[i], '', 'Yes']);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
    // Count Known Failure and Local Failure from the sheet rows (row[2], row[3])
    let knownCount = 0, localCount = 0;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][2] || '').trim().toLowerCase() === 'yes') knownCount++;
      if (String(rows[i][3] || '').trim().toLowerCase() === 'yes') localCount++;
    }
    summaryData.push([name, url, failed.length, knownCount, localCount]);
  }

  // Summary sheet
  const summaryRows = [['Value Stream', 'Baseline Jenkins URL', 'Failures Recorded', 'Known Failure', 'Local Failure']];
  for (const row of summaryData) summaryRows.push(row);
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 16 }, { wch: 100 }, { wch: 20 }, { wch: 16 }, { wch: 16 }];
  wb.SheetNames.unshift('Summary');
  wb.Sheets['Summary'] = summaryWs;

  XLSX.writeFile(wb, outputPath);
  console.log('\nBaseline Excel written to:', outputPath);

  // ── Pie chart: failures per value stream ─────────────────
  const chartCats = summaryData.filter(r => r[2] > 0).map(r => r[0]);
  const chartVals = summaryData.filter(r => r[2] > 0).map(r => r[2]);
  await injectPieChart(outputPath, {
    sheetName:  'Summary',
    title:      'Baseline Failures by Value Stream',
    categories: chartCats,
    values:     chartVals,
    fromCol: 0, fromRow: 8,
    toCol:   5, toRow:   25,
  });

  console.log('Run  rprt  (remotepayorregression) to use this baseline in a regression run.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
