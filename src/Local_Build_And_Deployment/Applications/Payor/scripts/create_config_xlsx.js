// ============================================================
// create_config_xlsx.js
//
// PURPOSE: Generate app_config.xlsx in the Delta_Jar_Local_Deployment/ folder.
//          Run this ONCE to create the file, then edit the
//          "Overridden Value" column when defaults need to change.
//
// USAGE:   node scripts/create_config_xlsx.js
// ============================================================

const path = require('path');
const BOOTSTRAP_NM = '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules';
const XLSX = require(path.join(BOOTSTRAP_NM, 'xlsx'));

const CONFIG_XLSX = path.join(__dirname, '..', 'app_config.xlsx');

const wb = XLSX.utils.book_new();

// ── Tab 1: General ──────────────────────────────────────────
const generalRows = [
  ['Key', 'Default Value', 'Overridden Value', 'Description'],
  ['nodeModules', '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules', '', 'Absolute path to folder containing xlsx and ssh2 npm packages'],
  ['payorRepoRoot', '' + require('os').homedir().replace(/\\/g, '/') + '/hebb', '', 'Fallback: parent folder containing hrp.payer.core-* repos. Not used when SRCDIR env var is set by setbranch.'],
  ['sharedFolder', '' + require('os').homedir().replace(/\\/g, '/') + '/shared', '', 'Windows shared folder mounted in docker at /home/weblogic/shared'],
];
const generalWs = XLSX.utils.aoa_to_sheet(generalRows);
generalWs['!cols'] = [{ wch: 18 }, { wch: 70 }, { wch: 70 }, { wch: 70 }];
XLSX.utils.book_append_sheet(wb, generalWs, 'General');

// ── Tab 2: Docker_VM ────────────────────────────────────────
const dockerRows = [
  ['Key', 'Default Value', 'Overridden Value', 'Notes'],
  ['containerName', 'payer-tc-261', '', 'Docker container name running the payor server'],
  ['dockerUser',    'weblogic',     '', 'Username inside the docker container'],
  ['dockerPassword', '',            '', 'Password for dockerUser — leave blank if no password'],
  ['deployDir',    '/home/weblogic/domains/healthedge/jars', '', 'Directory inside docker where jars are deployed'],
];
const dockerWs = XLSX.utils.aoa_to_sheet(dockerRows);
dockerWs['!cols'] = [{ wch: 18 }, { wch: 55 }, { wch: 55 }, { wch: 55 }];
XLSX.utils.book_append_sheet(wb, dockerWs, 'Docker_VM');

// ── Tab 3: jar_location ─────────────────────────────────────
const jarRows = [
  ['Module', 'From (override source jar path)', 'To (override deploy jar name)', 'Shared Folder (override)', 'Notes'],
  ['', '', '', '', 'Leave all columns blank to use auto-detection. Fill From to override source path, To to override deploy name, Shared Folder to override shared folder for this module.'],
];
const jarWs = XLSX.utils.aoa_to_sheet(jarRows);
jarWs['!cols'] = [{ wch: 20 }, { wch: 70 }, { wch: 40 }, { wch: 50 }, { wch: 60 }];
XLSX.utils.book_append_sheet(wb, jarWs, 'jar_location');

XLSX.writeFile(wb, CONFIG_XLSX);
console.log('app_config.xlsx created at:', CONFIG_XLSX);
console.log('Fill the "Overridden Value" column for each key; leave blank to keep defaults.');
console.log('config.js reads from it automatically — no JS edits needed.');
