// Undo/redo (docsync/editor/edit.html): pushHistory()/undo()/redo() snapshot
// {source, layout} on every structural edit. Uses the section-add flow (now a
// native <dialog> form) as a convenient, already-verified mutation.
const { sharedTest: test, expect, gotoEditor, fillDialog, submitDialog, clickAddSection } = require('./fixtures/editor-test');

async function addSection(page, slug) {
  await clickAddSection(page);
  await fillDialog(page, { page: 'basics', slug });
  await submitDialog(page);
  await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
}

test.describe('undo / redo', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('start disabled, then undo reverts an added section and redo brings it back', async ({ page }) => {
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#redo')).toBeDisabled();

    await addSection(page, 'undo-me');

    const frame = page.frameLocator('#out');
    const key = 'extra.basics.undo-me';
    await expect(frame.locator(`[data-slot="${key}"]`)).toHaveCount(1);
    await expect(page.locator('#undo')).toBeEnabled();
    await expect(page.locator('#redo')).toBeDisabled();

    await page.click('#undo');
    await expect(frame.locator(`[data-slot="${key}"]`)).toHaveCount(0);
    await expect(page.locator('#redo')).toBeEnabled();

    await page.click('#redo');
    await expect(frame.locator(`[data-slot="${key}"]`)).toHaveCount(1);
    await expect(page.locator('#redo')).toBeDisabled();
  });

  test('a text-slot edit is undoable — the slot editor pushes history', async ({ page }) => {
    // Regression: editing prose in a [data-slot] used to commit to `source`
    // WITHOUT pushHistory(), so a typed edit or deletion was not undoable —
    // ⌘Z found nothing (or undid an earlier move). Editing the cover title
    // (a proven editable slot) must now leave undo enabled and revert.
    const frame = page.frameLocator('#out');
    const title = frame.locator('[data-slot="cover.title"]');
    await expect(title).toContainText('HAWAI');

    await title.dblclick({ force: true });
    const ta = frame.locator('.ds-edit');
    await ta.waitFor({ state: 'visible' });
    await ta.evaluate(el => { el.textContent = 'A DIFFERENT TITLE'; });
    await ta.evaluate(el => el.blur());

    await expect(frame.locator('h1.cover-title')).toContainText('DIFFERENT');
    await expect(page.locator('#undo')).toBeEnabled();   // the edit was recorded

    await page.click('#undo');
    await expect(frame.locator('h1.cover-title')).toContainText('HAWAI');  // restored
  });

  test('undo with nothing to undo is a no-op, not an error', async ({ page }) => {
    // #undo is disabled (no history yet), so Playwright can't click it — use
    // the ⌘Z shortcut, which calls undo() directly and hits its own early
    // "nothing to undo" guard.
    await expect(page.locator('#undo')).toBeDisabled();
    await page.keyboard.press('Control+z');
    await expect(page.locator('#stat')).toContainText('nothing to undo');
  });

  // One history, two backends (undoHistory): a step that is opened and then
  // withdrawn because it changed nothing used to cost the redo list when
  // editing alone (pushHistory emptied it before the action had done
  // anything), while in a shared session redo survived.
  test('a refused change leaves the redo list as it was', async ({ page }) => {
    await page.evaluate(() => docsync.api.setSlot('basics.h1', 'REDO SURVIVES'));
    await page.evaluate(() => undo());
    await expect(page.locator('#redo')).toBeEnabled();
    const kept = await page.evaluate(async () => { await changeDoc(() => false); return !$('redo').disabled; });
    expect(kept).toBe(true);
    await page.evaluate(() => redo());
    await expect(page.frameLocator('#out').locator('[data-slot="basics.h1"]')).toContainText('REDO SURVIVES');
  });

  // A step's time was keyed by its snapshot string, so two steps that began
  // from the same state shared one time: the History list showed the first
  // step at the time of the later one (and withdrawing the later one wiped it).
  test('two steps that start from the same state keep their own times', async ({ page }) => {
    const t = await page.evaluate(async () => {
      const was = docsync.api.getSlot('basics.h1').md;
      await docsync.api.setSlot('basics.h1', 'FIRST');
      const first = historyList().find(r => r.i === -1).time;
      await new Promise(r => setTimeout(r, 1100));   // a different second on the list
      await docsync.api.setSlot('basics.h1', was);
      await docsync.api.setSlot('basics.h1', 'FIRST');
      return { first, listed: historyList().find(r => r.i === -3).time };
    });
    expect(t.first).toBeTruthy();
    expect(t.listed).toBe(t.first);
  });
});
