// docker_helpers.js — Helpers to run commands inside a local docker container.
// Uses `docker exec` so no SSH is needed; the container must be running.

'use strict';

const { execSync, spawnSync } = require('child_process');
const cfg = require('./config');

// Run a command inside the docker container.
// Returns stdout as a string. Throws on non-zero exit.
function dockerExec(cmd, opts = {}) {
  const { timeoutMs = 60000, input, throwOnError = true } = opts;
  const container = cfg.docker.containerName;
  const user      = cfg.docker.user;

  // Build: docker exec -u <user> <container> sh -c "<cmd>"
  // We use sh -c to handle pipes, env vars, etc.
  const args = ['exec', '-u', user, container, 'sh', '-c', cmd];

  const result = spawnSync('docker', args, {
    timeout: timeoutMs,
    input,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`docker exec failed: ${result.error.message}`);
  }

  if (throwOnError && result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(
      `docker exec exited ${result.status}\nCMD: ${cmd}\nSTDERR: ${stderr}\nSTDOUT: ${stdout}`
    );
  }

  return (result.stdout || '').trim();
}

// Copy a file from Windows host into the container via docker cp.
// localPath  — absolute Windows path  (e.g. C:/Users/<user>/shared/core-cvc.jar)
// remotePath — absolute path inside container (e.g. /home/weblogic/domains/healthedge/jars/core-cvc.jar)
function dockerCp(localPath, remotePath) {
  const container = cfg.docker.containerName;
  // docker cp <localPath> <container>:<remotePath>
  const result = spawnSync('docker', ['cp', localPath, `${container}:${remotePath}`], {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.error) throw new Error(`docker cp failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`docker cp exited ${result.status}\n${result.stderr}`);
  }
}

// Check that the container is running. Throws if not.
function assertContainerRunning() {
  const container = cfg.docker.containerName;
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot inspect docker container "${container}". Is docker running?`);
  }
  const running = (result.stdout || '').trim();
  if (running !== 'true') {
    throw new Error(`Docker container "${container}" is not running (State.Running = ${running}).`);
  }
}

module.exports = { dockerExec, dockerCp, assertContainerRunning };
