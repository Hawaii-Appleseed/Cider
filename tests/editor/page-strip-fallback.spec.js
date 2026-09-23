// The page strip for reports whose renderer does NOT declare its pages.
//
// The strip was built for the Primer, and it showed: `designedPages` came only
// from the ds-pagemeta script that report's renderer emits, so for every other
// report the list was empty and railRender() hid the whole strip — no
// thumbnails, no page numbers, no click-to-scroll. Even where a strip did
// appear, each preview was found with section[data-page="<id>"], another thing
// only that renderer stamps, so the chips fell back to the empty hatch.
//
// Two halves, and this file pins both:
//   * declared (L.pagemeta / the Primer) — thumbnails AND order editing;
//   * undeclared (demo-report and every hand-written renderer) — thumbnails and
//     navigation, with the order-editing controls deliberately absent, because
//     layout.pages means nothing to a renderer that never reads page_order().
// Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** How many chips show a real preview rather than the empty hatch. Reads the
 *  shadow root, which is where the cloned page actually lands — asserting on
 *  the absence of .empty alone would pass on a chip whose shadow tree is there
 *  but built to nothing (a scale(0) preview is exactly how this broke once). */
const previewCount = page => page.evaluate(() =>
  [...document.querySelectorAll('#rail-list .chip')]
    .filter(c => c.querySelector('.chip-view')?.shadowRoot?.childElementCount).length);

test.describe('page strip: renderer declares no pages', () => {
  test.beforeEach(async ({ page }) => {
    // demo-report's renderer emits no ds-pagemeta and no data-page — the case
    // the whole strip used to be invisible for. A tracked binding in this
    // repo's docsync.yml, so it is here in every clone, and kept unstamped on
    // purpose now that our-mission, rxkids and docsync.scaffold's output all
    // declare their pages (see insert-page-target.spec.js, which relies on the
    // same thing).
    await gotoEditor(page, '?project=demo-report');
    await page.waitForTimeout(800);
    // The premise, asserted rather than assumed: every check below is about
    // what the editor does with NO declaration, so a converted subject would
    // quietly turn this file into a test of the other branch.
    expect(await page.evaluate(() => pagesDeclared),
      'demo-report is the designated undeclared renderer; it now declares its '
      + 'pages, so this file needs a different subject').toBe(false);
  });

  test('the strip appears, with a real preview for every sheet', async ({ page }) => {
    await expect(page.locator('#rail')).toBeVisible();
    const sheets = await page.frameLocator('#out').locator('section.page').count();
    expect(sheets).toBeGreaterThan(1);          // a one-page report proves nothing

    // A chip per sheet, every one of them drawn.
    await expect(page.locator('#rail-list .chip')).toHaveCount(sheets);
    await expect.poll(() => previewCount(page)).toBe(sheets);
    await expect(page.locator('#rail-list .chip-thumb.empty')).toHaveCount(0);

    // Pages this report never named still get their ordinal, which is what a
    // report with no page identity means by "page 2".
    expect(await page.locator('#rail-list .chip').first().getAttribute('data-pid')).toBe('1');
  });

  test('clicking a chip scrolls to that page', async ({ page }) => {
    // The chip scrolls with behavior:'smooth', and this runner will not finish
    // that animation: headless Chromium starts it, moves about five pixels and
    // abandons it. The sheet never arrives, so railSyncActive is then RIGHT to
    // leave the highlight on page 1 — the failure was the runner's, not the
    // strip's. emulateMedia({reducedMotion:'reduce'}) does NOT help, because an
    // explicit behavior argument outranks both the CSS property and the media
    // query; the only lever is the argument itself. Patched in the preview
    // frame alone, and only the behavior — the call, the target it is called
    // on, and everything the click does to find that target are still the
    // code's own, which is the part worth testing.
    await page.evaluate(() => {
      const w = document.getElementById('out').contentWindow;
      const real = w.Element.prototype.scrollIntoView;
      w.Element.prototype.scrollIntoView = function (arg) {
        return real.call(this, arg && typeof arg === 'object'
          ? Object.assign({}, arg, { behavior: 'auto' }) : arg);
      };
    });

    const frame = page.frameLocator('#out');
    const second = frame.locator('section.page').nth(1);
    const top = () => second.evaluate(el => el.getBoundingClientRect().top);
    const before = await top();
    expect(before).toBeGreaterThan(200);       // page 2 starts well off-screen

    await page.locator('#rail-list .chip').nth(1).click();

    // ARRIVED, not merely moved. This was `toBeLessThan(before)`, which a few
    // stray pixels satisfy — which is exactly what an abandoned smooth scroll
    // leaves behind, so the one assertion that noticed anything was wrong was
    // the class below. The lookup used to be by data-page, which this report
    // does not stamp, so the click found nothing and scrolled nowhere.
    await expect.poll(top).toBeLessThan(40);
    await expect(page.locator('#rail-list .chip').nth(1)).toHaveClass(/\bon\b/);
  });

  test('the order-editing controls are absent, not inert', async ({ page }) => {
    // Reordering, hiding and blank pages all need a renderer that reads
    // L.page_order(); this one does not, so writing an order would change
    // layout.json and nothing on the page. Offering the control and doing
    // nothing is the one outcome worse than not offering it.
    await expect(page.locator('#rail-list .rail-ins')).toHaveCount(0);
    const draggable = await page.locator('#rail-list .chip').first()
      .evaluate(c => c.draggable);
    expect(draggable).toBe(false);

    // display:flex beats [hidden]'s display:none, so this needs the real
    // computed value — the same trap as #bar > button[hidden] and .pop .shp.
    await expect(page.locator('#rail-add')).toBeHidden();
    expect(await page.locator('#rail-add').evaluate(b => getComputedStyle(b).display))
      .toBe('none');
  });
});

test.describe('page strip: renderer declares its pages', () => {
  test('the Primer keeps thumbnails AND the full order editor', async ({ page }) => {
    await gotoEditor(page);                     // default project: budget-primer
    await page.waitForTimeout(800);

    const chips = page.locator('#rail-list .chip');
    const n = await chips.count();
    expect(n).toBeGreaterThan(1);
    await expect.poll(() => previewCount(page)).toBe(n);

    // Declared pages carry their names, which is what the fallback cannot know.
    // The name is the chip's tooltip and accessible name now, not a caption
    // under the thumbnail — twelve ellipsised captions ("Budget B…", "How
    // Mon…") identified nothing the preview and the number did not already.
    await expect(chips.first()).toHaveAttribute('data-tip', 'Cover');
    await expect(chips.first()).toHaveAttribute('aria-label', 'Cover');

    // Everything the undeclared case withholds is present here. Hiding is not
    // on that list — it is gone for every report (see pages.spec.js).
    await expect(page.locator('#rail-list .rail-ins')).toHaveCount(n + 1);
    await expect(page.locator('#rail-list .chip-eye')).toHaveCount(0);
    await expect(page.locator('#rail-add')).toBeVisible();
    expect(await chips.first().evaluate(c => c.draggable)).toBe(true);
  });
});
