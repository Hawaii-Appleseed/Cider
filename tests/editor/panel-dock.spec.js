// The right-hand panel dock (#dock, INDESIGN_PARITY.md 89, the control-bar
// plan's phase 4). Pins: a strip of icons on the window's right edge, the
// canvas stopping where it starts; an icon flies its panel out over the page
// (the canvas does not move) and a click on the page puts it away; pinned, the
// panel stays and the canvas makes room, and that is kept across a reload. The
// panels are the editor's own popovers MOVED in — the same ids, so View ▸
// Layers and the strip's Effects button open their tab in the dock — and a
// selection panel refills itself as the selection changes, or says what to
// select. A panel is in the dock only while its tab is shown: closed, it is
// the popover it always was, opened from its own button (View ▸ Layers, the
// strip's Effects) exactly as before, unless the dock is pinned on it.
// View ▸ Panel dock off hides the strip. Local mode.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

async function addRect(page) {
  await page.evaluate(async () => {
    pushHistory();
    layout.shapes.push({ id: 'dk-rect', page: 3, kind: 'rect', x: 1, y: 1,
                         w: 2, h: 1, fill: '#6B9E78', stroke: '#2F3E46', sw: 0.02, z: 3 });
    markDirty();
    await render();
    setSel($('out').contentDocument, ['dk-rect']);
  });
  await settled(page);
}
const box = (page, sel) => page.locator(sel).evaluate(e => {
  const b = e.getBoundingClientRect();
  return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width };
});
// A click on the canvas's grey, clear of every page: "elsewhere".
async function clickAway(page) {
  const st = await box(page, '#stage');
  await page.mouse.click(st.left + 30, st.bottom - 140);
}

test.describe('panel dock', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('folded to icons on the right edge; an icon flies its panel out over the page', async ({ page }) => {
    await expect(page.locator('#dock')).toBeVisible();
    await expect(page.locator('#dock-panel')).toBeHidden();
    const dock = await box(page, '#dock'), st = await box(page, '#stage');
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.abs(dock.right - vw)).toBeLessThan(1.5);
    expect(dock.w).toBeLessThan(50);
    expect(Math.abs(st.right - dock.left)).toBeLessThan(1.5);
    // Layers flies out over the canvas: the stage keeps its width.
    await page.click('#dock-icons [data-dock="layers"]');
    await expect(page.locator('#dock-panel')).toBeVisible();
    await expect(page.locator('#dock-title')).toHaveText('Layers');
    await expect(page.locator('#dock-body #layerspop')).toBeVisible();
    await expect(page.locator('#layers-list > *').first()).toBeVisible();
    expect((await box(page, '#stage')).w).toBeCloseTo(st.w, 0);
    const panel = await box(page, '#dock-panel');
    expect(panel.right).toBeLessThanOrEqual(dock.left + 1);
    // A click on the page puts it away; so does its icon a second time.
    await clickAway(page);
    await expect(page.locator('#dock-panel')).toBeHidden();
    await page.click('#dock-icons [data-dock="layers"]');
    await expect(page.locator('#dock-panel')).toBeVisible();
    await page.click('#dock-icons [data-dock="layers"]');
    await expect(page.locator('#dock-panel')).toBeHidden();
  });

  test('pinned, a panel stays and the canvas makes room; its own button leaves it there', async ({ page }) => {
    const st = await box(page, '#stage');
    // Dock closed: View ▸ Layers is the popover it was.
    await page.click('#view');
    await page.click('#layers');
    await expect(page.locator('#layerspop')).toBeVisible();
    expect(await page.locator('#layerspop').evaluate(e => !!e.closest('#dock'))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('#layerspop')).toBeHidden();
    await page.click('#dock-icons [data-dock="layers"]');
    await expect(page.locator('#dock-body #layerspop')).toBeVisible();
    await page.click('#dock-pin');
    await page.click('#view');
    await page.click('#layers');
    await expect(page.locator('#dock-body #layerspop')).toBeVisible();
    await expect(page.locator('#dock')).toHaveClass(/pinned/);
    const pinned = await box(page, '#stage');
    expect(pinned.w).toBeLessThan(st.w - 200);
    expect(Math.abs(pinned.right - (await box(page, '#dock')).left)).toBeLessThan(1.5);
    await clickAway(page);
    await expect(page.locator('#dock-panel')).toBeVisible();
    // The page strip and the floating card stand in from the dock.
    const railR = await page.evaluate(() => getComputedStyle(document.getElementById('rail')).right);
    expect(parseFloat(railR)).toBeGreaterThan(250);
    // Kept: a reload opens on the same tab, pinned.
    await gotoEditor(page);
    await page.click('#dock-icons [data-dock="layers"]');
    await expect(page.locator('#dock')).toHaveClass(/pinned/);
    await expect(page.locator('#layerspop')).toBeVisible();
  });

  test('a selection panel follows the selection, and says what to select', async ({ page }) => {
    await page.click('#dock-icons [data-dock="stroke"]');
    await expect(page.locator('#dock-empty')).toHaveText(/Select a shape/);
    await expect(page.locator('#ar-borderpop')).toBeHidden();
    await page.click('#dock-pin');           // stays while the selection changes
    await addRect(page);
    await expect(page.locator('#dock-empty')).toBeHidden();
    await expect(page.locator('#ar-borderpop')).toBeVisible();
    await expect(page.locator('#ar-dashrow button')).toHaveCount(3);
    // Dashed: the popover's own handler closes it — the tab fills again.
    await page.click('#ar-dashrow button:has-text("Dashed")');
    await settled(page);
    expect((await page.evaluate(() => layout.shapes.find(s => s.id === 'dk-rect').dash))).toBeTruthy();
    await expect(page.locator('#ar-borderpop')).toBeVisible();
    await expect(page.locator('#ar-dashrow button.on')).toHaveText('Dashed');
    // Effects from the strip's own button is its popover, as before; the
    // pinned Stroke tab stays where it is.
    await page.click('#ar-fxbtn');
    await expect(page.locator('#ar-fxpop')).toBeVisible();
    expect(await page.locator('#ar-fxpop').evaluate(e => !!e.closest('#dock'))).toBe(false);
    await expect(page.locator('#dock-body #ar-borderpop')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.click('#dock-icons [data-dock="fx"]');
    await expect(page.locator('#dock-title')).toHaveText('Effects');
    await expect(page.locator('#dock-body #ar-fxpop')).toBeVisible();
    await expect(page.locator('#ar-fxbody > *').first()).toBeVisible();
    expect(await page.locator('#ar-borderpop').evaluate(e => !!e.closest('#dock'))).toBe(false);
    // Nothing selected: the tab says so instead of showing the last shape's.
    await page.evaluate(() => clearSel($('out').contentDocument));
    await expect(page.locator('#dock-empty')).toHaveText(/Select a shape or a text frame/);
    await expect(page.locator('#ar-fxpop')).toBeHidden();
  });

  test('a text box: Paragraph and Text styles fill from it', async ({ page }) => {
    await page.click('#dock-icons [data-dock="para"]');
    await expect(page.locator('#dock-empty')).toHaveText(/Click into text/);
    await page.click('#dock-pin');
    await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2.5, md: 'Dock text' }));
    await settled(page);
    await page.evaluate(() => {
      const id = boxes().find(b => b.md === 'Dock text').id;
      setSel($('out').contentDocument, ['text.' + id]);
    });
    await expect(page.locator('#ty-parapop')).toBeVisible();
    await expect(page.locator('#dock-empty')).toBeHidden();
    await page.click('#dock-icons [data-dock="tstyles"]');
    await expect(page.locator('#ty-stylepop')).toBeVisible();
  });

  test('View ▸ Panel dock off puts the popovers back, and the choice is kept', async ({ page }) => {
    const st = await box(page, '#stage');
    await page.click('#view');
    await page.click('#dockbtn');
    await expect(page.locator('#dock')).toBeHidden();
    expect((await box(page, '#stage')).w).toBeGreaterThan(st.w + 30);
    expect(await page.evaluate(() => document.getElementById('layerspop').closest('#dock'))).toBeNull();
    // Layers is a popover under the View menu again.
    await page.click('#view');
    await page.click('#layers');
    await expect(page.locator('#layerspop')).toBeVisible();
    expect(await page.locator('#layerspop').evaluate(e => getComputedStyle(e).position)).toBe('fixed');
    await gotoEditor(page);
    await expect(page.locator('#dock')).toBeHidden();
    await page.evaluate(() => toggleDock(true));
    await expect(page.locator('#dock')).toBeVisible();
    await page.click('#dock-icons [data-dock="layers"]');
    expect(await page.evaluate(() => !!document.getElementById('layerspop').closest('#dock-body'))).toBe(true);
  });
});
