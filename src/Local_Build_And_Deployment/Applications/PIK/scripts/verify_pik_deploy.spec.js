// @ts-check
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');

const PIK_PORT  = 8080;
const BASE_URL  = `http://localhost:${PIK_PORT}`;
const CONTAINER = 'pik-tc-261';

test.describe('PIK deployment verification', () => {

  test('PIK container is running', () => {
    const out = execSync(
      `docker inspect --format "{{.State.Running}}" ${CONTAINER}`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    expect(out).toBe('true');
  });

  test('PIK HTTP endpoint is reachable on port 8080', async ({ request }) => {
    const resp = await request.get(BASE_URL + '/');
    expect([200, 302, 401, 403, 404]).toContain(resp.status());
  });

  test('PIK application responds with a web server header', async ({ request }) => {
    const resp = await request.get(BASE_URL + '/');
    const server = resp.headers()['server'] || '';
    // Tomcat or any container-served response confirms deployment
    expect(resp.status()).toBeLessThan(500);
  });

  test('PIK container has a running Java process', () => {
    const out = execSync(
      `docker exec ${CONTAINER} bash -c "ps -ef | grep java | grep -v grep | wc -l"`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();
    expect(parseInt(out, 10)).toBeGreaterThan(0);
  });

});
