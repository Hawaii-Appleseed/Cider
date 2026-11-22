// The headless editor (measure/server.mjs): the hub's connector laying out a
// report NOBODY has open. Before it, arrange_report, check_report and
// read_report's page map refused whenever the room was empty, because only an
// editor measures a page. This runs the whole loop the way production does:
// a `wrangler pages dev` hub (this tree's editor vendored into a copy of it),
// the relay holding its rooms, and the measurer, which the hub reaches at
// MEASURER_URL and which fetches every file back through the hub's door
// (GET /api/mcp?door=…). The connector is called as a person's Claude would
// call it, with a bearer token, and nobody ever opens a tab.
//
// What must hold: the change is applied by the editor (hubPilot), measured on
// the page it rendered (layout.new names the overlap this edit made), saved
// to the store as the person, and nothing is invented when the measurer is
// not there. A report made with new_report a moment ago, never opened, lays
// out the same way (its engine comes through the door's /primer/_hub/).
//
// Needs the hub checked out beside this repo, like collab-hub.spec.js (and
// run in the same CI job). affected-by: measure/** collab/hub-check.mjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('./fixtures/editor-test');
const { claimPort } = require('./fixtures/ports');

const REPO = path.resolve(__dirname, '../..');
const HUB_GIVEN = process.env.PRIMER_HUB_DIR || null;
const HUB_REF = process.env.PRIMER_HUB_REF || 'origin/main';
const HUB_SRC = HUB_GIVEN || path.resolve(REPO, '../staff-updates-internal');
const SECRET = 'measure-spec-secret';
const ME = 'ada@hiappleseed.org';
const PROJECT = 'demo-report';
const ROOM = `Hawaii-Appleseed~Cider~${PROJECT}`;

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);
test.skip(!fs.existsSync(path.join(HUB_SRC, 'functions/api/collab')),
  `needs the staff hub checked out at ${HUB_SRC} (PRIMER_HUB_DIR points elsewhere)`);

let relay = null, pages = null, measurer = null, HUB = '', HUB_DIR = HUB_GIVEN, token = '';

/** The hub's files at HUB_REF (or the folder as it is, for `worktree`), in
 *  a temporary directory: vendoring rewrites primer/** and must never do it
 *  in a checkout somebody works in. */
function copyHub(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-hub-'));
  if (HUB_REF === 'worktree') {
    const files = execFileSync('git', ['-C', src, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean);
    for (const rel of files) {
      const from = path.join(src, rel);
      if (!fs.statSync(from, { throwIfNoEntry: false })?.isFile()) continue;
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.copyFileSync(from, path.join(dir, rel));
    }
    return dir;
  }
  const remote = /^origin\/(.+)$/.exec(HUB_REF);
  if (remote) { try { execFileSync('git', ['-C', src, 'fetch', '-q', 'origin', remote[1]], { stdio: 'ignore', timeout: 60_000 }); } catch (e) { /* offline: last fetched */ } }
  const tar = dir + '.tar';
  execFileSync('git', ['-C', src, 'archive', '--format=tar', '-o', tar, HUB_REF]);
  execFileSync('tar', ['-x', '-f', tar, '-C', dir]);
  fs.rmSync(tar, { force: true });
  return dir;
}

async function call(name, args) {
  const r = await fetch(`${HUB}/api/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json();
  if (!j.result) throw new Error(`${name}: ${JSON.stringify(j)}`);
  return j.result.structuredContent;
}
/** A store read, as Access would stamp a person (locally the header is forgeable). */
const store = (room, sub) => fetch(`${HUB}/api/docs/${room}${sub ? '/' + sub : ''}`, { headers: { 'cf-access-authenticated-user-email': ME } });

test.beforeAll(async () => {
  const RELAY_PORT = await claimPort('measure-relay', 8834, { span: [0, 1000] });
  const HUB_PORT = await claimPort('measure-hub', 8838, { span: [0, 1000] });
  const M_PORT = await claimPort('measure-server', 8842, { span: [0, 1000] });
  HUB = `http://127.0.0.1:${HUB_PORT}`;
  if (!HUB_GIVEN) HUB_DIR = copyHub(HUB_SRC);
  // Without the door (a hub from before it), there is nothing to test here.
  test.skip(!/doorGet/.test(fs.readFileSync(path.join(HUB_DIR, 'functions/api/mcp.js'), 'utf8')),
    `the hub at ${HUB_REF} has no door for the headless editor yet`);
  execFileSync('python3', ['-m', 'docsync.hub', '--into', HUB_DIR, '--no-live-check'], { cwd: REPO, stdio: 'inherit' });
  // Its own cache: nothing a previous run (or the Mac mini's service) kept.
  process.env.MEASURE_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-cache-'));
  const { createServer } = await import('../../measure/server.mjs');
  const server = createServer({ allowed: [HUB] });
  await new Promise(res => server.listen(M_PORT, '127.0.0.1', res));
  measurer = server;
  const { startDev } = await import('../../collab/devserver.mjs');
  const { startPages } = await import('../../collab/hub-check.mjs');
  const relayName = `primer-collab-measure-${RELAY_PORT}`;
  relay = await startDev({ port: RELAY_PORT, name: relayName });
  pages = await startPages({ port: HUB_PORT, hubDir: HUB_DIR, relayName,
                             vars: { MCP_TOKEN_SECRET: SECRET, MEASURER_URL: `http://127.0.0.1:${M_PORT}` } });
  const { sign } = await import(path.join(HUB_DIR, 'assets/mcpauth.js'));
  token = await sign(SECRET, 't', { sub: ME, cid: 'measure-spec', exp: Math.floor(Date.now() / 1000) + 3600 });
});

test.afterAll(async () => {
  if (measurer) await new Promise(res => measurer.close(res));
  if (pages) await pages.stop();
  if (relay) await relay.stop();
  if (!HUB_GIVEN && HUB_DIR) fs.rmSync(HUB_DIR, { recursive: true, force: true, maxRetries: 3 });
});

test('nobody has it open: read_report measure:true lays the page out headless', async () => {
  const r = await call('read_report', { id: PROJECT, measure: true });
  expect(r.open_now).toBe(0);
  expect(r.measured && r.measured.by).toBe('headless editor');
  expect(r.pages.length).toBeGreaterThan(0);
  expect(r.pages.flatMap(p => p.elements).length).toBeGreaterThan(0);
  expect(r.slots.some(s => s.where && s.where.page)).toBe(true);
});

test('arrange_report with nobody in: applied by the editor, measured, saved as the person', async () => {
  const before = await call('read_report', { id: PROJECT, measure: true });
  const page1 = before.pages[0];
  const target = page1.elements.find(e => e.box && e.box.w > 1 && e.box.h > 0.3);
  // A box laid right over another one: the editor must name the overlap.
  const box = { page: Number(page1.id) || 1, x: target.box.x, y: target.box.y, w: Math.max(2, target.box.w), md: 'Laid over by the headless editor.' };
  const out = await call('arrange_report', { id: PROJECT, ops: [{ verb: 'addTextBox', args: [box], as: 'note' }], note: 'A box over a box.' });
  expect(out.applied, JSON.stringify(out)).toBe('saved to the hub');
  expect(out.via).toBe('headless editor');
  expect(out.by).toBe(ME);
  expect(out.layout && out.layout.new.some(i => i.kind === 'overlap' || i.kind === 'covers-flow'), JSON.stringify(out.layout)).toBe(true);
  expect(out.note).toMatch(/layout\.new/);
  expect(out.saved).toContain('layout');
  // The store has it, as this person, labelled with the note.
  const meta = await (await store(ROOM)).json();
  expect(meta.updated_by).toBe(ME);
  const layout = await (await store(ROOM, 'layout')).text();
  expect(layout).toContain('Laid over by the headless editor.');
  // And the next headless read sees it: the store is what the editor opens on.
  const after = await call('read_report', { id: PROJECT, measure: true });
  expect(after.pages.flatMap(p => p.elements).length).toBe(before.pages.flatMap(p => p.elements).length + 1);
});

test('check_report with nobody in answers from the headless editor', async () => {
  const r = await call('check_report', { id: PROJECT, checks: ['preflight'] });
  expect(r.checked, JSON.stringify(r)).toBe(true);
  expect(r.by).toBe('headless editor');
  expect(Array.isArray(r.checks.preflight.issues)).toBe(true);
});

test('a report made a moment ago, never opened, lays out headless too', async () => {
  const made = await call('new_report', { name: 'zz measure spec ' + Date.now(), from: 'blank-document' });
  expect(made.id, JSON.stringify(made)).toBeTruthy();
  const out = await call('arrange_report', { id: made.id, ops: [{ verb: 'addTextBox', args: [{ page: 1, x: 1, y: 1, w: 4, md: 'First words on a new report.' }] }] });
  expect(out.applied, JSON.stringify(out)).toBe('saved to the hub');
  expect(out.layout && out.layout.new).toEqual([]);
  const r = await call('read_report', { id: made.id, measure: true });
  expect(r.pages[0].elements.some(e => /First words/.test(e.text || ''))).toBe(true);
});

test('a forged job does nothing: the hub refuses its door', async () => {
  const r = await fetch(`http://127.0.0.1:${measurer.address().port}/measure`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, origin: HUB, door: 'd.' + 'x'.repeat(40) + '.y', project: PROJECT, room: ROOM, mode: 'ask', asks: ['inventory'] }),
  });
  const j = await r.json();
  expect(j.ok).toBe(false);
  expect(j.door).toBe(401);
  // And a hub it was not told about is not opened at all.
  const far = await fetch(`http://127.0.0.1:${measurer.address().port}/measure`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, origin: 'https://evil.test', door: 'd.' + 'x'.repeat(40) + '.y', project: PROJECT, room: ROOM, mode: 'ask', asks: ['inventory'] }),
  });
  expect(far.status).toBe(400);
});
