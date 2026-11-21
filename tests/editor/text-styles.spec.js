// Named text styles — a stylesheet, which is InDesign's organising idea and
// the one thing layout.text could never be. `layout.text[key]` is one style
// per slot: a report's type was set slot by slot, so taking body copy from
// 11px to 10.5 meant finding and editing every slot anyone had ever touched.
//
// A slot says `use: "<name>"` and may still carry keys of its own on top;
// those win, so a style is a starting point and never a cage. Resolution
// lives in layout.py's resolve_style() and is mirrored in the editor only so
// the toolbar can SHOW what the page does.
const { sharedTest: test, expect, gotoEditor, barField, settled, afterRender } = require('./fixtures/editor-test');

/** Select a slot and open its type toolbar, the way a click does. These
 *  tests type px into the floating card's own size field, so the docked
 *  Control bar (which shows size in points instead) is switched off. */
async function pickSlot(page, key) {
  await page.evaluate(() => toggleCtlBar(false));
  const frame = page.frameLocator('#out');
  const el = frame.locator(`[data-slot="${key}"]`).first();
  // To the middle of the pane, not merely into view: the page strip floats
  // over the foot of the canvas, and a slot left down there was clicked
  // through one of its thumbnails whenever the strip had painted in time.
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await el.click();
  // The type row is this slot's once `selected` says so.
  await page.waitForFunction(k => selected === k, key);
  await settled(page);
  await expect(page.locator('#type')).toBeVisible();
}

/** The first two styleable slots on the page, whatever this fixture calls
 *  them — a spec that hard-codes slot names breaks when the report is edited. */
async function twoSlots(page) {
  return page.frameLocator('#out').locator('[data-slot]')
    .evaluateAll(els => els.map(e => e.dataset.slot).filter((v, i, a) =>
      a.indexOf(v) === i).slice(0, 2));
}

test('a look is saved as a style, worn, and redefined for everything at once',
  async ({ page }) => {
    await gotoEditor(page);
    const [a, b] = await twoSlots(page);

    // Style one slot by hand, then name that look.
    await pickSlot(page, a);
    await page.locator('#ty-size').fill('22');
    await afterRender(page, () => page.locator('#ty-size').press('Enter'));
    await (await barField(page, '#ty-style-more')).click();
    await page.click('#ty-stylebody .tp-btn:text("+ Save as a style")');
    await settled(page);
    await page.locator('dialog.dsdlg input[type="text"]').fill('Body');
    await afterRender(page, () => page.locator('dialog.dsdlg form button').last().click());

    // The style holds the look; the slot that defined it now WEARS it rather
    // than keeping a copy — otherwise the one slot a style came from is the
    // one a redefine can never move.
    expect(await page.evaluate(() => layout.textStyles.Body)).toEqual({ size: 22 });
    expect(await page.evaluate(k => layout.text[k], a)).toEqual({ use: 'Body' });

    // A second slot wears it from the picker.
    await pickSlot(page, b);
    await afterRender(page, () => page.selectOption('#ty-style', 'Body'));
    expect(await page.evaluate(k => layout.text[k], b)).toEqual({ use: 'Body' });
    // And the toolbar shows the size the STYLE gives it, not a blank field.
    expect(await page.locator('#ty-size').inputValue()).toBe('22');

    // Redefine from this slot: one edit, and everything wearing it follows.
    await page.locator('#ty-size').fill('18');
    await afterRender(page, () => page.locator('#ty-size').press('Enter'));
    await (await barField(page, '#ty-style-more')).click();
    await afterRender(page, () => page.click('#ty-stylebody .tp-btn:text("Redefine")'));
    expect(await page.evaluate(() => layout.textStyles.Body.size)).toBe(18);
    expect(await page.evaluate(k => layout.text[k], b)).toEqual({ use: 'Body' });
    // The OTHER slot never moved, and renders at the new size.
    const px = await page.frameLocator('#out').locator(`[data-slot="${a}"]`).first()
      .evaluate(el => getComputedStyle(el).fontSize);
    expect(px).toBe('18px');
  });

test('a slot can override the style it wears, and say so', async ({ page }) => {
  await gotoEditor(page);
  const [a] = await twoSlots(page);
  await pickSlot(page, a);
  // Seed a style the way a previous session would have left one, then let the
  // toolbar rebuild — the picker is filled when a slot is shown, not polled.
  await page.evaluate(() => {
    layout.textStyles = { Body: { size: 22 } };
    showType(selected);
  });
  await afterRender(page, () => page.selectOption('#ty-style', 'Body'));
  await page.locator('#ty-size').fill('30');
  await afterRender(page, () => page.locator('#ty-size').press('Enter'));

  // Both are kept: the style it follows, and the one thing it disagrees about.
  expect(await page.evaluate(k => layout.text[k], a)).toEqual({ use: 'Body', size: 30 });
  await expect(page.locator('#ty-style')).toHaveClass(/ty-style-over/);
  const px = await page.frameLocator('#out').locator(`[data-slot="${a}"]`).first()
    .evaluate(el => getComputedStyle(el).fontSize);
  expect(px).toBe('30px');

  // Unlink keeps the look and stops following.
  await page.click('#ty-style-more');
  await afterRender(page, () => page.click('#ty-stylebody .tp-btn:text("Unlink")'));
  expect(await page.evaluate(k => layout.text[k].use, a)).toBeUndefined();
  expect(await page.evaluate(k => layout.text[k].size, a)).toBe(30);
});

test('Reset takes the style with it', async ({ page }) => {
  await gotoEditor(page);
  const [a] = await twoSlots(page);
  await pickSlot(page, a);
  await page.evaluate(() => {
    layout.textStyles = { Body: { size: 22 } };
    showType(selected);
  });
  await afterRender(page, () => page.selectOption('#ty-style', 'Body'));
  await afterRender(page, () => page.click('#ty-reset'));
  // Back to what the report designed — a Reset that left the slot silently
  // following Body would be a lie.
  expect(await page.evaluate(k => (layout.text || {})[k], a)).toBeUndefined();
});
