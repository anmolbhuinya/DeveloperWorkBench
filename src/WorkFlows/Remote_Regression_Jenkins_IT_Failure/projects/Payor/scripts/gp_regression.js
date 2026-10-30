// ============================================================
// gp_regression.js
//
// PURPOSE: Fetch GP Jenkins test results and mark GP Failure = Yes
//          in the output Excel for any test that failed in the GP run.
//          Treats GP Failure as equivalent to Local Failure for the
//          email draft (step4 classification already handles this).
//
// INPUT:   output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx
//          projects/<pid>_<version>.xlsx → gp_urls sheet → gp_url
// OUTPUT:  output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx (updated col E)
//          output/Regression_Email_<version>.docx (regenerated)
//
// COLUMN LAYOUT (A–H):
//   A: IT Class   B: Test Method   C: Known Failure
//   D: Local Failure  E: GP Failure  F: Timeout  G: Baseline Failure  H: Rerun
//
// USAGE:
//   gpregressionresult            (via CMD wrapper)
//   gpr                           (alias)
//   node scripts/gp_regression.js
//   node scripts/gp_regression.js --url <jenkinsUrl>  (one-off override)
// ============================================================

'use strict';

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const cfg     = require('./config');
const { resolveOutputDir, resolveOutputFile, nm, loadBaseline, writeFailuresTxt } = require('./utils');
const { injectPieChart } = require('./chart_helper');
const XLSX    = nm('xlsx');

const OUTPUT_EXCEL = resolveOutputFile();

// --url <override> for one-off runs
const args    = process.argv.slice(2);
const uIdx    = args.indexOf('--url');
const GP_URL  = (uIdx >= 0 && args[uIdx + 1]) ? args[uIdx + 1] : cfg.gpServer.url;

const TAB_KEYS = {
  Billing:      'billing',
  Claims:       'claims',
  Enrollment:   'enrollment',
  Integrations: 'integrations',
  Platform:     'platform',
  Provider:     'provider',
};

function isYes(val) {
  return String(val || '').trim().toLowerCase() === 'yes';
}

// Fetch GP test report — returns Set of "className.methodName" strings that FAILED
function fetchGpFailures(gpUrl) {
  const reportUrl = gpUrl.replace(/\/?$/, '/testReport/api/json?tree=suites[cases[className,testName,name,status]]&depth=10');
  console.log('Fetching GP report:', reportUrl);
  return new Promise((resolve, reject) => {
    const lib = reportUrl.startsWith('https') ? https : http;
    lib.get(reportUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json   = JSON.parse(data);
          const failed = new Set();
          (json.suites || []).forEach(suite => {
            (suite.cases || []).forEach(tc => {
              if (tc.status === 'FAILED' || tc.status === 'REGRESSION' || tc.status === 'ERROR') {
                const cls    = (tc.className || '').replace(/\([^)]*\)\s*$/, '').trim();
                const method = (tc.testName || tc.name || '').trim();
                if (cls && method) failed.add(`${cls}.${method}`);
                else if (cls)      failed.add(cls);
              }
            });
          });
          console.log(`  GP failures found: ${failed.size}`);
          resolve(failed);
        } catch (e) {
          reject(new Error(`Could not parse GP test report for ${gpUrl} - ${e.message}`));
        }
      });
    }).on('error', (e) => {
      reject(new Error(`Could not reach GP Jenkins URL ${gpUrl} - ${e.message}`));
    });
  });
}

async function main() {
  console.log(`\n=== GP REGRESSION: Update Excel with GP Failure results ===\n`);

  const hasUrlOverride = uIdx >= 0 && args[uIdx + 1];
  if (!hasUrlOverride && !cfg.gpServer.enabled) {
    console.log('GP regression is disabled for this project (gp_enabled=false in per-project xlsx).');
    console.log('Enable it via the IDP UI → GP Jenkins URLs tab, or set enabled=true in the gp_urls sheet.');
    process.exit(0);
  }
  if (!GP_URL) {
    console.error('ERROR: No GP Jenkins URL configured.');
    console.error('Open the per-project xlsx (projects/<pid>_<version>.xlsx) → gp_urls sheet and set gp_url, or pass --url <url>.');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_EXCEL)) {
    console.error('ERROR: Output Excel not found:', OUTPUT_EXCEL);
    console.error('Run rprt (steps 1–3) first to generate the Excel file.');
    process.exit(1);
  }

  const gpFailures = await fetchGpFailures(GP_URL);

  console.log('\nLoading baseline for cross-check...');
  const { baselineKnown, baselineLocalFail } = loadBaseline();

  const wb = XLSX.readFile(OUTPUT_EXCEL);
  let totalGpFail = 0, totalPromoted = 0;

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const ws   = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (data.length === 0) continue;

    // Ensure GP Failure header in col E (index 4)
    data[0][4] = 'GP Failure';

    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = String(row[0]).trim();
      if (!currentClass) continue;

      const method   = (row[1] || '').toString().trim();
      const entry    = method ? `${currentClass}.${method}` : currentClass;
      const isKnown  = isYes(row[2]);

      if (isKnown) continue;  // never overwrite Known Failure rows

      const inGp = gpFailures.has(entry) || gpFailures.has(currentClass);
      if (!inGp) continue;

      // Mark GP Failure
      row[4] = 'Yes';
      totalGpFail++;

      // Baseline cross-check for GP-only failures (Local Failure may be blank)
      if (!isYes(row[3])) {
        if (baselineKnown.has(entry)) {
          row[2] = 'Yes';   // promote to Known Failure
          row[4] = '';
          totalGpFail--;
          totalPromoted++;
        } else if (baselineLocalFail.has(entry)) {
          row[6] = 'Yes';   // Baseline Failure (col G)
        }
      }
    }

    const newWs = XLSX.utils.aoa_to_sheet(data);
    newWs['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }];
    wb.Sheets[sheetName] = newWs;
    console.log(`  Sheet "${sheetName}": updated`);
  }


  // ── Refresh Summary ───────────────────────────────────────
  const summaryRows = [
    ['Value Stream', 'Jenkins Job', 'Total Failures', 'Known Failures',
     'Locally Passing', 'Timeout', 'Matching Baseline', 'New Local Failure', 'GP Failure'],
  ];
  const localFailsByCat = [];

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
      const failsLocally = isLocalFail || isGpFail;
      if (!isKnown && failsLocally && method) localEntries.push(`${currentClass}#${method}`);
    }
    localFailsByCat.push({ name: tabName, entries: localEntries });
    const total = known + localPass + timeout + baselineFail + newLocalFail;
    const jobUrlsGp = cfg.jenkinsJobs[jobKey] || [];
    summaryRows.push([tabName, jobUrlsGp[0] || '', total, known, localPass, timeout, baselineFail, newLocalFail, gpFail]);
    for (let ui = 1; ui < jobUrlsGp.length; ui++) {
      summaryRows.push(['', jobUrlsGp[ui], '', '', '', '', '', '', '']);
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
  console.log(`  GP Failure = Yes     : ${totalGpFail}`);
  console.log(`  Promoted to Known    : ${totalPromoted}`);
  console.log('Summary sheet refreshed.');

  // ── Pie chart (update with GP failure totals) ─────────────
  const totals = summaryRows.slice(1).reduce((acc, row) => ({
    known:    acc.known    + (row[3] || 0),
    passing:  acc.passing  + (row[4] || 0),
    timeout:  acc.timeout  + (row[5] || 0),
    baseline: acc.baseline + (row[6] || 0),
    newLocal: acc.newLocal + (row[7] || 0),
    gpFail:   acc.gpFail   + (row[8] || 0),
  }), { known: 0, passing: 0, timeout: 0, baseline: 0, newLocal: 0, gpFail: 0 });

  await injectPieChart(OUTPUT_EXCEL, {
    sheetName:  'Summary',
    title:      'Test Results Breakdown',
    categories: ['Known Failures', 'Locally Passing', 'Timeout', 'Baseline Failure', 'New Local Failure', 'GP Failure'],
    values:     [totals.known, totals.passing, totals.timeout, totals.baseline, totals.newLocal, totals.gpFail],
    fromCol: 0, fromRow: 8,
    toCol:   7, toRow:   28,
  });

  // ── Write local_it_failures txt (GP failures treated as local) ──
  writeFailuresTxt(path.dirname(OUTPUT_EXCEL), 'local_it_failures', cfg.version, localFailsByCat);

  // ── Regenerate email draft ────────────────────────────────
  console.log('\nRegenerating email draft...');
  try {
    execSync(`node "${path.join(__dirname, 'step4_generate_email.js')}"`, { stdio: 'inherit' });
  } catch (e) {
    console.error('WARNING: Email generation failed:', e.message);
  }

  console.log('\n=== GP REGRESSION COMPLETE ===');
  console.log('Output folder: ' + path.dirname(OUTPUT_EXCEL));
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
