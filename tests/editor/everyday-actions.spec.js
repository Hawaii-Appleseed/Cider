// Four things a person making a report or a flyer reaches for every time:
// the browser's spelling suggestions from text, a floating strip that fits
// what is selected, same size and even spacing for several things, and a
// picture of the selection on the clipboard.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const boot = async page => {
  await gotoEditor(page, '?project=blank-document');
  await settled(page);
};
const addShapes = page => page.evaluate(async () => {
  const mk = (x, w, h) => docsync.api.addShape({ page: 1, x, y: 2, w, h, kind: 'rect', fill: '#6B9E78' });
  const a = await mk(1, 1.5, 1), b = await mk(3.2, 0.8, 1.6), c = await mk(6, 1.1, 0.7);
  return [a, b, c].map(r => r.id);
});
const sizes = (page, ids) => page.evaluate(ids => ids.map(id => {
  const s = shapeOf(id); return [s.w, s.h];
}), ids);

test.describe('everyday actions', () => {
  test('Shift + right-click in open words is left to the browser; the text menu says how', async ({ page }) => {
    await boot(page);
    const t = await page.evaluate(() => docsync.api.addTextBox({ page: 1, x: 1, y: 1, w: 3, md: 'A wurd spelled wrong' }));
    await settled(page);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${t.id}"]`).click();
    await expect.poll(() => page.evaluate(() => !!($('out').contentDocument.activeElement || {}).isContentEditable)).toBe(true);
    const fire = shift => page.evaluate(shift => {
      const d = $('out').contentDocument, host = d.activeElement;
      const r = host.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: shift,
        clientX: r.left + 8, clientY: r.top + 8, button: 2, view: d.defaultView });
      host.dispatchEvent(ev);
      return { prevented: ev.defaultPrevented, menu: !!d.querySelector('.ds-menu') };
    }, shift);
    expect(await fire(true)).toEqual({ prevented: false, menu: false });      // the browser's own menu
    expect(await fire(false)).toEqual({ prevented: true, menu: true });       // the editor's
    await frame.locator('.ds-menu button', { hasText: 'Spelling suggestions' }).click();
    expect(await page.locator('#stat').textContent()).toMatch(/spelling suggestions/);
    expect(await fire(false)).toEqual({ prevented: false, menu: false });     // the next one goes through…
    expect(await fire(false)).toEqual({ prevented: true, menu: true });       // …and only that one
  });

  test('Same size follows the one asked for, and is one undo step', async ({ page }) => {
    await boot(page);
    const ids = await addShapes(page);
    const before = await sizes(page, ids);
    await page.evaluate(async ids => {
      const d = $('out').contentDocument; setSel(d, ids);
      await matchSizeSel(d, 'wh', ids[1]);
    }, ids);
    await settled(page);
    expect(await sizes(page, ids)).toEqual([before[1], before[1], before[1]]);
    await page.evaluate(() => docsync.api.undo());
    await settled(page);
    expect(await sizes(page, ids)).toEqual(before);
    await page.evaluate(async ids => {
      const d = $('out').contentDocument; setSel(d, ids);
      await matchSizeSel(d, 'w', ids[0]);
    }, ids);
    await settled(page);
    const after = await sizes(page, ids);
    expect(after.map(s => s[0])).toEqual([before[0][0], before[0][0], before[0][0]]);
    expect(after.map(s => s[1])).toEqual(before.map(s => s[1]));              // heights untouched
  });

  test('the floating strip offers what fits the selection', async ({ page }) => {
    await boot(page);
    const ids = await addShapes(page);
    const labels = () => page.evaluate(() =>
      [...$('out').contentDocument.querySelectorAll('.ds-mini button')].map(b => b.getAttribute('aria-label')));
    await page.evaluate(id => docsync.api.select(id), ids[0]);
    await settled(page);
    let l = await labels();
    expect(l).toContain('Copy as picture');
    expect(l.some(x => /^Group/.test(x))).toBe(false);                        // one thing: nothing to group
    await page.evaluate(ids => setSel($('out').contentDocument, ids), ids);
    await settled(page);
    l = await labels();
    for (const want of [/^Group/, /^Same size/, /^Space evenly across/, /^Space evenly down/, /^Duplicate/, /^Delete/])
      expect(l.some(x => want.test(x)), String(want)).toBe(true);
    // Space evenly across, pressed: the gaps come out equal.
    await page.frameLocator('#out').locator('.ds-mini button[aria-label="Space evenly across"]').click();
    await settled(page);
    const xs = await page.evaluate(ids => ids.map(id => { const s = shapeOf(id); return [s.x, s.w]; }), ids);
    const gap1 = xs[1][0] - (xs[0][0] + xs[0][1]), gap2 = xs[2][0] - (xs[1][0] + xs[1][1]);
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.03);
  });

  test('Copy as picture puts a PNG of the selection on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await boot(page);
    const ids = await addShapes(page);
    await page.bringToFront();
    const res = await page.evaluate(async id => {
      const d = $('out').contentDocument; setSel(d, [id]);
      const r = await copySelAsPicture(d);
      const items = await navigator.clipboard.read();
      const png = items[0] && items[0].types.includes('image/png') ? await items[0].getType('image/png') : null;
      let dim = null;
      if (png) { const bm = await createImageBitmap(png); dim = [bm.width, bm.height]; }
      return { r, dim };
    }, ids[0]);
    expect(res.r.ok, JSON.stringify(res.r)).toBe(true);
    // 1.5 x 1 in at 288 dpi, plus a hair of margin: about 455 x 311.
    expect(res.dim[0]).toBeGreaterThan(400); expect(res.dim[0]).toBeLessThan(520);
    expect(res.dim[1]).toBeGreaterThan(260); expect(res.dim[1]).toBeLessThan(360);
  });
});
