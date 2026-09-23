// A project imported via docsync.scaffold + docsync.propose gets its PROSE
// wired as editable slots automatically, and free-standing images as
// movable — but everything else (stat cards, poll bars, any structural
// "content box") stays inert on purpose: turning arbitrary markup into a
// selectable, draggable element is a judgment call the tooling deliberately
// does not attempt (STAGE2_AUTOMATION.md). Reported live: tfc-2027-priorities
// opened with no ring and no floating mini toolbar on anything but text, and
// nothing had said that would happen. checkStage2() (edit.html) is the fix —
// this spec is what stops it regressing silently.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('the stage-two notice', () => {
  test('shows for a project imported via scaffold + propose', async ({ page }) => {
    // our-mission carries body.slotted.html in its engine list — the same
    // structural tell checkStage2() reads, and true of every project this
    // notice exists for (see docsync.yml).
    await gotoEditor(page, '?project=our-mission');
    await expect(page.locator('#s2')).toBeVisible();
    await expect(page.locator('#s2')).toContainText('content boxes not yet editable');
    const title = await page.locator('#s2').getAttribute('title');
    expect(title).toContain('STAGE2_AUTOMATION.md');
  });

  test('does not show for a project authored from a template', async ({ page }) => {
    // budget-primer has no body.slotted.html — every element that should be
    // selectable was wired by hand as it was written, not proposed
    // mechanically, so there is nothing this notice would be warning about.
    await gotoEditor(page);
    await expect(page.locator('#s2')).toBeHidden();
  });

  test('dismissing it is remembered per project, and does not leak to another',
    async ({ page }) => {
      await gotoEditor(page, '?project=our-mission');
      await expect(page.locator('#s2')).toBeVisible();
      await page.click('#s2');
      await expect(page.locator('#s2')).toBeHidden();

      // Stays dismissed across a reload of the SAME project.
      await gotoEditor(page, '?project=our-mission');
      await expect(page.locator('#s2')).toBeHidden();

      // A DIFFERENT scaffold-derived project still gets its own notice — the
      // dismissal is not a blanket "never show this again".
      await gotoEditor(page, '?project=tfc-2027-priorities');
      await expect(page.locator('#s2')).toBeVisible();

      // Clean up: this key must not outlive the spec and affect a later run.
      await page.evaluate(() => localStorage.removeItem('primer-s2-seen:our-mission'));
    });
});
