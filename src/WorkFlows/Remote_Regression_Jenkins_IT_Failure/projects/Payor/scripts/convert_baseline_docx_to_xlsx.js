// ============================================================
// convert_baseline_docx_to_xlsx.js  (Payor)
//
// PURPOSE: Convert a Payor regression email .docx into
//          Baseline_Jenkins_Payor_IT_Status.xlsx.
//
// OUTPUT COLUMNS:
//   A: IT Class   B: Test Method   C: Known Failure   D: Local Failure
//
// BLOCK HANDLING (from email structure):
//   "Payer Regression Monitoring:"   → included; VS detected by email/package
//   "Classic Regression Monitoring:" → included; maps to Claims tab
//   "Enrollment Regression Monitoring:" → SKIPPED (Connector Enrollment)
//   "Cprime Regression Monitoring:"  → SKIPPED (Connector)
//
// SECTION MAPPING within included blocks:
//   "Known Failures:"                → Known Failure = Yes
//   "New Failures:" / "Failing Locally:" / "New Failure:" → Local Failure = Yes
//
// USAGE:
//   node convert_baseline_docx_to_xlsx.js [path-to-docx]
//   Default: C:/Users/<user>/Downloads/Regression_Email_Payor_26.1.4.docx
// ============================================================

'use strict';

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const cfg          = require('./config');
const { nm, resolveInputDir } = require('./utils');
const XLSX         = nm('xlsx');

const DOCX_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : '' + require('os').homedir().replace(/\\/g, '/') + '/Downloads/Regression_Email_Payor_26.1.4.docx';

if (!fs.existsSync(DOCX_PATH)) {
  console.error('ERROR: Docx not found:', DOCX_PATH);
  console.error('Usage: node convert_baseline_docx_to_xlsx.js "path/to/Regression_Email_Payor_XX.X.X.docx"');
  process.exit(1);
}

const OUTPUT_FILE = path.join(resolveInputDir(), 'Baseline_Jenkins_Payor_IT_Status.xlsx');

// ── Step 1: Extract paragraphs ──────────────────────────────
const tmp = path.join(os.tmpdir(), 'payor_conv_' + process.pid);
let paragraphs = [];
try {
  execSync(`unzip -o "${DOCX_PATH.replace(/\\/g,'/')}" word/document.xml -d "${tmp.replace(/\\/g,'/')}"`, { encoding: 'utf8' });
  const xml    = fs.readFileSync(path.join(tmp, 'word', 'document.xml'), 'utf8');
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let pm;
  while ((pm = pRegex.exec(xml)) !== null) {
    let t = '', n; tRegex.lastIndex = 0;
    while ((n = tRegex.exec(pm[0])) !== null) t += n[1];
    if (t.trim()) paragraphs.push(t.trim());
  }
} finally {
  try { execSync(`rm -rf "${tmp.replace(/\\/g,'/')}"`); } catch (_) {}
}
console.log(`Extracted ${paragraphs.length} paragraphs from ${path.basename(DOCX_PATH)}`);

// ── VS detection ────────────────────────────────────────────
// From @email-address lines within Payer block
const VS_BY_EMAIL = [
  { key: 'provider',     re: /provider/i          },
  { key: 'claims',       re: /claims/i             },
  { key: 'platform',     re: /platform/i           },
  { key: 'enrollment',   re: /enrollment/i         },
  { key: 'billing',      re: /billing|financial/i  },
  { key: 'integrations', re: /integrat/i           },
];

// Fallback from Java package
const VS_BY_PACKAGE = [
  { key: 'provider',     re: /^com\.healthedge\.(provider|he\.provider)/i              },
  { key: 'platform',     re: /^com\.healthedge\.(cvc|platform)/i                       },
  { key: 'enrollment',   re: /^com\.healthedge\.(he\.enrollment|payer\.enrollment)/i   },
  { key: 'billing',      re: /^com\.healthedge\.(billing|financial)/i                  },
  { key: 'integrations', re: /^com\.healthedge\.(integrat)/i                           },
  { key: 'claims',       re: /^com\.healthedge\.(customer\.integration|claims)/i       },
];

function vsFromEmail(line) {
  for (const { key, re } of VS_BY_EMAIL) { if (re.test(line)) return key; }
  return null;
}
function vsFromPackage(fqcn) {
  for (const { key, re } of VS_BY_PACKAGE) { if (re.test(fqcn)) return key; }
  return null;
}

// ── Block state machine ──────────────────────────────────────
// INCLUDED blocks:
//   'payer'   — "Payer Regression Monitoring:"
//   'classic' — "Classic Regression Monitoring:"
// SKIPPED blocks (set activeBlock=null):
//   "Enrollment Regression Monitoring:" (Connector Enrollment)
//   "Cprime Regression Monitoring:"

const tabData = {
  provider: [], claims: [], platform: [],
  enrollment: [], billing: [], integrations: [],
};

const VS_NAMES = {
  provider: 'Provider', claims: 'Claims', platform: 'Platform',
  enrollment: 'Enrollment', billing: 'Billing', integrations: 'Integrations',
};

let activeBlock  = null;   // 'payer' | 'classic' | null (skipped)
let currentTab   = null;   // tab key for current context within payer block
let knownSection = false;

function parseEntry(text, defaultTab) {
  // Strip leading dashes
  const entry = text.replace(/^-+/, '').trim();
  if (!entry) return null;

  // Split on last dot followed by lowercase → method
  let lastDot = -1;
  for (let i = entry.length - 1; i >= 0; i--) {
    if (entry[i] === '.' && i + 1 < entry.length && /[a-z]/.test(entry[i + 1])) {
      lastDot = i; break;
    }
  }
  if (lastDot === -1) return null;

  const classPart = entry.slice(0, lastDot).replace(/\([^)]*\)\s*$/, '').trim();
  const method    = entry.slice(lastDot + 1).trim();
  if (!classPart || !method) return null;

  const tab = defaultTab || vsFromPackage(classPart) || 'claims';
  return { cls: classPart, method, tab };
}

for (const rawText of paragraphs) {
  const trimmed = rawText.trim();
  if (!trimmed) continue;
  const lower = trimmed.toLowerCase();

  // ── Block header detection ─────────────────────────────
  if (lower.startsWith('payer regression')) {
    activeBlock  = 'payer';
    currentTab   = null;
    knownSection = false;
    continue;
  }
  if (lower.startsWith('classic regression')) {
    activeBlock  = 'classic';
    currentTab   = 'claims';  // Classic entries run in the Payor Claims job
    knownSection = false;
    continue;
  }
  if (lower.startsWith('enrollment regression') || lower.startsWith('cprime regression')) {
    activeBlock = null;  // skip these blocks entirely
    continue;
  }

  if (activeBlock === null) continue;

  // ── Section headers ────────────────────────────────────
  if (lower.startsWith('known failure')) { knownSection = true;  continue; }
  if (lower.startsWith('new failure') || lower.startsWith('failing locally') || lower.startsWith('locally passing')) {
    knownSection = false; continue;
  }

  // ── VS from email address (payer block only) ───────────
  if (activeBlock === 'payer' && (trimmed.startsWith('@') || trimmed.includes('-value-stream'))) {
    const vs = vsFromEmail(trimmed);
    if (vs) currentTab = vs;
    continue;
  }

  // ── Job sub-headers in classic block ───────────────────
  // e.g. "Classic Claims Integ Tests: http://..."
  if (activeBlock === 'classic' && !trimmed.startsWith('--')) {
    // Could be a sub-header like "Classic Provider Integ Tests:"
    const vs = vsFromEmail(trimmed);
    if (vs) currentTab = vs;
    continue;
  }

  // ── Test entry ─────────────────────────────────────────
  if (!trimmed.startsWith('--')) continue;

  const parsed = parseEntry(trimmed, currentTab);
  if (!parsed) continue;

  tabData[parsed.tab].push({
    cls:   parsed.cls,
    method: parsed.method,
    known: knownSection ? 'Yes' : '',
    local: knownSection ? ''    : 'Yes',
  });
}

// ── Build workbook ──────────────────────────────────────────
const VS_ORDER = ['provider','claims','platform','enrollment','billing','integrations'];

const wb = XLSX.utils.book_new();
const summaryRows = [['Value Stream', 'Total', 'Known Failures', 'Local Failures']];

for (const key of VS_ORDER) {
  const entries = tabData[key];
  const name    = VS_NAMES[key];

  const rows = [['IT Class', 'Test Method', 'Known Failure', 'Local Failure']];
  let prevClass = '';
  for (const { cls, method, known, local } of entries) {
    rows.push([cls === prevClass ? '' : cls, method, known, local]);
    prevClass = cls;
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 90 }, { wch: 80 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, name);

  const knownCount = entries.filter(e => e.known === 'Yes').length;
  const localCount = entries.filter(e => e.local === 'Yes').length;
  summaryRows.push([name, entries.length, knownCount, localCount]);
}

const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
summaryWs['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
wb.SheetNames.unshift('Summary');
wb.Sheets['Summary'] = summaryWs;

const outDir = resolveInputDir();
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

XLSX.writeFile(wb, OUTPUT_FILE);
console.log('\nBaseline xlsx written to:', OUTPUT_FILE);
summaryRows.slice(1).forEach(r =>
  console.log(`  ${String(r[0]).padEnd(14)} total=${r[1]}  known=${r[2]}  local=${r[3]}`)
);
const total = summaryRows.slice(1).reduce((s, r) => s + r[1], 0);
console.log(`\n  Total entries: ${total}`);
console.log('\nVerify config.xlsx → General → baselineFile = Baseline_Jenkins_Payor_IT_Status.xlsx');
