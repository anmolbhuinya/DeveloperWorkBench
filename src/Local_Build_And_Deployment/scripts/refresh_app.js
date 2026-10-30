// ============================================================
// refresh_app.js — Generic local-app refresh script.
//
// Called by per-app thin wrappers that set APP_DIR before
// requiring this module. All app-specific config is read from
// APP_DIR/build_deploy_config.xlsx.
//
// WHAT IT DOES:
//   1. Read Build sheet (srcdir_env, branch_file, repo_prefix)
//   2. Resolve SRCDIR
//   3. Read Deploy sheet (container, user, staging_dir, dist_module, deploy_script)
//   4. git pull  [-ncs to skip]
//   5. mvn clean install  [-nbld to skip]
//   6. Find distribution tarball
//   7. Deploy into docker container
//      — deploy_script + args=DIST_DIR : Karaf/connector mode
//      — deploy_script (standalone)    : Classic-style mode
//      — auto-detect via container name: Classic -tc / -wl
//      — fallback                      : install.sh inside dist dir
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync } = require('child_process');

const APP_DIR = process.env.APP_DIR;
if (!APP_DIR) {
  console.error('ERROR: APP_DIR is not set. This script must be invoked via a per-app thin wrapper.');
  process.exit(1);
}
const APP_NAME = path.basename(APP_DIR).toLowerCase();

let effectiveContainer    = '';
let effectiveDockerUser   = '';
let effectiveStaging      = '';
let effectiveSrcdirEnv    = '';
let effectiveBranchFile   = '';
let effectiveRepoPrefix   = '';
let effectiveRepoBare     = '';
let effectiveDistModule   = '';
let effectiveMvnExtraArgs = '';

// ── Logging ───────────────────────────────────────────────────

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
  });
  if (result.error) throw new Error(`${cmd} failed to start: ${result.error.message}`);
  return result.status || 0;
}

// ── Docker helpers ────────────────────────────────────────────

function dockerCp(src, containerDest) {
  log(`docker cp  ${src}  ->  ${effectiveContainer}:${containerDest}`);
  const result = spawnSync('docker', ['cp', src, `${effectiveContainer}:${containerDest}`], {
    stdio:   'inherit',
    timeout: 5 * 60 * 1000,
  });
  if (result.error) throw new Error(`docker cp failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`docker cp exited ${result.status}`);
}

let _dockerUserChecked = false;
let _dockerUserExists  = false;

function _checkDockerUser() {
  if (_dockerUserChecked) return _dockerUserExists;
  _dockerUserChecked = true;
  if (!effectiveDockerUser || !effectiveContainer) { _dockerUserExists = false; return false; }
  const r = spawnSync('docker', ['exec', effectiveContainer, 'id', effectiveDockerUser],
    { encoding: 'utf8', timeout: 10000 });
  _dockerUserExists = r.status === 0;
  if (!_dockerUserExists) {
    console.warn(`[warn] User "${effectiveDockerUser}" not found in container "${effectiveContainer}" — running as default container user.`);
  }
  return _dockerUserExists;
}

function dockerExec(cmd, opts) {
  opts = opts || {};
  const useUser = effectiveDockerUser && _checkDockerUser();
  const args = useUser
    ? ['exec', '--user', effectiveDockerUser, effectiveContainer, 'bash', '-c', cmd]
    : ['exec', effectiveContainer, 'bash', '-c', cmd];
  const result = spawnSync('docker', args,
    { stdio: 'inherit', timeout: opts.timeoutMs || 30 * 60 * 1000 }
  );
  if (result.error) throw new Error(`docker exec failed: ${result.error.message}`);
  return result.status || 0;
}

function dockerExecRoot(cmd) {
  const result = spawnSync(
    'docker', ['exec', '--user', 'root', effectiveContainer, 'bash', '-c', cmd],
    { stdio: 'inherit', timeout: 60000 }
  );
  if (result.error) throw new Error(`docker exec (root) failed: ${result.error.message}`);
  return result.status || 0;
}

function containerState() {
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', effectiveContainer], {
    encoding: 'utf8',
    timeout:  15000,
  });
  if (result.error || result.status !== 0) return 'missing';
  return (result.stdout || '').trim() === 'true' ? 'running' : 'stopped';
}

function assertContainerRunning() {
  const state = containerState();
  if (state === 'missing') {
    throw new Error(
      `Cannot inspect docker container "${effectiveContainer}". ` +
      'Is docker running? Run  startdocker  then  startservers.'
    );
  }
  if (state !== 'running') {
    throw new Error(`Docker container "${effectiveContainer}" is not running.`);
  }
}

// ── XLSX loading ──────────────────────────────────────────────

function loadXLSX() {
  const candidates = [
    '' + require('os').homedir().replace(/\\/g, '/') + '/node_modules/xlsx',
    path.join(APP_DIR, '..', '..', '..', 'node_modules', 'xlsx'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return require(c); } catch (e) {}
  }
  try { return require('xlsx'); } catch (e) { return null; }
}

// ── Version-conditional config selection (shared by Build and Deploy sheets) ──
// Condition syntax: ">26 and <27", "=26.2", ">=27". "=" wins, then ranges, then unconditional rows.

function parseVer(s) {
  const parts = String(s || '').split('.');
  return (parseInt(parts[0], 10) || 0) * 1000 + (parseInt(parts[1], 10) || 0);
}

function evalCond(cond, v) {
  if (!cond) return { matches: true, isExact: false };
  const parts = cond.split(/\s+and\s+/i);
  if (parts.length > 1) {
    const results = parts.map(p => evalCond(p.trim(), v));
    return { matches: results.every(r => r.matches), isExact: results.some(r => r.isExact) };
  }
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

function selectByVersion(entries, version) {
  for (const e of entries) {
    const r = evalCond(e.condition, version);
    if (r.matches && r.isExact) return e.value;
  }
  for (const e of entries) {
    if (!e.condition) continue;
    if (evalCond(e.condition, version).matches) return e.value;
  }
  for (const e of entries) {
    if (!e.condition) return e.value;
  }
  return null;
}


// Config values may use  %VAR%  ~  {DWB} (this DeveloperWorkBench folder)  {DWB_HOME} (the DWB folder next to it)
function expandPath(v) {
  if (typeof v !== 'string') return v;
  const DWB = require('path').resolve(__dirname, '..', '..');
  return v.replace(/^~(?=[\\/]|$)/, require('os').homedir())
          .replace(/\{DWB_HOME\}/g, require('path').dirname(DWB))
          .replace(/\{DWB\}/g, DWB)
          .replace(/%([^%]+)%/g, (m, n) => process.env[n] !== undefined ? process.env[n] : m);
}

function readBuildConfig() {
  const XLSX = loadXLSX();
  if (!XLSX) return {};
  const cfgPath = path.join(APP_DIR, 'build_deploy_config.xlsx');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const wb  = XLSX.readFile(cfgPath);
    const wsn = wb.SheetNames.find(n => n.toLowerCase() === 'build');
    if (!wsn) return {};
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsn], { header: 1 });
    // Columns: Key, Value, Condition, Description — older sheets are Key, Value, Description (no condition)
    const hasCond = String((rows[0] || [])[2] || '').trim().toLowerCase() === 'condition';
    const groups = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const key  = String(row[0]).trim();
      const val  = String(row[1] != null ? row[1] : '').trim();
      const cond = hasCond ? String(row[2] != null ? row[2] : '').trim() : '';
      (groups[key] = groups[key] || []).push({ value: val, condition: cond });
    }
    // srcdir isn't resolved yet (srcdir_env itself comes from this sheet), so the version
    // comes from APP_RELEASE_VERSION or the branch file.
    const version = readCurrentVersion(null);
    const cfg = {};
    for (const [key, entries] of Object.entries(groups)) {
      const selected = selectByVersion(entries, version);
      if (selected !== null) cfg[key] = expandPath(selected);
    }
    return cfg;
  } catch (e) {
    console.warn(`[build-cfg] Failed to read Build sheet: ${e.message}`);
    return {};
  }
}

function readCurrentVersion(srcdir) {
  if (process.env.APP_RELEASE_VERSION) {
    const m = process.env.APP_RELEASE_VERSION.match(/^(\d+)\.(\d+)/);
    if (m) return parseInt(m[1], 10) * 1000 + (parseInt(m[2], 10) || 0);
  }
  if (srcdir) {
    try {
      const pomPath = path.join(srcdir, 'pom.xml');
      if (fs.existsSync(pomPath)) {
        const pom = fs.readFileSync(pomPath, 'utf8');
        // Strip <parent>...</parent> so we match the project version, not the parent version
        const pomNoParent = pom.replace(/<parent>[\s\S]*?<\/parent>/m, '');
        const m = pomNoParent.match(/<version>(\d+)\.(\d+)/);
        if (m) return parseInt(m[1], 10) * 1000 + (parseInt(m[2], 10) || 0);
      }
    } catch (e) {}
  }
  try {
    const branchFilePath = path.join(os.homedir(), effectiveBranchFile);
    if (fs.existsSync(branchFilePath)) {
      const branch = fs.readFileSync(branchFilePath, 'utf8').trim();
      const m = branch.match(/(\d+)\.(\d+)/);
      if (m) return parseInt(m[1], 10) * 1000 + (parseInt(m[2], 10) || 0);
    }
  } catch (e) {}
  return null;
}

function readDeployConfig(srcdir) {
  const XLSX = loadXLSX();
  if (!XLSX) { console.warn('[deploy-cfg] xlsx module not found — using defaults.'); return {}; }
  const cfgPath = path.join(APP_DIR, 'build_deploy_config.xlsx');
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

    const cfg = {};
    for (const [key, entries] of Object.entries(groups)) {
      const selected = selectByVersion(entries, version);
      if (selected !== null) cfg[key] = expandPath(selected);
    }
    return cfg;
  } catch (e) {
    console.warn(`[deploy-cfg] Failed to read build_deploy_config.xlsx: ${e.message}`);
    return {};
  }
}

// ── SRCDIR resolution ─────────────────────────────────────────

function resolveSrcDir() {
  const gitHome = process.env.GIT_HOME || path.join(os.homedir(), 'hebb');

  if (process.env[effectiveSrcdirEnv]) {
    const srcdir = process.env[effectiveSrcdirEnv].trim();
    if (srcdir && fs.existsSync(srcdir)) {
      return { srcdir, source: `${effectiveSrcdirEnv} env var` };
    }
    console.warn(`[${APP_NAME}] ${effectiveSrcdirEnv} set to "${srcdir}" but directory does not exist — falling back.`);
  }

  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
    return { srcdir: cwd, source: 'current working directory' };
  }

  const branchFilePath = path.join(os.homedir(), effectiveBranchFile);
  if (fs.existsSync(branchFilePath)) {
    const branch = fs.readFileSync(branchFilePath, 'utf8').trim();
    if (branch) {
      const repoDir = path.join(gitHome, `${effectiveRepoPrefix}${branch}`);
      if (fs.existsSync(repoDir)) {
        return { srcdir: repoDir, source: `~/${effectiveBranchFile} (branch="${branch}")` };
      }
      // PIK master uses bare folder (no -master suffix)
      if (branch === 'master' && effectiveRepoBare) {
        const bareDir = path.join(gitHome, effectiveRepoBare);
        if (fs.existsSync(bareDir)) {
          return { srcdir: bareDir, source: `~/${effectiveBranchFile} (master → bare folder)` };
        }
      }
      console.warn(`[${APP_NAME}] ~/${effectiveBranchFile} → "${repoDir}" does not exist — falling back.`);
    }
  }

  // PIK bare folder auto-detect
  if (effectiveRepoBare) {
    const bareDir = path.join(gitHome, effectiveRepoBare);
    if (fs.existsSync(bareDir)) {
      console.warn(`[${APP_NAME}] Auto-detected bare folder: "${bareDir}".`);
      return { srcdir: bareDir, source: 'auto-detected (bare folder)' };
    }
  }

  if (fs.existsSync(gitHome)) {
    const dirs = fs.readdirSync(gitHome)
      .filter(d => d.startsWith(effectiveRepoPrefix) && fs.statSync(path.join(gitHome, d)).isDirectory());
    if (dirs.length) {
      dirs.sort((a, b) =>
        fs.statSync(path.join(gitHome, b)).mtimeMs - fs.statSync(path.join(gitHome, a)).mtimeMs
      );
      const detected = path.join(gitHome, dirs[0]);
      console.warn(`[${APP_NAME}] Auto-detected: "${detected}".`);
      return { srcdir: detected, source: 'auto-detected' };
    }
  }

  throw new Error(
    `Cannot determine ${APP_NAME} source directory.\n` +
    `Tried: ${effectiveSrcdirEnv} env var, cwd (${process.cwd()}), ~/${effectiveBranchFile}, auto-detect in ${gitHome}\n` +
    `Fix: set ${effectiveSrcdirEnv} env var or run the appropriate setbranch command.`
  );
}

// ── Distribution tarball ──────────────────────────────────────

function findDistTarball(srcdir) {
  const distTarget = path.join(srcdir, effectiveDistModule, 'target');
  if (!fs.existsSync(distTarget)) {
    throw new Error(
      `Distribution target directory not found: ${distTarget}\n` +
      'Run a full build first (without -nbld).'
    );
  }
  const tarballs = fs.readdirSync(distTarget).filter(f => f.endsWith('.tar.gz'));
  if (tarballs.length === 0) {
    throw new Error(
      `No *.tar.gz found in ${distTarget}\n` +
      'Run a full build first (without -nbld).'
    );
  }
  tarballs.sort((a, b) =>
    fs.statSync(path.join(distTarget, b)).mtimeMs -
    fs.statSync(path.join(distTarget, a)).mtimeMs
  );
  return path.join(distTarget, tarballs[0]);
}

// ── Deploy script resolution ──────────────────────────────────
//
// Returns { scriptPath, mode }  where mode is:
//   'dist_dir'   — extract tarball first, pass DIST_DIR as arg to script
//   'standalone' — copy tarball + script, script handles extraction itself
//   'install'    — no custom script; use install.sh inside dist dir

function resolveDeployScriptInfo(deployCfg) {
  const dockerDir = path.join(APP_DIR, 'docker');

  // Explicit override from calling thin wrapper (full path)
  if (process.env.DEPLOY_SCRIPT_OVERRIDE) {
    const scriptPath = process.env.DEPLOY_SCRIPT_OVERRIDE;
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`DEPLOY_SCRIPT_OVERRIDE path not found: ${scriptPath}`);
    }
    const mode = (process.env.DEPLOY_SCRIPT_ARGS || '').trim() === 'DIST_DIR' ? 'dist_dir' : 'standalone';
    return { scriptPath, mode };
  }

  // deploy_script from xlsx — use value "install" to force install.sh mode and skip auto-detect
  if (deployCfg.deploy_script) {
    if (deployCfg.deploy_script.toLowerCase() === 'install') {
      return { scriptPath: null, mode: 'install' };
    }
    const scriptPath = path.join(dockerDir, deployCfg.deploy_script);
    if (!fs.existsSync(scriptPath)) {
      throw new Error(
        `deploy_script "${deployCfg.deploy_script}" not found: ${scriptPath}\n` +
        `Ensure the script exists in ${dockerDir}`
      );
    }
    const mode = (deployCfg.deploy_script_args || '').trim() === 'DIST_DIR' ? 'dist_dir' : 'standalone';
    return { scriptPath, mode };
  }

  // Auto-detect Classic-style deploy script from container name
  if (effectiveContainer.includes('-tc')) {
    const tcScript = path.join(dockerDir, 'deploy_classic_inside_container.sh');
    if (fs.existsSync(tcScript)) {
      return { scriptPath: tcScript, mode: 'standalone' };
    }
    const devToolsScript = path.join(os.homedir(), 'hebb', 'hrp.dev.tools', 'docker', 'payor', 'tomcat', 'deploy_classic_inside_container.sh');
    if (fs.existsSync(devToolsScript)) {
      return { scriptPath: devToolsScript, mode: 'standalone' };
    }
  }

  if (effectiveContainer.match(/-(wl\b|weblogic)/)) {
    const wlScript = path.join(dockerDir, 'deploy_classic_inside_container_weblogic.sh');
    if (fs.existsSync(wlScript)) {
      return { scriptPath: wlScript, mode: 'standalone' };
    }
    const devToolsScript = path.join(os.homedir(), 'hebb', 'hrp.dev.tools', 'docker', 'payor', 'weblogic', 'deploy_classic_inside_container.sh');
    if (fs.existsSync(devToolsScript)) {
      return { scriptPath: devToolsScript, mode: 'standalone' };
    }
  }

  return { scriptPath: null, mode: 'install' };
}

// ── Usage ──────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage:
  refresh-${APP_NAME} [options]

Options:
  -ncs  / --no-sync      Skip git pull
  -ncb  / --no-clean     Incremental build (skip mvn clean)
  -st   / --skip-tests   Add -DskipTests=true to Maven
  -nbld / --no-build     Skip Maven build entirely
  -nd   / --no-deploy    Skip deployment (build only)
  -rf <mod>              Maven resume from (-rf <mod>)
  -h    / --help         Show this message
`);
}

// ── CLI arg parsing ───────────────────────────────────────────

const cliArgs = process.argv.slice(2);

let syncCode      = true;
let doClean       = true;
let skipTests     = false;
let doBuild       = true;
let doDeploy      = true;
let mvnResumeFrom = '';

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];
  switch (arg) {
    case '-ncs':  case '--no-sync':    syncCode      = false; break;
    case '-ncb':  case '--no-clean':   doClean       = false; break;
    case '-st':   case '--skip-tests': skipTests     = true;  break;
    case '-nbld': case '--no-build':   doBuild       = false; break;
    case '-nd':   case '--no-deploy':  doDeploy      = false; break;
    case '-rf':   case '--resume-from':
      mvnResumeFrom = cliArgs[++i] || '';
      if (!mvnResumeFrom) { console.error('-rf requires a module name'); process.exit(1); }
      break;
    case '-h': case '--help':
      printUsage(); process.exit(0); break;
    default:
      console.error(`Unknown flag: ${arg}`);
      printUsage(); process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const scriptStart = Date.now();
  banner(`refresh_${APP_NAME}`);

  // ── Load build config (before srcdir known) ────────────────
  const buildCfg = readBuildConfig();
  if (buildCfg.srcdir_env)     { effectiveSrcdirEnv    = buildCfg.srcdir_env;     log(`srcdir_env:  ${effectiveSrcdirEnv}  (from xlsx)`); }
  if (buildCfg.branch_file)    { effectiveBranchFile   = buildCfg.branch_file; }
  if (buildCfg.mvn_extra_args) { effectiveMvnExtraArgs = buildCfg.mvn_extra_args; log(`mvn_extra_args: ${effectiveMvnExtraArgs}  (from xlsx)`); }
  if (buildCfg.java_home) {
    log(`java_home: ${buildCfg.java_home}  (from xlsx)`);
    process.env.JAVA_HOME = buildCfg.java_home;
    process.env.PATH = require('path').join(buildCfg.java_home, 'bin') + require('path').delimiter + process.env.PATH;
  }
  if (buildCfg.repo_prefix) {
    effectiveRepoPrefix = buildCfg.repo_prefix;
    effectiveRepoBare   = buildCfg.repo_bare || effectiveRepoPrefix.replace(/-$/, '');
  }

  if (!effectiveSrcdirEnv) {
    console.error(`ERROR: srcdir_env not found in ${APP_DIR}/build_deploy_config.xlsx Build sheet.`);
    process.exit(1);
  }

  // ── Step 1: Resolve SRCDIR ──────────────────────────────────
  log(`Resolving ${APP_NAME} source directory (${effectiveSrcdirEnv})...`);
  let srcdir;
  try {
    const resolved = resolveSrcDir();
    srcdir = resolved.srcdir;
    log(`SRCDIR: ${srcdir}  (via ${resolved.source})`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Load deploy config (version from pom.xml) ───────────────
  const deployCfg = readDeployConfig(srcdir);
  if (deployCfg.deployment_container) {
    effectiveContainer  = deployCfg.deployment_container;
    log(`deployment_container: ${effectiveContainer}  (from xlsx)`);
  }
  if (deployCfg.deployment_user !== undefined) effectiveDockerUser = deployCfg.deployment_user;
  if (deployCfg.staging_dir)                   effectiveStaging    = deployCfg.staging_dir;
  if (deployCfg.dist_module)                   effectiveDistModule = deployCfg.dist_module;

  if (!effectiveContainer) {
    console.error(`ERROR: deployment_container not found in ${APP_DIR}/build_deploy_config.xlsx Deploy sheet.`);
    process.exit(1);
  }
  if (!effectiveStaging) {
    console.error(`ERROR: staging_dir not found in ${APP_DIR}/build_deploy_config.xlsx Deploy sheet.`);
    process.exit(1);
  }
  if (!effectiveDistModule) {
    console.error(`ERROR: dist_module not found in ${APP_DIR}/build_deploy_config.xlsx Deploy sheet.`);
    process.exit(1);
  }

  // ── Step 2: Sync code ───────────────────────────────────────
  if (syncCode) {
    banner('Step 1 — Sync code (git pull)');
    log(`Running git pull in: ${srcdir}`);
    const ret = run('git', ['pull'], { cwd: srcdir, timeoutMs: 5 * 60 * 1000 });
    if (ret !== 0) {
      console.error(`\nERROR: git pull exited ${ret}.`);
      process.exit(ret);
    }
    log('Code sync complete.');
  } else {
    log('Skipping code sync (-ncs).');
  }

  // ── Step 3: Maven build ─────────────────────────────────────
  if (doBuild) {
    banner('Step 2 — Maven build');
    const mvnArgs = [];
    if (doClean) mvnArgs.push('clean');
    mvnArgs.push('install');
    if (mvnResumeFrom)          { log(`Resuming from: ${mvnResumeFrom}`);           mvnArgs.push('-rf', mvnResumeFrom); }
    if (skipTests)              { log('Skipping tests.');                             mvnArgs.push('-DskipTests=true'); }
    if (effectiveMvnExtraArgs)  { mvnArgs.push(...effectiveMvnExtraArgs.split(/\s+/).filter(Boolean)); }
    mvnArgs.push('-nsu');

    const t = Date.now();
    log(`Running: mvn ${mvnArgs.join(' ')}`);
    const status = run('mvn', mvnArgs, { cwd: srcdir, timeoutMs: 90 * 60 * 1000, shell: true });
    if (status !== 0) {
      console.error(`\nERROR: Maven build failed (exit ${status}) after ${elapsedSince(t)}.`);
      process.exit(status);
    }
    log(`Maven build successful (${elapsedSince(t)}).`);
  } else {
    log('Skipping maven build (-nbld).');
  }

  if (!doDeploy) {
    banner('Build complete. Deployment skipped (-nd).');
    log(`Total time: ${elapsedSince(scriptStart)}`);
    return;
  }

  // ── Step 4: Find distribution tarball ──────────────────────
  banner('Step 3 — Find distribution tarball');
  let distTarball;
  try {
    distTarball = findDistTarball(srcdir);
    log(`Distribution: ${distTarball}`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Step 5: Verify container ────────────────────────────────
  banner('Step 4 — Verify docker container');
  try {
    assertContainerRunning();
    log(`Container "${effectiveContainer}" is running.`);
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  // ── Step 6: Resolve deploy script ──────────────────────────
  let deployInfo;
  try {
    deployInfo = resolveDeployScriptInfo(deployCfg);
    if (deployInfo.scriptPath) {
      log(`Deploy script: ${deployInfo.scriptPath}  (mode: ${deployInfo.mode})`);
    } else {
      log('Deploy mode: install.sh (standard)');
    }
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }

  const tarball = path.basename(distTarball);

  if (deployInfo.mode === 'dist_dir') {
    // ── Karaf/Connector mode ─────────────────────────────────
    // chmod 777 so any user inside container can write; skip chown (deployment_user may be empty)
    banner('Step 5 — Copy distribution into container');
    const scriptName = path.basename(deployInfo.scriptPath);
    dockerExecRoot(`rm -rf ${effectiveStaging} && mkdir -p ${effectiveStaging} && chmod 777 ${effectiveStaging}`);
    dockerCp(distTarball,            effectiveStaging + '/');
    dockerCp(deployInfo.scriptPath,  effectiveStaging + '/');
    log('Distribution and deploy script copied to staging directory.');

    banner('Step 6 — Deploy inside container');
    const envVars = [];
    if (deployCfg.karaf_home) { envVars.push(`KARAF_HOME=${deployCfg.karaf_home}`); log(`KARAF_HOME: ${deployCfg.karaf_home}  (from xlsx)`); }
    if (deployCfg.java_home)  { envVars.push(`JAVA_HOME=${deployCfg.java_home}`);   log(`JAVA_HOME: ${deployCfg.java_home}  (from xlsx)`); }
    const envPrefix = envVars.length ? envVars.join(' ') + ' ' : '';
    const deployCmd =
      `cd ${effectiveStaging} && ` +
      `tar xzpf ${tarball} && ` +
      `DIST_DIR=$(ls -d */ 2>/dev/null | head -1 | tr -d /) && ` +
      `dos2unix ${scriptName} 2>/dev/null || true && ` +
      `${envPrefix}bash ${scriptName} ${effectiveStaging}/$DIST_DIR`;
    log(`Running: ${deployCmd}`);
    const status = dockerExec(deployCmd, { timeoutMs: 60 * 60 * 1000 });
    if (status !== 0) {
      console.error(`\nERROR: Deploy script failed (exit ${status}).`);
      process.exit(status);
    }

  } else if (deployInfo.mode === 'standalone') {
    // ── Classic mode ─────────────────────────────────────────
    // Script handles extraction itself; run it standalone with chown
    banner('Step 5 — Copy distribution into container');
    const scriptName = path.basename(deployInfo.scriptPath);
    dockerExecRoot(`rm -rf ${effectiveStaging} && mkdir -p ${effectiveStaging} && chmod 777 ${effectiveStaging}`);
    dockerCp(distTarball,           effectiveStaging + '/');
    dockerCp(deployInfo.scriptPath, `${effectiveStaging}/${scriptName}`);
    if (effectiveDockerUser && _checkDockerUser()) {
      dockerExecRoot(`chown -R ${effectiveDockerUser}:${effectiveDockerUser} ${effectiveStaging}`);
    }
    log('Tarball and deploy script copied to staging.');

    banner('Step 6 — Deploy inside container');
    const deployStatus = dockerExec(
      `cd ${effectiveStaging} && chmod +x ${scriptName} && ./${scriptName}`,
      { timeoutMs: 15 * 60 * 1000 }
    );
    if (deployStatus !== 0) {
      console.error(`\nERROR: Deploy script failed (exit ${deployStatus}).`);
      process.exit(deployStatus);
    }

  } else {
    // ── install.sh mode (Enrollment, PIK) ───────────────────
    banner('Step 5 — Copy distribution into container');
    dockerExecRoot(`rm -rf ${effectiveStaging} && mkdir -p ${effectiveStaging} && chmod 777 ${effectiveStaging}`);
    dockerCp(distTarball, effectiveStaging + '/');
    if (effectiveDockerUser && _checkDockerUser()) {
      dockerExecRoot(`chown -R ${effectiveDockerUser}:${effectiveDockerUser} ${effectiveStaging}`);
    }
    log('Distribution copied to staging directory.');

    banner('Step 6 — Install inside container');
    const installCmd =
      `cd ${effectiveStaging} && ` +
      `tar xzpf ${tarball} && ` +
      `DIST_DIR=$(ls -d */ 2>/dev/null | head -1 | tr -d /) && ` +
      `cd $DIST_DIR && ` +
      `dos2unix install.sh 2>/dev/null || true && ` +
      `bash install.sh`;
    log(`Running: ${installCmd}`);
    const installStatus = dockerExec(installCmd, { timeoutMs: 30 * 60 * 1000 });
    if (installStatus !== 0) {
      console.error(`\nERROR: install.sh failed (exit ${installStatus}).`);
      process.exit(installStatus);
    }
  }

  log('Installation complete.');
  banner('REFRESH COMPLETE');
  log(`Total time: ${elapsedSince(scriptStart)}`);
  log('Monitor server startup inside the container to confirm it is up.');
}

main().catch(e => {
  console.error('\nUnhandled error:', e.message);
  process.exit(1);
});
