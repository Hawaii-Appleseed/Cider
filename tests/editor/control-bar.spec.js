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
// (size and leading in points, tracking in thousandths of an em). Phase 3:
// the nine-point reference point (what X/Y read, and what stays put when the
// bar resizes, rotates or flips), the W/H link, scale X/Y, the P flip
// indicator, and the picture's anchor and Frame Fitting Options. Local mode.
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

  test('a field names itself on hover, and its icon scrubs the number', async ({ page }) => {
    await addRect(page);
    const lab = page.locator('#cb-x').locator('xpath=..');
    // the native title is gone (a slow, easy-to-miss tooltip); the hover chip says it
    await expect(lab).not.toHaveAttribute('title', /.+/);
    await lab.hover({ position: { x: 4, y: 8 } });
    await expect(page.locator('#tt')).toBeVisible();
    await expect(page.locator('#tt')).toContainText('Left edge');
    await expect(page.locator('#tt')).toContainText('drag');
    // press the letter and drag right 100px: X moves by 1 inch, in ONE undo step
    const before = (await rect(page)).x, steps = await page.evaluate(() => past.length);
    const box = await lab.boundingBox();
    const x0 = box.x + 4, y0 = box.y + box.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 50, y0, { steps: 5 });
    await page.mouse.move(x0 + 100, y0, { steps: 5 });
    await expect(page.locator('#cb-x')).toHaveValue(String(+(before + 1).toFixed(2)));
    await page.mouse.up();
    await settled(page);
    expect((await rect(page)).x).toBeCloseTo(before + 1, 2);
    expect(await page.evaluate(() => past.length)).toBe(steps + 1);
  });

  test('the docked bar wraps inside a narrow window instead of running off it', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 800 });
    const fits = () => page.evaluate(() => {
      const bar = $('ctl'), w = innerWidth;
      const kids = [...bar.querySelectorAll('input, select, button, label')]
        .filter(e => e.offsetParent !== null);
      // nothing past the window, and nothing hanging under the panel rail on the right
      const rail = $('dock-icons').getBoundingClientRect().left;
      const past = kids.filter(e => { const b = e.getBoundingClientRect();
        return b.right > w + 1 || (b.bottom > 46 && b.right > rail + 1); }).map(e => e.id || e.className);
      return { past, scrolls: bar.scrollWidth > bar.clientWidth + 1, h: bar.getBoundingClientRect().height };
    });
    // object mode
    await addRect(page);
    let r = await fits();
    expect(r.past).toEqual([]);
    expect(r.scrolls).toBe(false);
    // character mode: the longest row
    const id = await page.evaluate(async () =>
      (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words to set in the bar.' })).id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await settled(page);
    await page.click('#cb-mode [data-m="char"]');
    r = await fits();
    expect(r.past).toEqual([]);
    expect(r.scrolls).toBe(false);
    expect(r.h).toBe(44);   // and the bar itself did not grow: the canvas must not move on a click
  });

  test('the comments panel opens below the rows that hang from the bar, not over them', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 800 });
    const id = await page.evaluate(async () =>
      (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words to set in the bar.' })).id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await settled(page);
    await page.click('#cb-mode [data-m="char"]');
    await page.evaluate(() => { $('cpanel').hidden = false; });
    const r = await page.evaluate(() => {
      const bar = $('ctl').getBoundingClientRect();
      const low = Math.max(...[...$('ctl').querySelectorAll('input, select, button, label')]
        .filter(e => e.offsetParent).map(e => e.getBoundingClientRect().bottom));
      return { panelTop: $('cpanel').getBoundingClientRect().top, controlsBottom: low, barTop: bar.top };
    });
    expect(r.controlsBottom).toBeGreaterThan(r.barTop + 44);       // it did wrap
    expect(r.panelTop).toBeGreaterThanOrEqual(r.controlsBottom - 1);
  });

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

test.describe('control bar: reference point and fitting', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });
  async function rectAt(page, x, y, w, h) {
    await page.evaluate(async ([x, y, w, h]) => {
      pushHistory();
      layout.shapes.push({ id: 'cb-rect', page: 3, kind: 'rect', x, y, w, h,
                           fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
      markDirty(); await render();
      setSel($('out').contentDocument, ['cb-rect']);
    }, [x, y, w, h]);
    await settled(page);
  }
  const enter = async (page, sel, v) => { await page.locator(sel).fill(v); await page.locator(sel).press('Enter'); };

  test('X/Y read the chosen point, and a resize keeps it where it was', async ({ page }) => {
    await rectAt(page, 3, 3, 2, 1);
    await expect(page.locator('#cb-ref')).toBeVisible();
    await expect(page.locator('#cb-ref [data-ref="tl"]')).toHaveClass(/\bon\b/);   // the default
    await expect(page.locator('#cb-x')).toHaveValue('3');
    await page.click('#cb-ref [data-ref="c"]');
    await expect(page.locator('#cb-x')).toHaveValue('4');                            // the centre
    await expect(page.locator('#cb-y')).toHaveValue('3.5');
    await enter(page, '#cb-w', '4');                                                  // grows both ways
    await expect.poll(async () => (await rect(page)).w).toBe(4);
    expect((await rect(page)).x).toBeCloseTo(2, 3);
    await page.click('#cb-ref [data-ref="r"]');
    await enter(page, '#cb-w', '1');                                                  // right edge stays
    await expect.poll(async () => (await rect(page)).w).toBe(1);
    expect((await rect(page)).x).toBeCloseTo(5, 3);
    // Typing X puts the reference point there.
    await enter(page, '#cb-x', '7in');
    await expect.poll(async () => (await rect(page)).x).toBeCloseTo(6, 3);
    expect(await page.evaluate(() => localStorage.getItem('ds-refpt'))).toBe('r');
  });

  test('rotate and flip turn about the reference point; the P shows it', async ({ page }) => {
    await rectAt(page, 3, 3, 2, 1);
    await page.click('#cb-rotcw');                    // about the top left (3, 3)
    await expect.poll(async () => (await rect(page)).rot).toBe(90);
    let r = await rect(page);
    expect(r.x).toBeCloseTo(1.5, 3); expect(r.y).toBeCloseTo(3.5, 3);
    await expect(page.locator('#cb-x')).toHaveValue('3');   // the point did not move
    await expect(page.locator('#cb-y')).toHaveValue('3');
    await page.evaluate(() => undo());
    await expect.poll(async () => (await rect(page)).rot ?? 0).toBe(0);
    await page.evaluate(() => setSel($('out').contentDocument, ['cb-rect']));
    await page.click('#cb-fliph');                    // mirrored across its left edge
    await expect.poll(async () => (await rect(page)).flip).toBe('h');
    r = await rect(page);
    expect(r.x).toBeCloseTo(1, 3); expect(r.y).toBeCloseTo(3, 3);
    await expect(page.locator('#cb-pflag')).toHaveAttribute('style', /scale\(-1, ?1\)/);
    // About the centre, a turn stays in place.
    await page.click('#cb-ref [data-ref="c"]');
    await page.click('#cb-rotccw');
    await expect.poll(async () => (await rect(page)).rot).toBe(-90);
    r = await rect(page);
    expect(r.x).toBeCloseTo(1, 3); expect(r.y).toBeCloseTo(3, 3);
  });

  test('the link keeps proportions; scale X/Y resize by a percent', async ({ page }) => {
    await rectAt(page, 3, 3, 2, 1);
    await page.click('#cb-link');
    await expect(page.locator('#cb-link')).toHaveClass(/\bon\b/);
    await enter(page, '#cb-w', '4');
    await expect.poll(async () => (await rect(page)).h).toBe(2);
    await page.click('#cb-link');                     // off again
    await enter(page, '#cb-sx', '50');
    await expect.poll(async () => (await rect(page)).w).toBe(2);
    expect((await rect(page)).h).toBe(2);
    await expect(page.locator('#cb-sx')).toHaveValue('100');   // a frame's scale reads 100 again
  });

  test('a fitted picture: the anchor grid and Frame Fitting Options', async ({ page }) => {
    const id = await page.evaluate(() => {
      const d = $('out').contentDocument;
      const el = [...d.querySelectorAll('[data-el]')].find(e => fitKind(e.dataset.el));
      return el && el.dataset.el;
    });
    test.skip(!id, 'no picture in the fixture');
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await settled(page);
    await expect(page.locator('#cb-fit')).toBeVisible();
    await expect(page.locator('#cb-fitref')).toBeHidden();      // nothing fitted yet
    await page.click('#cb-fit [data-fit="cover"]');
    await expect.poll(() => page.evaluate(i => fitNow(i).fit, id)).toBe('cover');
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await expect(page.locator('#cb-fitref')).toBeVisible();
    await page.click('#cb-fitref [data-fa="tl"]');
    await expect.poll(() => page.evaluate(i => fitNow(i).align, id)).toBe('top left');
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await page.click('#cb-fitopts');
    const dlg = page.locator('dialog[open]');
    await dlg.locator('select').first().selectOption('contain');
    await dlg.locator('select').nth(1).selectOption('bottom right');
    await dlg.locator('button.dsdlg-ok').click();
    await expect.poll(() => page.evaluate(i => fitNow(i), id)).toEqual({ fit: 'contain', align: 'bottom right' });
  });
});

