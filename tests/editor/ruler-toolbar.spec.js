// The contextual toolbar (type / arrange strip) floats over the top of the
// canvas, where the top ruler stands. It must be drawn above the ruler.
const fs = require('fs');
const path = require('path');
const { sharedTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const SHOTS = process.env.RULER_SHOTS || '';

test('the contextual toolbar is not covered by the top ruler', async ({ page }) => {
  await gotoEditor(page);
  await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
  const r = await page.evaluate(() => docsync.api.addTextBox({ page: 1, x: 1, y: 1, w: 3, md: 'Hello' }));
  expect(r.ok).toBe(true);
  await page.evaluate(id => docsync.api.select(id), r.id);
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => {
    const strip = [...document.querySelectorAll('#type, #arrange')].find(e => !e.hidden && e.getBoundingClientRect().width > 0);
    if (!strip) return { none: true };
    const b = strip.getBoundingClientRect();
    const q = $('ruler-t').getBoundingClientRect();
    const t = Math.max(b.top, q.top) + 1, btm = Math.min(b.bottom, q.bottom) - 1;
    const bad = [];
    if (btm > t) {
      for (const fx of [0.1, 0.5, 0.9]) {
        const e = document.elementFromPoint(b.left + b.width * fx, (t + btm) / 2);
        if (!e || !strip.contains(e)) bad.push({ fx, hit: e && (e.id || e.className || e.tagName) });
      }
    }
    return { strip: strip.id, b: [b.top, b.bottom], ruler: [q.top, q.bottom], bad };
  });
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `toolbar-${process.env.SHOT_TAG || 'after'}.png`) }); }
  expect(res.none, 'a toolbar should show for a selected text box').toBeFalsy();
  expect(res.bad, JSON.stringify(res)).toEqual([]);
});
