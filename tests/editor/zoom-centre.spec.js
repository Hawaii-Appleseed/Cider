// Zoom keeps the middle of the pane fixed, and the canvas fills the pane so the
// report's own scrollbar sits on the window edge (docsync/editor/edit.html's
// applyZoom + viewCentre/restoreCentre). Before: the stage's scroll position was
// simply left alone while the canvas grew, so zooming in walked the page off to
// the right — "the zoom skews left" — and on a window wider than the design
// viewport the canvas floated in the middle, taking its scrollbar with it.
// Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const snap = (page) => page.evaluate(() => {
  const out = document.getElementById('out'), stage = document.getElementById('stage');
  const d = out.contentDocument, sc = d.scrollingElement;
  const ob = out.getBoundingClientRect(), sb = stage.getBoundingClientRect();
  const pg = d.querySelector('section.page').getBoundingClientRect();  // IFRAME-local
  return {
    scale: curScale,
    outRight: ob.right, stageRight: sb.right,
    docScrollTop: sc.scrollTop,
    // the page's centre in TOP-DOCUMENT coords, vs the pane's
    pageScreenMid: ob.x + (pg.x + pg.width / 2 - (sc.scrollLeft || 0)) * curScale,
    paneMid: sb.x + sb.width / 2,
  };
});

test.describe('zoom centring', () => {
  test('on a wide window the canvas fills the pane, so the scrollbar is flush',
    async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await gotoEditor(page);
      await page.waitForTimeout(900);
      const g = await snap(page);
      // The report scrolls INSIDE the iframe, so its scrollbar is at the
      // iframe's right edge — which must be the stage's, i.e. the window's.
      // Within a pixel, not exactly: the frame is snapped to an even width for
      // whole-pixel page centring, which can leave half a pixel either side.
      // The gap this replaced was ~200px on a 1600px window.
      expect(Math.abs(g.outRight - g.stageRight)).toBeLessThanOrEqual(2);
      // and widening the frame must not push the sheet off-centre
      expect(g.pageScreenMid).toBeCloseTo(g.paneMid, 0);
    });

  test('zooming keeps the middle of the pane, not the top-left corner',
    async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await gotoEditor(page);
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        document.getElementById('out').contentDocument.scrollingElement.scrollTop = 3000;
      });
      await page.waitForTimeout(200);
      const before = await snap(page);

      await page.evaluate(() => setZoom('1.5'));
      await page.waitForTimeout(500);
      const at150 = await snap(page);
      expect(at150.scale).toBe(1.5);
      // Horizontally the page stays under the middle of the pane...
      expect(at150.pageScreenMid).toBeCloseTo(at150.paneMid, -1);
      // ...and vertically the same part of the document is still centred: the
      // iframe viewport is clientHeight/s tall, so holding the CENTRE means
      // scrollTop must move, not stay put.
      const paneH = await page.evaluate(() => document.getElementById('stage').clientHeight);
      expect(before.docScrollTop + paneH / 2 / before.scale)
        .toBeCloseTo(at150.docScrollTop + paneH / 2 / at150.scale, -1);

      // and back out again lands where it started
      await page.evaluate(() => setZoom(''));
      await page.waitForTimeout(500);
      const back = await snap(page);
      expect(back.docScrollTop).toBeCloseTo(before.docScrollTop, -1);
      expect(back.pageScreenMid).toBeCloseTo(before.pageScreenMid, 0);
    });
});
