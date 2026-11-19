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
      let b = p.getBoundingClientRect();
      // A tray that docks in the left panel scrolls inside it: only the part the panel shows is on
      // the page (the bar's two rows leave the panel less height, so a tall tray scrolls).
      const host = p.closest('#side-body');
      if (host) {
        const h = host.getBoundingClientRect();
        const l = Math.max(b.left, h.left), t = Math.max(b.top, h.top), r = Math.min(b.right, h.right), bt = Math.min(b.bottom, h.bottom);
        b = { left: l, top: t, right: r, bottom: bt, width: r - l, height: bt - t };
      }
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

// The rail itself, not only its trays: the top ruler is a fixed canvas that runs the
// whole width, and used to be drawn over the first buttons of the rail (Select).
test('every rail button is on top of the rulers, all the way to its edges', async ({ page }) => {
  await gotoEditor(page);
  await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
  await page.waitForTimeout(250);
  const bad = await page.evaluate(() => {
    const rail = $('leftrail'), out = [];
    for (const b of rail.querySelectorAll('button')) {
      if (!b.offsetParent) continue;
      const r = b.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.08], [0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.92]]) {
        const e = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (!e || !rail.contains(e)) out.push({ id: b.id || b.getAttribute('aria-label'), fx, fy, hit: e && (e.id || e.className) });
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

// The rail is DOCKED (2026-11-19), a column of the work area like the right dock: flush to the window's
// edge, square, no shadow, and the rulers begin at its right edge with the hairline between. A tray
// opens over the canvas, clear of the left ruler beside it and the top ruler above it. Asserted as
// geometry (no shared pixel) at two window sizes, with rulers on and off.
const rects = `(() => { const r = id => { const e = document.getElementById(id); if (!e || e.hidden || !e.offsetWidth) return null;
  const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  return { rail: r('leftrail'), side: r('side'), T: r('ruler-t'), L: r('ruler-l'), C: r('ruler-c'), work: r('work') }; })()`;
const hit = (a, b) => a && b && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

for (const [w, h] of [[1280, 720], [1920, 1000]]) {
  test(`the rail is docked and keeps off both rulers, and a tray opens clear of them (${w}x${h})`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await gotoEditor(page);
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
    await page.waitForTimeout(250);
    const look = await page.evaluate(() => { const c = getComputedStyle(document.getElementById('leftrail'));
      return { shadow: c.boxShadow, radius: c.borderTopRightRadius + '/' + c.borderBottomRightRadius, position: c.position, w: parseFloat(c.width) }; });
    expect(look.shadow, 'no shadow falls on the ruler').toBe('none');
    expect(look.radius).toBe('0px/0px');
    expect(look.position, 'a column of the work area, not an overlay').toBe('relative');
    expect(look.w).toBe(48);
    let g = await page.evaluate(rects);
    expect(g.rail.l, 'flush to the window edge').toBe(0);
    expect(g.rail.t, 'from the top of the work area').toBe(g.work.t);
    expect(hit(g.rail, g.T), 'rail over the top ruler').toBeFalsy();
    expect(hit(g.rail, g.L), 'rail over the left ruler').toBeFalsy();
    expect(hit(g.rail, g.C), 'rail over the corner').toBeFalsy();
    // the rulers begin at the rail's right edge, the corner with them
    expect(Math.round(g.L.l)).toBe(Math.round(g.rail.r));
    expect(Math.round(g.T.t)).toBe(Math.round(g.work.t));
    expect(Math.round(g.C.l)).toBe(Math.round(g.rail.r));
    // a tray opens against the ruler's right edge and below the top ruler: over the canvas only
    await page.click('#shape');
    await page.waitForTimeout(300);
    g = await page.evaluate(rects);
    expect(g.side, 'the tray is open').toBeTruthy();
    expect(hit(g.side, g.L), 'tray over the left ruler').toBeFalsy();
    expect(hit(g.side, g.T), 'tray over the top ruler').toBeFalsy();
    expect(hit(g.side, g.C), 'tray over the corner').toBeFalsy();
    expect(Math.round(g.side.l)).toBe(Math.round(g.L.r));
    expect(Math.round(g.side.t)).toBe(Math.round(g.T.b));
    expect(hit(g.side, g.rail)).toBeFalsy();
    await page.click('#shape');
    // rulers off: the tray is against the rail again, from the top
    await page.evaluate(() => { if (guidesOn) toggleGuides(); });
    await page.waitForTimeout(250);
    await page.click('#shape');
    await page.waitForTimeout(300);
    g = await page.evaluate(rects);
    expect(g.L).toBeNull();
    expect(Math.round(g.side.l)).toBe(Math.round(g.rail.r));
    expect(Math.round(g.side.t)).toBe(Math.round(g.work.t));
    await page.click('#shape');
  });
}
