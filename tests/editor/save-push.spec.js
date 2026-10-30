// Local Save vs explicit Push (docsync/editor/edit.html Save/Push buttons,
// report2027/tools/serve.py _save/_push). Save writes content.md/layout.json
// to disk and commits LOCALLY — it never pushes on its own, so it can never
// surprise-trigger GitHub Actions (build.yml watches pushes to main) or send
// something to the shared repo before you meant to. Push is the separate,
// explicit action that sends whatever is committed locally to GitHub.
//
// /__save and /__push are mocked (fixtures/editor-test.js) so this never
// touches the real repo. /__ping is mocked HERE, per test, to a fixed `ahead`
// — the real server's own 1.5s poll (detectLocal) keeps running against
// whatever /__ping resolves to, and a genuinely-zero real value would
// otherwise race a test's own setPushState() call back to disabled between
// the call and the next assertion. Mocking makes the poll agree with the
// scenario instead of fighting it. These tests are about the CLIENT'S state
// machine, not serve.py's actual git plumbing.
const { test, staticTest, expect, gotoEditor, submitDialogIfPresent, PING, openFileMenu } = require('./fixtures/editor-test');

/** Navigate with /__ping pinned to an `ahead`, registered before the page ever
 *  loads — detectLocal()'s first ping (which decides `local` and the button's
 *  initial state) must see the same value the 1.5s poll will keep reporting for
 *  the rest of the test.
 *
 *  A FUNCTION may be passed instead of a number when the scenario moves the
 *  count mid-test: the poll then follows it instead of contradicting it. A
 *  fixed number could only ever describe a report whose backlog never changes,
 *  and the push test is exactly the one where it does. */
async function gotoWithAhead(page, context, ahead) {
  const read = typeof ahead === 'function' ? ahead : () => ahead;
  // PING, not '**/__ping': the editor asks for /__ping?project=<id>, which a
  // bare-path glob does not match — the mock was dead and the real server's
  // count (this machine's unpushed commits) answered instead.
  await context.route(PING, route =>
    route.fulfill({ json: { ok: true, v: 1, ahead: read() } }));
  await gotoEditor(page);
}

test.describe('local Save vs Push', () => {
  test('Push is visible in local mode, disabled with nothing to push', async ({ page, context }) => {
    await gotoWithAhead(page, context, 0);
    await expect(page.locator('#push')).toBeVisible();
    await expect(page.locator('#push')).toBeDisabled();   // nothing to push yet
  });

  // Regression: detectLocal() sets share/publish's `hidden` PROPERTY in local
  // mode, but a CSS rule (#bar button's display:inline-flex) can render a
  // "hidden" element anyway — see the hosted-mode describe block below for
  // the full explanation. toBeHidden() checks the real rendered box, which a
  // `.hidden` DOM-property read would not have caught.
  test('Share and Publish are genuinely hidden in local mode, not just marked', async ({ page, context }) => {
    await gotoWithAhead(page, context, 0);
    // Share is a File-menu row now: open the menu, or "hidden" would be true
    // of the whole popover and prove nothing about the row.
    await openFileMenu(page);
    await expect(page.locator('#share')).toBeHidden();
    await page.click('#file');
    await expect(page.locator('#publish')).toBeHidden();
  });


  test('Save writes locally and does not claim anything was pushed', async ({ page, context }) => {
    await gotoWithAhead(page, context, 0);
    await page.evaluate(() => { source = original + '\n'; markDirty(); });
    await expect(page.locator('#save')).toBeEnabled();
    await page.click('#save');
    await submitDialogIfPresent(page);
    // Not "the word push appears anywhere" (the safety mock's OWN message
    // mentions push) — specifically, no claim of a completed push.
    await expect(page.locator('#stat')).not.toContainText('pushed');
    await expect(page.locator('#save')).toBeDisabled();      // dirty cleared
  });

  test('Save response drives the Push button state via setPushState', async ({ page, context }) => {
    // Pin the poll to 2 throughout: the assertions below drive setPushState
    // directly (simulating what /__save's own response would carry, since
    // that endpoint is a fixed stub), and the poll must not contradict them.
    await gotoWithAhead(page, context, 2);
    await page.evaluate(() => setPushState(2));
    await expect(page.locator('#push')).toBeEnabled();
    await expect(page.locator('#push')).toHaveClass(/\bpending\b/);
    await expect(page.locator('#push')).toHaveText('Push (2)');
  });

  test('reaching zero ahead disables the button again', async ({ page, context }) => {
    await gotoWithAhead(page, context, 0);
    await page.evaluate(() => setPushState(0));
    await expect(page.locator('#push')).toBeDisabled();
    await expect(page.locator('#push')).not.toHaveClass(/\bpending\b/);
    await expect(page.locator('#push')).toHaveText('Push');
  });

  test('clicking Push calls /__push and reflects the response', async ({ page, context }) => {
    // One mutable count, read by BOTH mocks. Pinned to a fixed 1, the 1.5s poll
    // kept reporting a backlog the push had just cleared, so setPushState(1)
    // re-enabled the button behind the assertion — it only passed when it won a
    // race, and lost it about 1 run in 12 under load. A push that succeeds
    // really does leave nothing to push, and now the poll says so too.
    let ahead = 1;
    await gotoWithAhead(page, context, () => ahead);
    await context.route('**/__push', route => {
      ahead = 0;
      route.fulfill({
        json: { ok: true, message: 'pushed — GitHub Pages deploys in about a minute', ahead: 0 },
      });
    });
    await expect(page.locator('#push')).toBeEnabled();
    await page.click('#push');
    await expect(page.locator('#stat')).toContainText('pushed', { timeout: 5000 });
    await expect(page.locator('#push')).toBeDisabled();
  });

  test('a rejected push surfaces the error and stays enabled to retry', async ({ page, context }) => {
    await gotoWithAhead(page, context, 1);
    await context.route('**/__push', route => route.fulfill({
      json: { ok: false, error: 'push rejected — the remote has commits this machine doesn\'t '
        + '(often build.yml\'s own rebuild). Ask Claude to reconcile it.', ahead: 1 },
    }));
    await expect(page.locator('#push')).toBeEnabled();
    await page.click('#push');
    await expect(page.locator('#stat')).toContainText('push failed');
    await expect(page.locator('#stat')).toContainText('reconcile');
    await expect(page.locator('#push')).toBeEnabled();   // still there to retry
  });

  test('a hung /__save times out with a clear error instead of a dead spinner', async ({ page, context }) => {
    // A wedged server (a build stuck in a loop, git blocked on a credential
    // prompt) must not leave Save spinning forever — postLocal aborts the
    // request at its ceiling. Drive postLocal directly with a short ceiling
    // against a /__save route that never fulfils.
    await gotoWithAhead(page, context, 0);
    await context.route('**/__save', () => { /* never fulfil -> hang */ });
    const msg = await page.evaluate(async () => {
      try { await postLocal('/__save', { content: 'x' }, 1500); return 'NO-TIMEOUT'; }
      catch (e) { return e.message; }
    });
    expect(msg).toMatch(/timed out after 1\.5s/);
    expect(msg).toMatch(/live server still running/);
  });

  test('setPushState ignores a non-numeric ahead (a mocked/blocked response)', async ({ page, context }) => {
    // The test-safety mock (blockDangerousLocalEndpoints) returns ahead: 0
    // explicitly, but any caller passing undefined must not crash or blank
    // the button — this is what keeps every OTHER local-mode spec safe from
    // the Save mock's response shape.
    await gotoWithAhead(page, context, 3);
    await page.evaluate(() => setPushState(3));
    await expect(page.locator('#push')).toHaveText('Push (3)');
    await page.evaluate(() => setPushState(undefined));
    await expect(page.locator('#push')).toHaveText('Push (3)');   // unchanged
  });
});

staticTest.describe('static mode: local-only controls truly hidden, not just marked', () => {
  // Regression: [hidden] alone does not hide a #bar button — #bar button's
  // own display:inline-flex rule outranks the attribute's (non-!important)
  // display:none, so a button relying on ONLY the attribute rendered anyway.
  // toBeHidden() (not a `.hidden` DOM-property read) is what actually catches
  // this, since it checks the rendered box the same way the bug hid in it.
  // With neither the local server nor the staff hub there is nowhere to save
  // to or share from, so Save is disabled and Push/Share/Publish are hidden.
  staticTest('static viewer: Save disabled, Push/Share/Publish hidden', async ({ page }) => {
    await gotoEditor(page);
    await expect(page.locator('#push')).toBeHidden();
    await expect(page.locator('#share')).toBeHidden();
    await expect(page.locator('#publish')).toBeHidden();
    await expect(page.locator('#save')).toBeDisabled();
    await expect(page.locator('#save')).toHaveAttribute('title', 'Save needs the local server or the staff hub');
  });
});
