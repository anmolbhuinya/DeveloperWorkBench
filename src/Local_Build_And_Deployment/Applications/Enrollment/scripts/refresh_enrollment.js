'use strict';
const path = require('path');
process.env.APP_DIR = path.join(__dirname, '..');
require(path.join(__dirname, '..', '..', '..', 'scripts', 'refresh_app.js'));
