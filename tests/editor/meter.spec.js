// A bar is a chart (blocks.meter): it opens in the Chart panel, and every
// figure that restates it is computed from what it draws. Reported on
// tfc-2027-priorities, whose vote bars were <i style="width:43.8%"> typed by
// hand beside a tally typed by hand — nothing opened them, a retyped tally
// never moved one, and the page once shipped a bar disagreeing with its own
// numbers. docsync.check now refuses a hand-drawn bar under strict.
// affected-by: docsync/blocks.py docsync/layout.py projects/tfc-2027-priorities/*
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const text = (page, sel) => page.evaluate(s =>
  (document.getElementById('out').contentDocument.querySelector(s) || {}).textContent || '', sel);

test.describe('a bar is a chart you edit (tfc-2027-priorities)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, '?project=tfc-2027-priorities');
  });

  test('an idea bar opens in the Chart panel, and its tally and totals follow an edit', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const bar = frame.locator('[data-chart="bar.idea-4"]');
    await bar.scrollIntoViewIfNeeded();
    const before = {
      tally: await text(page, '[data-el="tally.idea-4"]'),
      fam: await text(page, '[data-el="tally.fam-1"]'),
      votes: await text(page, '[data-el="stat.votes"] .num'),
    };
    expect(before.tally).toContain('10 of 11');
    await bar.click();
    await page.waitForTimeout(500);
    await expect(page.locator('#ar-chart')).toBeVisible();
    await page.click('#ar-chart');
    await expect(page.locator('#side-title')).toHaveText('Chart');
    const cells = page.locator('#chartpop .ch-grid input.ch-num');
    expect(await cells.count()).toBe(3);                  // Agree, Pass, Disagree
    expect(await cells.first().inputValue()).toBe('10');
    await cells.first().fill('12');
    await cells.first().blur();
    await expect.poll(() => text(page, '[data-el="tally.idea-4"]')).toContain('12 of 13');
    // The sums built from it moved too: its family card and the headline.
    await expect.poll(() => text(page, '[data-el="tally.fam-1"]')).not.toBe(before.fam);
    expect(await text(page, '[data-el="stat.votes"] .num')).toBe(String(Number(before.votes) + 2));
    // Only the numbers were recorded, under layout.charts — colours and the
    // rest still come from the renderer.
    const over = await page.evaluate(() => layout.charts['bar.idea-4']);
    expect(Object.keys(over)).toEqual(['series']);
  });

  test('setChart changes a bar by series name, as one undo step', async ({ page }) => {
    const was = await text(page, '[data-el="stat.disagree"] .num');
    const r = await page.evaluate(() =>
      docsync.api.setChart('bar.idea-6', { points: { Disagree: 2 } }));
    expect(r.ok).toBe(true);
    await expect.poll(() => text(page, '[data-el="tally.idea-6"]')).toContain('2 disagrees');
    expect(await text(page, '[data-el="stat.disagree"] .num')).toBe(String(Number(was) + 2));
    const bad = await page.evaluate(() =>
      docsync.api.setChart('bar.idea-6', { points: { Nope: 1 } }));
    expect(bad.ok).toBe(false);
    await page.evaluate(() => docsync.api.undo());
    await expect.poll(() => text(page, '[data-el="stat.disagree"] .num')).toBe(was);
  });

  test('a computed bar is not a chart to edit — it says where its numbers come from', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const sum = frame.locator('[data-el="bar.fam-1"]');
    await sum.scrollIntoViewIfNeeded();
    await expect(sum).toHaveCount(1);
    await expect(frame.locator('[data-chart="bar.fam-1"]')).toHaveCount(0);
    expect(await sum.locator('svg').getAttribute('data-fixed')).toContain("family's idea bars");
  });
});
