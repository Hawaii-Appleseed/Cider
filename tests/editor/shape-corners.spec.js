// A rectangle's corner radius, settable through the pilot API (and so through the
// staff-hub connector): addShape({r}) and setShape(id, {r, stroke, sw, z}). Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const rx = (page, id) => page.evaluate(i =>
  $('out').contentDocument.querySelector(`[data-shape="${CSS.escape(i)}"]`).getAttribute('rx'), id);

test.describe('shape corners through the pilot API', () => {
  test('addShape takes a corner radius and setShape changes it', async ({ page }) => {
    await gotoEditor(page);
    const a = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 2, h: 1, r: 0.15 }));
    expect(a.ok).toBe(true);
    expect(await rx(page, a.id)).toBe('0.15');

    const s = await page.evaluate(i => docsync.api.setShape(i, { r: 0.3, stroke: '#3C73B9', sw: 0.03, z: 9 }), a.id);
    expect(s.ok).toBe(true);
    expect(await rx(page, a.id)).toBe('0.3');
    expect(await page.evaluate(i => { const o = shapeOf(i); return [o.r, o.stroke, o.sw, o.z]; }, a.id)).toEqual([0.3, '#3C73B9', 0.03, 9]);

    // 0 squares it again, and the key is gone rather than stored as 0.
    expect((await page.evaluate(i => docsync.api.setShape(i, { r: 0 }), a.id)).ok).toBe(true);
    expect(await page.evaluate(i => 'r' in shapeOf(i), a.id)).toBe(false);
  });

  test('refuses what cannot be a corner', async ({ page }) => {
    await gotoEditor(page);
    const e = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'ellipse', x: 1, y: 1, w: 1, h: 1 }));
    const r = await page.evaluate(i => docsync.api.setShape(i, { r: 0.1 }), e.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/only rectangles/);
    const rect = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 3, w: 1, h: 1 }))).id;
    expect((await page.evaluate(i => docsync.api.setShape(i, { r: 9 }), rect)).ok).toBe(false);
    expect((await page.evaluate(i => docsync.api.setShape(i, { colour: 'red' }), rect)).ok).toBe(false);
    expect((await page.evaluate(() => docsync.api.setShape('nope', { r: 0.1 }))).ok).toBe(false);
    expect((await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 5, w: 1, h: 1, r: -1 }))).ok).toBe(false);
  });
});
