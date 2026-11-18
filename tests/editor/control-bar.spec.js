// The docked Control bar (#ctl, INDESIGN_PARITY.md's control-bar plan, phase
// 1: object mode). Pins: it sits under the menu bar in the column's flow (the
// canvas starts below it), View ▸ Control bar hides it and the choice
// survives a reload, the arrange strip moves into it and back, an edit typed
// into it lands through the Position panel's own applier (typed units
// included), flip and rotate run right-click's turnObjects, a text box shows
// as a frame (columns through the Box panel's setBoxFrame), and with nothing
// selected it says what the page is rather than standing empty. Local mode.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

async function addRect(page) {
  await page.evaluate(async () => {
    pushHistory();
    layout.shapes.push({ id: 'cb-rect', page: 3, kind: 'rect', x: 1, y: 1,
                         w: 2, h: 1, fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
    markDirty();
    await render();
    setSel($('out').contentDocument, ['cb-rect']);
  });
  await settled(page);
}
const rect = page => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect'));
const rectOf = (page, id) => page.evaluate(i => {
  const b = document.getElementById(i).getBoundingClientRect();
  return { top: b.top, bottom: b.bottom, h: b.height };
}, id);

test.describe('control bar', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('docked under the menu bar, with the canvas below it', async ({ page }) => {
    await expect(page.locator('#ctl')).toBeVisible();
    const bar = await rectOf(page, 'bar'), ctl = await rectOf(page, 'ctl'),
      work = await rectOf(page, 'work');
    expect(Math.abs(ctl.top - bar.bottom)).toBeLessThan(1.5);
    expect(Math.abs(work.top - ctl.bottom)).toBeLessThan(1.5);
    // Nothing selected: the page, not an empty strip.
    await expect(page.locator('#cb-empty')).toBeVisible();
    await expect(page.locator('#cb-page')).toContainText(/Page .*in|Pageless/);
    await expect(page.locator('#cb-obj')).toBeHidden();
    // The rulers (PR #147) stand on the canvas's top edge, below the bar.
    await page.keyboard.press('Meta+Semicolon');
    await expect(page.locator('#ruler-t')).toBeVisible();
    const rt = await rectOf(page, 'ruler-t'), st = await rectOf(page, 'stage');
    expect(Math.abs(rt.top - st.top)).toBeLessThan(1.5);
    expect(rt.top).toBeGreaterThanOrEqual(ctl.bottom - 0.5);
  });

  test('View ▸ Control bar hides it, the canvas rises, and the choice is kept', async ({ page }) => {
    const before = await rectOf(page, 'work');
    await page.click('#view');
    await page.click('#ctlbar');
    await expect(page.locator('#ctl')).toBeHidden();
    const after = await rectOf(page, 'work');
    expect(before.top - after.top).toBeGreaterThan(30);
    // The arrange strip goes back to the floating card.
    expect(await page.evaluate(() => $('arrange').parentNode.id)).toBe('context');
    await gotoEditor(page);
    await expect(page.locator('#ctl')).toBeHidden();
    // ⌥⌘6 brings it back, strip and all.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Meta+Alt+Digit6');
    await expect(page.locator('#ctl')).toBeVisible();
    expect(await page.evaluate(() => $('arrange').parentNode.id)).toBe('ctl');
  });

  test('a shape: W typed with a unit, X in inches, flip and rotate', async ({ page }) => {
    await addRect(page);
    await expect(page.locator('#cb-obj')).toBeVisible();
    await expect(page.locator('#cb-empty')).toBeHidden();
    // The strip's own controls are in the bar too, not floating.
    await expect(page.locator('#ctl #ar-fill')).toBeVisible();
    await expect(page.locator('#cb-w')).toHaveValue('2');
    await expect(page.locator('#cb-corner')).toBeVisible();     // a rectangle
    await expect(page.locator('#cb-frame')).toBeHidden();       // not a text frame

    await page.locator('#cb-w').fill('216pt');                  // = 3in
    await page.locator('#cb-w').press('Enter');
    await expect.poll(async () => (await rect(page)).w).toBe(3);
    await page.locator('#cb-x').fill('1.5');
    await page.locator('#cb-x').press('Enter');
    await expect.poll(async () => (await rect(page)).x).toBeCloseTo(1.5, 2);
    await expect(page.locator('#cb-w')).toHaveValue('3');
    // One edit, one undo step: ⌘Z takes the X back and leaves the width.
    await page.evaluate(() => undo());
    await expect.poll(async () => (await rect(page)).x).toBeCloseTo(1, 2);
    expect((await rect(page)).w).toBe(3);

    await page.evaluate(() => setSel($('out').contentDocument, ['cb-rect']));
    await page.click('#cb-fliph');
    await expect.poll(async () => (await rect(page)).flip).toBe('h');
    await expect(page.locator('#cb-fliph')).toHaveClass(/\bon\b/);
    await page.click('#cb-rotcw');
    await expect.poll(async () => (await rect(page)).rot).toBe(90);
    await expect(page.locator('#cb-rot')).toHaveValue('90');
  });

  test('a bad length is refused, not written', async ({ page }) => {
    await addRect(page);
    await page.locator('#cb-h').fill('two inches');
    await page.locator('#cb-h').press('Enter');
    await expect(page.locator('#cb-h')).toHaveClass(/\bbad\b/);
    expect((await rect(page)).h).toBe(1);
  });

  test('a text box shows as a frame: columns land through the Box panel’s setter', async ({ page }) => {
    const id = await page.evaluate(async () =>
      (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words in a frame.' })).id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await settled(page);
    // The words keep their floating type card; the bar shows the frame.
    await expect(page.locator('#type')).toBeVisible();
    await expect(page.locator('#cb-frame')).toBeVisible();
    await expect(page.locator('#cb-w')).toHaveValue('4');
    await page.selectOption('#cb-cols', '2');
    await expect.poll(() => page.evaluate(i => (boxOf(i) || {}).cols, id)).toBe(2);
    await expect(page.locator('#cb-gapwrap')).toBeVisible();
    await page.click('#cb-frame [data-va="bottom"]');
    await expect.poll(() => page.evaluate(i => (boxOf(i) || {}).vAlign, id)).toBe('bottom');
  });

  test('parseLen reads InDesign’s units', async ({ page }) => {
    const got = await page.evaluate(() =>
      ['2', '2in', '2 in', '2"', '144pt', '12p', '3p6', 'p6', '25.4mm', '2.54cm', '96px', 'x', '']
        .map(s => parseLen(s)));
    expect(got.slice(0, 11).map(v => +v.toFixed(4)))
      .toEqual([2, 2, 2, 2, 2, 2, 0.5833, 0.0833, 1, 1, 1]);
    expect(Number.isNaN(got[11]) && Number.isNaN(got[12])).toBe(true);
  });
});
