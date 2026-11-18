// Every tray the left rail opens must sit ON TOP of the rulers: the rulers
// are fixed canvases over the stage's edges, and a tray that opens beside the
// rail crosses the left ruler (and the corner square) on its way out.
const fs = require('fs');
const path = require('path');
const { sharedTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const SHOTS = process.env.RULER_SHOTS || '';

for (const [btn, pop] of [['shape', 'shapepop'], ['icon', null], ['ar-img', null], ['text', null]]) {
  test(`rail tray from #${btn} is not covered by the rulers`, async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
    await page.waitForTimeout(150);
    await page.click('#' + btn);
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const open = [...document.querySelectorAll('.pop:not([hidden])')].filter(p => {
        const b = p.getBoundingClientRect(); return b.width > 20 && b.height > 20 && p.closest('#leftrail') !== null || (b.left < 400 && b.width > 20);
      });
      const p = open[0];
      if (!p) return { none: true };
      const b = p.getBoundingClientRect();
      const bad = [];
      // Wherever the tray and a ruler overlap, the tray must be what is on top
      // (probed away from the tray's rounded corners).
      for (const id of ['ruler-t', 'ruler-l', 'ruler-c']) {
        const q = $(id).getBoundingClientRect();
        const l = Math.max(q.left, b.left + 2), r = Math.min(q.right, b.right - 2),
              t = Math.max(q.top, b.top + 10), btm = Math.min(q.bottom, b.bottom - 10);
        if (r <= l || btm <= t) continue;
        const e = document.elementFromPoint((l + r) / 2, (t + btm) / 2);
        if (!e || !p.contains(e)) bad.push({ ruler: id, hit: e && (e.id || e.className || e.tagName) });
      }
      for (const [x, y] of [[b.left + 12, b.top + 12], [b.right - 12, b.top + 12], [b.left + 12, b.bottom - 12], [b.right - 12, b.bottom - 12], [b.left + b.width / 2, b.top + 12], [b.left + 12, b.top + b.height / 2]]) {
        const e = document.elementFromPoint(x, y);
        if (!e || !p.contains(e)) bad.push({ x, y, hit: e && (e.id || e.className || e.tagName) });
      }
      return { id: p.id, box: [b.left, b.top, b.right, b.bottom], bad };
    });
    if (r.none) return;                       // this tool opens no tray
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${btn}-${process.env.SHOT_TAG || 'after'}.png`) }); }
    expect(r.bad, JSON.stringify(r)).toEqual([]);
  });
}
