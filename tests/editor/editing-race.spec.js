// An inline text editor must SURVIVE a render that lands mid-edit.
//
// finish() runs render() after every editor close, and SSE bumps re-render a
// live tab at any time — so a swap arriving while someone is typing was easy
// to hit. The swap removed the old document, which destroyed the open editor,
// ate whatever was typed, and — because a removed contenteditable fires no
// blur — left `editing` stuck true. From then on every dblclick was silently
// ignored (edit() refuses while `editing`), the iframe's keydown ignored
// Delete, and clicks were swallowed by the commit-the-editor path whose host
// no longer existed: "takes several clicks to start editing", "still can't
// delete text boxes". renderOnce() now defers the swap while `editing`; the
// editor's own finish() renders again and supersedes the deferred twin, so
// nothing is ever lost and the flag cannot strand.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const SLOT = 'basics.h1';

async function openEditorOn(page, frame) {
  await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await frame.locator(`[data-slot="${SLOT}"]`).dblclick({ force: true });
  await frame.locator('.ds-edit').waitFor({ state: 'visible' });
}

// Escape and pullFromDisk both end in a render, and a render REPLACES the
// iframe's document. A click issued into the dying one waits forever on a
// locator that will never resolve — so every step that renders is followed by
// waiting for the new canvas to stand up.
async function settle(page, frame) {
  await frame.locator('section.page').first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(600);
}

test.describe('a render landing mid-edit', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('does not destroy the open editor or what was typed', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await openEditorOn(page, frame);
    await page.keyboard.type('XYZPROBE ');

    // The race: a render fires while the editor is open (the tail of a
    // previous commit, or a live-server bump). Pre-fix, the swap removed the
    // document under the caret.
    await page.evaluate(() => { render(); });
    await page.waitForTimeout(3500);

    const host = frame.locator('.ds-edit');
    await expect(host).toHaveCount(1);          // still open
    await expect(host).toContainText('XYZPROBE');   // nothing eaten
    expect(await page.evaluate(() => editing)).toBe(true);

    // Escape closes it (keeping the words); finish()'s own render supersedes
    // the deferred twin and the flag comes back down — the editor is not
    // stranded.
    await page.keyboard.press('Escape');
    await expect(frame.locator('.ds-edit')).toHaveCount(0, { timeout: 15000 });
    await expect.poll(() => page.evaluate(() => editing)).toBe(false);

    // And text editing still works afterwards — the pre-fix state killed it.
    await openEditorOn(page, frame);
    await expect(frame.locator('.ds-edit')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(frame.locator('.ds-edit')).toHaveCount(0, { timeout: 15000 });
  });
});

// The net UNDER that rule. The deferral above is what should make a stranded
// `editing` impossible, but it only holds while every path that opens an
// editor also closes it — and a stranded flag is catastrophic and silent: the
// whole text side of the editor dies until the page is reloaded ("the editor
// won't let me edit unless I refresh").
//
// The heal existed already, inside wire(). That was the wrong home: while
// `editing` is stranded no render ever swaps, so wire() never runs, so the
// net was hung from the very thing the wedge stops. It hangs from the live
// heartbeat now, which needs nothing to go right first.
test.describe('a stranded editing flag', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('heals on the next heartbeat — and never fires on a live editor',
    async ({ page }) => {
      const frame = page.frameLocator('#out');

      // FIRST: a genuinely open editor must survive the heal. This is the
      // failure mode a self-heal invites — mistaking someone mid-word for a
      // corpse — so it is asserted before the heal is asked to do anything.
      await openEditorOn(page, frame);
      await page.keyboard.type('STILLHERE ');
      expect(await page.evaluate(() => healStrandedEditor())).toBe(false);
      await expect(frame.locator('.ds-edit')).toHaveCount(1);
      await expect(frame.locator('.ds-edit')).toContainText('STILLHERE');
      expect(await page.evaluate(() => editing)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(frame.locator('.ds-edit')).toHaveCount(0, { timeout: 15000 });
      await settle(page, frame);

      // NOW the wedge itself — asserted by SETTING the flag, not by trying to
      // strand it for real. Removing the host used to strand it (a removed
      // contenteditable fired no blur); in current Chromium removal DOES fire
      // blur and finish() runs, so that particular route is closed and a spec
      // pretending otherwise would be testing the browser, not this code.
      // The flag is what matters: however it comes to be up with no editor
      // under it, everything text is dead until it comes down.
      await page.evaluate(() => { editing = true; });
      await frame.locator(`[data-slot="${SLOT}"]`).dblclick({ force: true });
      await expect(frame.locator('.ds-edit')).toHaveCount(0);   // edit() refuses

      // The heartbeat is what recovers it — pullFromDisk, which every live
      // bump goes through, and which is the whole point of moving the heal
      // out of wire(): wire() only runs on a swap, and a stranded flag is
      // exactly the state in which no swap ever happens.
      await page.evaluate(() => pullFromDisk());
      expect(await page.evaluate(() => editing)).toBe(false);
      await settle(page, frame);

      // And the text side is alive again without a reload.
      await openEditorOn(page, frame);
      await expect(frame.locator('.ds-edit')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(frame.locator('.ds-edit')).toHaveCount(0, { timeout: 15000 });
    });
});
