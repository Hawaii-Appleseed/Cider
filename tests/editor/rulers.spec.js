// Rulers, ruler guides and spacers (InDesign's rulers, guides and gap
// markers). The rulers are canvases over the stage's edges in the WINDOW;
// these tests read their pixels where an object's edge actually is, so a
// ruler that drew its inches anywhere but under the page fails here.
// RULER_SHOTS=<dir> also saves screenshots of each step there.
const fs = require('fs');
const path = require('path');
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const SHOTS = process.env.RULER_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};

/** Rulers on, page 3 in the middle of the view, a 1in square at (1in, 1in). */
async function setup(page) {
  await gotoEditor(page);
  await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
  const r = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 1, h: 1 }));
  expect(r.ok).toBe(true);
  await page.evaluate(() => {
    const pg = $('out').contentDocument.querySelector('section.page[data-page="3"]');
    pg.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(120);       // two frames for the ruler poll to redraw
  return r.id;
}

/** Where an element's left/top edge is in the WINDOW, and whether the ruler
 *  has a whole-inch tick (the only ticks that reach its outer 5px) there. */
const tickAt = (page, id, side) => page.evaluate(([i, sd]) => {
  const out = $('out'), or = out.getBoundingClientRect(), sc = or.width / out.offsetWidth;
  const el = $('out').contentDocument.querySelector(`[data-shape="${i}"]`);
  const r = el.getBoundingClientRect();
  const c = $(sd === 'x' ? 'ruler-t' : 'ruler-l');
  const cr = c.getBoundingClientRect(), dpr = c.width / cr.width;
  const at = sd === 'x' ? or.left + r.left * sc - cr.left : or.top + r.top * sc - cr.top;
  const ctx = c.getContext('2d');
  const ink = a => {
    const px = sd === 'x' ? ctx.getImageData(Math.round(a * dpr), Math.round(4 * dpr), 1, 1).data
                          : ctx.getImageData(Math.round(4 * dpr), Math.round(a * dpr), 1, 1).data;
    return px[0] < 150 && px[3] > 0;
  };
  const near = a => [-1, -0.5, 0, 0.5, 1].some(o => ink(a + o));
  const pxIn = DPI * zoomOf(el.closest('section.page')) * sc;
  // Which inch the ruler calls that edge: its own 0 and inch, read back.
  const R = window.__dsRuler, edge = sd === 'x' ? or.left + r.left * sc : or.top + r.top * sc;
  const pr = el.closest('section.page').getBoundingClientRect();
  const y0 = R.y0.find(v => Math.abs(v - (or.top + pr.top * sc)) < 1);
  const inch = (edge - (sd === 'x' ? R.x0 : y0)) / R.pxIn;
  return { hit: near(at), half: near(at + pxIn / 2), pxIn, shown: !c.hidden, inch, dbg: { edge, R, pageLeft: or.left + pr.left * sc } };
}, [id, side]);

test.describe('rulers', () => {
  test('a whole-inch tick sits under a 1in object at 1in, at two zoom levels', async ({ page }) => {
    const id = await setup(page);
    for (const z of ['1', '1.5']) {
      await page.evaluate(zz => setZoom(zz), z);
      await page.evaluate(() => $('out').contentDocument
        .querySelector('section.page[data-page="3"]').scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(150);
      await shot(page, `rulers-zoom-${z}`);
      for (const side of ['x', 'y']) {
        const t = await tickAt(page, id, side);
        expect(t.shown).toBe(true);
        expect(t.hit, `${side} ruler at zoom ${z}: whole-inch tick under the 1in edge`).toBe(true);
        expect(t.half, `${side} ruler at zoom ${z}: no whole-inch tick half an inch on`).toBe(false);
        expect(t.inch, `${side} ruler at zoom ${z} reads the edge as 1in: ${JSON.stringify(t.dbg)}`).toBeCloseTo(1, 1);
      }
    }
    // The ruler follows the zoom: an inch is half as long again at 150%.
    const p1 = await page.evaluate(() => { setZoom('1'); return DPI * zoomOf($('out').contentDocument.querySelector('section.page')) * ($('out').getBoundingClientRect().width / $('out').offsetWidth); });
    expect(p1).toBeGreaterThan(40);
    // Off, they go.
    await page.evaluate(() => toggleGuides());
    await page.waitForTimeout(60);
    expect(await page.evaluate(() => $('ruler-t').hidden && $('ruler-l').hidden)).toBe(true);
    expect(await page.evaluate(() => window.__dsChords().includes('rulers & guides'))).toBe(true);
  });

  test('a guide dragged out of the top ruler lands, snaps an object, and goes back', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate(() => setZoom('1'));
    await page.evaluate(() => $('out').contentDocument
      .querySelector('section.page[data-page="3"]').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    // Window coordinates of page 3's inch (x, y).
    const win = (x, y) => page.evaluate(([X, Y]) => {
      const out = $('out'), or = out.getBoundingClientRect(), sc = or.width / out.offsetWidth;
      const pg = $('out').contentDocument.querySelector('section.page[data-page="3"]');
      const r = pg.getBoundingClientRect(), px = DPI * zoomOf(pg);
      return { x: or.left + (r.left + X * px) * sc, y: or.top + (r.top + Y * px) * sc };
    }, [x, y]);
    const rt = await page.evaluate(() => { const r = $('ruler-t').getBoundingClientRect(); return { x: r.left + 300, y: r.top + 9 }; });
    const to = await win(4, 3);
    await page.mouse.move(rt.x, rt.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y - 40, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    const ys = await page.evaluate(() => (layout.guides || {}).y || []);
    expect(ys.length).toBe(1);
    expect(ys[0]).toBeCloseTo(3, 1);
    // Make it exactly 3 for the snap check (the drop is a pixel's worth off).
    await page.evaluate(() => { layout.guides.y = [3]; drawGuideLayer($('out').contentDocument); });
    // Drag the square so its top lands 0.02in under the guide: it snaps to 3.
    const c0 = await win(1.5, 1.5), c1 = await win(1.5, 3.52);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    await page.mouse.move(c0.x, c0.y + 30, { steps: 3 });
    await page.mouse.move(c1.x, c1.y, { steps: 6 });
    await shot(page, 'guide-snap');
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(i => shapeOf(i).y, id)).toBeCloseTo(3, 2);
    // Click the guide to select it; Delete removes it.
    await page.evaluate(() => { layout.guides.y = [3, 4]; drawGuideLayer($('out').contentDocument); });
    const g6 = await win(5, 4);
    await page.mouse.click(g6.x, g6.y);
    expect(await page.evaluate(() => selGuide && selGuide.axis)).toBe('h');
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => layout.guides.y)).toEqual([3]);
    // Dragged back onto the ruler, a guide is deleted.
    const g3 = await win(6, 3);
    await page.mouse.move(g3.x, g3.y);
    await page.mouse.down();
    await page.mouse.move(g3.x, g3.y - 30, { steps: 3 });
    await page.mouse.move(g3.x, rt.y, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => layout.guides)).toBeUndefined();
    // Locked guides do not move, and the pilot can add and take them away.
    expect((await page.evaluate(() => docsync.api.addGuide('x', 2.5))).ok).toBe(true);
    expect(await page.evaluate(() => layout.guides.x)).toEqual([2.5]);
    expect((await page.evaluate(() => docsync.api.addGuide('x', 99))).ok).toBe(false);
    expect((await page.evaluate(() => docsync.api.removeGuide('x', 2.5))).ok).toBe(true);
    expect(await page.evaluate(() => layout.guides)).toBeUndefined();
  });
});

test.describe('spacers', () => {
  test('a spacer holds its gap when the thing above grows, and never publishes', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate(() => setZoom('1'));
    const b = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 2.25, w: 1, h: 1, fill: '#52796F' }));
    const sp = await page.evaluate(i => docsync.api.addSpacer({ below: i }), id);
    expect(sp.ok).toBe(true);
    const spacer = sp.id;
    expect(await page.evaluate(i => { const s = shapeOf(i); return [s.kind, s.x, s.y, s.w, s.h]; }, spacer))
      .toEqual(['spacer', 1, 2, 1, 0.25]);
    // Drawn in the editor, with its gap on a label.
    expect(await page.evaluate(i => !!$('out').contentDocument.querySelector(`[data-gapmark][data-shape="${i}"]`), spacer)).toBe(true);
    expect(await page.evaluate(i => $('out').contentDocument.querySelector(`.ds-spacer-lbl[data-for="${i}"]`).textContent, spacer)).toBe('0.25 in');
    // The square above grows half an inch: the spacer and the square under it follow.
    const r = await page.evaluate(i => docsync.api.place(i, { h: 1.5 }), id);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).y, spacer)).toBeCloseTo(2.5, 2);
    expect(await page.evaluate(i => shapeOf(i).y, b.id)).toBeCloseTo(2.75, 2);
    // A taller spacer pushes what is under it.
    await page.evaluate(i => docsync.api.place(i, { h: 0.5 }), spacer);
    expect(await page.evaluate(i => shapeOf(i).y, b.id)).toBeCloseTo(3, 2);
    await page.evaluate(() => $('out').contentDocument
      .querySelector('section.page[data-page="3"]').scrollIntoView({ block: 'start' }));
    await page.evaluate(i => setSel($('out').contentDocument, [i]), spacer);
    await page.waitForTimeout(150);
    await shot(page, 'spacer-editor');
    // Gone from the published render (what PDF, print and export are built from)…
    const clean = await page.evaluate(() => renderClean());
    const at = clean.indexOf('data-gapmark');
    expect(at < 0 ? '' : clean.slice(at - 300, at + 100)).toBe('');
    expect(clean).toContain(`data-shape="${b.id}"`);
    // …and from the draft when it is printed.
    await page.emulateMedia({ media: 'print' });
    expect(await page.evaluate(i => getComputedStyle($('out').contentDocument.querySelector(`[data-gapmark][data-shape="${i}"]`)).display, spacer)).toBe('none');
    await page.emulateMedia({ media: 'screen' });
  });
});
