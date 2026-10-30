// ============================================================
// refresh_payor.js — Windows equivalent of Linux refresh-payor.
//
// Supports both Tomcat-based and WebLogic-based Payor branches.
// The deployment type is auto-detected from the source tree
// (presence of a weblogic/ module in pom.xml or weblogic/ dir).
// No extra flags needed — it just works for either stack.
//
// USAGE:
//   node scripts/refresh_payor.js [options]
//
// EXAMPLES:
//   node scripts/refresh_payor.js
//   node scripts/refresh_payor.js -st -ncs
//   node scripts/refresh_payor.js -nbld
//   node scripts/refresh_payor.js -nd -st
//   node scripts/refresh_payor.js -J core-cvc -st
//   node scripts/refresh_payor.js --skip-db-upgrade
//   node scripts/refresh_payor.js --only-start
//
// WHAT IT DOES:
//   1. Resolve SRCDIR (SRCDIR env var / ~/.default-branch / auto-detect)
//   2. Detect deployment type: Tomcat or WebLogic (from source tree)
//   3. git pull to sync latest code                    [-ncs to skip]
//   4. mvn clean install in SRCDIR                     [-nbld to skip]
//   5. Find distribution tarball in SRCDIR/distribution/target/
//   6. docker cp tarball + wl.properties + deploy script into container
//   7. Run deploy script inside container:
//        - Stop Artemis + Tomcat/WebLogic
//        - Extract tarball
//        - Run install.sh --full
//        - Upgrade OLTP + DW schemas     [--skip-db-upgrade to skip]
//        - Start Artemis + Tomcat/WebLogic
//   8. docker cp domain folders back to Windows host (DOMAIN_HOME)
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync } = require('child_process');

const cfg               = require('./config');
const { resolveSrcDir } = require('./jar_resolver');

const WL_PROPERTIES = 'wl.properties';
const DOCKER_DIR    = path.join(__dirname, '..', 'docker');

// Fallback locations (original hrp.dev.tools)
const DEV_TOOLS_HOME         = (process.env.DEV_TOOLS_HOME || (require('os').homedir() + '/hebb/hrp.dev.tools')).replace(/\\/g, '/');
const DEV_TOOLS_TOMCAT_DIR   = DEV_TOOLS_HOME + '/docker/payor/tomcat';
const DEV_TOOLS_WEBLOGIC_DIR = DEV_TOOLS_HOME + '/docker/payor/weblogic';

// Deploy script names
const DEPLOY_TOMCAT   = 'deploy_inside_container.sh';
const DEPLOY_WEBLOGIC = 'deploy_inside_container_weblogic.sh';

// Git Bash executable — cmd.exe PATH resolves bash to WSL; use full path to avoid that
const GIT_BASH = (() => {
  const candidates = [
    'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files/Git/bin/bash.exe',
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return 'bash'; // last resort
})();

// ── Logging ───────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function banner(text) {
  const line = '\u2500'.repeat(60);
  console.log('\n' + line);
  console.log(' ' + text);
  console.log(line);
}

function elapsedSince(startMs) {
  const s   = Math.round((Date.now() - startMs) / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ── Shell helpers ─────────────────────────────────────────────

function run(cmd, args, opts) {
  opts = opts || {};
  const result = spawnSync(cmd, args, {
    cwd:     opts.cwd || process.cwd(),
    stdio:   'inherit',
    timeout: opts.timeoutMs || 120 * 60 * 1000,
    shell:   opts.shell || false,
    env:     opts.env || process.env,
  });
  if (result.error) throw new Error(`${cmd} failed to start: ${result.error.message}`);
  return result.status || 0;
}

// ── Container name — resolved during detection ────────────────

// activeContainer is set before any docker calls are made.
let activeContainer = cfg.docker.containerName;  // default

function dockerCp(src, containerDest) {
  log(`docker cp  ${src}  ->  ${activeContainer}:${containerDest}`);
  const result = spawnSync('docker', ['cp', src, `${activeContainer}:${containerDest}`], {
    stdio:   'inherit',
    timeout: 5 * 60 * 1000,
  });
  if (result.error) throw new Error(`docker cp failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`docker cp exited ${result.status}`);
}

function dockerCpFrom(containerSrc, dest) {
  log(`docker cp  ${activeContainer}:${containerSrc}  ->  ${dest}`);
  const result = spawnSync('docker', ['cp', `${activeContainer}:${containerSrc}`, dest], {
    stdio:   'inherit',
    timeout: 5 * 60 * 1000,
  });
  if (result.error) throw new Error(`docker cp failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`docker cp exited ${result.status}`);
}

function dockerExec(cmd, opts) {
  opts = opts || {};
  const user   = cfg.docker.user || 'weblogic';
  const result = spawnSync(
    'docker', ['exec', '--user', user, activeContainer, 'bash', '-c', cmd],
    { stdio: 'inherit', timeout: opts.timeoutMs || 30 * 60 * 1000 }
  );
  if (result.error) throw new Error(`docker exec failed: ${result.error.message}`);
  return result.status || 0;
}

function dockerExecRoot(cmd) {
  const result = spawnSync(
    'docker', ['exec', '--user', 'root', activeContainer, 'bash', '-c', cmd],
    { stdio: 'inherit', timeout: 60000 }
  );
  if (result.error) throw new Error(`docker exec (root) failed: ${result.error.message}`);
  return result.status || 0;
}

// Returns 'running' | 'stopped' | 'missing'
function containerState(name) {
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
    encoding: 'utf8',
    timeout:  15000,
  });
  if (result.error || result.status !== 0) return 'missing';
  return (result.stdout || '').trim() === 'true' ? 'running' : 'stopped';
}

function assertContainerRunning() {
  const state = containerState(activeContainer);
  if (state === 'missing') {
    throw new Error(
      `Cannot inspect docker container "${activeContainer}". ` +
      'Is docker running? Run  startdocker  then  startservers.'
    );
  }
  if (state !== 'running') {
    throw new Error(`Docker container "${activeContainer}" is not running.`);
  }
}

// ── Deploy config (version-based container selection) ─────────

const PAYOR_BRANCH_FILE = '.default-branch';

function readCurrentVersion(srcdir) {
  if (process.env.APP_RELEASE_VERSION) {
    const m = process.env.APP_RELEASE_VERSION.match(/^(\d+)\.(\d+)/);
    if (m) return parseInt(m[1], 10) * 1000 + (parseInt(m[2], 10) || 0);
  }
  if (srcdir) {
    try {
      const pomPath = path.join(srcdir, 'pom.xml');
      if (fs.existsSync(pomPath)) {
        const pom = fs.readFileSync(pomPath, 'utf8')
          .replace(/<parent>[\s\S]*?<\/parent>/g, '');
        const m = pom.match(/<version>(\d+)\.(\d+)/);
        if (m) return parseInt(m[1], 10) * 1000 + (parseInt(m[2], 10) || 0);
      }
    } catch (e) {}
  }
  try {
    const branchFilePath = path.join(os.homedir(), PAYOR_BRANCH_FILE);
    if (fs.existsSync(branchFilePath)) {
      const branch = fs.readFileSync(branchFilePath, 'utf8').trim();
      const m = branch.match(/(\d+)\.(\d+)/);
      if (m) return parseInt(m[1], 10) * 1000 + (parseInt(m[2], 10) || 0);
    }
  } catch (e) {}
  return null;
}


// Config values may use  %VAR%  ~  {DWB} (this DeveloperWorkBench folder)  {DWB_HOME} (the DWB folder next to it)
function expandPath(v) {
  if (typeof v !== 'string') return v;
  const DWB = require('path').resolve(__dirname, '..', '..', '..', '..');
  return v.replace(/^~(?=[\\/]|$)/, require('os').homedir())
          .replace(/\{DWB_HOME\}/g, require('path').dirname(DWB))
          .replace(/\{DWB\}/g, DWB)
          .replace(/%([^%]+)%/g, (m, n) => process.env[n] !== undefined ? process.env[n] : m);
}

function readDeployConfig(srcdir) {
  const XLSX = (() => {
    const candidates = [
      '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules/xlsx',
      path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'xlsx'),
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return require(c); } catch (e) {}
    }
    try { return require('xlsx'); } catch (e) { return null; }
  })();
  if (!XLSX) { console.warn('[deploy-cfg] xlsx module not found — using defaults.'); return {}; }

  const cfgPath = path.join(__dirname, '..', 'build_deploy_config.xlsx');
  if (!fs.existsSync(cfgPath)) return {};

  try {
    const wb  = XLSX.readFile(cfgPath);
    const wsn = wb.SheetNames.find(n => n.toLowerCase() === 'deploy');
    if (!wsn) return {};
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsn], { header: 1 });

    const groups = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const key  = String(row[0]).trim();
      const val  = String(row[1] != null ? row[1] : '').trim();
      const cond = String(row[2] != null ? row[2] : '').trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push({ value: val, condition: cond });
    }

    const version = readCurrentVersion(srcdir);

    function parseVer(s) {
      const parts = String(s || '').split('.');
      return (parseInt(parts[0], 10) || 0) * 1000 + (parseInt(parts[1], 10) || 0);
    }

    function evalCond(cond, v) {
      if (!cond) return { matches: true, isExact: false };
      const m = cond.match(/^([<>]=?|=)([\d.]+)$/);
      if (!m || v === null) return { matches: false, isExact: false };
      const cv = parseVer(m[2]);
      const op = m[1];
      let matches;
      switch (op) {
        case '<':  matches = v < cv;   break;
        case '>':  matches = v > cv;   break;
        case '=':  matches = v === cv; break;
        case '<=': matches = v <= cv;  break;
        case '>=': matches = v >= cv;  break;
        default:   matches = false;
      }
      return { matches, isExact: op === '=' };
    }

    const result = {};
    for (const [key, entries] of Object.entries(groups)) {
      let selected = null;
      for (const e of entries) {
        const r = evalCond(e.condition, version);
        if (r.matches && r.isExact) { selected = e.value; break; }
      }
      if (selected === null) {
        for (const e of entries) {
          if (!e.condition) continue;
          const r = evalCond(e.condition, version);
          if (r.matches) { selected = e.value; break; }
        }
      }
      if (selected === null) {
        for (const e of entries) {
          if (!e.condition) { selected = e.value; break; }
        }
      }
      if (selected !== null) result[key] = expandPath(selected);
    }
    return result;
  } catch (e) {
    console.warn(`[deploy-cfg] Failed to read build_deploy_config.xlsx: ${e.message}`);
    return {};
  }
}

// ── Deployment type detection ─────────────────────────────────
//
// A WebLogic branch either:
//   (a) has a  weblogic/  directory at the repo root, OR
//   (b) lists  <module>weblogic</module>  in the root pom.xml
//
// Everything else is Tomcat.

function detectDeployTypeFromSrcdir(srcdir) {
  // Check for weblogic/ directory
  if (fs.existsSync(path.join(srcdir, 'weblogic'))) {
    return 'weblogic';
  }

  // Check root pom.xml for <module>weblogic</module>
  const pomPath = path.join(srcdir, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    const pom = fs.readFileSync(pomPath, 'utf8');
    // Match <module>weblogic</module>  (allow whitespace)
    if (/<module>\s*weblogic\s*<\/module>/i.test(pom)) {
      return 'weblogic';
    }
  }

  return 'tomcat';
}

// For --only-start when we haven't resolved srcdir yet: detect from running containers.
// Prefers weblogic container if both run; falls back to Tomcat container.
function detectDeployTypeFromContainers() {
  const wlName = cfg.docker.weblogicContainerName;
  const tcName = cfg.docker.containerName;

  const wlState = containerState(wlName);
  const tcState = containerState(tcName);

  if (wlState === 'running') return { type: 'weblogic', container: wlName };
  if (tcState  === 'running') return { type: 'tomcat',   container: tcName };

  // Neither running — return whichever exists (stopped)
  if (wlState === 'stopped') return { type: 'weblogic', container: wlName };
  if (tcState  === 'stopped') return { type: 'tomcat',   container: tcName };

  throw new Error(
    `Neither "${wlName}" nor "${tcName}" exists in Docker.\n` +
    'Run  startservers  first.'
  );
}

// ── Usage ──────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage:
  node scripts/refresh_payor.js [options]

The deployment type (Tomcat vs WebLogic) is detected automatically from the
source tree — no extra flags needed.

Options:
  -ncs                   Skip git pull (do not sync code)
  -ncb                   Skip mvn clean (incremental build)
  -st                    Add -DskipTests=true to maven
  -p [threads]           Parallel Maven build (-T <threads>, default 1C)
  -nbld                  Skip maven build (use last built distribution)
  -nd                    Skip docker deployment (build only)
  -J <mods>              Build only <mods>,install,distribution
  -FM                    Build from core-main (-PstartAtMain)
  -rf <mod>              Maven resume from (-rf <mod>)
  -P  <name>             Extra maven profile (-P<name>)
  -sdu / --skip-db-upgrade  Skip OLTP + DW schema upgrade steps inside container
  -os / --only-start     Only start Artemis + Tomcat/WebLogic (no build, no deploy)
  -y                     Assume yes for all prompts
  -h / --help            Show this message

Defaults:
  Sync code (git pull), full clean build, deploy distribution tarball,
  upgrade schemas, start servers.
`);
}

// ── Argument parsing ──────────────────────────────────────────

const cliArgs = process.argv.slice(2);

let syncCode         = true;
let doClean          = true;
let skipTests        = false;
let doBuild          = true;
let doDeploy         = true;
let buildJustModules = '';
let buildFromMain    = false;
let mvnResumeFrom    = '';
let mvnProfile       = '';
let mvnParallel      = '';
let skipDbUpgrade    = false;
let onlyStart        = false;
let noPrompts        = false;

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];
  switch (arg) {
    case '-ncs':  case '--no-sync':         syncCode      = false; break;
    case '-ncb':  case '--no-clean':        doClean       = false; break;
    case '-st':   case '--skip-tests':      skipTests     = true;  break;
    case '-nbld': case '--no-build':        doBuild       = false; break;
    case '-nd':   case '--no-deploy':       doDeploy      = false; break;
    case '-FM':   case '--build-from-main': buildFromMain = true;  break;
    case '-sdu':  case '--skip-db-upgrade': skipDbUpgrade = true;  break;
    case '-os':   case '--only-start':      onlyStart     = true;  break;
    case '-y':    case '--no-prompts':      noPrompts     = true;  break;
    case '-J': case '--build-just':
      buildJustModules = cliArgs[++i] || '';
      if (!buildJustModules) { console.error('-J requires a module list'); process.exit(1); }
      break;
    case '-rf': case '--resume-from':
      mvnResumeFrom = cliArgs[++i] || '';
      if (!mvnResumeFrom) { console.error('-rf requires a module name'); process.exit(1); }
      break;
    case '-p': case '--parallel':
      mvnParallel = (cliArgs[i + 1] && !cliArgs[i + 1].startsWith('-')) ? cliArgs[++i] : '1C';
      break;
    case '-P': case '--profile':
      mvnProfile = cliArgs[++i] || '';
      if (!mvnProfile) { console.error('-P requires a profile name'); process.exit(1); }
      break;
    case '-h': case '--help':
      printUsage(); process.exit(0); break;
    default:
      console.error(`Unknown flag: ${arg}`);
      printUsage(); process.exit(1);
  }
}

// ── Git sync ──────────────────────────────────────────────────

function gitPull(srcdir) {
  log(`Running git pull in: ${srcdir}`);
  return run('git', ['pull'], { cwd: srcdir, timeoutMs: 5 * 60 * 1000 });
}

// ── Reactor ordering for parallel builds ──────────────────────
// configuration-viewer (reads config-metadata JSON written while 4 modules compile) and install (copies other
// modules' artifacts via dependency:copy) have no Maven dependency on what they consume, so under -T they can
// start too early. For a parallel build we temporarily add those dependencies (pom backed up as
// pom.xml.parallel.bak, restored on any exit; the IDP server also restores after a killed/aborted build).

const PAR_BAK = '.parallel.bak';
// its-maven-plugin keeps static state (MdrEntity hashtable), so the modules that run it must not overlap: chain them.
const ITS_CHAIN = { 'metadata/hicl': 'metadata/iom', 'metadata/dbm': 'metadata/hicl', 'metadata/ddl': 'metadata/dbm' };
// Hidden ordering: he-webservices' ant step (jwsc/build.xml) compiles web-services-tomcat/target/generated-sources/jwsc/*,
// which web-services-tomcat's wsimport executions create, but Maven doesn't know about it.
const ORDER_AFTER = { 'core-webservices': { a: 'web-services-tomcat', type: 'war', v: '${project.version}', noTransitive: true } };
const PAR_POMS = ['configuration-viewer', 'install', ...Object.keys(ITS_CHAIN), ...Object.keys(ORDER_AFTER)];
const CV_DEPS = ['core-foundation', 'core-cvc', 'core-security', 'core-main'];

function parPomPath(srcdir, mod) { return path.join(srcdir, mod, 'pom.xml'); }

function restoreParallelPoms(srcdir) {
  for (const mod of PAR_POMS) {
    const pom = parPomPath(srcdir, mod);
    try {
      if (fs.existsSync(pom + PAR_BAK)) {
        fs.copyFileSync(pom + PAR_BAK, pom);
        fs.unlinkSync(pom + PAR_BAK);
      }
    } catch (e) { console.error(`WARNING: could not restore ${pom}: ${e.message}`); }
  }
}

// Reactor artifacts install/pom.xml copies (groupId healthedge.core), one per artifactId, with the version it uses.
function installCopiedArtifacts(pomText) {
  const seen = new Map();
  let hasXml = false;
  for (const m of pomText.matchAll(/<artifactItem>([\s\S]*?)<\/artifactItem>/g)) {
    const g = (m[1].match(/<groupId>(.*?)<\/groupId>/) || [])[1] || '';
    const a = (m[1].match(/<artifactId>(.*?)<\/artifactId>/) || [])[1];
    if (!a || !(g.includes('healthedge.core') || g.includes('project.groupId'))) continue;
    const type = (m[1].match(/<type>(.*?)<\/type>/) || [])[1] || 'jar';
    if (type === 'xml') { hasXml = true; continue; }
    if (!seen.has(a)) seen.set(a, { a, type, v: (m[1].match(/<version>(.*?)<\/version>/) || [])[1] || '${project.version}' });
  }
  const out = [...seen.values()];
  if (hasXml) out.push({ a: 'core-xml', type: 'pom', v: '${project.version}' });
  return out;
}

function depXml(d) {
  const type = d.type && d.type !== 'jar' ? `\n            <type>${d.type}</type>` : '';
  const excl = d.noTransitive ? '\n            <exclusions><exclusion><groupId>*</groupId><artifactId>*</artifactId></exclusion></exclusions>' : '';
  return `        <dependency>\n            <groupId>\${project.groupId}</groupId>\n            <artifactId>${d.a}</artifactId>\n            <version>${d.v}</version>${type}\n            <scope>provided</scope>${excl}\n        </dependency>`;
}

function addParallelDependencies(srcdir) {
  restoreParallelPoms(srcdir);                // clear leftovers from an earlier killed run
  let changed = false;
  for (const mod of PAR_POMS) {
    const pom = parPomPath(srcdir, mod);
    if (!fs.existsSync(pom)) continue;
    const orig = fs.readFileSync(pom, 'utf8');
    if (ORDER_AFTER[mod]) {
      if (!orig.includes('<dependencies>')) { log(`${mod}: no <dependencies>; cannot order after ${ORDER_AFTER[mod].a}.`); continue; }
      fs.writeFileSync(pom + PAR_BAK, orig);
      fs.writeFileSync(pom, orig.replace('<dependencies>', '<dependencies>\n' + depXml(ORDER_AFTER[mod])));
      log(`Parallel build: ${mod} now waits for ${ORDER_AFTER[mod].a}.`);
      changed = true;
      continue;
    }
    if (ITS_CHAIN[mod]) {
      const pt = fs.readFileSync(path.join(srcdir, ITS_CHAIN[mod], 'pom.xml'), 'utf8').replace(/<parent>[\s\S]*?<\/parent>/, '');
      const a = (pt.match(/<artifactId>(.*?)<\/artifactId>/) || [])[1];
      const v = (pt.match(/<version>(.*?)<\/version>/) || [])[1] || '${project.version}';
      if (!a || !orig.includes('<dependencies>')) { log(`${mod}: cannot chain after ${ITS_CHAIN[mod]}; skipping.`); continue; }
      fs.writeFileSync(pom + PAR_BAK, orig);
      fs.writeFileSync(pom, orig.replace('<dependencies>', '<dependencies>\n' + depXml({ a, type: 'jar', v })));
      log(`Parallel build: ${mod} now waits for ${a} (its-maven-plugin is not thread-safe).`);
      changed = true;
      continue;
    }
    if (/\n\s*<dependencies>/.test(orig.split(/\n\s*<build>/)[0])) { log(`${mod} already has <dependencies>; leaving it unchanged.`); continue; }
    const deps = mod === 'install'
      ? installCopiedArtifacts(orig)
      : CV_DEPS.map(a => ({ a, type: 'jar', v: '${project.version}' }));
    if (!deps.length) continue;
    const block = `    <dependencies>\n${deps.map(depXml).join('\n')}\n    </dependencies>\n`;
    const updated = orig.replace(/(\n\s*<build>)/, `\n${block}$1`);
    if (updated === orig) { log(`${mod}: <build> not found; skipping dependency injection.`); continue; }
    fs.writeFileSync(pom + PAR_BAK, orig);
    fs.writeFileSync(pom, updated);
    log(`Parallel build: added ${deps.length} dependencies to ${mod}/pom.xml (restored afterwards).`);
    changed = true;
  }
  if (changed) {
    const undo = () => restoreParallelPoms(srcdir);
    process.on('exit', undo);
    ['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach(s => process.on(s, () => { undo(); process.exit(130); }));
  }
}

// ── Maven build ───────────────────────────────────────────────

function buildMavenArgs() {
  const args = [];
  if (doClean) args.push('clean');
  args.push('install');

  if (buildJustModules) {
    log(`Building only: ${buildJustModules}, install, distribution`);
    args.push('-pl', `${buildJustModules},install,distribution`);
  } else if (buildFromMain) {
    log('Building from core-main (-PstartAtMain).');
    args.push('-PstartAtMain');
  } else if (mvnResumeFrom) {
    log(`Resuming from: ${mvnResumeFrom}`);
    args.push('-rf', mvnResumeFrom);
  }

  if (mvnProfile) { log(`Profile: ${mvnProfile}`);   args.push(`-P${mvnProfile}`); }
  if (skipTests)  { log('Skipping tests.');           args.push('-DskipTests=true'); }

  if (mvnParallel) { log(`Parallel build: -T ${mvnParallel}`); args.push('-T', mvnParallel, '-Dmaven.compiler.fork=true'); }

  args.push('-nsu');
  return args;
}

// ── Find distribution tarball ─────────────────────────────────

function findDistTarball(srcdir) {
  const distTarget = path.join(srcdir, 'distribution', 'target');
  if (!fs.existsSync(distTarget)) {
    throw new Error(
      `Distribution target directory not found: ${distTarget}\n` +
      'Run a full build first (without -nbld).'
    );
  }
  const tarballs = fs.readdirSync(distTarget)
    .filter(f => f.startsWith('core.distribution-') && f.endsWith('-pkg.tar.gz'));
  if (tarballs.length === 0) {
    throw new Error(
      `No core.distribution-*-pkg.tar.gz found in ${distTarget}\n` +
      'Run a full build first (without -nbld).'
    );
  }
  tarballs.sort((a, b) =>
    fs.statSync(path.join(distTarget, b)).mtimeMs -
    fs.statSync(path.join(distTarget, a)).mtimeMs
  );
  return path.join(distTarget, tarballs[0]);
}

// ── Resolve deploy assets ──────────────────────────────────────
// Returns { wlPropsPath, deployScriptPath, deployScriptName }

function resolveDeployAssets(deployType, deployCfg) {
  deployCfg = deployCfg || {};
  const origDevToolsDir = deployType === 'weblogic' ? DEV_TOOLS_WEBLOGIC_DIR : DEV_TOOLS_TOMCAT_DIR;
  const scriptDir  = deployCfg.deploy_script_dir  || origDevToolsDir;
  const scriptName = deployCfg.deploy_script_name || (deployType === 'weblogic' ? DEPLOY_WEBLOGIC : DEPLOY_TOMCAT);

  // wl.properties stays in the standard locations regardless of script dir override
  const wlPropsLocal    = path.join(DOCKER_DIR, WL_PROPERTIES);
  const wlPropsFallback = path.join(origDevToolsDir, WL_PROPERTIES);
  const wlPropsPath     = fs.existsSync(wlPropsLocal) ? wlPropsLocal : wlPropsFallback;
  if (!fs.existsSync(wlPropsPath)) {
    throw new Error(
      `wl.properties not found at:\n  ${wlPropsLocal}\n  ${wlPropsFallback}`
    );
  }

  // Deploy script: check DOCKER_DIR first (local override), then scriptDir (may be version-specific)
  const deployScriptLocal    = path.join(DOCKER_DIR, scriptName);
  const deployScriptFallback = path.join(scriptDir, scriptName);
  const deployScriptPath     = fs.existsSync(deployScriptLocal) ? deployScriptLocal : deployScriptFallback;
  if (!fs.existsSync(deployScriptPath)) {
    throw new Error(
      `${scriptName} not found at:\n  ${deployScriptLocal}\n  ${deployScriptFallback}`
    );
  }
  if (deployCfg.deploy_script_dir || deployCfg.deploy_script_name) {
    log(`Deploy script override: ${deployScriptPath}`);
  }

  return { wlPropsPath, deployScriptPath, deployScriptName: scriptName };
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const scriptStart = Date.now();

  banner('refresh_payor');

  // ── --only-start shortcut ───────────────────────────────────
  // When skipping build/deploy we detect type from running containers
  // instead of from srcdir (user may not have SRCDIR set up yet).
  if (onlyStart) {
    banner('Only-start mode — starting servers');
    let detected;
    try {
      detected = detectDeployTypeFromContainers();
    } catch (e) {
      // Fall back to srcdir-based detection if containers not accessible
      log(`Container detection failed (${e.message}), falling back to srcdir detection.`);
      const { srcdir } = resolveSrcDir();
      const type = detectDeployTypeFromSrcdir(srcdir);
      detected = {
        type,
        container: type === 'weblogic' ? cfg.docker.weblogicContainerName : cfg.docker.containerName,
      };
    }

    activeContainer = detected.container;
    log(`Deploy type : ${detected.type}  (container: ${activeContainer})`);

    let onlyStartDeployCfg = {};
    try { const { srcdir: _s } = resolveSrcDir(); onlyStartDeployCfg = readDeployConfig(_s); }
    catch (e) {
      // srcdir unavailable: readDeployConfig still resolves version from APP_RELEASE_VERSION / branch file
      log(`srcdir not resolved (${e.message}); reading deploy config without it.`);
      onlyStartDeployCfg = readDeployConfig(null);
    }

    // Container from build_deploy_config.xlsx (version-based) wins over detection
    if (onlyStartDeployCfg.deployment_container) {
      activeContainer = onlyStartDeployCfg.deployment_container;
      log(`deployment_container: ${activeContainer}  (from build_deploy_config.xlsx)`);
    }
    assertContainerRunning();

    // Host-side deploy script (e.g. deployPayorTomcat.sh for v27+) — run directly on host
    if (onlyStartDeployCfg.deploy_script_dir && onlyStartDeployCfg.deploy_script_name) {
      const hostScript = path.join(onlyStartDeployCfg.deploy_script_dir, onlyStartDeployCfg.deploy_script_name).replace(/\\/g, '/');
      banner('Running host deploy script (--only-start)');
      log(`Script: ${hostScript}`);
      const hostEnv = { ...process.env };
      if (onlyStartDeployCfg.secrets_management_dir) hostEnv.SECRETS_DIR = onlyStartDeployCfg.secrets_management_dir;
      const rc = run(GIT_BASH, [hostScript, '--only-start', '--container', activeContainer], { timeoutMs: 10 * 60 * 1000, env: hostEnv });
      if (rc !== 0) {
        console.error(`\nERROR: Host deploy script failed (exit ${rc}).`);
        process.exit(rc);
      }
      banner('Server start complete');
      log(`Total time: ${elapsedSince(scriptStart)}`);
      return;
    }

    const stagingDir   = '/home/weblogic/staging';
    const { deployScriptPath, deployScriptName } = resolveDeployAssets(detected.type, onlyStartDeployCfg);

    // Copy deploy script into container so --only-start can use it
    dockerExec(`mkdir -p ${stagingDir}`);
    dockerCp(deployScriptPath, `${stagingDir}/${deployScriptName}`);
    dockerExec(`dos2unix ${stagingDir}/${deployScriptName}`);

    const onlyStartCmd = `cd ${stagingDir} && bash ${deployScriptName} --only-start`;
    log(`Running: ${onlyStartCmd}`);
    const rc = dockerExec(onlyStartCmd, { timeoutMs: 10 * 60 * 1000 });
    if (rc !== 0) {
      console.error(`\nERROR: Server start failed (exit ${rc}).`);
      process.exit(rc);
    }
    banner('Server start complete');
    log(`Total time: ${elapsedSince(scriptStart)}`);
    return;
  }

  // ── Step 1: Resolve SRCDIR ──────────────────────────────────
  log('Resolving payor source directory (SRCDIR)...');
  let srcdir;
  try {
    const resolved = resolveSrcDir();
    srcdir = resolved.srcdir;
    log(`SRCDIR: ${srcdir}  (via ${resolved.source})`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Step 2: Detect deployment type ─────────────────────────
  const deployType = detectDeployTypeFromSrcdir(srcdir);
  activeContainer  = deployType === 'weblogic'
    ? cfg.docker.weblogicContainerName
    : cfg.docker.containerName;
  log(`Deploy type : ${deployType}  (container: ${activeContainer})`);

  // Override container from build_deploy_config.xlsx (version-based)
  const deployCfg = readDeployConfig(srcdir);
  if (deployCfg.deployment_container) {
    activeContainer = deployCfg.deployment_container;
    log(`deployment_container: ${activeContainer}  (from build_deploy_config.xlsx)`);
  }

  // ── Step 3: Sync code ───────────────────────────────────────
  if (syncCode) {
    banner('Step 1 — Sync code (git pull)');
    const ret = gitPull(srcdir);
    if (ret !== 0) {
      console.error(`\nERROR: git pull exited ${ret}.`);
      if (!noPrompts) {
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ok = await new Promise(res => rl.question('Continue despite git pull failure? [y/N] ', a => { rl.close(); res(/^y/i.test(a)); }));
        if (!ok) process.exit(ret);
      } else {
        process.exit(ret);
      }
    }
    log('Code sync complete.');
  } else {
    log('Skipping code sync (-ncs).');
  }

  // ── Step 4: Maven build ─────────────────────────────────────
  if (doBuild) {
    banner('Step 2 — Maven build');
    if (mvnParallel) addParallelDependencies(srcdir);
    const mvnArgs = buildMavenArgs();
    const t       = Date.now();
    log(`Running: mvn ${mvnArgs.join(' ')}`);
    // Forked javac doesn't inherit Maven's system properties; the config-metadata processor needs this one
    // to publish its catalog under the root config-metadata/target instead of each module's directory.
    const mvnEnv = mvnParallel
      ? { ...process.env, JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ''} -Dmaven.multiModuleProjectDirectory=${srcdir.replace(/\\/g, '/')}`.trim() }
      : process.env;
    // Full builds exceed 90 min (seen: 1h30m); a timeout kills only the shell wrapper, so mvn keeps running
    // and prints BUILD SUCCESS while this script already failed. Allow 6h and always restore the poms.
    let status;
    try {
      status = run('mvn', mvnArgs, { cwd: srcdir, timeoutMs: 6 * 60 * 60 * 1000, shell: true, env: mvnEnv });
    } finally {
      if (mvnParallel) restoreParallelPoms(srcdir);
    }
    if (status !== 0) {
      console.error(`\nERROR: Maven build failed (exit ${status}) after ${elapsedSince(t)}.`);
      process.exit(status);
    }
    log(`Maven build successful (${elapsedSince(t)}).`);
  } else {
    log('Skipping maven build (-nbld).');
  }

  // ── Build-only exit ─────────────────────────────────────────
  if (!doDeploy) {
    banner('Build complete. Deployment skipped (-nd).');
    log(`Total time: ${elapsedSince(scriptStart)}`);
    return;
  }

  // ── Host-side deploy script override (e.g. deployPayorTomcat.sh for v27+) ─
  // refresh_payor already handled git sync and Maven build above.
  // The host script handles: find tarball, docker cp, run deploy_inside_container.sh.
  if (deployCfg.deploy_script_dir && deployCfg.deploy_script_name) {
    const hostScript = path.join(deployCfg.deploy_script_dir, deployCfg.deploy_script_name).replace(/\\/g, '/');
    banner('Step 3 — Run host deploy script');
    log(`Script: ${hostScript}`);
    const hostArgs = ['--skip-build'];  // build was already handled above (or skipped with -nbld)
    if (skipDbUpgrade) hostArgs.push('--skip-db-upgrade');
    const hostEnv = { ...process.env };
    if (deployCfg.secrets_management_dir) hostEnv.SECRETS_DIR = deployCfg.secrets_management_dir;
    const rc = run(GIT_BASH, [hostScript, ...hostArgs], { timeoutMs: 120 * 60 * 1000, env: hostEnv });
    if (rc !== 0) {
      console.error(`\nERROR: Host deploy script failed (exit ${rc}).`);
      process.exit(rc);
    }
    banner('Deployment complete.');
    log(`Total time: ${elapsedSince(scriptStart)}`);
    return;
  }

  // ── Step 5: Find distribution tarball ──────────────────────
  banner('Step 3 — Find distribution tarball');
  let distTarball;
  try {
    distTarball = findDistTarball(srcdir);
    log(`Distribution: ${distTarball}`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Step 6: Verify container ────────────────────────────────
  banner('Step 4 — Verify docker container');
  try {
    assertContainerRunning();
    log(`Container "${activeContainer}" is running.`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Step 7: Prepare staging dir ────────────────────────────
  banner('Step 5 — Prepare staging directory');
  const stagingDir = '/home/weblogic/staging';
  dockerExec(`rm -rf ${stagingDir} && mkdir -p ${stagingDir}`);
  log('Staging directory ready.');

  // ── Step 8: Copy files into container ──────────────────────
  banner('Step 6 — Copy files into container');
  let wlPropsPath, deployScriptPath, deployScriptName;
  try {
    ({ wlPropsPath, deployScriptPath, deployScriptName } = resolveDeployAssets(deployType, deployCfg));
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }
  log(`wl.properties        : ${wlPropsPath}`);
  log(`Deploy script        : ${deployScriptPath}`);

  dockerCp(wlPropsPath,       `${stagingDir}/${WL_PROPERTIES}`);
  dockerCp(deployScriptPath,  `${stagingDir}/${deployScriptName}`);
  dockerCp(distTarball,       `${stagingDir}/`);

  // Fix ownership so weblogic can read everything
  dockerExecRoot(`chown -R weblogic:weblogic /${stagingDir}`);
  log('Files copied and ownership set.');

  dockerExec(`dos2unix ${stagingDir}/${deployScriptName}`);
  log('Line endings converted.');

  // upgrade-dw.sh / upgrade-oltp.sh in the distribution hardcode
  // /user_projects/domains/healthedge/... (standard WebLogic install path).
  // The container stores the domain under /home/weblogic/domains/healthedge/.
  // A symlink makes both paths resolve to the same place.
  dockerExecRoot(
    'mkdir -p /user_projects && ' +
    'ln -sfn /home/weblogic/domains /user_projects/domains'
  );
  log('/user_projects/domains -> /home/weblogic/domains symlink ensured.');

  // ── Step 9: Run deploy script ───────────────────────────────
  banner('Step 7 — Run deployment inside container');
  const deployArgs = skipDbUpgrade ? '--skip-db-upgrade' : '';
  const deployCmd  = `cd ${stagingDir} && bash ${deployScriptName} ${deployArgs}`.trimEnd();
  log(`Running: ${deployCmd}`);
  const deployStatus = dockerExec(deployCmd, { timeoutMs: 60 * 60 * 1000 });
  if (deployStatus !== 0) {
    console.error(`\nERROR: Deployment script inside container failed (exit ${deployStatus}).`);
    process.exit(deployStatus);
  }
  log('Deployment script completed successfully.');

  // ── Step 10: Copy domain folders back to Windows host ───────
  banner('Step 8 — Copy domain folders back to Windows host');
  const domainHome = process.env.DOMAIN_HOME;
  if (!domainHome) {
    log('WARNING: DOMAIN_HOME env var is not set — skipping copy-back of domain folders.');
    log('         Set DOMAIN_HOME in PowerShell (done by setbranch) to enable this step.');
  } else {
    log(`DOMAIN_HOME: ${domainHome}`);
    const copyBack = [
      '/home/weblogic/domains/healthedge/jars',
      '/home/weblogic/domains/healthedge/tools',
      '/home/weblogic/domains/healthedge/data',
      '/home/weblogic/domains/healthedge/lib',
      '/home/weblogic/domains/healthedge/encrypt-keystore.jks',
      '/home/weblogic/domains/healthedge/runtime.properties',
      '/home/weblogic/domains/healthedge/xml',
    ];
    for (const src of copyBack) {
      try {
        dockerCpFrom(src, domainHome + '/');
      } catch (e) {
        log(`WARNING: Could not copy ${src}: ${e.message}`);
      }
    }
    log('Domain folders copied back to Windows host.');
  }

  // ── Done ─────────────────────────────────────────────────────
  banner('REFRESH COMPLETE');
  log(`Total time: ${elapsedSince(scriptStart)}`);
  log('Monitor server startup inside the container to confirm it is up.');
}

main().catch(e => {
  console.error('\nUnhandled error:', e.message);
  process.exit(1);
});
