// The report scrolls inside the #out iframe; the stage's own vertical range is
// only the clearance band applyZoom leaves under it, so the last page can rise
// clear of the floating page strip (docsync/editor/edit.html, stageChainWire).
// Two nested scrollers are one too many for a wheel: the browser latches a
// gesture to the scroller it began on, so reaching the report's end left the
// band for a second gesture, and after a visit to the band, scrolling back up
// moved the report while the band stayed out — the top of page 1 hidden above
// the pane until one more bump moved the stage. "Scrolling all the way up
// takes an additional bump." The pair now behaves as one scroller. Local mode.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const geo = page => page.evaluate(() => {
  const out = document.getElementById('out'), stage = document.getElementById('stage');
  const w = out.contentWindow, se = w.document.scrollingElement;
  return { top: se.scrollTop, max: se.scrollHeight - w.innerHeight,
           stageTop: stage.scrollTop, band: stage.scrollHeight - stage.clientHeight,
           s: curScale };
});

test.describe('the clearance band under the last page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoEditor(page);
  });

  test('a wheel runs on into the band past the end, and unwinds it first on the way back up',
    async ({ page }) => {
      const g0 = await geo(page);
      expect(g0.band).toBeGreaterThan(20);          // the strip is out, so there is a band
      expect(g0.s).toBe(1);                         // fit at this width: report px == screen px
      const sb = await page.locator('#stage').boundingBox();
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);

      // Down, well past the end of the report. The tail is paced so a smooth-
      // scroll animation (if the engine runs one) has caught up when the ticks
      // that cross the end arrive — a finger keeps going the same way.
      for (let i = 0; i < Math.ceil(g0.max / 400) + 2; i++) await page.mouse.wheel(0, 400);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60); }
      await expect.poll(async () => (await geo(page)).top).toBeGreaterThanOrEqual(g0.max - 1);
      // …and INTO the band, in the same run of ticks — no second gesture.
      await expect.poll(async () => (await geo(page)).stageTop).toBeGreaterThanOrEqual(g0.band - 1);

      // One tick back up: the band gives first; the report has not moved yet.
      await page.mouse.wheel(0, -40);
      await expect.poll(async () => Math.abs((await geo(page)).stageTop - (g0.band - 40)) <= 1).toBe(true);
      expect((await geo(page)).top).toBeGreaterThanOrEqual(g0.max - 1);

      // All the way up in one motion: the top of page 1, nothing left to bump.
      for (let i = 0; i < Math.ceil(g0.max / 400) + 4; i++) await page.mouse.wheel(0, -400);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60); }
      await expect.poll(async () => (await geo(page)).top).toBe(0);
      expect((await geo(page)).stageTop).toBe(0);
    });

  test('a scroll that lifts the report off its end while the band is out hands the band back, without moving the page',
    async ({ page }) => {
      await page.evaluate(() => {
        const out = document.getElementById('out'), stage = document.getElementById('stage');
        const se = out.contentDocument.scrollingElement;
        se.scrollTop = se.scrollHeight;           // the end of the report…
        stage.scrollTop = stage.scrollHeight;     // …and the band, as a wheel leaves them
      });
      await page.waitForTimeout(150);
      const atEnd = await geo(page);
      expect(atEnd.top).toBeGreaterThanOrEqual(atEnd.max - 1);
      expect(atEnd.stageTop).toBeGreaterThanOrEqual(atEnd.band - 1);

      // Something other than a wheel moves the report 300px up — a key, the
      // scrollbar, a restored place.
      await page.evaluate(() => {
        const se = document.getElementById('out').contentDocument.scrollingElement;
        se.scrollTop -= 300;
      });
      // The band is handed back to the report: the same point of the page
      // stays under the same pixel, so the report sits band/s further down
      // than the bare 300 would have put it, and the stage is at rest.
      await expect.poll(async () => (await geo(page)).stageTop).toBe(0);
      const after = await geo(page);
      expect(Math.abs(after.top - (atEnd.max - 300 + atEnd.band / atEnd.s))).toBeLessThanOrEqual(1);
    });

  test('a wheel in the middle of the report is the browser\'s own — nothing is intercepted',
    async ({ page }) => {
      const sb = await page.locator('#stage').boundingBox();
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      const seen = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        window.__wheelSeen = [];
        d.addEventListener('wheel', e => window.__wheelSeen.push(e.defaultPrevented), { passive: true });
        return true;
      });
      expect(seen).toBe(true);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(100);
      await page.mouse.wheel(0, -200);
      await expect.poll(() => page.evaluate(() => window.__wheelSeen.length)).toBe(2);
      expect(await page.evaluate(() => window.__wheelSeen)).toEqual([false, false]);
      expect((await geo(page)).stageTop).toBe(0);
    });
});
