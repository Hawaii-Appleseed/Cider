// Which page a new element is stamped with (edit.html's visiblePageId, fed by
// layout.py's edit-mode mount marker). Every insert — text box, expandable,
// PDF button, shape, icon, image, table, chart — carries a page, and the
// validator refuses one without a real page number, so getting this wrong
// bricks the draft on the very FIRST thing someone adds.
//
// The whole rest of the suite drives the Budget Primer fixture, which stamps
// data-page on its sections. These tests deliberately drive demo-report, which
// stamps nothing — the case that shipped broken precisely because no test
// looked at it. Local mode; nothing is saved.
//
// demo-report is now the DESIGNATED renderer for that case, and is kept
// unstamped on purpose: our-mission, rxkids and everything docsync.scaffold
// builds went over to L.page_order()/L.pagemeta(), and a report that declares
// its pages exercises the stamped path instead. If demo-report is ever
// converted too, these tests would keep passing while testing nothing at all —
// so the premise is asserted below rather than assumed.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const DEMO = '?project=demo-report';

/** Fails loudly, naming the cause, if the subject stops being the unstamped
 *  case — the alternative is silent loss of the only coverage this path has. */
async function expectNoStampedPages(page) {
  const stamped = await page.frameLocator('#out')
    .locator('section.page[data-page]').count();
  expect(stamped,
    'demo-report is the designated renderer with NO stamped page ids; it now '
    + 'stamps them, so this file needs a different subject (or a fixture that '
    + 'declares nothing) to keep covering the fallback').toBe(0);
}

test.describe('insert target on a report with no stamped page ids', () => {
  test('adding a text box yields a real page number, and the draft still builds',
    async ({ page }) => {
      await gotoEditor(page, DEMO);
      await expectNoStampedPages(page);
      await page.click('#text');
      await page.click('#textpop .txtpreset[data-k="body"]');
      await page.frameLocator('#out').locator('.ds-textbox').first()
        .waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForTimeout(800);

      // the stamp itself: a number the renderer will actually look for
      const box = await page.evaluate(() => layout.boxes[layout.boxes.length - 1]);
      expect(box).toBeTruthy();
      expect(typeof box.page).toBe('number');
      expect(box.page).toBe(1);          // demo-report mounts on page 1 only

      // and the draft still renders — this is the reported crash:
      // "box #1: 'page' must be a page number or blank-page id"
      const err = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        return (d && d.body ? d.body.textContent : '') || '';
      });
      expect(err).not.toContain('does not build');
      expect(await page.locator('#stat').textContent()).not.toContain('does not build');
      // the box is really on the page, not just in the data
      await expect(page.frameLocator('#out').locator('.ds-textbox')).toHaveCount(1);
    });

  test('a shape added there is stamped too, so the draft survives it',
    async ({ page }) => {
      await gotoEditor(page, DEMO);
      await expectNoStampedPages(page);
      await page.click('#shape');
      await page.click('#shapepop .shp[data-k="rect"]');
      await page.frameLocator('#out').locator('[data-shape]').first()
        .waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForTimeout(800);

      const shape = await page.evaluate(() => layout.shapes[layout.shapes.length - 1]);
      expect(typeof shape.page).toBe('number');
      const body = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        return (d && d.body ? d.body.textContent : '') || '';
      });
      expect(body).not.toContain('does not build');
    });

  // demo-report's SECOND sheet is its endnotes page, which its renderer never
  // mounts inserts on — text_boxes(1) is the only call. Landing a box there
  // validates and then silently never appears, which is worse than the crash.
  // The nearest sheet that can actually host it is the answer.
  test('an insert made while viewing an unmountable sheet lands where it will show',
    async ({ page }) => {
      await gotoEditor(page, DEMO);
      await expectNoStampedPages(page);
      // scroll the endnotes sheet into view, so it is the "page in view"
      await page.frameLocator('#out').locator('section.page').last()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await page.click('#text');
      await page.click('#textpop .txtpreset[data-k="body"]');
      await page.waitForTimeout(1200);

      const box = await page.evaluate(() => layout.boxes[layout.boxes.length - 1]);
      expect(box.page).toBe(1);          // NOT 2 — page 2 would swallow it
      await expect(page.frameLocator('#out').locator('.ds-textbox')).toHaveCount(1);
    });
});
