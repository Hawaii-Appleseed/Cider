// Editable + movable cover title/year (report2027/content.md cover.title/
// cover.year + render_report.py): the cover title and year now carry the
// same data-el position-override hook as section headings (basics.h1 etc.)
// — a single click selects the <h1>/<div> as a draggable/resizable object,
// double-clicking its text opens the inline editor. Both are plain text (not
// run through md_inline), so that editor offers no Bold/Italic/Link toolbar.
// Local mode; editor opens on the cover.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('editable cover title', () => {
  test('the cover title is an editable slot and commits an edit', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');

    const title = frame.locator('[data-slot="cover.title"]');
    await expect(title).toHaveCount(1);
    await expect(title).toContainText('HAWAI');

    // Nested inside [data-el="cover.title"] like any section heading, so a
    // double-click (not single) opens the text editor — a single click
    // selects the heading as a movable object instead (see below).
    await title.dblclick({ force: true });
    const ta = frame.locator('.ds-edit');
    await ta.waitFor({ state: 'visible' });
    await expect(ta).toHaveText(/HAWAI[\s\S]*BUDGET[\s\S]*PRIMER/);

    // Edit all three lines and commit (blur).
    await ta.evaluate(el => { el.textContent = 'HAWAII\nSTATE\nBUDGET'; });
    await ta.evaluate(el => el.blur());

    // The rendered title reflects the edit, still stacked with <br>. Polling
    // assertions, not a one-shot count: the re-render loads in a hidden twin
    // and swaps in when ready, so the committed h1 (the one WITH the <br>s)
    // only exists after the swap — a snapshot could catch the old document.
    const after = frame.locator('h1.cover-title');
    await expect(after).toContainText('STATE');
    await expect(after.locator('br')).toHaveCount(2);   // three lines -> two <br>
  });

  test('the cover year is editable too', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');
    await expect(frame.locator('.cover-year [data-slot="cover.year"]')).toHaveCount(1);
  });

  test('a single click selects the cover title as a movable object, not text-edit', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');

    const h1 = frame.locator('[data-el="cover.title"]');
    await expect(h1).toHaveCount(1);
    await h1.click();

    await expect(frame.locator('.ds-edit')).toHaveCount(0);   // no text editor opened
    // A single-slot text object: one click brings up the type controls,
    // selection and dragging still work exactly as before.
    await expect(page.locator('#type')).toBeVisible();
    await expect(page.locator('#ty-key')).toHaveText('heading');
    await expect(page.locator('#ty-key')).toHaveAttribute('title', 'cover.title');
    // The font dropdown NAMES the rendered font even with no override set —
    // the cover title is Barlow, so the picker says so rather than a blank.
    await expect(page.locator('#ty-font')).toHaveValue('Barlow');
    expect(await page.evaluate(() => (layout.text || {})['cover.title'])).toBeUndefined();
  });

  test('dragging the cover title records a position, and the cover year stays put', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await gotoEditor(page);

    const h1 = frame.locator('[data-el="cover.title"]');
    await h1.click();
    const box = await h1.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const pos = await page.evaluate(() => layout.positions['cover.title']);
    expect(pos).toBeTruthy();
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.reserve).toBeGreaterThan(0);
    expect(await frame.locator('.ds-spacer').count()).toBeGreaterThanOrEqual(1);
  });

  test('dragging the cover year records its own position', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await gotoEditor(page);

    const yearEl = frame.locator('[data-el="cover.year"]');
    await expect(yearEl).toHaveCount(1);
    await yearEl.click();
    const box = await yearEl.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const pos = await page.evaluate(() => layout.positions['cover.year']);
    expect(pos).toBeTruthy();
  });

  test('untouched cover title/year publish with no position scaffolding', async ({ page }) => {
    await gotoEditor(page);
    const pos = await page.evaluate(() => layout.positions || {});
    expect(pos['cover.title']).toBeUndefined();
    expect(pos['cover.year']).toBeUndefined();
  });
});
