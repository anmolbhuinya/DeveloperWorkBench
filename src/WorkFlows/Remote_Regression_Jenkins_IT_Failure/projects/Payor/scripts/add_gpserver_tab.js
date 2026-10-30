// add_gpserver_tab.js
//
// One-time migration: adds GPServer tab to an existing config.xlsx.
// Safe to re-run — skips if GPServer tab already exists.
//
// USAGE: node scripts/add_gpserver_tab.js

'use strict';

const path = require('path');
const { nm } = require('./utils');
const XLSX = nm('xlsx');

const CONFIG_FILE = path.join(__dirname, '..', 'config.xlsx');

const wb = XLSX.readFile(CONFIG_FILE);

if (wb.SheetNames.includes('GPServer')) {
  console.log('GPServer tab already exists — nothing to do.');
  process.exit(0);
}

const gpServerRows = [
  ['Key', 'Default Value', 'Overridden Value', 'Notes'],
  [
    'gpUrl',
    'http://central-gp:6060/job/stormtroopers/job/payor-end-to-end/352/',
    '',
    'GP Jenkins build URL. Update the build number for each run. Leave blank to skip GP regression step.',
  ],
];

const gpServerWs = XLSX.utils.aoa_to_sheet(gpServerRows);
gpServerWs['!cols'] = [{ wch: 12 }, { wch: 90 }, { wch: 90 }, { wch: 65 }];

// Insert after RemoteServer tab
const remoteIdx = wb.SheetNames.indexOf('RemoteServer');
if (remoteIdx >= 0) {
  wb.SheetNames.splice(remoteIdx + 1, 0, 'GPServer');
} else {
  wb.SheetNames.push('GPServer');
}
wb.Sheets['GPServer'] = gpServerWs;

XLSX.writeFile(wb, CONFIG_FILE);
console.log('GPServer tab added to', CONFIG_FILE);
console.log('Open config.xlsx → GPServer tab and set the correct GP Jenkins build URL.');
