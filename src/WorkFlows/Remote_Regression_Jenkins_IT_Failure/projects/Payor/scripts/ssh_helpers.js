// ssh_helpers.js — promise-based SSH/SCP helpers using the ssh2 package.
// Replaces sshpass (Linux-only) with a pure-Node solution that works on Windows.

'use strict';

const fs   = require('fs');
const path = require('path');
const cfg  = require('./config');

function nm(pkg) {
  return require(path.join(cfg.paths.nodeModules, pkg));
}

const { Client } = nm('ssh2');

function connectOptions() {
  const opts = {
    host:           cfg.remote.host,
    port:           22,
    username:       cfg.remote.user,
    readyTimeout:   30000,
    keepaliveInterval: 10000,
  };
  if (cfg.remote.auth === 'key' && cfg.remote.sshKey) {
    opts.privateKey = fs.readFileSync(cfg.remote.sshKey);
  } else {
    opts.password = cfg.remote.password;
  }
  return opts;
}

// Execute a single command; returns stdout as a string.
function sshExec(cmd, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      conn.destroy();
      reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${cmd.slice(0, 80)}`));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on('data', d => { output += d; });
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          clearTimeout(timer);
          conn.end();
          if (!timedOut) resolve(output);
        });
      });
    })
    .on('error', err => { clearTimeout(timer); if (!timedOut) reject(err); })
    .connect(connectOptions());
  });
}

// Upload a local file to a remote path via SFTP.
function scpTo(localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        sftp.fastPut(localPath, remotePath, err2 => {
          conn.end();
          if (err2) reject(err2); else resolve();
        });
      });
    })
    .on('error', reject)
    .connect(connectOptions());
  });
}

// Download a remote file to a local path via SFTP.
function scpFrom(remotePath, localPath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        sftp.fastGet(remotePath, localPath, err2 => {
          conn.end();
          if (err2) reject(err2); else resolve();
        });
      });
    })
    .on('error', reject)
    .connect(connectOptions());
  });
}

module.exports = { sshExec, scpTo, scpFrom };
