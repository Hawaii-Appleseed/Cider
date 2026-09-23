// THE CANARY: a change on disk must reach the open editor, even mid-edit.
//
// Live-reload staleness has been fixed four separate times, each in a
// different link of the same chain, and each time a per-link spec was added
// that could not have caught the next one:
//
//   1. the preview's <link> stylesheet was never re-fetched   (preview-css-reload)
//   2. a version bump arriving mid-edit was swallowed whole   (bump-mid-edit)
//   3. an unsaved edit suppressed UNRELATED engine changes    (this spec)
//   4. the server itself was running pre-fix code             (server-stale)
//
// So this one tests the CHAIN rather than a link: with the editor genuinely
// dirty, a bump lands, the engine on disk has moved, and a render must
// happen anyway. Anything that breaks pull -> engine refresh -> render fails
// here regardless of which link is at fault.
//
// It writes NOTHING to disk. The default project maps to a real report
// checkout (see fixtures/editor-test.js), so the "change on disk" is served
// by route interception instead — the same bytes the editor would have
// fetched, altered. Everything downstream is the real code path.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const SLOT = 'basics.h1';

test.describe('a disk change reaching a dirty editor', () => {
  test('renders even though unsaved edits make it a clash', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');

    // Count real renders. `render` is a global function binding, so
    // reassigning it is what _pull's own call resolves to.
    await page.evaluate(() => {
      window.__renders = 0;
      const real = render;
      window.render = async (...a) => { window.__renders++; return real(...a); };
    });

    // Make the editor genuinely dirty, through the UI — this is what sets
    // source !== original, which is the clash precondition.
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await frame.locator(`[data-slot="${SLOT}"]`).dblclick({ force: true });
    await frame.locator('.ds-edit').waitFor({ state: 'visible' });
    await page.keyboard.type('CANARY ');
    await page.evaluate(() => document.querySelector('#out')
      .contentDocument.querySelector('.ds-edit').blur());
    await expect.poll(() => page.evaluate(() => editing)).toBe(false);
    expect(await page.evaluate(() => source !== original),
      'the editor should be dirty by now — the clash precondition').toBe(true);

    const before = await page.evaluate(() => window.__renders);

    // Now "disk moves": content.md differs (-> clash) AND an engine file
    // differs (-> engineMoved). Appending a comment keeps the renderer valid
    // Python while changing its bytes, which is all fileSig compares.
    await page.route(/engine\/.*content\.md/, async route => {
      const r = await route.fetch();
      route.fulfill({ response: r, body: (await r.text()) + '\n<!-- disk moved -->\n' });
    });
    await page.route(/engine\/.*render_report\.py/, async route => {
      const r = await route.fetch();
      route.fulfill({ response: r, body: (await r.text()) + '\n# disk moved\n' });
    });

    await page.evaluate(() => window.__onBump(liveVer + 1));

    await expect.poll(() => page.evaluate(() => window.__renders), {
      timeout: 30000,
      message: 'a clash suppressed the render of an unrelated engine change — '
        + 'a stylesheet or renderer edit will not appear until the page is reloaded',
    }).toBeGreaterThan(before);

    // The whole point of rendering during a clash: the unsaved edit survives.
    expect(await page.evaluate(() => source.includes('CANARY')),
      'the re-render must draw from the in-memory source, not clobber it').toBe(true);
  });
});
