// Two things the page used to lose silently: the strut a renderer never
// emitted (docsync/layout.py attr() + ANCHOR_JS: an element that reserves
// flow space gets its spacer from the runtime when spacer() was not called),
// and anything past the RIGHT edge (fitCheck looked only down; .page is
// overflow:hidden on both sides). Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('struts and edges', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('an element that reserves flow space gets its strut from the runtime when the renderer emitted none', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const id = 'para.basics.p2';
    await page.evaluate(async id => {
      pushHistory();
      layout.positions[id] = { x: 1, y: 6, w: 5, reserve: 0.9 };
      markDirty(); await render();
    }, id);
    const el = frame.locator(`[data-el="${id}"]`);
    await expect(el).toHaveAttribute('data-reserve-for', id);
    await expect(el).toHaveAttribute('data-reserve', '0.9');
    // The renderer for this report does call spacer(): one strut, not two.
    const sp = frame.locator(`.ds-spacer[data-spacer-for="${id}"]`);
    await expect(sp).toHaveCount(1);
    // Take it away, as a renderer that never emitted it would have, and ask
    // the runtime again: the strut is back, before the element, same names.
    const r = await page.evaluate(id => {
      const d = document.getElementById('out').contentDocument;
      d.querySelector(`.ds-spacer[data-spacer-for="${id}"]`).remove();
      placeAnchors(d);
      const el = d.querySelector(`[data-el="${id}"]`);
      const sp = el.previousElementSibling;
      return sp && { cls: sp.className, host: sp.dataset.ancHost, h: sp.style.height, w: sp.style.width,
                     n: d.querySelectorAll(`.ds-spacer[data-spacer-for="${id}"]`).length };
    }, id);
    expect(r).toEqual({ cls: 'ds-spacer', host: 'spacer:' + id, h: '0.9in', w: '5in', n: 1 });
  });

  test('an element scaled past the right edge is reported, painted, and told apart from the bottom cut', async ({ page }) => {
    // A shape or a box past the edge already fails the build (check_bounds),
    // but a SCALE is a transform check_bounds never sees: 2in wide at x=6
    // passes, drawn at 200% it reaches 9in. Only the rendered box knows.
    const frame = page.frameLocator('#out');
    const id = 'toc.logo';
    const before = await page.evaluate(() => lastFit.length);
    await page.evaluate(async id => {
      pushHistory();
      layout.positions[id] = { x: 6, y: 1, w: 2, scale: 2 };
      markDirty(); await render();
    }, id);
    const mine = await page.evaluate(id => lastFit.filter(b => b.who === id && b.side === 'right'), id);
    expect(mine).toHaveLength(1);
    expect(mine[0].over).toBeGreaterThan(0.3);
    await expect(page.locator('#fit')).toBeVisible();
    await expect(page.locator('#fit')).toHaveAttribute('title', /toc\.logo is .* past the right edge/);
    await expect(frame.locator('.ds-cut.ds-cut-r')).toHaveCount(1);
    expect(await page.evaluate(() => fitReport().cut.map(c => c.side))).toContain('right');
    // At its own size it fits, and the warning goes.
    await page.evaluate(async id => { delete layout.positions[id].scale; markDirty(); await render(); }, id);
    expect(await page.evaluate(() => lastFit.length)).toBe(before);
    await expect(frame.locator('.ds-cut-r')).toHaveCount(0);
  });
});
