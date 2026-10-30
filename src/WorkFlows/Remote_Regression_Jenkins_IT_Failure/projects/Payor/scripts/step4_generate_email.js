// ============================================================
// step4_generate_email.js
//
// PURPOSE: Read the updated Excel sheet and produce the
//          regression email draft as a .docx file.
//
// INPUT:   output/Jenkins_Payor_IT_Failures_Local_<version>.xlsx
// OUTPUT:  output/Regression_Email_<version>.docx
//
// COLUMN LAYOUT (A–G):
//   A: IT Class        B: Test Method    C: Known Failure
//   D: Local Failure   E: Timeout        F: Baseline Failure   G: Rerun
//
// EMAIL SECTION MAPPING:
//   C=Yes                        → Known Failures
//   D=blank (and C blank)        → Locally Passing
//   D=Yes and F=Yes              → Failing Locally > a) Matching with Baseline
//   D=Yes and F=blank            → Failing Locally > b) New Local Failure
//   Timeout (E=Yes) is NOT a separate bucket — counted in Failing Locally
//
// USAGE:   node step4_generate_email.js
// ============================================================

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');
const { resolveOutputDir, resolveOutputFile, nm } = require('./utils');
const XLSX = nm('xlsx');
const { Document, Packer, Paragraph, TextRun, ExternalHyperlink } = nm('docx');


const OUTPUT_EXCEL = resolveOutputFile();
const OUTPUT_DOCX  = path.join(resolveOutputDir(), `Regression_Email_${cfg.version}.docx`);

const TAB_JOB_MAP = [
  { tab: 'Billing',     key: 'billing'      },
  { tab: 'Claims',      key: 'claims'       },
  { tab: 'Enrollment',  key: 'enrollment'   },
  { tab: 'Integrations',key: 'integrations' },
  { tab: 'Platform',    key: 'platform'     },
  { tab: 'Provider',    key: 'provider'     },
];

function isYes(val) {
  return String(val || '').trim().toLowerCase() === 'yes';
}

function getTabData(wb, sheetName) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  const knownList    = [];
  const passList     = [];   // Local Failure blank → Locally Passing
  const baselineList = [];   // Local Failure=Yes + Baseline=Yes → Failing Locally > Matching with Baseline
  const newFailList  = [];   // Local Failure=Yes + Baseline blank → Failing Locally > New Local Failure
  let currentClass   = '';

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || (!row[0] && !row[1])) continue;
    if (row[0]) currentClass = String(row[0]).trim();
    if (!currentClass) continue;
    const method = (row[1] || '').toString().trim();
    const entry  = method ? `${currentClass}.${method}` : currentClass;

    // col C=Known(2) D=LocalFail(3) E=GPFail(4) F=Timeout(5) G=Baseline(6) H=Rerun(7)
    // GP Failure is treated as equivalent to Local Failure for email classification.
    // Baseline failures were skipped (not run), so LocalFail is blank — check Baseline before LocalFail.
    // BUILD_ERROR: LocalFail is blank in Excel (kept out of Excel failure counts) but goes to Failing Locally in email.
    const isBuildError  = String(row[7] || '').trim().toUpperCase() === 'BUILD_ERROR';
    const failsLocally  = isYes(row[3]) || isYes(row[4]) || isBuildError;
    if (isYes(row[2])) {
      knownList.push(entry);
    } else if (isYes(row[6])) {
      baselineList.push(entry);
    } else if (!failsLocally) {
      passList.push(entry);
    } else {
      newFailList.push(entry);
    }
  }

  return { knownList, passList, baselineList, newFailList };
}

function blankPara() {
  return new Paragraph({ children: [new TextRun({ text: '' })] });
}

function textPara(text) {
  return new Paragraph({ children: [new TextRun({ text })] });
}

// Label with highlight on the word part only, count in plain text
function highlightLabelPara(label, count, highlight) {
  return new Paragraph({
    children: [
      new TextRun({ text: label, highlight }),
      new TextRun({ text: `(${count}):` }),
    ],
  });
}

// Header: job name cyan-highlighted, count + email plain
function headerPara(jobName, totalFailed, email) {
  return new Paragraph({
    children: [
      new TextRun({ text: jobName, highlight: 'cyan' }),
      new TextRun({ text: `(${totalFailed} Failures) ${email}` }),
    ],
  });
}

// Jenkins URL as a clickable hyperlink
function hyperlinkPara(url) {
  return new Paragraph({
    children: [
      new ExternalHyperlink({
        link: url,
        children: [
          new TextRun({ text: url, color: '0563C1', underline: {} }),
        ],
      }),
    ],
  });
}

function buildSection({ jobName, email, urls, knownList, passList, baselineList, newFailList }) {
  const totalFailed = knownList.length + passList.length + baselineList.length + newFailList.length;
  const urlList = Array.isArray(urls) ? urls : (urls ? [urls] : []);

  const paras = [
    headerPara(jobName, totalFailed, email),
    ...urlList.map(u => hyperlinkPara(u)),
    blankPara(),
    highlightLabelPara('Known Failures', knownList.length, 'yellow'),
    ...knownList.map(t => textPara(t)),
    highlightLabelPara('Matching with Baseline', baselineList.length, 'darkCyan'),
    ...baselineList.map(t => textPara(t)),
    highlightLabelPara('Locally Passing', passList.length, 'green'),
    ...passList.map(t => textPara(t)),
    highlightLabelPara('Failing Locally', newFailList.length, 'red'),
    ...(newFailList.length > 0 ? newFailList.map(t => textPara(t)) : [textPara('  (none)')]),
    blankPara(),
  ];

  return paras;
}

function main() {
  console.log(`=== STEP 4: Generate regression email for ${cfg.version} ===\n`);

  const wb = XLSX.readFile(OUTPUT_EXCEL);
  const children = [
    blankPara(),
    textPara('Hi Everyone,'),
    new Paragraph({ children: [new TextRun({ text: ' ' })] }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Respective VS please have a look on regression status for ' }),
        new TextRun({ text: cfg.version, bold: true }),
        new TextRun({ text: ' into this on priority:' }),
      ],
    }),
    blankPara(),
    blankPara(),
    blankPara(),
  ];

  for (const { tab, key } of TAB_JOB_MAP) {
    if (!wb.SheetNames.includes(tab)) {
      console.warn(`  WARNING: Tab "${tab}" not found in Excel, skipping.`);
      continue;
    }
    const { knownList, passList, baselineList, newFailList } = getTabData(wb, tab);
    const total = knownList.length + passList.length + baselineList.length + newFailList.length;
    console.log(`${tab}: total=${total}, known=${knownList.length}, locallyPassing=${passList.length}, matchingBaseline=${baselineList.length}, newLocalFail=${newFailList.length}`);

    children.push(...buildSection({
      jobName:      `payer-${key === 'integrations' ? 'he-integrations' : key + '-ora-container'}`,
      email:        cfg.jobEmails[key],
      urls:         cfg.jenkinsJobs[key] || [],
      knownList,
      passList,
      baselineList,
      newFailList,
    }));
  }

  children.push(textPara('Thanks,'));
  children.push(textPara('Anmol'));

  const doc = new Document({ sections: [{ properties: {}, children }] });

  Packer.toBuffer(doc).then(buffer => {
    fs.writeFileSync(OUTPUT_DOCX, buffer);
    console.log(`\nEmail draft written to: ${OUTPUT_DOCX}`);
  });
}

main();
