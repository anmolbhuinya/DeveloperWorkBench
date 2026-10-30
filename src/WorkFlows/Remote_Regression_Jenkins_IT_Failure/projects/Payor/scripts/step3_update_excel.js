// ============================================================
// step3_update_excel.js
//
// PURPOSE: Parse remote IT run results and update the Excel
//          sheet with Local Failure (col D), Timeout (col E),
//          and Baseline Failure (col F) columns.
//
// INPUT:   output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx
//          output/it_results_raw_<version>.txt
//          baseline/Baseline_Jenkins_Payor_IT_Status_<baselineVersion>.xlsx (optional)
// OUTPUT:  output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx (updated)
//
// COLUMN LAYOUT (A–G):
//   A: IT Class        B: Test Method    C: Known Failure
//   D: Local Failure   E: Timeout        F: Baseline Failure   G: Rerun
//
// USAGE:   node step3_update_excel.js
// ============================================================

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');
const { resolveOutputDir, resolveOutputFile, nm, writeFailuresTxt } = require('./utils');
const { injectPieChart } = require('./chart_helper');
const XLSX = nm('xlsx');

const OUTPUT_EXCEL = resolveOutputFile();
const RAW_RESULTS  = path.join(resolveOutputDir(), `it_results_raw_${cfg.version}.txt`);

function parseResults(file) {
  const classResults = new Map();
  const lines = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.includes('=== DONE ==='));

  for (const line of lines) {
    const parts     = line.split('|');
    const status    = parts[0];
    const className = parts[1];
    if (!className) continue;

    const failedMethods = new Set();
    let allFailed = false;

    if (status === 'FAIL') {
      const errorText  = parts.slice(2).join('|');
      const countMatch = errorText.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/);
      if (countMatch) {
        const total  = parseInt(countMatch[1]);
        const fails  = parseInt(countMatch[2]) + parseInt(countMatch[3]);
        if (fails >= total && total > 0) allFailed = true;
      }
      // Match "methodName(className)  Time elapsed: ... <<< FAILURE!" format
      const regex = /(\w+)\([^)]+\)\s+Time elapsed:[^<]*<<<\s+(?:FAILURE!|ERROR!)/g;
      let m;
      while ((m = regex.exec(errorText)) !== null) failedMethods.add(m[1]);
      if (failedMethods.size === 0) allFailed = true;
    }

    classResults.set(className, { status, failedMethods, allFailed });
  }
  return classResults;
}

const TAB_KEYS = {
  Billing:      'billing',
  Claims:       'claims',
  Enrollment:   'enrollment',
  Integrations: 'integrations',
  Platform:     'platform',
  Provider:     'provider',
};

async function main() {
  console.log('=== STEP 3: Update Excel with Local Failure + Baseline results ===\n');

  const classResults = parseResults(RAW_RESULTS);

  let pass = 0, fail = 0, timeout = 0, nomod = 0, notRun = 0;
  for (const [, { status }] of classResults) {
    if (status === 'PASS')          pass++;
    else if (status === 'FAIL')     fail++;
    else if (status === 'TIMEOUT')  timeout++;
    else if (status === 'NOMODULE') nomod++;
    else if (status === 'NOT_RUN')  notRun++;
  }
  console.log(`Results parsed: PASS=${pass}, FAIL=${fail}, TIMEOUT=${timeout}, NOT_RUN=${notRun}, NOMODULE=${nomod}`);

  // Baseline cross-check is done in step3_mark_failures.js before the remote run.
  const wb = XLSX.readFile(OUTPUT_EXCEL);
  let totalLocalFail = 0, totalBaselineFail = 0;

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
      if (!currentClass) continue;
      const method = (row[1] || '').toString().trim();
      const entry  = method ? `${currentClass}.${method}` : currentClass;
      const result = classResults.get(currentClass);

      // ── Set Local Failure (col D), Timeout (col F), Rerun (col H) ────────
      let localFail = false;
      row[5] = '';  // default: clear Timeout
      row[7] = '';  // default: clear Rerun
      if (!result) {
        row[3] = '';
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
      } else if (result.status === 'BUILD_ERROR') {
        row[3] = ''; row[7] = 'BUILD_ERROR';  // no local fail in Excel count, but flagged for email
      } else {
        row[3] = '';
      }

      // Baseline Failure (col G) was already set in step3_mark_failures.js.
      // Only count it here for the summary; do not overwrite it.
      if (String(row[6] || '').trim().toLowerCase() === 'yes') {
        totalBaselineFail++;
      }
    }

    const newWs = XLSX.utils.aoa_to_sheet(data);
    newWs['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }];
    wb.Sheets[sheetName] = newWs;
    console.log(`Sheet "${sheetName}": updated`);
  }

  // ── Refresh Summary sheet ─────────────────────────────────────
  const summaryRows = [
    ['Value Stream', 'Jenkins Job', 'Total Failures', 'Known Failures',
     'Matching Baseline', 'Locally Passing', 'Timeout', 'New Local Failure', 'GP Failure'],
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
      const isKnown     = String(row[2] || '').trim().toLowerCase() === 'yes';
      const isLocalFail = String(row[3] || '').trim().toLowerCase() === 'yes';
      const isGpFail    = String(row[4] || '').trim().toLowerCase() === 'yes';
      const isTimeout   = String(row[5] || '').trim().toLowerCase() === 'yes';
      const isBaseline  = String(row[6] || '').trim().toLowerCase() === 'yes';
      if (isKnown)                    known++;
      else if (isBaseline)            baselineFail++;
      else if (!isLocalFail)          localPass++;
      else if (isTimeout)             timeout++;
      else                            newLocalFail++;
      if (!isKnown && isGpFail)       gpFail++;
      if (!isKnown && isLocalFail && method) localEntries.push(`${currentClass}#${method}`);
    }
    localFailsByCat.push({ name: tabName, entries: localEntries });
    const total = known + localPass + timeout + baselineFail + newLocalFail;
    const jobUrls3 = cfg.jenkinsJobs[jobKey] || [];
    summaryRows.push([tabName, jobUrls3[0] || '', total, known, baselineFail, localPass, timeout, newLocalFail, gpFail]);
    for (let ui = 1; ui < jobUrls3.length; ui++) {
      summaryRows.push(['', jobUrls3[ui], '', '', '', '', '', '', '']);
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
  console.log('Summary sheet refreshed.');

  writeFailuresTxt(path.dirname(OUTPUT_EXCEL), 'local_it_failures', cfg.version, localFailsByCat);

  // ── Pie chart: sum each category column across all value streams ─
  const totals = summaryRows.slice(1).reduce((acc, row) => ({
    known:     acc.known     + (row[3] || 0),
    baseline:  acc.baseline  + (row[4] || 0),
    passing:   acc.passing   + (row[5] || 0),
    timeout:   acc.timeout   + (row[6] || 0),
    newLocal:  acc.newLocal  + (row[7] || 0),
  }), { known: 0, baseline: 0, passing: 0, timeout: 0, newLocal: 0 });

  await injectPieChart(OUTPUT_EXCEL, {
    sheetName:  'Summary',
    title:      'Test Results Breakdown',
    categories: ['Known Failures', 'Locally Passing', 'Timeout', 'Baseline Failure', 'New Local Failure'],
    values:     [totals.known, totals.passing, totals.timeout, totals.baseline, totals.newLocal],
    fromCol: 0, fromRow: 8,
    toCol:   7, toRow:   28,
  });

  console.log('Next step: run step4_generate_email.js');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
