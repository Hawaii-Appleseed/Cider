// Delete on a DESIGNED element (renderer-emitted, no layout.json entry) used
// to be a silent no-op: deleteSel matched shapes, boxes, tables and position
// overrides, and a designed element in its designed place is none of those —
// touched stayed false and the history entry was popped. Now Delete stages:
//   moved element   -> back to its designed spot (the old behavior, kept)
//   designed spot   -> hidden (layout.hidden; display:none in the editor AND
//                      on the published page — a delete that half-fades an
//                      element reads as a delete that did not work)
// Reversal is Undo, or File > Restore deleted, which lists what is gone: a
// deleted element draws nothing, so it cannot be clicked to bring it back.
// Local mode; basics.h1 is the same guinea pig movable-headings.spec.js uses.
// Delete goes through the KEYBOARD: for a single text object the toolbar row
// shows the type controls, not the arrange strip, so #ar-del isn't on screen
// — which is exactly the path a person deleting a heading takes.
const { warmTest: test, expect, gotoEditor, selectWithoutTyping } = require('./fixtures/editor-test');

const ID = 'basics.h1';

async function selectH1(page, frame) {
  await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  // Without opening its words: with the heading's words open, Delete deletes
  // a character instead of resetting or hiding the element, and on CI the move
  // then never reset whenever the editor was still open at the keypress.
  await selectWithoutTyping(page, frame.locator(`[data-el="${ID}"]`));
}

test.describe('deleting a designed element hides it, reversibly', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('delete removes it from the canvas, and File > Restore brings it back',
    async ({ page }) => {
    const frame = page.frameLocator('#out');
    await selectH1(page, frame);

    // Pre-fix this exact step left layout.hidden undefined — the no-op path.
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => layout.hidden)).toEqual([ID]);

    // Gone, not faded. The element stays in the markup (the renderer would
    // regenerate it anyway) but draws nothing and occupies no space.
    const gone = frame.locator(`[data-el="${ID}"]`);
    await expect(gone).toBeHidden();
    expect(await gone.evaluate(el => getComputedStyle(el).display)).toBe('none');
    expect(await gone.evaluate(el => el.getBoundingClientRect().height)).toBe(0);
    expect(await gone.evaluate(el => getComputedStyle(el).opacity)).toBe('1');

    // It is still marked, which is what lets the editor list it for restore.
    await expect(gone).toHaveAttribute('data-hidden', '1');

    // The File menu now offers it back, and names how many are gone.
    await page.click('#file');
    const restore = page.locator('#file-restore');
    await expect(restore).toBeVisible();
    await expect(restore).toHaveText('Restore deleted (1)…');
    await restore.click();

    const dlg = page.locator('dialog[open]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('select option')).toHaveText([ID, 'Everything (1)']);
    await dlg.getByRole('button', { name: 'Restore' }).click();

    await expect.poll(() => page.evaluate(() => layout.hidden)).toBeUndefined();
    await expect(frame.locator(`[data-el="${ID}"]`)).toBeVisible();
  });

  test('a moved element resets first, hides second — the old behavior survives', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await selectH1(page, frame);

    // Seed a position override the way a drag would.
    await page.evaluate(id => {
      layout.positions[id] = { x: 1.2, y: 3.4, w: 3 };
      markDirty();
    }, ID);

    // First delete: reset the move, do NOT hide.
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(id => layout.positions[id], ID)).toBeUndefined();
    expect(await page.evaluate(() => layout.hidden)).toBeUndefined();

    // Second delete: now it hides.
    await selectH1(page, frame);
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate(() => layout.hidden)).toEqual([ID]);

    // Restore so this spec leaves no state behind for the next one — through
    // File ▸ Restore, the way the test above establishes. Clicking the element
    // itself cannot work and never really did: a hidden one is display:none
    // with a zero box (asserted above), so the click only ever landed while
    // the canvas still lagged the data. Incremental rendering applies the
    // hide immediately, and the lag it leaned on is gone.
    await page.click('#file');
    await page.locator('#file-restore').click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => page.evaluate(() => layout.hidden)).toBeUndefined();
  });

  test('deleting closes the gap, so the page reflows as it will when published',
    async ({ page }) => {
    const frame = page.frameLocator('#out');
    const page3 = frame.locator('section.page').nth(2);
    await page3.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const before = await page3.evaluate(el => el.scrollHeight);

    await selectH1(page, frame);
    await page.keyboard.press('Delete');
    // The re-render swaps documents in when Pyodide finishes — under a loaded
    // suite that can outlast any fixed sleep, so wait for the marker itself.
    await expect(frame.locator(`[data-el="${ID}"]`))
      .toHaveAttribute('data-hidden', '1', { timeout: 30000 });

    // The heading's space is genuinely given back — no reserved hole where it
    // used to be. That is the half the old ghost could not do. (A global
    // .ds-spacer count would be wrong here: this page carries spacers for
    // unrelated moved elements, as movable-headings.spec.js also notes.)
    const after = await frame.locator('section.page').nth(2)
      .evaluate(el => el.scrollHeight);
    expect(after).toBeLessThan(before);
  });
});
