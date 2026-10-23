// What a person sees when a local Save or Push goes wrong, and whether the
// editor recovers with every word it had. Found by the 2026-10-22 second
// audit pass (WEAK-POINTS-2026-10-22.md, items 1–5). Each test fails on the
// editor before its fix.
//
// /__ping is pinned per test (see save-push.spec.js for why: the real
// server's 1.5s poll would otherwise race the scenario); /__save and
// /__push are routed per test to the failure under study.
const { test, expect, gotoEditor, PING, submitDialogIfPresent } = require('./fixtures/editor-test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SAVE = /\/__save(\?|$)/, PUSH = /\/__push(\?|$)/, EVENTS = /\/__events(\?|$)/;

// The pinned ping answers for the server, so it must answer what the server
// WOULD now: the poll lands every 1.5s, and a fixed `ahead` overwrote a Save's
// "2 ahead" (or a test's own setPushState) with the stale number it started
// with - "Push (1)" for "Push (2)", a Push button that went disabled under a
// click. Tests that change the server's count change it here.
const serverAhead = new WeakMap();
const setAhead = (context, n) => serverAhead.set(context, n);
async function go(page, context, ahead = 0) {
  setAhead(context, ahead);
  await context.route(PING, route => route.fulfill({ json: { ok: true, v: 1, ahead: serverAhead.get(context) } }));
  await gotoEditor(page);
}
/** Type something (a new paragraph at the end), as the pilot would. */
const dirtyIt = page => page.evaluate(() => { source = original + '\nWords before Save.\n'; markDirty(); });
/** Press Save and answer the "pages cut off" confirm the fixture report
 *  raises (budget-primer overflows two pages by design). */
async function pressSave(page) {
  page.click('#save').catch(() => {});
  await submitDialogIfPresent(page, 1500);
}
const state = page => page.evaluate(() => ({
  stat: $('stat').textContent, dirty, srcIsOrig: source === original,
  saveDisabled: $('save').disabled, pushDisabled: $('push').disabled,
  tail: source.slice(-60),
}));

test.describe('a slow Save', () => {
  test('words typed while it is in flight stay unsaved, not marked saved', async ({ page, context }) => {
    await go(page, context);
    await context.route(SAVE, async r => {
      await new Promise(res => setTimeout(res, 1500));
      setAhead(context, 1);
      r.fulfill({ json: { ok: true, ahead: 1, message: 'saved locally' } });
    });
    await dirtyIt(page);
    await pressSave(page);
    await expect(page.locator('#stat')).toHaveText('saving to disk…');
    // ...and the person keeps typing.
    await page.evaluate(() => { source = source + 'Words typed during the save.\n'; markDirty(); });
    await expect(page.locator('#stat')).toHaveText('saved locally', { timeout: 5000 });
    const s = await state(page);
    expect(s.tail).toContain('Words typed during the save.');
    expect(s.dirty).toBe(true);               // the late words are still unsaved
    expect(s.saveDisabled).toBe(false);       // and Save is there to take them
    // The baseline moved to exactly what was sent, so a second Save sends only
    // the late words — never "already up to date" over words that never left.
    expect(await page.evaluate(() => original.endsWith('Words before Save.\n'))).toBe(true);
  });

  test('Push waits for it: nothing is pushed under a commit that has not landed', async ({ page, context }) => {
    await go(page, context, 1);
    const calls = [];
    await context.route(SAVE, async r => {
      calls.push('save');
      await new Promise(res => setTimeout(res, 1500));
      setAhead(context, 2);
      r.fulfill({ json: { ok: true, ahead: 2, message: 'saved locally' } });
    });
    await context.route(PUSH, r => { calls.push('push'); r.fulfill({ json: { ok: true, ahead: 0, message: 'pushed' } }); });
    await dirtyIt(page);
    await pressSave(page);
    await expect(page.locator('#stat')).toHaveText('saving to disk…');
    await expect(page.locator('#push')).toBeDisabled();
    // Typing meanwhile must not re-enable either button through markDirty.
    await page.evaluate(() => { source = source + 'More.\n'; markDirty(); });
    expect(await page.evaluate(() => $('save').disabled && $('push').disabled)).toBe(true);
    // A press anyway (keyboard, script) is refused, not queued behind the save.
    await page.evaluate(() => $('push').onclick());
    expect(calls).toEqual(['save']);
    await expect(page.locator('#stat')).toHaveText('saved locally', { timeout: 5000 });
    await expect(page.locator('#push')).toBeEnabled();     // 2 ahead now
    await expect(page.locator('#push')).toHaveText('Push (2)');
  });
});

test.describe('a server that answers wrongly, or not at all', () => {
  test('a crash page (500, HTML) is named as the server\'s error, with the words kept', async ({ page, context }) => {
    await go(page, context);
    await context.route(SAVE, r => r.fulfill({ status: 500, contentType: 'text/html', body: '<h1>Internal Server Error</h1>' }));
    await dirtyIt(page);
    await pressSave(page);
    const stat = page.locator('#stat');
    await expect(stat).toContainText('save failed');
    await expect(stat).toContainText('hit an error (500)');
    await expect(stat).not.toContainText('JSON');           // never a parser's words
    await expect(stat).toContainText('words are still here');
    const s = await state(page);
    expect(s.dirty).toBe(true);
    expect(s.tail).toContain('Words before Save.');
    expect(s.saveDisabled).toBe(false);
  });

  test('a connection nobody answers says the server is gone, not "Failed to fetch"', async ({ page, context }) => {
    await go(page, context);
    await context.route(SAVE, r => r.abort('connectionrefused'));
    await dirtyIt(page);
    await pressSave(page);
    const stat = page.locator('#stat');
    await expect(stat).toContainText('not answering');
    await expect(stat).toContainText('Relaunch the editor app');
    await expect(stat).not.toContainText('Failed to fetch');
    expect((await state(page)).dirty).toBe(true);
    // Push too.
    await context.route(PUSH, r => r.abort('connectionrefused'));
    setAhead(context, 1);
    await page.evaluate(() => setPushState(1));
    await page.click('#push');
    await expect(stat).toContainText('push failed');
    await expect(stat).toContainText('not answering');
    await expect(page.locator('#push')).toBeEnabled();
  });

  test('a server that stops answering is said while idle, and stood down when it is back', async ({ page, context }) => {
    await go(page, context);
    await expect(page.locator('#stat')).toContainText('live');
    // The server goes away: every poll and the stream are refused.
    await context.unroute(PING);
    await context.route(PING, r => r.abort('connectionrefused'));
    await context.route(EVENTS, r => r.abort('connectionrefused'));
    const stat = page.locator('#stat');
    // Three missed 2s polls, then it says so — before anyone presses Save.
    await expect(stat).toContainText('not answering', { timeout: 12000 });
    await expect(stat).toHaveClass(/err/);
    await expect(stat).toHaveAttribute('title', /Nothing on disk changed/);
    // Editing is unaffected meanwhile.
    await dirtyIt(page);
    expect((await state(page)).saveDisabled).toBe(false);
    // It comes back (a relaunch).
    await context.unroute(PING);
    await context.route(PING, route => route.fulfill({ json: { ok: true, v: 1, ahead: 0 } }));
    await expect(stat).not.toContainText('not answering', { timeout: 6000 });
    await expect(stat).not.toHaveClass(/err/);
  });
});

test.describe('the disk holding exactly the unsaved words', () => {
  test('is not read as "Claude changed the same thing" — it is nothing to save', async ({ page, context }) => {
    let v = 1, diskSrc = null;
    await context.route(PING, route => route.fulfill({ json: { ok: true, v, ahead: 0 } }));
    await context.route(/\/engine\/.*content\.md(\?|$)/, route => diskSrc == null
      ? route.continue() : route.fulfill({ body: diskSrc, contentType: 'text/markdown' }));
    await gotoEditor(page);
    await dirtyIt(page);
    // Something wrote the very same words to disk (an outside editor, a copy
    // of this tab, a commit a hook then refused on an older server).
    diskSrc = await page.evaluate(() => source);
    v = 2;
    await expect.poll(() => page.evaluate(() => dirty), { timeout: 8000 }).toBe(false);
    await expect(page.locator('#stat')).not.toContainText('Claude changed the same thing');
    expect(await page.evaluate(() => source === original)).toBe(true);
  });
});

// The server's own half: a commit a hook refuses must leave the disk as it
// was, or the words sit there uncommitted and every open editor reads them
// back as somebody else's change. A real repo in a scratch dir, adopted by
// the real server, saved through the real /__save (the suite's block is
// lifted by a header, like /__pull's; see serve.py).
// affected-by: report2027/tools/serve.py
test.describe('a commit the hook refuses', () => {
  const REPO = path.resolve(__dirname, '..', '..');
  const SLUG = 'zz-spec-hookref';
  const { removeRegistryKeys } = require('./fixtures/host-state');
  const git = (cwd, cmd) => execSync(`git -C ${JSON.stringify(cwd)} ${cmd}`, { stdio: 'pipe' }).toString();
  let scratch, clone;

  test.beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hookref-'));
    clone = path.join(scratch, 'clone');
    fs.mkdirSync(clone);
    execSync(`cp -R ${JSON.stringify(path.join(REPO, 'docsync'))} ${JSON.stringify(clone)}`);
    execSync(`find ${JSON.stringify(clone)} -name __pycache__ -type d -exec rm -rf {} +`);
    fs.writeFileSync(path.join(clone, 'docsync.yml'),
      'bindings:\n  - id: seed\n    content: projects/seed/content.md\n');
    fs.mkdirSync(path.join(clone, 'projects'));
    execSync('python3 -', { input: [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(REPO)})`,
      'from pathlib import Path',
      'from docsync.new import create',
      `create(${JSON.stringify(SLUG)}, "Hook Refused Spec", root=Path(${JSON.stringify(clone)}))`,
    ].join('\n') });
    execSync(`find ${JSON.stringify(clone)} -name __pycache__ -type d -exec rm -rf {} +`);
    fs.writeFileSync(path.join(clone, '.gitignore'), '__pycache__/\nweb/\ndocs/\n');
    git(clone, 'init -q -b main');
    git(clone, '-c user.email=s@x -c user.name=S add -A');
    git(clone, '-c user.email=s@x -c user.name=S commit -q -m "first"');
    // The repo's own hook, so a machine-wide hooksPath (Devin's ʻokina lint)
    // is not what decides this; it refuses every commit, loudly.
    git(clone, 'config core.hooksPath .git/hooks');
    fs.writeFileSync(path.join(clone, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\necho "okina-lint: a straight apostrophe in Hawai\'i (line 3)" >&2\nexit 1\n', { mode: 0o755 });
  });
  test.afterAll(() => {
    removeRegistryKeys(SLUG);
    execSync(`rm -rf ${JSON.stringify(scratch)}`);
  });

  test('puts the disk back and says the words are still in the editor', async ({ request }) => {
    const ad = await (await request.post('/__adopt', { data: { root: clone } })).json();
    expect(ad.ok, JSON.stringify(ad)).toBe(true);
    const md = path.join(clone, 'projects', SLUG, 'content.md');
    const before = fs.readFileSync(md, 'utf8');
    const head = git(clone, 'rev-parse HEAD').trim();
    const j = await (await request.post('/__save', {
      headers: { 'X-Primer-Test-Save': '1' },
      data: { project: SLUG, content: before.replace('Hook Refused Spec', 'Hook Refused Spec REVISED') },
    })).json();
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/nothing was saved/);
    expect(j.error).toMatch(/still here in the editor/);
    expect(j.error).toMatch(/okina-lint/);              // the hook's own reason rides along
    // The disk is what is committed, not the refused draft.
    expect(fs.readFileSync(md, 'utf8')).toBe(before);
    expect(git(clone, 'rev-parse HEAD').trim()).toBe(head);
    expect(git(clone, 'status --porcelain -- projects').trim()).toBe('');
  });
});
