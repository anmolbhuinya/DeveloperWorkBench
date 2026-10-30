// jar_resolver.js — Resolves the source jar path and deploy name for a module.
//
// Branch resolution order (mirrors the real PowerShell setbranch system):
//
//   1. If SRCDIR environment variable is set (populated by setbranch in PowerShell),
//      use it directly as the payor repo root — this is the most reliable source.
//
//   2. Otherwise read %USERPROFILE%\.default-branch  — the file setbranch writes
//      with  Set-Content -Path "$HOME\.default-branch" -Value $CURRENT_BRANCH
//      Its content is the bare branch name, e.g.  "26.1"  or  "master".
//      The full repo directory is then:
//        - SEPARATE_BRANCH_DIRECTORIES=true  →  GIT_HOME\hrp.payer.core-<branch>
//        - SEPARATE_BRANCH_DIRECTORIES=false →  GIT_HOME\hrp.payer.core
//      GIT_HOME defaults to %USERPROFILE%\hebb (set in Healthedge.Powershell_truths.ps1)
//
//   3. Fallback: pick the most recently modified hrp.payer.core-* directory
//      under payorRepoRoot as configured in config.xlsx → General.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const cfg  = require('./config');

// Resolve the SRCDIR (absolute path to the current payor branch repo).
// This is what all deploy scripts use — it's the canonical reference.
function resolveSrcDir() {
  // Priority 1: $SRCDIR env var — set by setbranch in the current PowerShell session
  if (process.env.SRCDIR) {
    const srcdir = process.env.SRCDIR.trim();
    if (srcdir && fs.existsSync(srcdir)) {
      return { srcdir, source: 'SRCDIR env var' };
    }
    console.warn(`[jar_resolver] SRCDIR env var is set to "${srcdir}" but directory does not exist — falling back.`);
  }

  const userProfile = process.env.USERPROFILE || os.homedir();
  const gitHome     = process.env.GIT_HOME    || path.join(userProfile, 'hebb');
  const repoPayor   = process.env.REPO_PAYOR  || 'hrp.payer.core';
  const separateDirs = (process.env.SEPARATE_BRANCH_DIRECTORIES || '').toLowerCase() === 'true';

  // Priority 2: ~/.default-branch — written by setbranch as the bare branch name
  const defaultBranchFile = path.join(userProfile, '.default-branch');
  if (fs.existsSync(defaultBranchFile)) {
    const branch = fs.readFileSync(defaultBranchFile, 'utf8').trim();
    if (branch) {
      // When SEPARATE_BRANCH_DIRECTORIES=true: hrp.payer.core-<branch>
      // When false (single checkout): hrp.payer.core
      const repoDir = separateDirs
        ? path.join(gitHome, `${repoPayor}-${branch}`)
        : path.join(gitHome, repoPayor);

      if (fs.existsSync(repoDir)) {
        return { srcdir: repoDir, source: `~/.default-branch (branch="${branch}")` };
      }
      console.warn(`[jar_resolver] ~/.default-branch says "${branch}" → resolved to "${repoDir}" but that directory does not exist — falling back.`);
    }
  }

  // Priority 3: config.xlsx setBranchFile (legacy / manual fallback)
  const setBranchFile = cfg.paths.setBranchFile;
  if (fs.existsSync(setBranchFile)) {
    const raw   = fs.readFileSync(setBranchFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || '';
    const match = raw.match(/^(?:set\s+)?(?:branch\s*=\s*)?(.+)$/i);
    const val   = match ? match[1].trim() : raw;
    if (val && fs.existsSync(val)) {
      // If the value looks like an absolute path pointing to a repo, use it directly
      return { srcdir: val, source: `setBranchFile as absolute path` };
    }
    if (val) {
      // Treat as a branch name or repo-dir-suffix
      const candidates = [
        path.join(cfg.paths.payorRepoRoot, val),              // exact dir name
        path.join(gitHome, `${repoPayor}-${val}`),            // branch suffix
        path.join(gitHome, repoPayor),                        // single-checkout
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          return { srcdir: c, source: `setBranchFile (value="${val}")` };
        }
      }
    }
  }

  // Priority 4: auto-detect the most recently modified hrp.payer.core-* directory
  const root = cfg.paths.payorRepoRoot;
  if (fs.existsSync(root)) {
    const coreDirs = fs.readdirSync(root)
      .filter(d => d.startsWith('hrp.payer.core-') && fs.statSync(path.join(root, d)).isDirectory());

    if (coreDirs.length) {
      coreDirs.sort((a, b) =>
        fs.statSync(path.join(root, b)).mtimeMs - fs.statSync(path.join(root, a)).mtimeMs
      );
      const detected = path.join(root, coreDirs[0]);
      console.warn(
        `[jar_resolver] Could not determine branch from SRCDIR / ~/.default-branch.\n` +
        `  Auto-detected: "${detected}" (most recently modified core dir).\n` +
        `  Run  setbranch <branch>  in PowerShell to make this explicit.`
      );
      return { srcdir: detected, source: 'auto-detected (most recently modified)' };
    }
  }

  throw new Error(
    `Cannot determine payor source directory.\n` +
    `Resolution chain tried:\n` +
    `  1. SRCDIR env var (not set or invalid)\n` +
    `  2. %USERPROFILE%\\.default-branch (not found)\n` +
    `  3. setBranchFile: ${cfg.paths.setBranchFile} (not found or unresolvable)\n` +
    `  4. Auto-detect in: ${cfg.paths.payorRepoRoot} (no hrp.payer.core-* dirs)\n\n` +
    `Fix: run  setbranch 26.1  (or whichever branch) in PowerShell, then re-run this script.`
  );
}

// Given a module name and the srcdir, find the SNAPSHOT jar in target/.
function findSourceJar(moduleName, srcdir) {
  const moduleDir = path.join(srcdir, moduleName);

  if (!fs.existsSync(moduleDir)) {
    throw new Error(
      `Module directory not found: ${moduleDir}\n` +
      `Check that "${moduleName}" exists in the payor branch at "${srcdir}".`
    );
  }

  const targetDir = path.join(moduleDir, 'target');
  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `target/ directory missing for module "${moduleName}" at: ${targetDir}\n` +
      `Run  mvn clean install  (or  mvn package)  for this module first.`
    );
  }

  // Pick the main jar: starts with moduleName, not -sources or -tests
  const jars = fs.readdirSync(targetDir).filter(f => {
    if (!f.endsWith('.jar')) return false;
    if (f.includes('-sources') || f.includes('-tests')) return false;
    return f.startsWith(moduleName + '-') || f === moduleName + '.jar';
  });

  // Prefer SNAPSHOT jars
  const chosen = jars.find(f => f.includes('SNAPSHOT')) || jars[0];

  if (!chosen) {
    const all = fs.readdirSync(targetDir).join(', ');
    throw new Error(
      `No jar found for module "${moduleName}" in ${targetDir}\n` +
      `Files in target/: ${all}`
    );
  }

  return path.join(targetDir, chosen);
}

// Strip version/qualifier: core-cvc-26.1.5-SNAPSHOT.jar → core-cvc.jar
// Matches the logic in deployPayorWithNexusDist.sh:
//   cp $SRCDIR/${1}/target/${1}-${release_ver}-SNAPSHOT.jar  ${dest}/${1}.jar
function stripVersion(jarFilename) {
  const base = path.basename(jarFilename, '.jar');
  return base.replace(/-\d.*$/, '') + '.jar';
}

// Main entry point. Returns { sourcePath, deployName, sharedFolder, srcdir }.
function resolveJar(moduleName) {
  const override = cfg.jarLocMap[moduleName] || {};

  const sharedFolder = override.sharedFolder || cfg.paths.sharedFolder;

  let sourcePath;
  let srcdir;

  if (override.from) {
    sourcePath = override.from;
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Override 'From' path does not exist: ${sourcePath}`);
    }
  } else {
    const resolved = resolveSrcDir();
    srcdir    = resolved.srcdir;
    console.log(`[jar_resolver] Using SRCDIR: ${srcdir}  (via ${resolved.source})`);
    sourcePath = findSourceJar(moduleName, srcdir);
  }

  const deployName = override.to || stripVersion(path.basename(sourcePath));

  return { sourcePath, deployName, sharedFolder, srcdir };
}

module.exports = { resolveJar, resolveSrcDir, stripVersion };
