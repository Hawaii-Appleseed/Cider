// Getting about a long report: the page strip's chips, a Layers row and
// Find's "Show me" all jump the report (docsync/editor/edit.html jumpTo); a
// chip's live thumbnail never takes the click for one of its links; the
// undo stack is 200 deep and says so; the Find list says what it does not
// show. Found by the 2026-10-22 second audit pass on budget-primer
// (WEAK-POINTS-2026-10-22.md). Each test fails on the editor before its fix.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const scrollY = page => page.evaluate(() => $('out').contentWindow.scrollY);
const pageTop = (page, n) => page.evaluate(n => {
  const w = $('out').contentWindow, d = $('out').contentDocument;
  const pg = d.querySelectorAll('section.page')[n - 1];
  return w.scrollY + pg.getBoundingClientRect().top;
}, n);

test.describe('jumping about a long report', () => {
  test('a page chip scrolls the report to that page and never follows a link in the thumbnail', async ({ page }) => {
    await gotoEditor(page);
    const url = page.url();
    const chips = page.locator('#rail-list .chip');
    const n = await chips.count();
    expect(n).toBeGreaterThan(10);
    // Page 12 of the primer is the one whose chip is 39% links (the sources).
    const target = await pageTop(page, n);
    // The click lands where a person's would: the middle of the chip, which
    // on this page is a link in the clone.
    await chips.nth(n - 1).click();
    await expect.poll(() => scrollY(page), { timeout: 6000 }).toBeGreaterThan(target - 40);
    expect(page.url()).toBe(url);                       // still the editor
    await expect(chips.nth(n - 1)).toHaveClass(/\bon\b/);
  });

  test('a Layers row and Find\'s "Show me" arrive too', async ({ page }) => {
    await gotoEditor(page);
    const n = await page.locator('#rail-list .chip').count();
    const key = await page.evaluate(n => {
      const d = $('out').contentDocument;
      const pg = d.querySelectorAll('section.page')[n - 1];
      const s = pg.querySelector('[data-slot]');
      return s && s.getAttribute('data-slot');
    }, n);
    expect(key).toBeTruthy();
    const needle = await page.evaluate(k => readSlot(k).split(/\s+/).find(w => /^[A-Za-z]{6,}$/.test(w)), key);
    expect(needle).toBeTruthy();
    await page.keyboard.press('Meta+f');
    await page.waitForTimeout(600);
    await page.locator('#find-needle').fill(needle);
    await page.waitForTimeout(700);
    const y0 = await scrollY(page);
    // The hit in the last page's slot, shown.
    const row = page.locator('#find-list .find-group', { hasText: key }).locator('.find-go').first();
    await row.click();
    await expect.poll(() => scrollY(page), { timeout: 6000 }).toBeGreaterThan(y0 + 1000);
  });
});

test('undo keeps 200 steps, and the button says so', async ({ page }) => {
  await gotoEditor(page);
  await expect(page.locator('#undo')).toHaveAttribute('title', /200 steps/);
  const id = 'cover.logo';
  const start = await page.evaluate(id => layout.positions[id] ? { ...layout.positions[id] } : null, id);
  // 80 nudges: past the old cap of 60.
  for (let i = 0; i < 80; i++) {
    await page.evaluate(([id, i]) => docsync.api.place(id, { x: 1 + (i % 5) * 0.1, y: 1 + (i % 7) * 0.1 }), [id, i]);
  }
  await settled(page);
  expect(await page.evaluate(() => past.length)).toBe(80);
  for (let i = 0; i < 80; i++) await page.evaluate(() => undo());
  await settled(page);
  const end = await page.evaluate(id => layout.positions[id] ? { ...layout.positions[id] } : null, id);
  expect(end).toEqual(start);
  expect(await page.evaluate(() => past.length)).toBe(0);
});

test('the Find list says how much of it is not shown', async ({ page }) => {
  await gotoEditor(page);
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(600);
  await page.locator('#find-needle').fill('e');             // every place has one
  await page.waitForTimeout(800);
  const places = await page.evaluate(() => new Set(findState.hits.map(h => h.target.label)).size);
  expect(places).toBeGreaterThan(40);
  await expect(page.locator('#find-list .find-more')).toHaveText(new RegExp(`${places - 40} more places not shown`));
  await expect(page.locator('#find-list .find-more')).toContainText('Change all covers them');
  await expect(page.locator('#find-list .find-where', { hasText: 'more not shown' }).first()).toBeVisible();
});
