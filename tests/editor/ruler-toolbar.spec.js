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
    // The Control bar's two rows of columns (the strips' controls are laid in its columns, ctlFit): every control
    // that is drawn must answer a press, and none may reach down into the ruler.
    const ctls = [...document.querySelectorAll('#ctl .ctl-cell > *')]
      .filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
    if (!ctls.length) return { none: true };
    const q = $('ruler-t').getBoundingClientRect();
    const bad = [];
    ctls.forEach(c => {
      const b = c.getBoundingClientRect(), row = $('ctl-cols').getBoundingClientRect();
      if (b.bottom > q.top + 1 && b.top < q.bottom - 1) bad.push({ over: c.id || c.className });
      for (const fx of [0.1, 0.5, 0.9]) {
        const x = b.left + b.width * fx;
        if (x < row.left || x > row.right) continue;
        const e = document.elementFromPoint(x, (b.top + b.bottom) / 2);
        if (!e || !(c === e || c.contains(e) || e.contains(c))) bad.push({ fx, id: c.id || c.className, hit: e && (e.id || e.className || e.tagName) });
      }
    });
    return { controls: ctls.length, ruler: [q.top, q.bottom], bad };
  });
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `toolbar-${process.env.SHOT_TAG || 'after'}.png`) }); }
  expect(res.none, 'a toolbar should show for a selected text box').toBeFalsy();
  expect(res.bad, JSON.stringify(res)).toEqual([]);
});
