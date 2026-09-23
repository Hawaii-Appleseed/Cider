// Page create/delete from the left sidebar (docsync/editor/edit.html rail).
// "+ Page" already existed (inserts a blank page after the one in view);
// deleting a blank page (the × on its chip) is fixed here to also purge any
// shapes/boxes/tables placed on it — otherwise they sat orphaned in
// layout.json and could silently reappear if a later blank page reused the
// same id. A designed (content.md-backed) page can only be HIDDEN, never
// deleted — hiding preserves its content so it can be shown again; that's
// intentional and unchanged. Local mode.
const { warmTest: test, expect, gotoEditor, submitDialog } = require('./fixtures/editor-test');

test.describe('pages: create & delete', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('"+ Page" in the left sidebar adds a blank page you can scroll to', async ({ page }) => {
    const before = await page.locator('#rail-list .chip').count();
    await page.click('#rail-add');
    await page.waitForTimeout(800);

    await expect(page.locator('#rail-list .chip')).toHaveCount(before + 1);
    await expect(page.locator('#stat')).toContainText('blank page added');
    const bid = await page.evaluate(() => layout.pages.blanks[0].id);
    await expect(page.frameLocator('#out').locator(`section[data-page="${bid}"]`)).toHaveCount(1);
  });

  test('deleting an empty blank page needs no confirmation', async ({ page }) => {
    await page.click('#rail-add');
    await page.waitForTimeout(600);
    const bid = await page.evaluate(() => layout.pages.blanks[0].id);
    const before = await page.locator('#rail-list .chip').count();

    await page.locator(`.chip[data-pid="${bid}"] .chip-x`).click();
    await page.waitForTimeout(600);

    await expect(page.locator('#rail-list .chip')).toHaveCount(before - 1);
    await expect(page.locator('dialog.dsdlg')).toHaveCount(0);
    // Back to zero overrides — writeOrder() drops layout.pages entirely once
    // order+blanks match the default, keeping an untouched report byte-identical.
    const stillThere = await page.evaluate(() => (layout.pages && layout.pages.blanks || []).length);
    expect(stillThere).toBe(0);
  });

  test('deleting a blank page WITH content confirms first, then purges its shapes so they cannot reappear', async ({ page }) => {
    await page.click('#rail-add');
    await page.waitForTimeout(600);
    const bid = await page.evaluate(() => layout.pages.blanks[0].id);

    const frame = page.frameLocator('#out');
    await frame.locator(`section[data-page="${bid}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.click('#shape');
    await page.click('#shapepop .shp[data-k="rect"]');
    await frame.locator('[data-shape]').first().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => layout.shapes.length)).toBe(1);

    // Deleting now must ask first — a blank page has no "unhide" to come back to.
    await page.locator(`.chip[data-pid="${bid}"] .chip-x`).click();
    const dlg = page.locator('dialog.dsdlg');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('1 element');
    await submitDialog(page);
    await page.waitForTimeout(600);

    // The page is gone, and so is the shape that lived only on it — nothing
    // orphaned in layout.json to reappear if a future blank page reuses the id.
    await expect(page.locator(`.chip[data-pid="${bid}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => layout.shapes.length)).toBe(0);
    expect(await page.evaluate(() => (layout.pages && layout.pages.blanks || []).length)).toBe(0);
  });

  test('a designed page can be neither deleted nor hidden', async ({ page }) => {
    // Designed pages (content.md-backed) carry no × control — deleting one
    // would mean deleting content.md prose from a page control, which is what
    // editing the content is for.
    const designedChip = page.locator('#rail-list .chip').first();
    await expect(designedChip.locator('.chip-x')).toHaveCount(0);

    // And no hide control either, on any chip. Hiding put a page somewhere it
    // was invisible everywhere except this strip; it is gone rather than
    // relocated, so nothing in the editor can produce a hidden page.
    await expect(page.locator('#rail-list .chip-eye')).toHaveCount(0);
    await expect(page.locator('.chip.hidden-pg')).toHaveCount(0);

    // Nothing about the strip wrote an override just by being drawn.
    expect(await page.evaluate(() => layout.pages)).toBeUndefined();
  });
});
