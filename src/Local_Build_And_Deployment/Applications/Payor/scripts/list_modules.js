// ============================================================
// list_modules.js — List all deployable payor modules.
//
// A module is included when it has BOTH:
//   - a pom.xml  (it is a Maven module)
//   - a target/<name>-*.jar  excluding -sources / -tests jars
//
// Modules whose target/ has no jar yet are listed separately
// so you know they need to be built first.
//
// USAGE:  node scripts/list_modules.js [--all]
//   --all   also show non-module dirs (no pom.xml)
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { resolveSrcDir } = require('./jar_resolver');

function findJar(moduleName, moduleDir) {
  const targetDir = path.join(moduleDir, 'target');
  if (!fs.existsSync(targetDir)) return null;
  const jars = fs.readdirSync(targetDir).filter(f => {
    if (!f.endsWith('.jar')) return false;
    if (f.includes('-sources') || f.includes('-tests')) return false;
    return f.startsWith(moduleName + '-') || f === moduleName + '.jar';
  });
  return jars.find(f => f.includes('SNAPSHOT')) || jars[0] || null;
}

function stripVersion(jarName) {
  return path.basename(jarName, '.jar').replace(/-\d.*$/, '') + '.jar';
}

function main() {
  const showAll = process.argv.includes('--all');

  const { srcdir, source } = resolveSrcDir();
  console.log(`\nPayor repo : ${srcdir}`);
  console.log(`Source     : ${source}\n`);

  const entries = fs.readdirSync(srcdir)
    .filter(name => fs.statSync(path.join(srcdir, name)).isDirectory())
    .sort();

  const ready   = [];   // has pom.xml + jar in target/
  const noJar   = [];   // has pom.xml but no jar yet (needs build)
  const nonMvn  = [];   // no pom.xml

  for (const name of entries) {
    const moduleDir = path.join(srcdir, name);
    const hasPom    = fs.existsSync(path.join(moduleDir, 'pom.xml'));

    if (!hasPom) {
      nonMvn.push(name);
      continue;
    }

    const jar = findJar(name, moduleDir);
    if (jar) {
      ready.push({ name, jar, deployAs: stripVersion(jar) });
    } else {
      noJar.push(name);
    }
  }

  // ── Ready to deploy ───────────────────────────────────────
  console.log(`${'─'.repeat(70)}`);
  console.log(` READY TO DEPLOY  (${ready.length} modules)`);
  console.log(`${'─'.repeat(70)}`);
  const col = Math.max(...ready.map(m => m.name.length), 8);
  console.log(`  ${'Module'.padEnd(col)}   Jar in target/                      Deploys as`);
  console.log(`  ${'─'.repeat(col)}   ${'─'.repeat(35)} ${'─'.repeat(20)}`);
  for (const { name, jar, deployAs } of ready) {
    console.log(`  ${name.padEnd(col)}   ${jar.padEnd(35)} ${deployAs}`);
  }

  // ── Needs build ───────────────────────────────────────────
  console.log(`\n${'─'.repeat(70)}`);
  console.log(` NEEDS BUILD FIRST  (${noJar.length} modules — no jar in target/)`);
  console.log(`${'─'.repeat(70)}`);
  for (const name of noJar) {
    console.log(`  ${name}`);
  }

  // ── Non-Maven dirs ────────────────────────────────────────
  if (showAll) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(` NON-MAVEN DIRECTORIES  (${nonMvn.length} — no pom.xml, not deployable)`);
    console.log(`${'─'.repeat(70)}`);
    for (const name of nonMvn) {
      console.log(`  ${name}`);
    }
  }

  console.log(`\nTo deploy:  node scripts/deploy_jar.js <module-name>\n`);
}

main();
