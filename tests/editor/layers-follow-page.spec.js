// The Layers panel lists the page in view, so its title follows the canvas
// while it is open; and the page strip's previews are built incrementally —
// a render that changed no page reuses what is already drawn.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('layers panel follows the visible page', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('scrolling to another page retitles an open panel', async ({ page }) => {
    await page.evaluate(() => document.getElementById('layers').click());
    await expect(page.locator('#layerspop')).toBeVisible();
    await expect(page.locator('#layers-title')).toHaveText('Layers — page 1');
    const n = await page.evaluate(() => pageOrder().length);
    test.skip(n < 2, 'needs a multi-page report');
    await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const secs = d.querySelectorAll('section.page');
      secs[secs.length - 1].scrollIntoView();
    });
    await expect(page.locator('#layers-title')).not.toHaveText('Layers — page 1');
    const want = await page.evaluate(() => `Layers — page ${pageOrder().indexOf(visiblePageId()) + 1}`);
    await expect(page.locator('#layers-title')).toHaveText(want);
  });
});

test.describe('page strip previews are incremental', () => {
  test('a second render reuses the built previews instead of cloning every sheet', async ({ page }) => {
    await gotoEditor(page);
    await page.waitForFunction(() => thumbCache.size > 0);
    // Boot is still settling for a moment (fonts, a second render), and a
    // changed sheet is rightly rebuilt — so wait for a pass that rebuilds
    // nothing, then hold it to that.
    const pass = () => page.evaluate(async () => {
      const before = [...thumbCache].map(([k, v]) => [k, v.wrap]);
      await railThumbs();
      return before.length > 0 && before.every(([k, w]) => thumbCache.get(k) && thumbCache.get(k).wrap === w);
    });
    await expect.poll(pass, { timeout: 15000 }).toBe(true);
    expect(await pass(), 'previews of unchanged pages are the same nodes').toBe(true);
    // The cache is what the chips show, not a side copy.
    const shown = await page.evaluate(() => [...document.querySelectorAll('#rail-list .chip')]
      .filter(c => c.querySelector('.chip-view').shadowRoot?.firstChild).length);
    expect(shown).toBeGreaterThan(0);
  });
});
