// Resize handles sit OUTSIDE the content box (docsync/editor/edit.html's
// .ds-h-* offsets). They used to straddle the edge — a 7-9px grip hung on
// -4px — which painted 3-5px of white-and-green over the first and last
// characters of every line. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('handle placement', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('a prose slot’s width grips clear the box on both sides', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await frame.locator('[data-el="basics.h1"]').click();
    await page.waitForTimeout(600);

    const box = await frame.locator('.ds-handles').boundingBox();
    const e = await frame.locator('.ds-h-e').boundingBox();
    const w = await frame.locator('.ds-h-w').boundingBox();
    // Flush is the contract, not merely "mostly outside": no part of a grip
    // may cross into the box. (Nor may it float free of it — the box's own
    // boundary pixel has to stay the handle's, or a right-click there falls
    // through to whatever element's box happens to overlap the edge.)
    expect(e.x).toBeGreaterThanOrEqual(box.x + box.width - 0.01);
    expect(e.x).toBeLessThan(box.x + box.width + 1);
    expect(w.x + w.width).toBeLessThanOrEqual(box.x + 0.01);
    expect(w.x + w.width).toBeGreaterThan(box.x - 1);
  });

  test('a shape’s corners clear the box, and each rotate ring still surrounds its square',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await page.click('#shape');
      await page.click('#shapepop .shp[data-k="rect"]');
      await frame.locator('[data-shape]').first().waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForTimeout(800);

      const box = await frame.locator('.ds-handles').boundingBox();
      const se = await frame.locator('.ds-h-se').boundingBox();
      const n = await frame.locator('.ds-h-n').boundingBox();
      expect(se.x).toBeGreaterThanOrEqual(box.x + box.width - 0.01);
      expect(se.y).toBeGreaterThanOrEqual(box.y + box.height - 0.01);
      expect(n.y + n.height).toBeLessThanOrEqual(box.y + 0.01);

      // Moving the square out moves the ring with it, or the "ring outside the
      // square rotates" affordance quietly stops being true.
      const ring = await frame.locator('.ds-rot-se').boundingBox();
      expect(Math.abs((se.x + se.width / 2) - (ring.x + ring.width / 2))).toBeLessThan(1);
      expect(Math.abs((se.y + se.height / 2) - (ring.y + ring.height / 2))).toBeLessThan(1);
      expect(ring.width).toBeGreaterThan(se.width + 6);
    });
});
