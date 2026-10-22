// Phase 4 of collab/README.md, the branch underneath: a shared project saves
// to ONE draft branch for the whole room, a Save by anyone resets everyone's
// "unsaved changes", and a commit that lands on that branch OUTSIDE the
// session is noticed before Save can overwrite it.
//
// Hosted mode against the in-memory FakeGitHub — one instance for both
// editors, so what A commits is what B's next Save is measured against — and
// a real `wrangler dev` relay booted here on a port of its own, claimed in
// beforeAll (PRIMER_DRAFTS_PORT, else the first free one from 8793 —
// fixtures/ports.js). A hosted
// editor ignores `?collab=` by design, so the relay is named the way a real
// project names it: through the manifest, via a route that adds `collab` to
// engine/manifest.json. Contexts are built by hand rather than through the
// hostedTest fixture (which makes a fresh FakeGitHub per test) so the two
// editors and the branch persist across the tests below, which run in order.
const { test, expect, gotoEditor, PING, EVENTS } = require('./fixtures/editor-test');
const { FakeGitHub } = require('./fixtures/fake-github');
const { claimPort } = require('./fixtures/ports');

let RELAY_PORT = 0;                    // claimed in beforeAll
const EDITOR_PORT = process.env.PRIMER_TEST_PORT || 8199;
const SLOT = 'whopays.p1';
const BRANCH = 'draft/budget-primer';
const CONTENT = 'report2027/content.md';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let relay = null;
const github = new FakeGitHub();
let ctxA, ctxB, a, b;

const status = page => page.evaluate('docsync.api.status().collab');
const slot = page => page.evaluate(`readSlot(${JSON.stringify(SLOT)})`);
const setSlot = (page, text) => page.evaluate(`docsync.api.setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(text)})`);

async function waitLive(page) {
  await expect.poll(async () => {
    const s = await status(page);
    if (s.status === 'error') throw new Error('collab error: ' + s.error);
    return s.status;
  }, { timeout: 60_000, message: 'the editor never joined the room' }).toBe('live');
}

/** A hosted editor (no local server), on the shared fake GitHub, signed in
 *  as `login` — the relay accepts a `dev:<login>` token under its development
 *  secret, and the fake does not look at the token at all. */
async function open(browser, login) {
  const ctx = await browser.newContext();
  await ctx.route(PING, route => route.fulfill({ status: 404, body: 'no local server' }));
  await ctx.route(EVENTS, route => route.fulfill({ status: 404, body: 'no local server' }));
  await github.install(ctx);
  await ctx.route(/\/engine\/manifest\.json(\?|$)/, async route => {
    const m = await (await route.fetch()).json();
    m.collab = { url: `http://127.0.0.1:${RELAY_PORT}` };
    await route.fulfill({ json: m });
  });
  await ctx.addInitScript(l => { window.localStorage.setItem('docsync-pat', 'dev:' + l); }, login);
  const page = await ctx.newPage();
  await gotoEditor(page);
  await waitLive(page);
  return { ctx, page };
}

/** Click Save and answer its dialogs: any confirm on the way (the print-fit
 *  warning) is accepted; the moved-branch one gets `choice`. Returns that
 *  dialog's text, or null if it never appeared. The editor reuses ONE
 *  <dialog> element, so "answered" means its text changed or it hid — a
 *  wait for hidden alone can miss the next confirm opening in its place. */
async function save(page, choice) {
  await expect(page.locator('#save')).toBeEnabled();
  await page.click('#save');
  const d = page.locator('dialog.dsdlg');
  const answer = async (btn, text) => {
    await d.locator(btn).click();
    await expect.poll(async () => (await d.isVisible()) ? await d.textContent() : null).not.toBe(text);
  };
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await d.waitFor({ state: 'visible', timeout: 2000 }); } catch (e) { return null; }
    const text = await d.textContent();
    if (text.includes('changed outside this session')) {
      await answer(choice === 'cancel' ? '.dsdlg-cancel' : '.dsdlg-ok', text);
      return text;
    }
    await answer('.dsdlg-ok', text);
  }
  return null;
}

test.beforeAll(async ({ browser }) => {
  RELAY_PORT = await claimPort('drafts', 8793, { span: [0, 1000] });
  const { startDev } = await import('../../collab/devserver.mjs');
  relay = await startDev({
    port: RELAY_PORT,
    vars: { ALLOWED_ORIGINS: `http://localhost:${EDITOR_PORT},http://127.0.0.1:${EDITOR_PORT}` },
  });
  ({ ctx: ctxA, page: a } = await open(browser, 'ada'));
  ({ ctx: ctxB, page: b } = await open(browser, 'grace'));
});

test.afterAll(async () => {
  for (const c of [ctxA, ctxB]) { try { await c.close(); } catch (e) { /* gone */ } }
  if (relay) await relay.stop();
});

test('the room knows the commit it was built from', async () => {
  expect((await status(a)).peers).toBe(2);
  // The seeding editor read the deploy branch's tip; the adopting one took it from the room.
  expect((await status(a)).baseSha).toBe(github.refs.get('main'));
  expect((await status(b)).baseSha).toBe(github.refs.get('main'));
  expect((await status(a)).branch).toBe(null);      // no shared draft exists yet
});

test('a Save goes to the one shared draft branch, and everyone in the room sees the document as saved', async () => {
  const text = 'Saved by Ada at ' + Date.now() + '.';
  await setSlot(a, text);
  await expect.poll(() => slot(b), { timeout: 20_000 }).toBe(text);
  await expect(b.locator('#save')).toBeEnabled();     // B: unsaved changes — the room moved
  expect(await save(a)).toBe(null);                     // nothing to warn about
  await expect(a.locator('#stat')).toContainText('draft saved', { timeout: 15_000 });

  expect(github.refs.has(BRANCH)).toBe(true);
  expect(github.refs.has('draft/budget-primer/test-user')).toBe(false);   // not a per-user draft
  expect(github.contents.get(`${BRANCH}:${CONTENT}`)).toContain(text);
  await expect(a.locator('#title')).toContainText('shared draft');
  expect((await status(a)).baseSha).toBe(github.refs.get(BRANCH));
  expect((await status(a)).branch).toBe(BRANCH);

  // B saved nothing, but the document B is looking at is on the branch now.
  await expect.poll(async () => (await status(b)).baseSha, { timeout: 10_000 }).toBe(github.refs.get(BRANCH));
  await expect(b.locator('#save')).toBeDisabled();
  await expect(b.locator('#title')).toContainText('shared draft');
  await expect(b.locator('#stat')).toContainText('a collaborator saved');
  expect((await status(b)).branch).toBe(BRANCH);
});

test('a commit that lands on the shared branch outside the session stops Save until someone decides', async () => {
  // A push from a laptop: a new commit on top of the branch, changing the file.
  const before = github.refs.get(BRANCH);
  const outside = github.commit(BRANCH, {
    [CONTENT]: github.contents.get(`${BRANCH}:${CONTENT}`) + '\n<!-- pushed from a laptop -->\n',
  });
  expect(outside).not.toBe(before);

  await setSlot(b, 'Grace edits after the outside push.');
  const warned = await save(b, 'cancel');
  expect(warned).toContain('changed outside this session');
  expect(warned).toContain(outside.slice(0, 7));
  expect(warned).toContain(before.slice(0, 7));
  await expect(b.locator('#stat')).toContainText('not saved');
  expect(github.refs.get(BRANCH)).toBe(outside);        // untouched
  await expect(b.locator('#save')).toBeEnabled();

  // Asked again, this time it is a decision: save over it.
  expect(await save(b, 'over')).toContain('changed outside this session');
  await expect(b.locator('#stat')).toContainText('draft saved', { timeout: 15_000 });
  const saved = github.refs.get(BRANCH);
  expect(saved).not.toBe(outside);
  expect(github.commits.get(saved).parents).toEqual([outside]);   // on top of it, not beside it
  const committed = github.contents.get(`${BRANCH}:${CONTENT}`);
  expect(committed).toContain('Grace edits after the outside push.');
  expect(committed).not.toContain('pushed from a laptop');         // the room's copy won, as it said it would
  // And the room now measures against this commit — A included.
  await expect.poll(async () => (await status(a)).baseSha, { timeout: 10_000 }).toBe(saved);
  await expect(a.locator('#save')).toBeDisabled();      // A has nothing unsaved: B's Save was A's too
  await expect(a.locator('#stat')).toContainText('a collaborator saved');
});
