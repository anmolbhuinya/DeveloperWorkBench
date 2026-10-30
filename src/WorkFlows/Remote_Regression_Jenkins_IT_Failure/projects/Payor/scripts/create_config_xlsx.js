// ============================================================
// create_config_xlsx.js
//
// PURPOSE: Generate config.xlsx in the Payor/ folder.
//          Run this ONCE to create the file, then edit the
//          "Overridden Value" column for each release cycle.
//
// USAGE:   node create_config_xlsx.js
// ============================================================

const path = require('path');
const BOOTSTRAP_NM = '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules';
const XLSX = require(path.join(BOOTSTRAP_NM, 'xlsx'));

const CONFIG_XLSX = path.join(__dirname, '..', 'config.xlsx');

const wb = XLSX.utils.book_new();

// ── Tab 1: General ──────────────────────────────────────────
// version and baselineVersion are stored per-project in projects/<pid>_<version>.xlsx → remote_server sheet.
const generalRows = [
  ['Key', 'Default Value', 'Overridden Value', 'Description'],
  ['nodeModules',    '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules', '', 'Absolute path to folder containing xlsx and docx npm packages'],
  ['outputFileName', '',             '', 'Output Excel filename (without path). Leave blank to use Jenkins_Payor_IT_Failures_Local_{version}.xlsx'],
  ['testTimeout',    '600',          '', 'Per-test Maven timeout in seconds on the remote server (default: 600)'],
  ['outputDir',      '',             '', 'Leave blank to use the folder where you run the script (cwd). Set absolute path to override.'],
  ['baselineDir',    require('path').resolve(__dirname, '..', 'baseline').replace(/\\/g, '/'), '', 'Folder containing baseline and other input files'],
  ['emailFormat',    require('path').resolve(__dirname, '..', 'email_format', 'Regression_Email_Format.docx').replace(/\\/g, '/'), '', 'Absolute path to Regression_Email_Format.docx'],
];
const generalWs = XLSX.utils.aoa_to_sheet(generalRows);
generalWs['!cols'] = [{ wch: 16 }, { wch: 110 }, { wch: 110 }, { wch: 60 }];
XLSX.utils.book_append_sheet(wb, generalWs, 'General');

// ── Tab 2: JenkinsJobs ───────────────────────────────────────
// Regression URLs are now stored per-project in projects/<pid>_<version>.xlsx → regression_urls sheet.
const jenkinsRows = [
  ['ValueStream', 'Default Email', 'Overridden Email'],
  ['billing',      '@billings-financial-value-stream@healthedge.com', ''],
  ['claims',       '@claims-value-stream@healthedge.com',             ''],
  ['enrollment',   '@enrollment-value-stream@healthedge.com',         ''],
  ['integrations', '@he-integrations-value-stream@healthedge.com',    ''],
  ['platform',     '@platform-value-stream@healthedge.com',           ''],
  ['provider',     '@provider-value-stream@healthedge.com',           ''],
];
const jenkinsWs = XLSX.utils.aoa_to_sheet(jenkinsRows);
jenkinsWs['!cols'] = [{ wch: 16 }, { wch: 55 }, { wch: 55 }];
XLSX.utils.book_append_sheet(wb, jenkinsWs, 'JenkinsJobs');

// ── Tab 3: Monitoring ───────────────────────────────────────
// Remote server details (host, user, password, repo) are now stored per-project
// in projects/<pid>_<version>.xlsx → remote_server sheet. VM is selected from vms.xlsx.
const monitoringRows = [
  ['Key', 'Default Value', 'Overridden Value', 'Description'],
  ['intervalMinutes',   '5',  '', 'How often (in minutes) to print the full status panel'],
  ['heartbeatSeconds',  '60', '', 'How often (in seconds) to print a brief heartbeat line between panels'],
];
const monitoringWs = XLSX.utils.aoa_to_sheet(monitoringRows);
monitoringWs['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 60 }];
XLSX.utils.book_append_sheet(wb, monitoringWs, 'Monitoring');

XLSX.writeFile(wb, CONFIG_XLSX);
console.log('config.xlsx created at:', CONFIG_XLSX);
console.log('Fill the "Overridden Value" column for each release; leave blank to keep the default.');
console.log('config.js reads from it automatically — no JS edits needed.');
