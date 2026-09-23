// Zooming keeps you where you were looking (edit.html's viewCentre /
// restoreCentre, applyZoom). Stepping out and back in is the case people hit:
// each step re-anchors, and any drift compounds until the report lands
// somewhere else entirely — reported as "it zooms in on the middle instead of
// where I was". Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

// Where the middle of the pane is looking, in the report's own pixels —
// independent of the scale, so it is comparable across zoom levels.
const centreY = (page) => page.evaluate(() => {
  const out = document.getElementById('out');
  const sc = out.contentDocument.scrollingElement;
  const stage = document.getElementById('stage');
  return sc.scrollTop + (stage.clientHeight / curScale) / 2;
});

test.describe('zoom keeps its place', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('stepping out and back in returns to the same part of the report',
    async ({ page }) => {
      // Look at something well down the report, not the top and not the middle.
      await page.frameLocator('#out').locator('section.page').nth(6)
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      const before = await centreY(page);
      expect(before).toBeGreaterThan(1000);     // genuinely scrolled away

      // out three rungs, then back in three
      for (let i = 0; i < 3; i++) { await page.click('#zb-out'); await page.waitForTimeout(250); }
      const zoomedOut = await page.evaluate(() => curScale);
      for (let i = 0; i < 3; i++) { await page.click('#zb-in'); await page.waitForTimeout(250); }
      await page.waitForTimeout(400);

      expect(await page.evaluate(() => curScale)).toBeCloseTo(1, 2);
      expect(zoomedOut).toBeLessThan(1);
      const after = await centreY(page);
      // Within half a page of where it started. Anchoring is not exact — a
      // clamp at either end legitimately shifts it — but "the middle of the
      // document" is thousands of pixels away, which is the bug.
      expect(Math.abs(after - before)).toBeLessThan(500);
    });

  // The case that actually broke. Zoom out far enough on a SHORT report and
  // the whole thing fits the pane — scrollTop pins to 0, and every further
  // step re-anchors on the middle of the document. The position is destroyed
  // while zoomed out, so coming back in cannot find it again.
  test('a report that fits when zoomed out still comes back to where you were',
    async ({ page }) => {
      await gotoEditor(page, '?project=demo-report');
      await page.frameLocator('#out').locator('section.page').last()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(700);
      const before = await page.evaluate(() =>
        document.getElementById('out').contentDocument.scrollingElement.scrollTop);
      expect(before).toBeGreaterThan(600);

      // all the way out — far enough that the report fits and cannot scroll
      for (let i = 0; i < 10; i++) {
        if (await page.locator('#zb-out').isDisabled()) break;
        await page.click('#zb-out'); await page.waitForTimeout(140);
      }
      const fits = await page.evaluate(() => {
        const sc = document.getElementById('out').contentDocument.scrollingElement;
        return sc.scrollHeight - sc.clientHeight <= 1;
      });
      expect(fits).toBe(true);          // the premise: nothing left to scroll

      // and back to where we started
      for (let i = 0; i < 20; i++) {
        if (await page.evaluate(() => curScale >= 1)) break;
        await page.click('#zb-in'); await page.waitForTimeout(140);
      }
      await page.waitForTimeout(400);
      const after = await page.evaluate(() =>
        document.getElementById('out').contentDocument.scrollingElement.scrollTop);
      // Exact in practice; the margin is for rounding at intermediate rungs.
      // Pre-fix this drifted 435px on a report only 2184px tall.
      expect(Math.abs(after - before)).toBeLessThan(120);
    });

  test('a single step out keeps the same point centred', async ({ page }) => {
    await page.frameLocator('#out').locator('section.page').nth(5)
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const before = await centreY(page);
    await page.click('#zb-out');
    await page.waitForTimeout(500);
    const after = await centreY(page);
    expect(Math.abs(after - before)).toBeLessThan(300);
  });

  // THE TOP OF THE DOCUMENT — the case the other tests all miss, because they
  // scroll somewhere first and so never sit against scrollTop 0.
  //
  // Zooming out from the top wants to scroll ABOVE the document on every
  // step: a shorter scale makes the viewport taller, and holding a point at
  // its centre would need a negative scrollTop. The scroller refuses, so the
  // visible centre slides further into the document each step — unavoidable,
  // and fine, as long as it is recognised as a CLAMP rather than as where the
  // reader chose to be. restoreCentre's check compared against Math.max(0,
  // wantY), which at the top compares 0 against 0: no gap, never flagged. The
  // slid position was then measured as a real one, and zooming back in
  // restored the drift faithfully. Reported as "zoom out and back in and it
  // zooms in on a different part of the page"; the repro below came back on
  // page 2, 1296px adrift.
  test('zooming out from the TOP and back returns to the top, not further in',
    async ({ page }) => {
      await gotoEditor(page, '?project=tax-testimony');
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        document.getElementById('out').contentDocument.scrollingElement.scrollTop = 0;
      });
      await page.waitForTimeout(400);

      // Which page is actually under the middle of the pane — measured from
      // the document, not from the formula the anchoring itself uses.
      const centrePage = () => page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const sc = d.scrollingElement;
        const mid = sc.scrollTop + sc.clientHeight / 2;
        const pages = [...d.querySelectorAll('section.page')];
        const i = pages.findIndex(p => mid >= p.offsetTop
          && mid < p.offsetTop + p.offsetHeight);
        return { page: i + 1, docY: Math.round(mid) };
      });

      const walk = async (btn) => {
        for (let i = 0; i < 30; i++) {
          if (await page.locator(btn).isDisabled()) break;
          await page.click(btn);
          await page.waitForTimeout(160);
        }
        await page.waitForTimeout(400);
      };

      await walk('#zb-in');                    // all the way in (200%)
      const at200 = await centrePage();
      expect(at200.page).toBe(1);              // still at the top

      await walk('#zb-out');                   // all the way out (25%)
      await walk('#zb-in');                    // and all the way back in
      const back = await centrePage();

      expect(back.page).toBe(at200.page);
      expect(Math.abs(back.docY - at200.docY)).toBeLessThan(120);
    });
});
