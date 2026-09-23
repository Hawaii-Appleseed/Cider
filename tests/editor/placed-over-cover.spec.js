// A placed element must be REACHABLE wherever it is placed — including on top
// of the report's own designed content.
//
// Boxes render at z-index 2 (layout.py text_boxes). The Primer's cover wrapper
// used the same 2, and comes later in the markup, so a box dropped on the cover
// painted UNDERNEATH the cover's title and wrapper. The worst failure shape:
// perfectly visible (the wrapper is transparent) and completely unclickable —
// you can see your note, you cannot select it, move it, or edit it, and nothing
// says why. Playwright's own diagnosis when this surfaced: "element is visible,
// enabled and stable ... <div class="cover-inner"> intercepts pointer events".
//
// The invariant this pins is deliberately not "cover-inner has z-index 1": it
// is that a freshly placed box is the thing under the cursor at its own centre.
// Any future chrome that outranks the editable layer fails here too.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('a text box placed over the cover', () => {
  test('is the element under the cursor, not buried by the cover', async ({ page }) => {
    await gotoEditor(page);

    // Mid-cover, over the title — the spot the original report came from.
    const id = await page.evaluate(async () => {
      await docsync.api.addTextBox({ page: 1, x: 2, y: 4, w: 3, md: 'Cover note' });
      return boxes().slice(-1)[0].id;
    });
    await page.waitForTimeout(1200);

    const probe = await page.evaluate(boxId => {
      const d = document.getElementById('out').contentDocument;
      const el = d.querySelector(`[data-el="text.${boxId}"]`);
      if (!el) return { placed: false };
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const hit = d.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        placed: true,
        reachesBox: !!(hit && hit.closest(`[data-el="text.${boxId}"]`)),
        // What actually won, so a failure names the culprit instead of just
        // reporting false.
        topmost: hit ? hit.tagName.toLowerCase()
          + (hit.className ? '.' + String(hit.className).slice(0, 30) : '') : '(none)',
      };
    }, id);

    expect(probe.placed, 'the box was never placed on page 1').toBe(true);
    expect(probe.reachesBox,
      `a box placed on the cover is buried — "${probe.topmost}" is on top of it, `
      + 'so it cannot be selected, moved or edited').toBe(true);
  });

  test('and can actually be selected by clicking it', async ({ page }) => {
    await gotoEditor(page);
    const id = await page.evaluate(async () => {
      await docsync.api.addTextBox({ page: 1, x: 2, y: 4, w: 3, md: 'Cover note' });
      return boxes().slice(-1)[0].id;
    });
    await page.waitForTimeout(1200);

    const frame = page.frameLocator('#out');
    const el = frame.locator(`[data-el="text.${id}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(400);
    // The editor marks its current selection on the element itself.
    await expect(el).toHaveClass(/ds-sel/);
  });
});
