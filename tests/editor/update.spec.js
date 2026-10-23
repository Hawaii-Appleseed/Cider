// Staying current: the version chip, the update offer, and installing one.
//
// The app is a real git checkout that fast-forwards itself, and it used to do
// that ONLY at launch — so anyone who leaves the editor open (which is how it
// is used) ran whatever was current the day they last quit. The server now
// polls in the background and publishes what it finds; these tests drive that
// payload directly, because the alternative is a test that needs a second
// repository and a push to it in order to assert on a tooltip.
//
// The real git decisions — whether an update is safe, whether local saves can
// be replayed on top of it — live in tools/selfupdate.py and are exercised
// against actual repositories there, not here.
const { test, expect, gotoEditor, PING, UPDATE } = require('./fixtures/editor-test');
const ROLLBACK = /\/__rollback(\?|$)/;

const ver = (page) => page.locator('#ver');
const upd = (page) => page.locator('#upd');

/** Answer /__ping with an `update` block of our choosing. Version is held
 *  constant so nothing re-renders — these tests are about the chrome. */
async function withUpdate(context, update) {
  await context.unroute(PING).catch(() => {});
  await context.route(PING, route => route.fulfill({
    json: { ok: true, v: 90010, ahead: 0, watchAge: 0.4, update },
  }));
}

test.describe('version and updates', () => {
  test('the running version is reported, without a sha sitting in the toolbar',
    async ({ page, context }) => {
    await withUpdate(context, { sha: 'abc1234', date: '2026-07-26', behind: 0, can: false, log: [] });
    await gotoEditor(page);
    // On the latest version with nothing to undo, the chip has nothing to do
    // and shows nothing — but still ANSWERS "what am I running?" on hover.
    await expect(ver(page)).toBeHidden();
    await expect(ver(page)).toHaveAttribute('title', /abc1234/);
    await expect(ver(page)).toHaveAttribute('title', /2026-07-26[\s\S]*latest version/);
    await expect(upd(page)).toBeHidden();      // nothing to offer
  });

  test('an available update is offered, and names what is in it', async ({ page, context }) => {
    await withUpdate(context, {
      sha: 'abc1234', date: '2026-07-26', behind: 2, can: true,
      log: ['editor: fix chart dragging', 'editor: faster scrolling'],
    });
    await gotoEditor(page);
    await expect(upd(page)).toBeVisible();
    await expect(upd(page)).toHaveText('Update (2)');
    // The count alone is ignorable; the subjects are the reason to click.
    await expect(upd(page)).toHaveAttribute('title', /fix chart dragging[\s\S]*faster scrolling/);
  });

  test('an update held back by the person’s own work is explained, not offered', async ({ page, context }) => {
    await withUpdate(context, {
      sha: 'abc1234', date: '2026-07-26', behind: 1, can: false,
      why: 'you have 2 commits of your own touching the same files as this update',
      log: ['editor: fix chart dragging'],
    });
    await gotoEditor(page);
    // A button that would do nothing when pressed is worse than no button —
    // but the reason still has to be reachable.
    await expect(upd(page)).toBeHidden();
    await expect(ver(page)).toHaveAttribute('title', /Not applied:[\s\S]*commits of your own/);
  });

  test('installing is refused while there are unsaved edits', async ({ page, context }) => {
    await withUpdate(context, {
      sha: 'abc1234', date: '2026-07-26', behind: 1, can: true, log: ['editor: a fix'],
    });
    await gotoEditor(page);

    let posted = false;
    await context.route(UPDATE, route => { posted = true; route.fulfill({ json: { ok: true } }); });
    await page.evaluate(() => { source = original + '\n'; markDirty(); });
    await upd(page).click();

    await expect(page.locator('#stat')).toContainText('save your changes first');
    expect(posted, 'an install must not start with unsaved work in the document').toBe(false);
    await expect(upd(page)).toBeVisible();     // still offered, not consumed
  });

  test('installing posts, waits for the server to come back, then reloads', async ({ page, context }) => {
    await withUpdate(context, {
      sha: 'abc1234', date: '2026-07-26', behind: 1, can: true, log: ['editor: a fix'],
    });
    await gotoEditor(page);

    // The server restarts into the new code, so it goes away and comes back.
    // Reloading into that gap shows a browser error page, which reads as "the
    // update broke it" — so the client must wait for a live answer first.
    //
    // The outage is counted in refused pings, not timed: a wall-clock window
    // (it was 1.5s from the install POST) is what made this flaky, because a
    // slow shard could let the whole window pass before the client's first
    // poll and a fast one let the reload land while the next ping was still
    // being aborted. Three refusals, then the server answers, however long
    // that takes. And the reload is witnessed by a marker that only the OLD
    // document carries, not by waitForNavigation, which is a race against the
    // very navigation it is waiting for and says nothing about WHICH
    // document it saw.
    let refusals = 0, restarted = false;
    await context.route(UPDATE, route => {
      restarted = true;
      route.fulfill({ json: { ok: true, restarting: true, sha: 'def5678' } });
    });
    await context.unroute(PING).catch(() => {});
    await context.route(PING, route => (restarted && refusals < 3)
      ? (refusals++, route.abort())
      : route.fulfill({ json: restarted
          ? { ok: true, v: 90010, ahead: 0, update: { sha: 'def5678', behind: 0, can: false } }
          : { ok: true, v: 90010, ahead: 0, update: { sha: 'abc1234', date: '2026-07-26', behind: 1, can: true, log: ['editor: a fix'] } } }));

    await page.evaluate(() => { window.__oldDocument = true; });
    await upd(page).click();
    await expect(page.locator('#stat')).toContainText(/restarting/);
    // Gone from the page means the page was reloaded.
    await page.waitForFunction(() => window.__oldDocument === undefined, null, { timeout: 30000 });
    expect(refusals, 'the client saw the server down before it reloaded').toBe(3);
    // Back up on the new version — which the chip reports in its TOOLTIP now,
    // not as a sha sitting in the toolbar (see "the version chip stays out of
    // the way" below).
    await expect(ver(page)).toHaveAttribute('title', /def5678/, { timeout: 30000 });
  });

  test('the version chip stays out of the way when it can do nothing',
    async ({ page, context }) => {
    // It used to sit in the toolbar showing the running sha permanently —
    // seven hex characters beside the zoom bar that read as a stray colour
    // code. With no earlier version there is nothing to undo, so there is
    // nothing for it to say: it is hidden, and the version lives in the
    // tooltip for anyone who goes looking.
    await withUpdate(context, { sha: 'abc1234', date: '2026-07-26', behind: 0, can: false, rollback: '' });
    await gotoEditor(page);
    await expect(ver(page)).toBeHidden();
    await expect(ver(page)).not.toHaveClass(/can-undo/);
    await expect(ver(page)).toHaveAttribute('title', /latest version/);
    await expect(ver(page)).not.toHaveAttribute('title', /go back/);
  });

  test('after an update the version chip offers the way back', async ({ page, context }) => {
    await withUpdate(context, { sha: 'def5678', date: '2026-07-26', behind: 0, can: false, rollback: 'abc1234' });
    await gotoEditor(page);
    // Visible ONLY here — when there is genuinely something to undo — and
    // labelled in words rather than in a sha.
    await expect(ver(page)).toBeVisible();
    await expect(ver(page)).toHaveText('Undo update');
    await expect(ver(page)).toHaveClass(/can-undo/);
    await expect(ver(page)).toHaveAttribute('title', /Click to go back to abc1234/);

    // Confirmed, because it restarts the editor — and cancelling must not.
    let posted = 0;
    await context.route(ROLLBACK, route => { posted++; route.fulfill({ json: { ok: true } }); });
    await ver(page).click();
    await page.locator('dialog.dsdlg button.dsdlg-cancel').click();
    expect(posted, 'cancelling must not roll anything back').toBe(0);
  });

  test('going back is refused while there are unsaved edits', async ({ page, context }) => {
    await withUpdate(context, { sha: 'def5678', date: '2026-07-26', behind: 0, can: false, rollback: 'abc1234' });
    await gotoEditor(page);
    let posted = 0;
    await context.route(ROLLBACK, route => { posted++; route.fulfill({ json: { ok: true } }); });
    await page.evaluate(() => { source = original + '\n'; markDirty(); });
    await ver(page).click();
    await expect(page.locator('#stat')).toContainText('save your changes first');
    expect(posted).toBe(0);
  });
});
