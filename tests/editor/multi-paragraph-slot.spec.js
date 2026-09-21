// EVERY paragraph of a multi-paragraph slot must open the editor — not just
// the first.
//
// content.py's html() stamps data-slot on each <p> it emits, and paragraphs()
// exists precisely so someone can add a paragraph inside a slot and have it
// flow into the report. But wire() bound its click/dblclick handler behind a
// `seen` Set keyed on the slot name, so the SECOND <p> of a slot — correctly
// tagged, visually part of the same text block — got no listener at all and
// was simply dead to the mouse. Reported on the live primer as "clicking the
// top of this paragraph edits it, clicking the bottom half does nothing"
// (whopays.p1, plus three more slots in that report).
//
// edit() has always been keyed by SLOT, not by element — it collects every
// block with the key, replaces the first with one editor holding the whole
// slot's markdown and drops the rest — so binding all of them is both safe
// and idempotent.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const SLOT = 'whopays.p1';
const PROBE = 'SECONDPARAPROBE this paragraph was added inside the slot.';

test.describe('a slot rendered as several paragraphs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('opens the editor from the SECOND paragraph, not just the first',
    async ({ page }) => {
      const frame = page.frameLocator('#out');

      // Add a second paragraph the way the slot format intends: a blank line.
      await page.evaluate(async ([slot, probe]) => {
        writeSlot(slot, readSlot(slot) + '\n\n' + probe);
        await render();
      }, [SLOT, PROBE]);

      const paras = frame.locator(`[data-slot="${SLOT}"]`);
      await expect(paras).toHaveCount(2);          // the renderer tagged both

      // The bug: this second <p> had no handler bound, so nothing happened.
      const second = paras.nth(1);
      await second.scrollIntoViewIfNeeded();
      await expect(second).toContainText('SECONDPARAPROBE');
      await second.dblclick({ force: true });

      await expect(frame.locator('.ds-edit')).toBeVisible();
      // One editor, holding the WHOLE slot — both paragraphs, as edit() intends.
      await expect(frame.locator('.ds-edit')).toContainText('SECONDPARAPROBE');
      expect(await page.evaluate(() => editing)).toBe(true);
    });

  test('still opens the editor from the first paragraph', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await page.evaluate(async ([slot, probe]) => {
      writeSlot(slot, readSlot(slot) + '\n\n' + probe);
      await render();
    }, [SLOT, PROBE]);

    const first = frame.locator(`[data-slot="${SLOT}"]`).first();
    await first.scrollIntoViewIfNeeded();
    await first.dblclick({ force: true });
    await expect(frame.locator('.ds-edit')).toBeVisible();
    // Exactly one editor opened, not one per paragraph.
    await expect(frame.locator('.ds-edit')).toHaveCount(1);
  });
  test('an emptied slot keeps an element, so the words can be typed back',
    async ({ page }) => {
      const frame = page.frameLocator('#out');

      // Delete every word of the slot — what selecting a paragraph and
      // pressing Backspace does. The block stays in content.md; the page used
      // to render nothing for it, which left no element to click and no way
      // back in short of editing content.md by hand.
      await page.evaluate(async slot => {
        writeSlot(slot, '');
        await render();
      }, SLOT);

      const para = frame.locator(`[data-slot="${SLOT}"]`);
      await expect(para).toHaveCount(1);
      await expect(para).toContainText('empty');

      await para.scrollIntoViewIfNeeded();
      await para.dblclick({ force: true });
      await expect(frame.locator('.ds-edit')).toBeVisible();
      expect(await page.evaluate(() => editing)).toBe(true);
      // The placeholder is page furniture, never content: the editor reads
      // the slot from content.md, so it opens empty.
      expect(await page.evaluate(s => readSlot(s), SLOT)).toBe('');

      // and typing puts real words back in — blur commits (Escape discards)
      await page.keyboard.type('BACKAGAIN');
      await page.evaluate(() =>
        document.getElementById('out').contentDocument
          .querySelector('.ds-edit').blur());
      await page.waitForTimeout(1500);
      expect(await page.evaluate(s => readSlot(s), SLOT)).toContain('BACKAGAIN');
    });
});
