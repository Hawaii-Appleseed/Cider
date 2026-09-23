// Corner-based rotation (docsync/editor/edit.html): Canva's own affordance —
// the small square right at a corner still resizes, but dragging from the
// ring just OUTSIDE it rotates. Implemented as an invisible .ds-rot-corner
// zone painted behind (and larger than) its resize square. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

async function addShape(page) {
  await page.click('#shape');
  await page.click('#shapepop .shp[data-k="rect"]');
  await page.frameLocator('#out').locator('[data-shape]').first().waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(800);
}

test.describe('corner rotation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('a selected shape has a rotate ring at each corner, and the dangling top handle is gone', async ({ page }) => {
    await addShape(page);
    const frame = page.frameLocator('#out');
    for (const dir of ['ne', 'nw', 'se', 'sw']) {
      await expect(frame.locator(`.ds-handles .ds-rot-${dir}`)).toHaveCount(1);
    }
    await expect(frame.locator('.ds-handles .ds-rot')).toHaveCount(0);   // superseded for cornered shapes
  });

  test('dragging just outside the SE corner rotates the shape (not resize)', async ({ page }) => {
    await addShape(page);
    const frame = page.frameLocator('#out');
    const ring = frame.locator('.ds-rot-se');
    const box = await ring.boundingBox();
    // Grab a point in the ring's outer edge — outside the resize square's hit
    // area, inside the 22px ring — and drag it perpendicular to the diagonal
    // (a motion that would do nothing to width/height but everything to angle).
    const startX = box.x + box.width - 2, startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 120, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const rot = await page.evaluate(() => {
      const id = layout.shapes[0].id;
      return (layout.positions && layout.positions[id] && layout.positions[id].rot) || null;
    });
    // A shape's rotation lives directly on the shape object, not positions{}.
    const shapeRot = await page.evaluate(() => layout.shapes[0].rot || null);
    expect(rot ?? shapeRot).not.toBeNull();
    await expect(page.locator('#stat')).toContainText('°');
  });

  test('dragging directly on the SE resize square still resizes', async ({ page }) => {
    await addShape(page);
    const frame = page.frameLocator('#out');
    const before = await page.evaluate(() => ({ w: layout.shapes[0].w, h: layout.shapes[0].h }));

    const handle = frame.locator('.ds-h-se');
    const box = await handle.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => ({ w: layout.shapes[0].w, h: layout.shapes[0].h }));
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
    const rot = await page.evaluate(() => layout.shapes[0].rot || null);
    expect(rot).toBeNull();   // resize only, no rotation
  });

  test('a text box (also cornered) rotates from its corner ring too', async ({ page }) => {
    await page.click('#text');
    await page.click('#textpop .txtpreset[data-k="body"]');
    const frame = page.frameLocator('#out');
    await frame.locator('.ds-textbox').first().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(800);

    for (const dir of ['ne', 'nw', 'se', 'sw']) {
      await expect(frame.locator(`.ds-handles .ds-rot-${dir}`)).toHaveCount(1);
    }
  });

  test('a table (width-only) keeps the dangling top rotate handle, no corner rings', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.click('#table');
    await frame.locator('table.ds-table[data-el]').first().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(800);

    await expect(frame.locator('.ds-handles .ds-rot')).toHaveCount(1);
    await expect(frame.locator('.ds-handles .ds-rot-corner')).toHaveCount(0);
  });
  test('a callout wearing a class transform turns without jumping',
    async ({ page }) => {
      // .lc-right / .lc-left carry `transform: translateY(-50%)` from the
      // report's own stylesheet (report2027/web/primer.css). One inline
      // `transform` REPLACES that, so a rotation of a hundredth of a degree
      // used to drop the translate and move the callout half its own height —
      // live and on the published page. Rotation has its own property now.
      const frame = page.frameLocator('#out');
      const el = frame.locator('[data-el="lc.jan"]');
      const read = () => el.evaluate(e => {
        const r = e.getBoundingClientRect();
        return { mid: r.top + r.height / 2, h: r.height,
                 tf: getComputedStyle(e).transform };
      });
      const before = await read();
      expect(before.tf).not.toBe('none');           // the class transform is on
      await page.evaluate(() => {
        layout.positions['lc.jan'].rot = 0.001; markDirty(); return render();
      });
      await page.waitForTimeout(2200);
      const after = await read();
      expect(after.tf).toBe(before.tf);             // still wearing it
      expect(Math.abs(after.mid - before.mid)).toBeLessThan(1);
    });
});
