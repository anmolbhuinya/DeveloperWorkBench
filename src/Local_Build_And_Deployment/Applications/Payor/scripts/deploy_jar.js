// ============================================================
// deploy_jar.js — Deploy a payor module jar to the local docker container.
//
// USAGE:
//   node scripts/deploy_jar.js <module-name>
//
// EXAMPLE:
//   node scripts/deploy_jar.js core-cvc
//
// WHAT IT DOES:
//   1. Resolve source jar path (from setBranch + module target/, or app_config.xlsx override)
//   2. Copy jar to Windows shared folder (mounted in docker at /home/weblogic/shared)
//   3. Inside docker: stopServer, wait for server to stop
//   4. Inside docker: copy jar from shared → deploy dir, rename to strip version
//   5. Inside docker: ensure Artemis queue is running (startArtemis if not)
//   6. Inside docker: startServer
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const cfg             = require('./config');
const { resolveJar }  = require('./jar_resolver');
const { dockerExec, dockerCp, assertContainerRunning } = require('./docker_helpers');

// ── helpers ──────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function banner(text) {
  const line = '─'.repeat(60);
  console.log('\n' + line);
  console.log(' ' + text);
  console.log(line);
}

// Convert Windows path to POSIX (for docker cp source argument on Windows host)
function toPosix(winPath) {
  return winPath.replace(/\\/g, '/');
}

// Wait until stopServer has finished: poll for server process to disappear.
// We check if the weblogic admin server process is still running by looking
// for the presence of the pid file or the server state via a simple pattern.
function waitForServerStop(timeoutMs = 5 * 60 * 1000) {
  log('Waiting for Tomcat to stop...');
  const interval = 5000;
  const start    = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      // Tomcat runs as a java process with catalina or Bootstrap in the command line
      const out = dockerExec(
        "ps aux | grep -E 'catalina|Bootstrap' | grep -v grep || true",
        { throwOnError: false }
      );

      if (!out.trim()) {
        log('Tomcat appears stopped.');
        return;
      }

      log(`Tomcat still running... retrying in ${interval / 1000}s`);
    } catch (_) {
      return;
    }

    const deadline = Date.now() + interval;
    while (Date.now() < deadline) { /* busy-wait */ }
  }

  log('WARNING: Timed out waiting for Tomcat to stop. Proceeding anyway.');
}

// Check whether Artemis is running inside the container; start it if not.
function ensureArtemisRunning() {
  log('Checking Artemis queue status...');
  try {
    const out = dockerExec(
      "ps aux | grep -E '[Aa]rtemis' | grep -v grep || true",
      { throwOnError: false }
    );

    if (out.trim()) {
      log('Artemis is already running.');
      return;
    }

    log('Artemis not running — starting Artemis...');
    const startOut = dockerExec(
      'startArtemis 2>&1 || echo "startArtemis done"',
      { timeoutMs: 60000, throwOnError: false }
    );
    if (startOut) log(startOut);
    log('startArtemis command issued.');
  } catch (e) {
    log(`WARNING: Could not verify/start Artemis: ${e.message}`);
  }
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  const moduleName = process.argv[2];
  if (!moduleName) {
    console.error('ERROR: No module name provided.');
    console.error('USAGE: node scripts/deploy_jar.js <module-name>');
    console.error('       e.g. node scripts/deploy_jar.js core-cvc');
    process.exit(1);
  }

  banner(`Deploying module: ${moduleName}`);

  // ── Step 1: Resolve jar ───────────────────────────────────
  log('Resolving jar path...');
  let sourcePath, deployName, sharedFolder, targets;
  try {
    ({ sourcePath, deployName, sharedFolder, targets } = resolveJar(moduleName));
  } catch (e) {
    console.error('\nERROR resolving jar:', e.message);
    process.exit(1);
  }

  log(`Source jar   : ${sourcePath}`);
  log(`Deploy name  : ${deployName}`);
  log(`Shared folder: ${sharedFolder}`);

  if (!fs.existsSync(sourcePath)) {
    console.error(`\nERROR: Source jar not found: ${sourcePath}`);
    process.exit(1);
  }

  // ── Step 2: Verify docker container ──────────────────────
  banner('Step 1/4 — Verify docker container');
  try {
    assertContainerRunning();
    log(`Container "${cfg.docker.containerName}" is running.`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Step 3: Copy jar to shared folder ────────────────────
  banner('Step 2/4 — Copy jar to shared folder');
  if (!fs.existsSync(sharedFolder)) {
    log(`Shared folder does not exist, creating: ${sharedFolder}`);
    fs.mkdirSync(sharedFolder, { recursive: true });
  }

  const sharedDest = path.join(sharedFolder, deployName);
  log(`Copying "${path.basename(sourcePath)}" → "${sharedDest}"`);
  fs.copyFileSync(sourcePath, sharedDest);
  log('Copy to shared folder complete.');

  // ── WAR: deploy through Tomcat Manager (like the Manager page's "WAR file to deploy") ──
  // Hot deploy: no server stop/start. Falls back to the stop/copy/start flow below if the Manager is unavailable.
  if (/\.war$/i.test(deployName)) {
    banner('WAR — deploy with Tomcat Manager');
    try {
      const ctxName  = deployName.replace(/\.war$/i, '');
      const ctxPath  = ctxName === 'ROOT' ? '' : `/${ctxName}`;
      const mgrUser  = process.env.DWB_TOMCAT_MGR_USER || 'admin';
      const mgrPass  = process.env.DWB_TOMCAT_MGR_PASS || 'admin';
      const mgrPort  = process.env.DWB_TOMCAT_MGR_PORT || '7001';
      // 1. copy into the deploy directory(ies)
      for (const t of targets) {
        const dest = `${t.dir}/${t.name}`;
        log(`Copying ${path.basename(sourcePath)} → ${dest}`);
        dockerCp(sourcePath, dest);
        require('child_process').spawnSync('docker', ['exec', '-u', 'root', cfg.docker.containerName, 'chown', cfg.docker.user, dest], { timeout: 30000 });
      }
      // 2. deploy it with Tomcat Manager, the same call the Manager page makes for a WAR
      const warOnServer = `${targets[0].dir}/${targets[0].name}`;
      log(`Deploying ${warOnServer} to context "${ctxPath || '/'}" via Tomcat Manager (port ${mgrPort})`);
      const out = dockerExec(
        `curl -s -u ${mgrUser}:${mgrPass} -G "http://localhost:${mgrPort}/manager/text/deploy" --data-urlencode "path=${ctxPath}" --data-urlencode "war=file:${warOnServer}" --data-urlencode "update=true" 2>&1`,
        { timeoutMs: 300000, throwOnError: false }
      );
      log(out);
      let deployed = out.startsWith('OK');
      if (!deployed && /already being serviced/i.test(out)) {
        // The deploy directory is Tomcat's webapps: copying the WAR there already triggered Tomcat's own auto-deploy,
        // which holds the lock. Wait for that deployment to finish and confirm the context is running.
        log('Tomcat is already deploying this WAR (auto-deploy) — waiting for it to finish...');
        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline && !deployed) {
          const t0 = Date.now(); while (Date.now() - t0 < 3000) { /* wait */ }
          const lst = dockerExec(`curl -s -u ${mgrUser}:${mgrPass} "http://localhost:${mgrPort}/manager/text/list" 2>&1`, { throwOnError: false });
          const line = lst.split('\n').find(l => l.startsWith(`${ctxPath || '/'}:`));
          if (line && line.split(':')[1] === 'running') { deployed = true; log(`Context is running: ${line}`); }
        }
      }
      if (deployed) {
        try { fs.unlinkSync(sharedDest); } catch (e) { /* ignore */ }
        banner('DEPLOYMENT COMPLETE');
        log(`Module   : ${moduleName}`);
        log(`Deployed : ${deployName} → context ${ctxPath || '/'} (Tomcat Manager)`);
        return;
      }
      log('Tomcat Manager deploy did not succeed — falling back to copying into the deploy directory with a server restart.');
    } catch (e) {
      log(`Tomcat Manager deploy failed (${e.message}) — falling back to copying into the deploy directory with a server restart.`);
    }
  }

  // ── Step 4: Stop server ───────────────────────────────────
  banner('Step 3/4 — Stop Tomcat server in docker');
  log('Running stop_tomcat_instances.sh...');
  try {
    const stopOut = dockerExec(
      'cd /home/weblogic/environments/healthedge/claimserver/install/tools/bin && chmod +x stop_tomcat_instances.sh && ./stop_tomcat_instances.sh 2>&1',
      { timeoutMs: 60000, throwOnError: false }
    );
    if (stopOut) log(stopOut);
  } catch (e) {
    log(`stop output: ${e.message}`);
  }

  waitForServerStop();

  // ── Step 5: Deploy jar inside docker ─────────────────────
  banner('Step 4/4 — Deploy jar and start server');
  const sharedInDocker = `/home/weblogic/shared/${deployName}`;
  const deployTarget   = `${targets[0].dir}/${targets[0].name}`;

  // The host shared folder is only visible inside some containers (bind mount); otherwise copy straight from the host with docker cp.
  let sharedVisible = false;
  try { sharedVisible = dockerExec(`test -f "${sharedInDocker}" && echo yes || echo no`, { throwOnError: false }) === 'yes'; } catch (e) { /* use docker cp */ }

  for (const t of targets) {
    const dest = `${t.dir}/${t.name}`;
    try {
      if (sharedVisible) {
        log(`Copying inside docker: ${sharedInDocker} → ${dest}`);
        dockerExec(`cp "${sharedInDocker}" "${dest}"`);
      } else {
        log(`Shared folder is not mounted in "${cfg.docker.containerName}" — docker cp: ${sourcePath} → ${dest}`);
        dockerCp(sourcePath, dest);
        // docker cp creates the file as root: hand it to the server user (best effort)
        require('child_process').spawnSync('docker', ['exec', '-u', 'root', cfg.docker.containerName, 'chown', cfg.docker.user, dest], { timeout: 30000 });
      }
      log('Copied to deploy directory.');
    } catch (e) {
      console.error('\nERROR copying inside docker:', e.message);
      process.exit(1);
    }
  }

  // Remove jar from shared folder after successful deployment
  const sharedDestPath = path.join(sharedFolder, deployName);
  try {
    fs.unlinkSync(sharedDestPath);
    log(`Removed jar from shared folder: ${sharedDestPath}`);
  } catch (e) {
    log(`WARNING: Could not remove jar from shared folder: ${e.message}`);
  }

  // ── Step 5b: Ensure Artemis queue is running ─────────────
  banner('Step 4b/4 — Ensure Artemis queue is running');
  ensureArtemisRunning();

  // ── Step 6: Start server ──────────────────────────────────
  log('Running start_tomcat_instances.sh...');
  try {
    dockerExec(
      'cd /home/weblogic/environments/healthedge/claimserver/install/tools/bin && chmod +x start_tomcat_instances.sh && nohup ./start_tomcat_instances.sh -d > /tmp/startTomcat.log 2>&1 &',
      { timeoutMs: 30000, throwOnError: false }
    );
  } catch (e) {
    log(`start output: ${e.message}`);
  }
  log('Tomcat start command issued. Server is starting in the background.');

  banner('DEPLOYMENT COMPLETE');
  log(`Module    : ${moduleName}`);
  log(`Source jar: ${sourcePath}`);
  log(`Deployed  : ${deployTarget}`);
  log(`Monitor startup: docker exec ${cfg.docker.containerName} tail -f /tmp/startTomcat.log`);
}

main().catch(e => {
  console.error('\nUnhandled error:', e.message);
  process.exit(1);
});
