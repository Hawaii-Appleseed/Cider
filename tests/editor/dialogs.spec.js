// Native <dialog> modals (docsync/editor/edit.html): dsForm/dsConfirm/dsPrompt
// replaced prompt()/confirm()/alert(). These pin the behaviors that were the
// point of the change — a validation error keeps typed input instead of
// discarding it (the old sequential-prompt + alert flow lost everything), and
// cancel/Escape are clean no-ops.
const { warmTest: test, expect, gotoEditor, dialog, fillDialog, cancelDialog, clickAddSection } = require('./fixtures/editor-test');

test.describe('modal dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('cancelling the +Section form adds nothing and pushes no history', async ({ page }) => {
    await clickAddSection(page);
    await fillDialog(page, { slug: 'never-added' });
    await cancelDialog(page);

    await expect(page.frameLocator('#out').locator('[data-slot="extra.basics.never-added"]')).toHaveCount(0);
    await expect(page.locator('#undo')).toBeDisabled();   // no pushHistory on cancel
  });

  test('a validation error keeps the form (and its input) open, then submits once fixed', async ({ page }) => {
    await clickAddSection(page);
    const d = await dialog(page);

    // Non-empty but normalizes to an empty slug — trips the dsForm validator.
    await d.locator('[name="slug"]').fill('!!!');
    await d.locator('.dsdlg-ok').click();
    await expect(d).toBeVisible();                         // NOT dismissed
    await expect(d.locator('.dsdlg-err')).toContainText('short name');

    // Fix it in the same dialog — nothing was lost to a dismissal — and submit.
    await d.locator('[name="slug"]').fill('now-valid');
    await d.locator('.dsdlg-ok').click();
    await d.waitFor({ state: 'hidden' });

    await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page.frameLocator('#out').locator('[data-slot="extra.basics.now-valid"]')).toHaveCount(1);
  });

  test('Escape cancels a dialog without acting', async ({ page }) => {
    await clickAddSection(page);
    await dialog(page);
    await page.keyboard.press('Escape');

    await expect(page.locator('dialog.dsdlg')).toBeHidden();
    await expect(page.locator('#undo')).toBeDisabled();
  });
});
