// ============================================================
// build_module.js — Smart Payor module builder.
//
// USAGE:
//   node scripts/build_module.js [<module-name>] [options]
//
// MODES:
//   No module name  — detect changed modules via git, build each
//                     plus all transitive dependents (deduped),
//                     then install and distribution.
//   <module-name>   — build only that single module.
//   <module-name> -dist — build module + all transitive dependents
//                         + install + distribution.
//
// OPTIONS:
//   -st / --skip-tests   Add -DskipTests=true to Maven
//   -dist                (with module name) expand to full dep closure
//                        + install + distribution
//   -h / --help          Show this message
//
// EXAMPLES:
//   node scripts/build_module.js
//   node scripts/build_module.js -st
//   node scripts/build_module.js core-cvc
//   node scripts/build_module.js core-cvc -st
//   node scripts/build_module.js core-cvc -dist
//   node scripts/build_module.js core-cvc -st -dist
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveSrcDir } = require('./jar_resolver');

// ── Helpers ───────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function elapsedSince(startMs) {
  const s = Math.round((Date.now() - startMs) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Minimal regex-based XML extractor — no external parser needed.
function xmlValues(text, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

// Returns intra-project artifactId deps from a pom.xml text.
// Only counts deps with groupId com.healthedge.core or ${project.groupId}.
function extractIntraDeps(pomText) {
  const INTRA = /com\.healthedge\.core|\$\{project\.groupId\}/;
  const deps = new Set();
  const blockRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let block;
  while ((block = blockRe.exec(pomText)) !== null) {
    const body      = block[1];
    const groupIds  = xmlValues(body, 'groupId');
    const artifacts = xmlValues(body, 'artifactId');
    if (groupIds.some(g => INTRA.test(g)) && artifacts.length) {
      deps.add(artifacts[0]);
    }
  }
  return deps;
}

// ── DAG builder ───────────────────────────────────────────────

// Returns:
//   modules    : string[]                     — root pom module list (declaration order = build order)
//   deps       : Map<string, Set<string>>     — module → its intra-project deps
//   reverseDeps: Map<string, Set<string>>     — module → modules that depend on it
function buildDag(srcdir) {
  const rootPom = path.join(srcdir, 'pom.xml');
  if (!fs.existsSync(rootPom)) throw new Error(`Root pom.xml not found at ${rootPom}`);
  const rootText = fs.readFileSync(rootPom, 'utf8');

  const modulesBlock = (rootText.match(/<modules>([\s\S]*?)<\/modules>/) || ['', ''])[1];
  const modules = xmlValues(modulesBlock, 'module');

  const deps        = new Map();
  const reverseDeps = new Map();
  for (const mod of modules) {
    deps.set(mod, new Set());
    reverseDeps.set(mod, new Set());
  }

  const moduleSet = new Set(modules);
  for (const mod of modules) {
    const pomPath = path.join(srcdir, mod, 'pom.xml');
    if (!fs.existsSync(pomPath)) continue;
    const intraDeps = extractIntraDeps(fs.readFileSync(pomPath, 'utf8'));
    for (const dep of intraDeps) {
      if (!moduleSet.has(dep)) continue;
      deps.get(mod).add(dep);
      reverseDeps.get(dep).add(mod);
    }
  }

  return { modules, deps, reverseDeps };
}

// BFS: collect `root` plus all modules that transitively depend on it.
function reverseClosure(root, reverseDeps) {
  const visited = new Set([root]);
  const queue   = [root];
  while (queue.length) {
    const cur = queue.shift();
    for (const dep of (reverseDeps.get(cur) || [])) {
      if (!visited.has(dep)) { visited.add(dep); queue.push(dep); }
    }
  }
  return visited;
}

// BFS over multiple roots — union of their reverse closures (deduped).
function reverseClosureMulti(roots, reverseDeps) {
  const visited = new Set();
  const queue   = [];
  for (const r of roots) {
    if (!visited.has(r)) { visited.add(r); queue.push(r); }
  }
  while (queue.length) {
    const cur = queue.shift();
    for (const dep of (reverseDeps.get(cur) || [])) {
      if (!visited.has(dep)) { visited.add(dep); queue.push(dep); }
    }
  }
  return visited;
}

// Kahn's topo-sort over `subset`, edges restricted to subset members.
// Returns modules in build order (dependencies before dependents).
function topoSort(subset, deps) {
  const inDegree  = new Map();
  const localDeps = new Map();

  for (const mod of subset) {
    const filtered = new Set([...(deps.get(mod) || [])].filter(d => subset.has(d)));
    localDeps.set(mod, filtered);
    inDegree.set(mod, filtered.size);
  }

  const queue  = [...subset].filter(m => inDegree.get(m) === 0);
  const result = [];

  while (queue.length) {
    const cur = queue.shift();
    result.push(cur);
    for (const mod of subset) {
      if (localDeps.get(mod).has(cur)) {
        const deg = inDegree.get(mod) - 1;
        inDegree.set(mod, deg);
        if (deg === 0) queue.push(mod);
      }
    }
  }

  // Cycle fallback — return original declaration order
  return result.length === subset.size ? result : [...subset];
}

// ── Git changed modules detection ────────────────────────────

// Collect all changed file paths (relative to srcdir) from:
//   1. git status --porcelain  (staged + unstaged working-tree changes)
//   2. git diff --name-only origin/HEAD...HEAD  (committed but not yet pushed)
function collectChangedPaths(srcdir) {
  const paths = new Set();

  function parsePaths(output) {
    for (const raw of (output || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      // git status --porcelain: "XY path" or "XY old -> new"
      const filePath = line.length > 3 && line[2] === ' ' ? line.slice(3).trim() : line;
      const parts = filePath.split(' -> ');
      paths.add(parts[parts.length - 1].trim());
    }
  }

  const statusResult = spawnSync('git', ['status', '--porcelain'], {
    cwd: srcdir, encoding: 'utf8', timeout: 15000, shell: false,
  });
  if (!statusResult.error) parsePaths(statusResult.stdout);

  const diffResult = spawnSync('git', ['diff', '--name-only', 'origin/HEAD...HEAD'], {
    cwd: srcdir, encoding: 'utf8', timeout: 15000, shell: false,
  });
  if (!diffResult.error) parsePaths(diffResult.stdout);

  return paths;
}

// Returns the mtime (ms) of the newest file in an array of relative paths.
function newestMtime(srcdir, relPaths) {
  let newest = 0;
  for (const rel of relPaths) {
    try {
      const mtime = fs.statSync(path.join(srcdir, rel)).mtimeMs;
      if (mtime > newest) newest = mtime;
    } catch (_) { /* file may be deleted */ }
  }
  return newest;
}

// Find the jar mtime for a module (returns 0 if no jar exists yet).
function jarMtime(moduleName, srcdir) {
  const targetDir = path.join(srcdir, moduleName, 'target');
  if (!fs.existsSync(targetDir)) return 0;
  let newest = 0;
  for (const f of fs.readdirSync(targetDir)) {
    if (!f.endsWith('.jar')) continue;
    if (f.includes('-sources') || f.includes('-tests')) continue;
    if (!f.startsWith(moduleName + '-') && f !== moduleName + '.jar') continue;
    try {
      const mtime = fs.statSync(path.join(targetDir, f)).mtimeMs;
      if (mtime > newest) newest = mtime;
    } catch (_) { /* ignore */ }
  }
  return newest;
}

// Returns:
//   stale   : Set<string>  — changed modules whose jar is older than their changes
//   upToDate: Set<string>  — changed modules whose jar is already newer
function detectStaleModules(srcdir, moduleSet) {
  const changedPaths = collectChangedPaths(srcdir);

  // Group changed paths by module
  const pathsByModule = new Map();
  for (const rel of changedPaths) {
    const mod = rel.split(/[\\/]/)[0];
    if (!moduleSet.has(mod)) continue;
    if (!pathsByModule.has(mod)) pathsByModule.set(mod, []);
    pathsByModule.get(mod).push(rel);
  }

  const stale    = new Set();
  const upToDate = new Set();

  for (const [mod, relPaths] of pathsByModule) {
    const srcNewest = newestMtime(srcdir, relPaths);
    const jar       = jarMtime(mod, srcdir);

    if (jar === 0 || jar < srcNewest) {
      stale.add(mod);
    } else {
      upToDate.add(mod);
    }
  }

  return { stale, upToDate };
}

// ── Usage ─────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage:
  node scripts/build_module.js [<module-name>] [options]

Arguments:
  <module-name>   (optional) Maven module directory name (e.g. core-cvc).
                  If omitted, changed modules are auto-detected via git.

Options:
  -st / --skip-tests   Skip tests (-DskipTests=true)
  -dist                (with module name) Build transitive dependents
                       + install + distribution
  -h / --help          Show this message

Behaviour:
  No module name  → detect changed modules, build each + transitive
                    dependents (deduped), then install, distribution
  <module>        → build only that module
  <module> -dist  → build module + transitive dependents + install + distribution

Examples:
  node scripts/build_module.js
  node scripts/build_module.js -st
  node scripts/build_module.js core-cvc
  node scripts/build_module.js core-cvc -st
  node scripts/build_module.js core-cvc -dist
  node scripts/build_module.js core-cvc -st -dist
`);
}

// ── Argument parsing ──────────────────────────────────────────

const cliArgs = process.argv.slice(2);

let moduleName = '';
let skipTests  = false;
let buildDist  = false;

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];
  switch (arg) {
    case '-st':   case '--skip-tests': skipTests = true;  break;
    case '-dist': case '--dist':       buildDist = true;  break;
    case '-h':    case '--help':       printUsage(); process.exit(0); break;
    default:
      if (arg.startsWith('-')) {
        console.error(`Unknown flag: ${arg}`);
        printUsage();
        process.exit(1);
      }
      if (moduleName) {
        console.error(`Unexpected argument: ${arg}  (module name already set to "${moduleName}")`);
        printUsage();
        process.exit(1);
      }
      moduleName = arg;
  }
}

// ── Main ──────────────────────────────────────────────────────

const startMs = Date.now();

let srcdir;
try {
  const resolved = resolveSrcDir();
  srcdir = resolved.srcdir;
  log(`Payor repo : ${srcdir}  (via ${resolved.source})`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const autoDetect = !moduleName;   // no module name → detect from git
const needDag    = autoDetect || buildDist;

// Build DAG when needed (auto-detect or -dist)
let dag = null;
if (needDag) {
  log('Scanning pom.xml files to build dependency graph...');
  try {
    dag = buildDag(srcdir);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

let ordered;      // final topo-sorted module list to pass to Maven
let staleRoots;   // Set of stale changed modules (for display only)

if (autoDetect) {
  // ── Auto-detect mode ──────────────────────────────────────
  const { stale, upToDate } = detectStaleModules(srcdir, new Set(dag.modules));

  if (stale.size === 0 && upToDate.size === 0) {
    log('No changed modules detected (working tree clean, no unpushed commits).');
    log('Nothing to build.');
    process.exit(0);
  }

  if (upToDate.size > 0) {
    log(`Up-to-date (jar newer than changes, skipping): ${[...upToDate].join(', ')}`);
  }
  if (stale.size === 0) {
    log('All changed modules are already up-to-date. Nothing to build.');
    process.exit(0);
  }
  log(`Stale (jar older than changes): ${[...stale].join(', ')}`);

  // Reverse-dep closure from stale roots only — dependents of stale modules
  // must be rebuilt even if their own source hasn't changed.
  staleRoots = stale;
  const toBuild = reverseClosureMulti(stale, dag.reverseDeps);
  ordered = topoSort(toBuild, dag.deps);

} else if (buildDist) {
  // ── Single module + full dep closure ─────────────────────
  if (!dag.reverseDeps.has(moduleName)) {
    console.error(`ERROR: Module "${moduleName}" not found in root pom.xml.`);
    process.exit(1);
  }
  const toBuild = reverseClosure(moduleName, dag.reverseDeps);
  ordered = topoSort(toBuild, dag.deps);

} else {
  // ── Single module only ────────────────────────────────────
  // Build the DAG to validate the module is in the reactor.
  if (!dag) {
    log('Validating module against reactor pom.xml…');
    try {
      dag = buildDag(srcdir);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }
  }
  ordered = [moduleName];
}

// Always append install + distribution (auto-detect mode always needs them;
// explicit module + -dist also needs them)
const appendDist = autoDetect || buildDist;

// Check if the module is listed in the root pom.xml reactor.
// If not, we build it via -f <module>/pom.xml rather than -pl,
// because Maven's -pl only resolves against the reactor.
const inReactor = !moduleName || (dag && dag.modules && dag.modules.includes(moduleName));

// Print plan
const line = '─'.repeat(60);
console.log('\n' + line);
const suffix = appendDist ? ' + install + distribution' : '';
console.log(` Modules to build  (${ordered.length}${suffix})`);
if (!inReactor && moduleName) {
  console.log(` NOTE: "${moduleName}" is not in root pom.xml reactor — building standalone via -f`);
}
console.log(line);
for (const m of ordered) {
  let marker = '';
  if (!autoDetect && m === moduleName) marker = ' <- target';
  else if (autoDetect && staleRoots && staleRoots.has(m)) marker = ' <- stale';
  console.log(`  ${m}${marker}`);
}
if (appendDist) {
  console.log('  install');
  console.log('  distribution');
}
console.log(line + '\n');

let mvnArgs, spawnCwd;

if (!inReactor && moduleName && !appendDist) {
  // Module is not in the reactor: build it standalone from its own directory.
  spawnCwd = path.join(srcdir, moduleName);
  mvnArgs  = ['clean', 'install', '-nsu'];
  if (skipTests) mvnArgs.push('-DskipTests=true');
} else {
  // Normal reactor-based build.
  spawnCwd = srcdir;
  const plList = appendDist
    ? [...ordered, 'install', 'distribution'].join(',')
    : moduleName;
  mvnArgs = ['clean', 'install', '-pl', plList, '-nsu'];
  if (skipTests) mvnArgs.push('-DskipTests=true');
}

log(`mvn ${mvnArgs.join(' ')}  [cwd: ${spawnCwd}]`);
console.log();

const result = spawnSync('mvn', mvnArgs, {
  cwd:     spawnCwd,
  stdio:   'inherit',
  timeout: 60 * 60 * 1000,
  shell:   true,
});

if (result.error) {
  console.error(`ERROR: mvn failed to start: ${result.error.message}`);
  process.exit(1);
}

const elapsed = elapsedSince(startMs);

if (result.status !== 0) {
  console.error(`\nBuild FAILED (exit ${result.status}) after ${elapsed}`);
  process.exit(result.status);
}

log(`Build SUCCESS  [${elapsed}]`);
if (appendDist) {
  log(`${ordered.length} module(s) + install + distribution built.`);
} else {
  log(`Module "${moduleName}" built. Run  node scripts/deploy_jar.js ${moduleName}  to deploy.`);
}
