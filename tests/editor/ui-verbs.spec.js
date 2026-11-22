// The editor's own UI makes its edits through the pilot verbs (uiVerb in
// edit.html, docs/ui-pilot-verbs.md): one code path per action. These hold
// what that changed for a person: a refused or empty edit leaves no undo step
// and no unsaved mark, and the type toolbar's controls are each one step.
const { test, expect, gotoEditor, selectWithoutTyping } = require('./fixtures/editor-test');

const past = page => page.evaluate(() => undoHistory.steps().past.length);

test.describe('UI edits through the pilot verbs', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('a refused edit leaves no undo step, no unsaved mark, and says why', async ({ page }) => {
    const before = await past(page);
    // A note on a slot content.md does not hold: setSlotNotes found nothing,
    // the change returned undefined, and changeDoc kept an empty step.
    const r = await page.evaluate(() => uiVerb('setNotes', 'no.such-slot', ['a note']));
    expect(r).toBeNull();
    expect(await past(page)).toBe(before);
    expect(await page.evaluate(() => dirty)).toBe(false);
    await expect(page.locator('#stat')).toContainText('a slot that exists');
  });

  test('an edit that changes nothing leaves no undo step', async ({ page }) => {
    const before = await past(page);
    // A font used in no place: replaced 0, and the step used to stay.
    const r = await page.evaluate(() => uiVerb('replaceFont', 'Not A Font In This Report',
      Object.keys(fonts).sort()[0]));
    expect(r).toEqual({ replaced: 0 });
    expect(await past(page)).toBe(before);
    expect(await page.evaluate(() => dirty)).toBe(false);
  });

  test('a menu row is one undo step, and ⌘Z takes it back', async ({ page }) => {
    const before = await past(page);
    const r = await page.evaluate(() => uiVerb('setNotes', 'basics.p1', ['check this figure']));
    expect(r).toMatchObject({ key: 'basics.p1', notes: ['check this figure'] });
    expect(await past(page)).toBe(before + 1);
    expect(await page.evaluate(() => dirty)).toBe(true);
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(() => slotNotes('basics.p1').length)).toBe(0);
  });

  test('the type toolbar size field is one undo step', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await selectWithoutTyping(page, frame.locator('[data-slot="basics.h1"]').first());
    await expect.poll(() => page.evaluate(() => selected)).toBe('basics.h1');
    const was = await page.evaluate(() => styleOf('basics.h1').size ?? null);
    const before = await past(page);
    // Typing a size fires input (painted live) and then change (committed).
    await page.evaluate(async () => {
      const f = document.getElementById('ty-size');
      for (const v of ['3', '33']) { f.value = v; f.dispatchEvent(new Event('input')); }
      f.dispatchEvent(new Event('change'));
    });
    await expect.poll(() => page.evaluate(() => styleOf('basics.h1').size)).toBe(33);
    expect(await past(page)).toBe(before + 1);
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(() => styleOf('basics.h1').size ?? null)).toBe(was);
  });

  test('the size stepper is one undo step per press', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await selectWithoutTyping(page, frame.locator('[data-slot="basics.h1"]').first());
    await expect.poll(() => page.evaluate(() => selected)).toBe('basics.h1');
    const before = await past(page);
    await page.evaluate(() => document.getElementById('ty-up').click());
    await expect.poll(() => past(page)).toBe(before + 1);
  });
});
