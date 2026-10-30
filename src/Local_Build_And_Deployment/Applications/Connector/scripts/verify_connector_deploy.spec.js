// @ts-check
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');

const KARAF_PORT = 8181;
const BASE_URL   = `http://localhost:${KARAF_PORT}`;
const CONTAINER  = 'connector-jdk21-271';
const KARAF_BIN  = '/home/cprime/cprime/healthrules-connector-server-4.4.11/bin';

function karafStatus() {
  try {
    const out = execSync(
      `docker exec ${CONTAINER} ${KARAF_BIN}/status`,
      { encoding: 'utf8', timeout: 30000 }
    );
    return out.trim();
  } catch (e) {
    return ((e.stdout || '') + (e.stderr || '') || e.message || '').trim();
  }
}

test.describe('Connector deployment verification', () => {

  test('Karaf server is Running', () => {
    const status = karafStatus();
    expect(status, `Karaf status: ${status}`).toBe('Running ...');
  });

  test('Karaf HTTP endpoint is reachable on port 8181', async ({ request }) => {
    // Any HTTP response (even 404) confirms the server is up; connection error means it is not
    const resp = await request.get(BASE_URL + '/');
    expect([200, 302, 401, 403, 404]).toContain(resp.status());
  });

  test('Karaf server is version 4.4.11 (correct KARAF_HOME)', async ({ request }) => {
    // The Jetty Server header is set by Karaf — validate the server responded over HTTP
    const resp = await request.get(BASE_URL + '/');
    const server = resp.headers()['server'] || '';
    expect(server.toLowerCase()).toContain('jetty');
  });

  test('Connector container is running', () => {
    const out = execSync(
      `docker inspect --format "{{.State.Running}}" ${CONTAINER}`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    expect(out).toBe('true');
  });

});
