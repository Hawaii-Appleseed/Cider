// Two chrome controls an --app window cannot do without.
//
// REFRESH: a Chrome --app window has no address bar and no reload button, so
// the only way to refresh one was ⌘R — which assumes you know the window is a
// browser. Refreshing is also the fix for the states the editor cannot fix from
// inside (a page served stale from the offline cache, a boot that failed before
// the app existed), so it needs to be reachable without that knowledge.
//
// FORCE QUIT: the server exits by itself PRIMER_LINGER seconds after the last
// window says goodbye, but a force-quit browser never says goodbye — verified:
// its entry survives in CLIENTS and only the 2-hour CLIENT_TTL sweep clears it.
// File ▸ Force quit is the deliberate stop for that, and for a server that has
// gone wrong. Local mode.
const { test, expect, gotoEditor, openFileMenu, clickTool, openToolMenu } = require('./fixtures/editor-test');

test.describe('refresh', () => {
  test('View ▾ has it, and it reloads the window', async ({ page }) => {
    await gotoEditor(page);
    await openToolMenu(page, 'reload');
    await expect(page.locator('#reload')).toBeVisible();

    // A reload is observable without depending on navigation events: stamp the
    // window, press it, and the stamp is gone only if the document really went.
    await page.evaluate(() => { window.__beforeReload = true; });
    await clickTool(page, 'reload');
    await expect.poll(() => page.evaluate(() => window.__beforeReload === undefined),
                      { timeout: 20_000 }).toBe(true);
    // And it comes back as a working editor, not a blank frame.
    await expect(page.locator('#file')).toBeVisible();
  });

  test('with unsaved edits it asks first, and cancelling keeps them',
    async ({ page }) => {
      await gotoEditor(page);
      // A real edit, so `dirty` is set the way the app sets it.
      await page.evaluate(() => docsync.api.addTextBox(
        { page: 1, x: 1, y: 1, w: 2, md: 'unsaved' }));
      await expect.poll(() => page.evaluate(() => dirty)).toBe(true);

      await page.evaluate(() => { window.__beforeReload = true; });
      await clickTool(page, 'reload');
      const dlg = page.locator('dialog[open]');
      await expect(dlg).toContainText('Unsaved edits');
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(600);

      // Still the same document, still dirty.
      expect(await page.evaluate(() => window.__beforeReload)).toBe(true);
      expect(await page.evaluate(() => dirty)).toBe(true);
    });
});

test.describe('force quit', () => {
  test('it sits in the File menu, under its own heading', async ({ page }) => {
    await gotoEditor(page);
    await openFileMenu(page);
    await expect(page.locator('#file-quit')).toBeVisible();
    await expect(page.locator('#file-quit-h')).toBeVisible();
    // Not dressed as an ordinary row — it stops the editor for every window.
    await expect(page.locator('#file-quit')).toHaveClass(/danger/);
  });

  test('it confirms first, and cancelling asks the server nothing',
    async ({ page }) => {
      await gotoEditor(page);
      let called = false;
      await page.route('**/__quit*', async route => {
        called = true;
        await route.fulfill({ status: 200, contentType: 'application/json',
                              body: JSON.stringify({ ok: true, stopping: true }) });
      });
      await openFileMenu(page);
      await page.click('#file-quit');

      const dlg = page.locator('dialog[open]');
      await expect(dlg).toContainText('every open window');
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(400);
      expect(called).toBe(false);
    });

  test('confirming posts /__quit', async ({ page }) => {
    await gotoEditor(page);
    // Intercepted: the real endpoint stops the server this whole suite shares.
    // serve.py refuses it under PRIMER_TEST_SAFE for the same reason — belt and
    // braces, since a spec reaching the real one would fail every parallel
    // worker on a dead port, a long way from the cause.
    let method = null;
    await page.route('**/__quit*', async route => {
      method = route.request().method();
      await route.fulfill({ status: 200, contentType: 'application/json',
                            body: JSON.stringify({ ok: true, stopping: true }) });
    });
    await openFileMenu(page);
    await page.click('#file-quit');
    await page.locator('dialog[open]').getByRole('button', { name: 'Force quit' }).click();

    await expect.poll(() => method).toBe('POST');
    // window.close() is not granted to a window the script did not open — the
    // SERVER closes the editor's windows on its way down (serve.py
    // _close_own_windows). The page still states the outcome rather than
    // assuming it, for the cases nothing can close: its fallback line only
    // draws if the window survived to draw it.
    await expect(page.locator('#stat')).toContainText(/stopped|stopping/);
  });

  test('the server closes its own windows as it stops', async () => {
    // The AppleScript walk itself cannot run here (it needs macOS, Chrome and
    // an Automation grant — and against the suite's shared server it would
    // close real windows), so this pins the two halves of the contract that
    // CAN be held: the quit path calls the close before any shutdown, and the
    // close is keyed to every origin a window of this server may carry.
    const text = require('fs').readFileSync(
      require('path').join(__dirname, '../../report2027/tools/serve.py'), 'utf8');
    const quit = text.slice(text.indexOf('def _quit'), text.indexOf('def _restart_soon'));
    expect(quit.indexOf('_close_own_windows()')).toBeGreaterThan(-1);
    // Before shutdown, not after: a closed server cannot close anything.
    expect(quit.indexOf('_close_own_windows()'))
      .toBeLessThan(quit.indexOf('srv.shutdown'));
    const helper = text.slice(text.indexOf('def _close_own_windows'),
                              text.indexOf('def _idle_reaper'));
    for (const origin of ['http://localhost:{PORT}/', 'http://127.0.0.1:{PORT}/',
                          'http://[::1]:{PORT}/']) {
      expect(helper).toContain(origin);
    }
    // And never anywhere but macOS — osascript does not exist elsewhere.
    expect(helper).toContain('darwin');
  });

  test('a refusal is reported, not swallowed', async ({ page }) => {
    await gotoEditor(page);
    await page.route('**/__quit*', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'blocked in tests' }) }));
    await openFileMenu(page);
    await page.click('#file-quit');
    await page.locator('dialog[open]').getByRole('button', { name: 'Force quit' }).click();

    await expect(page.locator('#stat')).toContainText('blocked in tests');
  });

  test('the suite\'s own server refuses the real endpoint', async ({ request }) => {
    // PRIMER_TEST_SAFE=1 is set on the suite's webServer. If this ever stops
    // being true, one stray click takes the whole run down.
    const r = await request.post('/__quit', { data: {} });
    expect(r.ok()).toBe(true);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/blocked in tests/);
  });
});
