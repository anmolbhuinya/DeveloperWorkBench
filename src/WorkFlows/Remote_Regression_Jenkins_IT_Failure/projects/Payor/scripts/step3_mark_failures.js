// ============================================================
// step3_mark_failures.js
//
// PURPOSE: Cross-reference the Jenkins failures Excel against
//          the baseline and update the sheet BEFORE the remote
//          IT run so that step4 (step2_run_remote_its.js) can
//          skip those classes entirely.
//
//   Baseline Known Failure (col C = Yes already in baseline xlsx)
//     → promoted to Known Failure in current Excel (col C = Yes)
//       so step4 skips these classes.
//
//   Baseline Local Failure (col D = Yes in baseline xlsx)
//     → marked as Baseline Failure in current Excel (col G = Yes)
//       so step4 skips these classes.
//
// INPUT:   output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx
//          baseline/Baseline_Jenkins_Payor_IT_Status_<pid>_<ver>.xlsx
// OUTPUT:  output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx (updated)
//
// USAGE:   node step3_mark_failures.js
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');
const { resolveOutputFile, nm, loadBaseline } = require('./utils');
const XLSX = nm('xlsx');

const OUTPUT_EXCEL = resolveOutputFile();

async function main() {
  console.log('=== STEP 3: Mark Known Failures and Baseline Failures ===\n');

  if (!fs.existsSync(OUTPUT_EXCEL)) {
    console.error('ERROR: Excel not found:', OUTPUT_EXCEL);
    process.exit(1);
  }

  console.log('Loading baseline...');
  const { baselineKnown, baselineLocalFail } = loadBaseline();
  console.log(`  baselineKnown: ${baselineKnown.size}, baselineLocalFail: ${baselineLocalFail.size}`);

  if (baselineKnown.size === 0 && baselineLocalFail.size === 0) {
    console.log('  No baseline data — nothing to mark. Continuing.');
    return;
  }

  const wb = XLSX.readFile(OUTPUT_EXCEL);
  let promotedToKnown = 0, markedBaseline = 0;

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const ws   = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (data.length === 0) continue;

    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = String(row[0]).trim();
      if (!currentClass) continue;
      const method = (row[1] || '').toString().trim();
      if (!method) continue;

      const entry = `${currentClass}.${method}`;

      if (baselineKnown.has(entry)) {
        row[2] = 'Yes';   // col C: Known Failure
        row[6] = '';      // clear any stale Baseline Failure
        promotedToKnown++;
      } else if (baselineLocalFail.has(entry)) {
        row[6] = 'Yes';   // col G: Baseline Failure
        markedBaseline++;
      }
    }

    const newWs = XLSX.utils.aoa_to_sheet(data);
    newWs['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }];
    wb.Sheets[sheetName] = newWs;
  }

  XLSX.writeFile(wb, OUTPUT_EXCEL);
  console.log(`\nExcel updated:`);
  console.log(`  Promoted to Known Failure : ${promotedToKnown}`);
  console.log(`  Marked as Baseline Failure: ${markedBaseline}`);
  console.log('\nNext step: run step2_run_remote_its.js (skips Known + Baseline Failures)');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
