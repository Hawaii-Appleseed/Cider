// The docked Control bar (#ctl, INDESIGN_PARITY.md's control-bar plan, phase
// 1: object mode). Pins: it sits under the menu bar in the column's flow (the
// canvas starts below it), View ▸ Control bar hides it and the choice
// survives a reload, the arrange strip moves into it and back, an edit typed
// into it lands through the Position panel's own applier (typed units
// included), flip and rotate run right-click's turnObjects, a text box shows
// as a frame (columns through the Box panel's setBoxFrame), and with nothing
// selected it says what the page is rather than standing empty. Phase 2: text
// docks too, in A (character) or ¶ (paragraph) mode, and the bar's fields
// write the type card's and Paragraph panel's own fields in InDesign's units
// (size and leading in points, tracking in thousandths of an em). Local mode.
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
    // Text first: the bar opens in A (character) mode; ▭ shows the frame.
    await expect(page.locator('#ctl #type')).toBeVisible();
    await expect(page.locator('#cb-frame')).toBeHidden();
    await page.click('#cb-mode [data-m="frame"]');
    await expect(page.locator('#cb-frame')).toBeVisible();
    await expect(page.locator('#ty-font')).toBeHidden();
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

  test('text: A mode sets size in points, leading and tracking; ¶ mode indents and drop cap', async ({ page }) => {
    const id = await page.evaluate(async () =>
      (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words to set in the bar.' })).id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await settled(page);
    const st = () => page.evaluate(i => resolvedStyle(styleOf(i)), id);
    await page.click('#cb-mode [data-m="char"]');
    await expect(page.locator('#ctl')).toHaveAttribute('data-mode', 'char');
    await expect(page.locator('#ty-font')).toBeVisible();
    await expect(page.locator('#cb-il')).toBeHidden();
    // Leading with none set reads as auto, in brackets.
    await expect(page.locator('#cb-lead')).toHaveValue(/^\(.*\)$/);

    await page.locator('#cb-size').fill('18');                 // points
    await page.locator('#cb-size').press('Enter');
    await expect.poll(async () => (await st()).size).toBe(24);  // 18pt = 24px
    await expect(page.locator('#cb-size')).toHaveValue('18');
    await page.locator('#cb-lead').fill('27');                 // 27pt on 18pt = 1.5
    await page.locator('#cb-lead').press('Enter');
    await expect.poll(async () => (await st()).leading).toBe(1.5);
    await expect(page.locator('#cb-lead')).toHaveValue('27');
    await page.locator('#cb-track').fill('50');                // 50/1000 em of 24px = 1.2px
    await page.locator('#cb-track').press('Enter');
    await expect.poll(async () => (await st()).tracking).toBeCloseTo(1.2, 2);
    await page.click('#cb-strike');
    await expect.poll(async () => (await st()).strike).toBe(true);
    await expect(page.locator('#cb-strike')).toHaveClass(/\bon\b/);

    // ⌥⌘7 flips to ¶, and the choice is remembered.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Meta+Alt+Digit7');
    await expect(page.locator('#ctl')).toHaveAttribute('data-mode', 'para');
    await expect(page.locator('#ty-font')).toBeHidden();
    await expect(page.locator('#cb-il')).toBeVisible();
    await page.locator('#cb-il').fill('18pt');                 // = 0.25in
    await page.locator('#cb-il').press('Enter');
    await expect.poll(async () => (await st()).indentLeft).toBe(0.25);
    await page.locator('#cb-sa').fill('0.1');
    await page.locator('#cb-sa').press('Enter');
    await expect.poll(async () => (await st()).spaceAfter).toBe(0.1);
    await page.click('#ty-alseg [data-a="center"]');
    await expect.poll(async () => (await st()).align).toBe('center');
    await page.selectOption('#cb-dcap', '3');
    await expect.poll(async () => (await st()).dropCap).toBe(3);
    // A value set from the bar is one undo step of its own.
    await page.evaluate(() => undo());
    await expect.poll(async () => (await st()).dropCap ?? null).toBe(null);
    expect((await st()).spaceAfter).toBe(0.1);
    expect((await st()).align).toBe('center');
    expect(await page.evaluate(() => localStorage.getItem('ds-ctlmode'))).toBe('para');
  });

  test('a bad size is refused, and the bar off puts the type card back in the float', async ({ page }) => {
    const id = await page.evaluate(async () =>
      (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'More words.' })).id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await settled(page);
    await page.click('#cb-mode [data-m="char"]');
    await page.locator('#cb-size').fill('big');
    await page.locator('#cb-size').press('Enter');
    await expect(page.locator('#cb-size')).toHaveClass(/\bbad\b/);
    expect(await page.evaluate(i => styleOf(i).size ?? null, id)).toBe(null);
    await page.evaluate(() => toggleCtlBar(false));
    expect(await page.evaluate(() => $('type').parentNode.id)).toBe('context');
    await expect(page.locator('#ty-size')).toBeVisible();      // the float's own stepper
    await expect(page.locator('#cb-size')).toBeHidden();
  });
});
