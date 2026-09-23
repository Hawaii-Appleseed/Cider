// The colour panel and picker (docsync/editor/edit.html openColorPanel).
// Colour outgrew a popover hanging off a 46px row — search, the design's own
// colours, the report palette, a few dozen defaults, gradients, and a full
// picker — so it opens the LEFT column, which stopped holding pages for
// exactly this reason (they moved to the bottom strip). Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

async function addRect(page) {
  await page.evaluate(async () => {
    pushHistory();
    layout.shapes.push({ id: 'cp-rect', page: 3, kind: 'rect', x: 1, y: 1,
                         w: 2, h: 1, fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
    markDirty();
    await render();
    setSel($('out').contentDocument, ['cp-rect']);
  });
  await page.waitForTimeout(300);
}
const shape = page => page.evaluate(() => layout.shapes.find(x => x.id === 'cp-rect'));
const openPanel = async page => { await page.click('#ar-fill'); await expect(page.locator('#side')).toBeVisible(); };

test.describe('colour panel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('pages moved to a bottom strip, below the canvas', async ({ page }) => {
    const rail = page.locator('#rail');
    await expect(rail).toBeVisible();
    await expect(rail.locator('.chip').first()).toBeVisible();
    // It is a filmstrip now: laid out in a row, and BELOW the stage.
    expect(await page.evaluate(() => getComputedStyle($('rail')).flexDirection)).toBe('row');
    const railTop = (await rail.boundingBox()).y;
    const stageTop = (await page.locator('#stage').boundingBox()).y;
    expect(railTop).toBeGreaterThan(stageTop);
    // And the left column is no longer the pages.
    await expect(page.locator('#work #rail')).toHaveCount(0);
  });

  test('the colour button opens the panel with the expected sections', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await expect(page.locator('#side-title')).toHaveText('Color');
    await expect(page.locator('#side-search')).toBeVisible();
    const heads = await page.locator('#side-body h4').allTextContents();
    expect(heads.join('|')).toContain('Colors in this design');
    expect(heads.join('|')).toContain('Default solid colors');
    expect(heads.join('|')).toContain('Default gradient colors');
    // Close puts the column away.
    await page.click('#side-x');
    await expect(page.locator('#side')).toBeHidden();
  });

  test('a default swatch recolours the shape', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await page.locator('#side-body .cdot[title$="#E23B3B"]').first().click();
    await page.waitForTimeout(900);
    expect((await shape(page)).fill).toBe('#E23B3B');
  });

  test('a default gradient applies as a real gradient, not a flat colour', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await page.locator('#side-body .cdot[title="ocean gradient"]').click();
    await page.waitForTimeout(900);
    const f = (await shape(page)).fill;
    expect(typeof f).toBe('object');
    expect(f.type).toBe('linear');
    expect(f.stops).toHaveLength(2);
    expect(f.stops[0].color).toBe('#2F4A8F');
  });

  test('search finds a colour by name and by hex', async ({ page }) => {
    await addRect(page);
    await openPanel(page);

    await page.fill('#side-search', 'teal');
    await expect(page.locator('#side-body h4')).toHaveText(['Matches']);
    expect(await page.locator('#side-body .cdot').count()).toBeGreaterThan(0);

    // A hex typed straight in is offered even though it is in no list.
    await page.fill('#side-search', '#00c4cc');
    const hit = page.locator('#side-body .cdot[title="#00C4CC"]');
    await expect(hit).toHaveCount(1);
    await hit.click();
    await page.waitForTimeout(900);
    expect((await shape(page)).fill).toBe('#00C4CC');
  });

  test('the + swatch opens the picker; the hex field sets the colour', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await page.click('#side-body .cdot.plus');
    await expect(page.locator('#cpick')).toBeVisible();
    // Canva's arrangement: two tabs, an SV square, a hue rail, a hex field.
    await expect(page.locator('.cp-tab', { hasText: 'Solid color' })).toHaveClass(/\bon\b/);
    await expect(page.locator('#cp-sv')).toBeVisible();
    await expect(page.locator('#cp-hue')).toBeVisible();

    await page.fill('#cp-hex', '#123456');
    await page.locator('#cp-hex').dispatchEvent('change');
    await page.waitForTimeout(900);
    expect((await shape(page)).fill.toLowerCase()).toBe('#123456');
  });

  test('dragging the saturation square changes the colour', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await page.click('#side-body .cdot.plus');
    const before = (await shape(page)).fill;

    const sv = await page.locator('#cp-sv').boundingBox();
    await page.mouse.move(sv.x + sv.width * 0.15, sv.y + sv.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(sv.x + sv.width * 0.85, sv.y + sv.height * 0.15, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(900);

    const after = (await shape(page)).fill;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('the Gradient tab builds a gradient with editable stops', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await page.click('#side-body .cdot.plus');
    await page.locator('.cp-tab', { hasText: 'Gradient' }).click();
    await page.waitForTimeout(900);

    let f = (await shape(page)).fill;
    expect(typeof f).toBe('object');
    expect(f.stops).toHaveLength(2);
    await expect(page.locator('.cp-stop')).toHaveCount(2);

    // Select the second stop and recolour just it.
    await page.locator('.cp-stop').nth(1).click();
    await page.fill('#cp-hex', '#ABCDEF');
    await page.locator('#cp-hex').dispatchEvent('change');
    await page.waitForTimeout(900);
    f = (await shape(page)).fill;
    expect(f.stops[1].color.toLowerCase()).toBe('#abcdef');
    expect(f.stops[0].color.toLowerCase()).not.toBe('#abcdef');
  });

  test('the panel follows the selection and closes when it is gone', async ({ page }) => {
    await addRect(page);
    await openPanel(page);
    await page.evaluate(async () => {
      pushHistory();
      layout.shapes.push({ id: 'cp-rect2', page: 3, kind: 'ellipse', x: 3, y: 1,
                           w: 1, h: 1, fill: '#354F52', stroke: 'none', sw: 0.02, z: 3 });
      markDirty();
      await render();
      setSel($('out').contentDocument, ['cp-rect2']);
    });
    await page.waitForTimeout(600);
    await expect(page.locator('#side')).toBeVisible();
    expect(await page.evaluate(() => sideFillId)).toBe('cp-rect2');

    await page.evaluate(() => clearSel($('out').contentDocument));
    await page.waitForTimeout(400);
    await expect(page.locator('#side')).toBeHidden();
  });
});
