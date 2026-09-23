// File ▸ Connect GitHub against a LOCAL server: the device flow runs through
// serve.py's /__oauth proxy (no relay worker), and the winning token lands ON
// THE SERVER — the party that actually pushes in local mode. GitHub itself is
// a stand-in here: playwright.config points the server's PRIMER_GH_BASE/API
// at the mock this file runs, so the whole loop is exercised without network.
const { warmTest: test, expect } = require('./fixtures/editor-test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const TOKEN_FILE = path.join(REPO, '.primer-github-token');
const GH_PORT = 8390;

// The three GitHub endpoints the flow touches. Pending twice, then a token —
// so the panel's polling loop is really exercised, not just its happy exit.
let polls;
function makeMock() {
  polls = 0;
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const send = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url === '/login/device/code') {
        const j = JSON.parse(body || '{}');
        if (j.client_id !== 'Iv23TESTCLIENT') return send({ error: 'wrong_client' });
        return send({ device_code: 'dev123', user_code: 'ABCD-1234',
                      verification_uri: 'https://github.com/login/device',
                      interval: 1, expires_in: 300 });
      }
      if (req.url === '/login/oauth/access_token') {
        polls += 1;
        if (polls < 3) return send({ error: 'authorization_pending' });
        return send({ access_token: 'ghs_SPEC_TOKEN', token_type: 'bearer' });
      }
      if (req.url === '/user') return send({ login: 'spec-user' });
      res.statusCode = 404; res.end('{}');
    });
  });
}

let mock;

// One worker, in order: these tests share a socket (the GitHub stand-in) or
// on-disk state their before/after hooks snapshot and restore — fullyParallel
// would run each test's hooks in its OWN worker, and the second worker's
// setup/teardown lands mid-flight under the first (EADDRINUSE on the mock,
// a registry restored while the other test is still writing it).
test.describe.configure({ mode: 'serial' });

test.describe('connect github', () => {
  test.beforeAll(async () => {
    mock = makeMock();
    await new Promise(r => mock.listen(GH_PORT, r));
  });
  test.afterAll(async () => {
    await new Promise(r => mock.close(r));
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  });
  test.beforeEach(() => {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  });

  test('the whole loop: code shown, poll survives pending, server keeps the token',
    async ({ page }) => {
      const { gotoEditor } = require('./fixtures/editor-test');
      await gotoEditor(page);
      await page.click('#file');
      await expect(page.locator('#file-ghconn')).toBeVisible();
      await page.click('#file-ghconn');

      // The sign-in panel, with the code the mock issued.
      await expect(page.locator('#authpanel')).toBeVisible();
      await expect(page.locator('#authpanel .au-code')).toHaveText('ABCD-1234', { timeout: 5000 });

      // Two pendings then a token: give the poller room to get there.
      await expect(page.locator('#authpanel')).toBeHidden({ timeout: 15000 });
      expect(polls).toBeGreaterThanOrEqual(3);

      // The row now names the account, and the SERVER holds the credential —
      // the file _push authenticates https pushes with.
      await expect(page.locator('#file-ghconn')).toHaveText('GitHub: spec-user');
      await expect(page.locator('#stat')).toContainText('connected as spec-user');
      const kept = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      expect(kept).toEqual({ token: 'ghs_SPEC_TOKEN', login: 'spec-user' });
      expect((fs.statSync(TOKEN_FILE).mode & 0o777)).toBe(0o600);

      // And a fresh editor learns the state from the server, not localStorage.
      const status = await page.evaluate(() =>
        fetch('/__oauth/status').then(r => r.json()));
      expect(status.connected).toBe(true);
      expect(status.login).toBe('spec-user');
    });

  test('a pasted token takes the same path to the server', async ({ page }) => {
    const { gotoEditor } = require('./fixtures/editor-test');
    await gotoEditor(page);
    const login = await page.evaluate(async () => {
      const j = await fetch('/__oauth/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'ghp_PASTED' }) }).then(r => r.json());
      return j.ok ? j.login : j.error;
    });
    expect(login).toBe('spec-user');
    expect(fs.existsSync(TOKEN_FILE)).toBe(true);
  });

  test('garbage is refused and nothing is stored', async ({ page }) => {
    const { gotoEditor } = require('./fixtures/editor-test');
    await gotoEditor(page);
    const out = await page.evaluate(async () =>
      fetch('/__oauth/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '' }) }).then(r => r.json()));
    expect(out.ok).toBe(false);
    expect(fs.existsSync(TOKEN_FILE)).toBe(false);
  });
});
