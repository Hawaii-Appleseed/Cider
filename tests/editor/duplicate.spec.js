// Duplicate, made honest (docsync/editor/edit.html dupModeOf/duplicateSel).
// It used to allow only shapes and text boxes and grey out on everything
// else — which read as broken, because "everything else" is most of what a
// person clicks. Now: shapes, text boxes and TABLES clone outright; a
// designed element (heading, prose, logo) hands back its content as a
// floating text box — a second heading slot cannot exist, but the words,
// loose and restylable, are what duplicating one means. Endnotes stay out:
// their drag story is reordering, not copying. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** Select an element by id through the editor's own selection machinery,
 *  which also raises the mini toolbar beside it. */
async function select(page, id) {
  await page.evaluate(id => setSel($('out').contentDocument, [id]), id);
  await page.waitForTimeout(150);
}

const miniDup = page => page.frameLocator('#out')
  .locator('.ds-mini button[aria-label^="Duplicate"]');

test.describe('duplicate', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('a table duplicates from the mini toolbar', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.click('#table');
    await frame.locator('table.ds-table[data-el]').first()
      .waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(800);

    const before = await page.evaluate(() => layout.tables.length);
    await expect(miniDup(page)).toBeEnabled();
    await miniDup(page).click();
    await page.waitForTimeout(1200);

    const t = await page.evaluate(() => layout.tables);
    expect(t.length).toBe(before + 1);
    // A real clone: same grid, its own id, nudged off the original.
    expect(t[1].rows).toEqual(t[0].rows);
    expect(t[1].id).not.toBe(t[0].id);
    expect(t[1].x).toBeCloseTo(t[0].x + 0.2, 5);
  });

  test('a designed heading duplicates as a text box carrying its words', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await select(page, 'basics.h1');

    await expect(miniDup(page)).toBeEnabled();
    await miniDup(page).click();
    await page.waitForTimeout(1200);

    const box = await page.evaluate(() => (layout.boxes || [])[0]);
    expect(box).toBeTruthy();
    // The authored text from content.md, not the DOM's marker-riddled copy.
    const slotMd = await page.evaluate(() => readSlot('basics.h1'));
    expect(box.md).toBe(slotMd);
    expect(box.page).toBe(3);
    // And the heading itself is untouched — this was a copy, not a move.
    await expect(frame.locator('[data-el="basics.h1"]')).toHaveCount(1);
  });

  test('a designed image duplicates as an image box', async ({ page }) => {
    await select(page, 'cover.logo');
    await expect(miniDup(page)).toBeEnabled();
    await miniDup(page).click();
    await page.waitForTimeout(1200);

    const box = await page.evaluate(() => (layout.boxes || [])[0]);
    expect(box).toBeTruthy();
    expect(box.md).toMatch(/^!\[.*\]\(assets\/appleseed-logo\.svg\)$/);
    expect(box.page).toBe(1);
  });

  test('an endnote does not offer Duplicate — its drag reorders instead', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(11).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const id = await page.evaluate(() => {
      const li = document.querySelector('#out').contentDocument
        .querySelector('[data-el^="endnote."]');
      return li && li.dataset.el;
    });
    expect(id).toBeTruthy();
    await select(page, id);
    await expect(miniDup(page)).toBeDisabled();
    await expect(miniDup(page)).toHaveAttribute('aria-label', /reorders instead/);
    await expect(page.locator('#ar-dup')).toBeDisabled();
  });
});
