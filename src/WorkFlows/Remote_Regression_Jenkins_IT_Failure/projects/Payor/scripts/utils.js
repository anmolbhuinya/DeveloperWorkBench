// utils.js — shared helpers used by all steps

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');

// Resolve app root from env var (set by IDP for non-Payor apps) or default to Payor dir
const APP_DIR = process.env.RPB_APP_DIR
  ? path.resolve(process.env.RPB_APP_DIR)
  : path.join(__dirname, '..');

function makeReportSubdir() {
  const pid = cfg.pid != null ? cfg.pid : '0';
  return `reports_${pid}_${cfg.version}`;
}

function resolveOutputDir() {
  const baseDir = cfg.paths.outputDir || path.join(APP_DIR, 'output');
  const subdir  = process.env.RPRT_REPORT_SUBDIR || makeReportSubdir();
  const dir     = path.join(baseDir, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveOutputFile() {
  const name = cfg.paths.outputFileName ||
    `Jenkins_${cfg.appName}_IT_Failures_Local_${cfg.version}.xlsx`;
  return path.join(resolveOutputDir(), name);
}

function resolveInputDir() {
  return cfg.paths.baselineDir;
}

function nm(pkg) {
  return require(path.join(cfg.paths.nodeModules, pkg));
}

// Load baseline Excel and return two Sets:
//   baselineKnown     — "class.method" entries where col C (Known Failure) = Yes
//   baselineLocalFail — "class.method" entries where col D (Local Failure) = Yes
function loadBaseline() {
  const baselineKnown     = new Set();
  const baselineLocalFail = new Set();

  const baselinePath = path.join(resolveInputDir(), cfg.paths.baselineFile);
  if (!fs.existsSync(baselinePath)) {
    console.warn(`  [baseline] File not found: ${baselinePath} — baseline comparison skipped.`);
    return { baselineKnown, baselineLocalFail };
  }

  // Copy baseline into the report subfolder for traceability
  try {
    const outDir   = resolveOutputDir();
    const pid      = cfg.pid != null ? cfg.pid : '0';
    const copyPath = path.join(outDir, `Baseline_${cfg.appName}_IT_Status_${pid}_${cfg.version}.xlsx`);
    if (!fs.existsSync(copyPath)) {
      fs.copyFileSync(baselinePath, copyPath);
      console.log(`  [baseline] Snapshot: ${path.basename(copyPath)}`);
    }
  } catch (e) {
    console.warn(`  [baseline] Could not copy baseline snapshot: ${e.message}`);
  }

  const XLSX = nm('xlsx');
  const wb   = XLSX.readFile(baselinePath);

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Summary') continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    let currentClass = '';
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || (!row[0] && !row[1])) continue;
      if (row[0]) currentClass = String(row[0]).trim();
      const method = (row[1] || '').toString().trim();
      if (!method || !currentClass) continue;
      const key      = `${currentClass}.${method}`;
      const isKnown  = String(row[2] || '').trim().toLowerCase() === 'yes';
      const isLocal  = String(row[3] || '').trim().toLowerCase() === 'yes';
      if (isKnown) baselineKnown.add(key);
      if (isLocal) baselineLocalFail.add(key);
    }
  }

  console.log(`  [baseline] Loaded from ${baselinePath}`);
  console.log(`  [baseline] Known failures: ${baselineKnown.size}, Local failures: ${baselineLocalFail.size}`);
  return { baselineKnown, baselineLocalFail };
}

// Write per-category failures text files into a named subfolder.
function writeFailuresTxt(dir, prefix, version, sections) {
  const subdir = path.join(dir, prefix);
  if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });
  for (const s of sections) {
    const filePath = path.join(subdir, `${prefix}_${s.name}_${version}.txt`);
    fs.writeFileSync(filePath, s.entries.length > 0 ? s.entries.join(', ') + '\n' : '(none)\n');
    console.log(`  Written: ${path.relative(dir, filePath)}`);
  }
}

module.exports = { resolveOutputDir, resolveOutputFile, resolveInputDir, nm, loadBaseline, makeReportSubdir, writeFailuresTxt };
