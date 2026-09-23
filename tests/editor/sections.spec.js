// Structural section editing (docsync/editor/edit.html): add/reorder/move/
// delete an [[extra.<page>.<slug>]] overflow section. The +Section and delete
// flows now go through native <dialog> modals (dsForm/dsConfirm), not
// prompt()/confirm(). Local-mode: no GitHub, only in-memory `source` and the
// Pyodide-rendered iframe.
const { warmTest: test, expect, gotoEditor, fillDialog, submitDialog, clickAddSection } = require('./fixtures/editor-test');

/** Add a section through the +Section dialog: pick a page and name it in one
 *  form, submit, then Escape out of the auto-opened editor so it re-renders
 *  read-only with its .extra-section / .ds-xtools controls. */
async function addSection(page, slug, pageValue = 'basics') {
  await clickAddSection(page);
  await fillDialog(page, { page: pageValue, slug });
  await submitDialog(page);
  await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
}

test.describe('section editing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('adds a new section to a page and it renders', async ({ page }) => {
    await addSection(page, 'auto-test-section');

    const frame = page.frameLocator('#out');
    // toHaveCount, not toBeVisible: a section landing past the print-fit cut
    // is genuinely clipped by its (print-accurate) .page container — that's
    // real behavior, not a broken render, so visibility isn't the right check.
    const section = frame.locator('[data-slot="extra.basics.auto-test-section"]');
    await expect(section).toHaveCount(1);
    await expect(section).toContainText('New section');
    await expect(page.locator('#undo')).toBeEnabled();
    await expect(page.locator('#save')).toBeEnabled();
  });

  test('reorders two sections on the same page with ↑/↓', async ({ page }) => {
    await addSection(page, 'section-a');
    await addSection(page, 'section-b');

    const frame = page.frameLocator('#out');
    const extras = frame.locator('.extra-section[data-extra="1"]');
    await expect(extras).toHaveCount(2);
    await expect(extras.nth(0)).toHaveAttribute('data-slot', 'extra.basics.section-a');
    await expect(extras.nth(1)).toHaveAttribute('data-slot', 'extra.basics.section-b');

    // .ds-xtools only shows on :hover of its .extra-section, and the report
    // page can render below the fold of the (CSS-scaled) preview iframe — both
    // make a real mouse hover/click unreliable here. dispatchEvent fires the
    // listener directly on the node, skipping hit-testing and CSS visibility.
    await extras.nth(1).locator('.ds-xtools button', { hasText: '↑' }).dispatchEvent('click');
    const extrasAfter = frame.locator('.extra-section[data-extra="1"]');
    await expect(extrasAfter.nth(0)).toHaveAttribute('data-slot', 'extra.basics.section-b');
    await expect(extrasAfter.nth(1)).toHaveAttribute('data-slot', 'extra.basics.section-a');
  });

  test('deletes a section via the ✕ control after confirming', async ({ page }) => {
    await addSection(page, 'to-delete');

    const frame = page.frameLocator('#out');
    const key = 'extra.basics.to-delete';
    const section = frame.locator(`[data-slot="${key}"]`);
    await expect(section).toHaveCount(1);

    // The ✕ opens a dsConfirm dialog (in the parent doc); accept it.
    await section.locator('.ds-xtools button.del').dispatchEvent('click');
    await submitDialog(page);

    await expect(frame.locator(`[data-slot="${key}"]`)).toHaveCount(0);
  });

  test('a section moved to another page takes the layout with it',
    async ({ page }) => {
      await addSection(page, 'travels');
      const frame = page.frameLocator('#out');
      const key = 'extra.basics.travels';
      const moved = 'extra.process.travels';

      // Everything the layout can say about a slot, said about this one: a
      // type from the panel, a hidden paragraph inside it, that paragraph's
      // own pinned position, and a figure told to follow the section.
      await page.evaluate(k => {
        layout.text = layout.text || {};
        layout.text[k] = { size: 22 };
        layout.hidden = [`para.${k}`];
        layout.positions[`para.${k}`] = { x: 1, y: 2, reserve: 0.5 };
        layout.positions.fig = { x: 3, y: 4, anchor: { to: k } };
        layout.positions.fig2 = { x: 3, y: 5, anchor: { to: `spacer:para.${k}` } };
      }, key);

      await frame.locator(`[data-slot="${key}"] .ds-xtools button[aria-label="Move to another page"]`)
        .dispatchEvent('click');
      await fillDialog(page, { page: 'process' });
      await submitDialog(page);
      await expect(frame.locator(`[data-slot="${moved}"]`)).toHaveCount(1);

      const after = await page.evaluate(() => JSON.parse(JSON.stringify(layout)));
      expect(after.text[moved]).toEqual({ size: 22 });
      expect(after.text[key]).toBeUndefined();
      expect(after.hidden).toEqual([`para.${moved}`]);
      expect(after.positions[`para.${moved}`]).toBeTruthy();
      expect(after.positions[`para.${key}`]).toBeUndefined();
      expect(after.positions.fig.anchor.to).toBe(moved);
      expect(after.positions.fig2.anchor.to).toBe(`spacer:para.${moved}`);
    });
});
