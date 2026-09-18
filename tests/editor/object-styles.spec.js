// Object styles — InDesign's, for the things that are not text. A style names
// its kind (shape, box, table) because the three are three key sets; an
// object says `use` and its own keys still win. Resolution is layout.py's
// resolve_object(), mirrored in the editor only so the controls can SHOW what
// the page draws. The engine side — fold-in, validation, byte-identity — is
// checked in docsync/test_docsync.py; this file is the editor's promise:
// every verb writes ONE `use` or ONE style, and ⌘Z takes it back.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const frame = page => page.frameLocator('#out');

/** A shape through the pilot API, then selected the way a click would. */
async function shape(page, kind, fill) {
  const r = await page.evaluate(async ({ kind, fill }) => {
    const got = await docsync.api.addShape({ page: 1, kind, x: 1, y: 1, w: 2, h: 1, fill });
    await docsync.api.select(got.id);
    return got;
  }, { kind, fill });
  await page.waitForTimeout(600);
  return r.id;
}

async function saveAs(page, moreBtn, bodySel, name) {
  await page.click(moreBtn);
  await page.click(`${bodySel} .tp-btn:text("+ Save as a style")`);
  await page.waitForTimeout(300);
  await page.locator('dialog.dsdlg input[type="text"]').fill(name);
  await page.locator('dialog.dsdlg form button').last().click();
  await page.waitForTimeout(1800);
}

test('a shape\'s look is saved as a style, worn by another, and redefined for both',
  async ({ page }) => {
    await gotoEditor(page);
    const a = await shape(page, 'rect', '#C0392B');
    await expect(page.locator('#ar-style')).toBeVisible();
    await expect(page.locator('#ar-style')).toHaveValue('');

    await saveAs(page, '#ar-style-more', '#ar-stylebody', 'Alert');
    // The style holds the look; the shape WEARS it with nothing left over.
    const st = await page.evaluate(() => layout.objectStyles.Alert);
    expect(st.kind).toBe('shape');
    expect(st.fill).toBe('#C0392B');
    const own = await page.evaluate(id => layout.shapes.find(s => s.id === id), a);
    expect(own.use).toBe('Alert');
    expect(own.fill).toBeUndefined();
    // And the page still draws it red — the fill came back through the style.
    await expect(frame(page).locator(`[data-shape="${a}"]`)).toHaveAttribute('fill', '#C0392B');

    // A second shape wears it from the picker.
    const b = await shape(page, 'ellipse', '#6B9E78');
    await page.selectOption('#ar-style', 'Alert');
    await page.waitForTimeout(1800);
    await expect(frame(page).locator(`[data-shape="${b}"]`)).toHaveAttribute('fill', '#C0392B');
    expect(await page.evaluate(id => layout.shapes.find(s => s.id === id).use, b)).toBe('Alert');

    // Override this one by hand — the picker says so with a + — then Redefine:
    // one edit, and the first shape follows.
    await page.evaluate(id => docsync.api.recolor(id, '#2F3E46'), b);
    await page.waitForTimeout(1500);
    await page.evaluate(id => docsync.api.select(id), b);
    await page.waitForTimeout(400);
    await expect(page.locator('#ar-style')).toHaveClass(/ty-style-over/);
    await page.click('#ar-style-more');
    await page.click('#ar-stylebody .tp-btn:text("Redefine")');
    await page.waitForTimeout(1800);
    expect(await page.evaluate(() => layout.objectStyles.Alert.fill)).toBe('#2F3E46');
    await expect(frame(page).locator(`[data-shape="${a}"]`)).toHaveAttribute('fill', '#2F3E46');
    expect(await page.evaluate(id => layout.shapes.find(s => s.id === id).fill, b)).toBeUndefined();

    // ⌘Z is one step per verb.
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => layout.objectStyles.Alert.fill)).toBe('#C0392B');
  });

test('a text box gets a Box panel: a rule, padding, columns — and the whole look becomes a style',
  async ({ page }) => {
    await gotoEditor(page);
    const id = await page.evaluate(async () => {
      // addTextBox answers with the id AS THE PAGE KNOWS IT, 'text.<n>'.
      const got = await docsync.api.addTextBox({ page: 1, x: 1, y: 2, w: 4,
        md: 'A pull quote, set apart from the body.', fill: '#FFF6D8' });
      await docsync.api.select(got.id);
      return got.id.replace(/^text\./, '');
    });
    await page.waitForTimeout(800);
    // A text box is text: the type bar, with a Box button a slot never gets.
    await expect(page.locator('#type')).toBeVisible();
    await expect(page.locator('#ty-box')).toBeVisible();
    await page.click('#ty-box');
    await expect(page.locator('#ty-boxpop')).toBeVisible();

    // A left rule in the palette's first colour.
    await page.locator('#ty-boxpop .bx-row .sw').first().click();
    await page.waitForTimeout(1500);
    await page.click('#ty-boxpop .ar-dashrow button:text("Left")');
    await page.waitForTimeout(1500);
    let bx = await page.evaluate(id => layout.boxes.find(b => b.id === id), id);
    expect(bx.border.sides).toBe('left');
    expect(bx.border.color).toMatch(/^#/);
    // Padding through the slider (one history step, one render on release).
    await page.locator('#bx-pad').fill('0.2');
    await page.locator('#bx-pad').dispatchEvent('change');
    await page.waitForTimeout(1500);
    // Two columns.
    await page.selectOption('#bx-cols', '2');
    await page.waitForTimeout(1500);
    bx = await page.evaluate(id => layout.boxes.find(b => b.id === id), id);
    expect(bx.pad).toBe(0.2);
    expect(bx.cols).toBe(2);
    // And the page draws exactly that.
    const css = await frame(page).locator(`[data-el="text.${id}"]`).evaluate(el => ({
      pad: getComputedStyle(el).paddingLeft, cols: getComputedStyle(el).columnCount,
      rule: getComputedStyle(el).borderLeftStyle, none: getComputedStyle(el).borderRightStyle }));
    expect(css.pad).toBe('19.2px');       // 0.2in
    expect(css.cols).toBe('2');
    expect(css.rule).toBe('solid');
    expect(css.none).toBe('none');

    // Name the whole look. The box wears it and carries nothing of its own.
    await saveAs(page, '#ty-box', '#ty-boxbody', 'Pull quote');
    const st = await page.evaluate(() => layout.objectStyles['Pull quote']);
    expect(st.kind).toBe('box');
    expect(st.fill).toBe('#FFF6D8');
    expect(st.pad).toBe(0.2);
    expect(st.cols).toBe(2);
    expect(st.border.sides).toBe('left');
    bx = await page.evaluate(id => layout.boxes.find(b => b.id === id), id);
    expect(bx.use).toBe('Pull quote');
    expect(bx.fill).toBeUndefined();
    expect(bx.border).toBeUndefined();
    // Still drawn: the rule came back through the style.
    await expect(frame(page).locator(`[data-el="text.${id}"]`))
      .toHaveCSS('border-left-style', 'solid');

    // A second box wears it from the panel's picker.
    const id2 = await page.evaluate(async () => {
      const got = await docsync.api.addTextBox({ page: 1, x: 1, y: 6, w: 4, md: 'Another.' });
      await docsync.api.select(got.id);
      return got.id.replace(/^text\./, '');
    });
    await page.waitForTimeout(800);
    await page.click('#ty-box');
    await page.selectOption('#ty-boxstyle', 'Pull quote');
    await page.waitForTimeout(1800);
    await expect(frame(page).locator(`[data-el="text.${id2}"]`))
      .toHaveCSS('border-left-style', 'solid');
    expect(await page.evaluate(id => layout.boxes.find(b => b.id === id).use, id2)).toBe('Pull quote');
  });

test('the blend picker rides the transparency pop, and a designed element does not get one',
  async ({ page }) => {
    await gotoEditor(page);
    const a = await shape(page, 'rect', '#6B9E78');
    await page.click('#ar-alpha');
    await expect(page.locator('#ar-blendrow')).toBeVisible();
    await page.selectOption('#ar-blend', 'multiply');
    await page.waitForTimeout(1800);
    expect(await page.evaluate(id => layout.shapes.find(s => s.id === id).blend, a)).toBe('multiply');
    await expect(frame(page).locator(`[data-shape="${a}"]`)).toHaveCSS('mix-blend-mode', 'multiply');
    // Back to normal is the ABSENCE of the key on a shape wearing no style.
    await page.click('#ar-alpha');
    await page.selectOption('#ar-blend', 'normal');
    await page.waitForTimeout(1800);
    expect(await page.evaluate(id => layout.shapes.find(s => s.id === id).blend, a)).toBeUndefined();
  });
