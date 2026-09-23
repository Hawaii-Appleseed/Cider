// Moving a placed icon. An icon is a NESTED <svg data-shape> inside the
// shape layer, and paintShape used to fall through to the line branch for it
// (x1/y1/x2/y2 — attributes a nested svg ignores), so a drag updated
// layout.shapes but the glyph never moved on screen: "I can't move icons."
// The fixture repo has no icons, and picking one needs the network, so the
// spec plants one exactly the way addIcon stores it.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const STAR = '<path fill="none" stroke="currentColor" stroke-width="2" '
  + 'd="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>';

async function plantIcon(page) {
  return page.evaluate(svg => {
    pushHistory();
    const sid = freeShapeId('icon');
    layout.shapes.push({ id: sid, page: visiblePageId(), kind: 'icon',
      x: 1, y: 1, w: 0.6, h: 0.6, icon: 'spec:star', vb: '0 0 24 24',
      svg, fill: '#52796F', z: 3 });
    markDirty();
    return render().then(() => sid);
  }, STAR);
}

test.describe('placed icon', () => {
  test('dragging an icon moves it on screen, not only in the model', async ({ page }) => {
    await gotoEditor(page);
    const sid = await plantIcon(page);
    const icon = page.frameLocator('#out').locator(`[data-shape="${sid}"]`);
    const b0 = await icon.boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 90, b0.y + b0.height / 2 + 70, { steps: 5 });
    // mid-drag, BEFORE mouseup: the live paint is what the bug broke
    const bMid = await icon.boundingBox();
    expect(bMid.x - b0.x).toBeGreaterThan(50);
    expect(bMid.y - b0.y).toBeGreaterThan(40);
    await page.mouse.up();
    // and the model agrees with the pixels
    const sh = await page.evaluate(id =>
      layout.shapes.find(s => s.id === id), sid);
    expect(sh.x).toBeGreaterThan(1.4);
    expect(sh.y).toBeGreaterThan(1.3);
  });

  test('corner-resizing an icon repaints it live too', async ({ page }) => {
    await gotoEditor(page);
    const sid = await plantIcon(page);
    const frame = page.frameLocator('#out');
    const icon = frame.locator(`[data-shape="${sid}"]`);
    const b0 = await icon.boundingBox();
    await page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2);
    const se = frame.locator('.ds-handles .ds-h-se');
    const hb = await se.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 60, hb.y + 60, { steps: 4 });
    const bMid = await icon.boundingBox();
    expect(bMid.width).toBeGreaterThan(b0.width + 30);
    await page.mouse.up();
  });
});
