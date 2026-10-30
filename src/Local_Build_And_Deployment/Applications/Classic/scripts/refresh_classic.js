'use strict';
const path = require('path');
process.env.APP_DIR = path.join(__dirname, '..');
// Classic has Tomcat and WebLogic variants; deploy script auto-detected from container
// name in refresh_app.js: -tc → deploy_classic_inside_container.sh,
//                          -wl → deploy_classic_inside_container_weblogic.sh
require(path.join(__dirname, '..', '..', '..', 'scripts', 'refresh_app.js'));
