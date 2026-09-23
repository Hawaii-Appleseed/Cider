// A rebuild that lands mid-edit must not be LOST.
//
// pullFromDisk() declines while a text editor is open — right, because yanking
// the document out from under the caret destroys the editor and eats what was
// typed (see editing-race.spec.js). But onBump used to record the version
// BEFORE calling it:
//
//     if (v === liveVer) return;
//     liveVer = v;              // consumed
//     await pullFromDisk();     // ...then quietly declined
//
// so that build was dropped permanently: every later ping carries the same v
// and short-circuits on the guard above. A file changed on disk while a text
// box happened to be open never appeared until the page was reloaded — which
// is exactly the "I had to hard refresh" report this spec exists to prevent.
//
// The version is now consumed only on a pull that actually happened, so the
// next 2s heartbeat retries and the change lands as soon as the editor closes.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const SLOT = 'basics.h1';

test.describe('a build bump arriving mid-edit', () => {
  test('is retried rather than swallowed', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');

    const start = await page.evaluate(() => liveVer);
    const target = start + 999;             // a version this tab has not seen

    // Open an inline editor: `editing` goes true and pulls are declined.
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await frame.locator(`[data-slot="${SLOT}"]`).dblclick({ force: true });
    await frame.locator('.ds-edit').waitFor({ state: 'visible' });
    expect(await page.evaluate(() => editing)).toBe(true);
    expect(await page.evaluate(() => pullFromDisk())).toBe(false);

    await page.evaluate(v => window.__onBump(v), target);
    expect(await page.evaluate(() => liveVer),
      'the version was consumed while the pull was declined — this build is now '
      + 'unreachable, and only a reload will show it').toBe(start);

    // Close the editor; `editing` clears and the retry must now take effect.
    await page.evaluate(() => document.querySelector('#out')
      .contentDocument.querySelector('.ds-edit').blur());
    await expect.poll(() => page.evaluate(() => editing)).toBe(false);

    await page.evaluate(v => window.__onBump(v), target);
    await expect.poll(() => page.evaluate(() => liveVer),
      { message: 'the retried bump still did not land once editing finished' })
      .toBe(target);
  });
});
