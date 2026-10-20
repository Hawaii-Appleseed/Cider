// INDESIGN_PARITY.md 76 (style housekeeping), 79 (default styles for new
// things), 81 (clear transformations) and 78 (span columns). Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};
/** Write straight into layout.json's model, as one undo step and one render. */
const setLayout = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  pushHistory(); (0, eval)(src)(a); markDirty(); await render();
}, [fn.toString(), arg]);

test.describe('76 style housekeeping', () => {
  test('finds and deletes unused styles and swatches, keeping what is worn, built from, or a default', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'worn');
    await setLayout(page, i => {
      layout.swatches = { ...(layout.swatches || {}), Brand: '#1E6194', Gone: '#C0392B' };
      layout.textStyles = { ...(layout.textStyles || {}), Base: { size: 14 }, Body: { from: 'Base', color: '@Brand' },
                            Kid: { from: 'Body', italic: true }, Spare: { color: '@Gone' }, Deflt: { size: 16 } };
      layout.objectStyles = { ...(layout.objectStyles || {}), Card: { kind: 'box', fill: '#EEEEEE' }, Old: { kind: 'shape', stroke: '#000000' } };
      layout.cellStyles = { ...(layout.cellStyles || {}), Hdr: { bold: true } };
      layout.defaultStyles = { text: 'Deflt' };
      boxOf(i).style = { use: 'Body' };
      boxOf(i).use = 'Card';
    }, id);
    const before = await page.evaluate(() => ({ t: Object.keys(layout.textStyles), o: Object.keys(layout.objectStyles) }));
    const un = (await api(page, 'unusedStyles()')).unused;
    expect(un.text).toEqual(expect.arrayContaining(['Kid', 'Spare']));
    expect(un.text).not.toEqual(expect.arrayContaining(['Base']));    // Body is built from it
    expect(un.text).not.toContain('Body');
    expect(un.text).not.toContain('Deflt');                           // the default for new text boxes
    expect(un.object).toContain('Old');
    expect(un.object).not.toContain('Card');
    expect(un.cell).toContain('Hdr');
    expect(un.swatches).toContain('Gone');                            // named only by a style that goes
    expect(un.swatches).not.toContain('Brand');
    const r = await page.evaluate(() => docsync.api.dropUnusedStyles());
    expect(r.ok).toBe(true);
    const after = await page.evaluate(() => ({ t: Object.keys(layout.textStyles || {}), o: Object.keys(layout.objectStyles || {}),
      c: layout.cellStyles, sw: Object.keys(layout.swatches || {}) }));
    expect(after.t).toEqual(expect.arrayContaining(['Base', 'Body', 'Deflt']));
    expect(after.t).not.toContain('Kid');
    expect(after.t).not.toContain('Spare');
    expect(after.o).toContain('Card');
    expect(after.o).not.toContain('Old');
    expect(after.c).toBeUndefined();
    expect(after.sw).toContain('Brand');
    expect(after.sw).not.toContain('Gone');
    expect(after.t.length).toBeLessThan(before.t.length);
    // The page still renders the box in its style.
    expect(await page.evaluate(i => getComputedStyle($('out').contentDocument.querySelector(`[data-el="${i}"]`)).color, id))
      .toBe('rgb(30, 97, 148)');
    // One undo step brings every one of them back.
    await page.evaluate(async () => { await undo(); });
    expect(await page.evaluate(() => Object.keys(layout.textStyles))).toEqual(expect.arrayContaining(['Kid', 'Spare']));
  });

  test('duplicates a style, and refuses a name that is taken', async ({ page }) => {
    await gotoEditor(page);
    await setLayout(page, () => {
      layout.textStyles = { ...(layout.textStyles || {}), Body: { size: 15, italic: true } };
      layout.objectStyles = { ...(layout.objectStyles || {}), Card: { kind: 'box', fill: '#EEEEEE' } };
    });
    let r = await page.evaluate(() => docsync.api.duplicateStyle('text', 'Body'));
    expect(r.name).toBe('Body copy');
    r = await page.evaluate(() => docsync.api.duplicateStyle('text', 'Body'));
    expect(r.name).toBe('Body copy 2');
    r = await page.evaluate(() => docsync.api.duplicateStyle('object', 'Card', 'Card wide'));
    expect(r.name).toBe('Card wide');
    expect(await page.evaluate(() => [layout.textStyles['Body copy'], layout.objectStyles['Card wide']]))
      .toEqual([{ size: 15, italic: true }, { kind: 'box', fill: '#EEEEEE' }]);
    r = await page.evaluate(() => docsync.api.duplicateStyle('text', 'Body', 'Body copy'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already/);
  });

  test('the override highlighter outlines text that differs from its style, and Clear overrides puts it back', async ({ page }) => {
    await gotoEditor(page);
    const key = await page.frameLocator('#out').locator('[data-slot]').first().evaluate(e => e.dataset.slot);
    const id = await addBox(page, 'a box', { y: 4 });
    await setLayout(page, ([k, i]) => {
      layout.textStyles = { ...(layout.textStyles || {}), Body: { size: 15, italic: true } };
      layout.text = layout.text || {};
      layout.text[k] = { use: 'Body', size: 30, italic: true };    // italic is the style's own value: not an override
      boxOf(i).style = { use: 'Body' };
    }, [key, id]);
    const ov = (await api(page, 'overrides()')).overrides;
    expect(ov).toEqual([{ key, style: 'Body', keys: ['size'] }]);
    await page.evaluate(() => docsync.api.highlightOverrides(true));
    const outlined = () => page.evaluate(() => [...$('out').contentDocument.querySelectorAll('.ds-override')]
      .map(e => e.dataset.slot || e.dataset.el));
    expect(await outlined()).toContain(key);
    expect(await outlined()).not.toContain(id);
    // Editor-only: the dashed outline is the editor's stylesheet, not the report's.
    expect(await page.evaluate(k => getComputedStyle($('out').contentDocument
      .querySelector(`[data-slot="${k}"]`)).outlineStyle, key)).toBe('dashed');

    // From the Text style pop: select the slot, Clear overrides.
    const frame = page.frameLocator('#out');
    const el = frame.locator(`[data-slot="${key}"]`).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(700);
    await page.click('#ty-style-more');
    await expect(page.locator('#ty-stylebody .tp-btn:text("Highlighting overrides")')).toBeVisible();
    await page.click('#ty-stylebody .tp-btn:text("Clear overrides")');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(k => layout.text[k], key)).toEqual({ use: 'Body' });
    expect(await outlined()).toEqual([]);
    expect((await api(page, 'overrides()')).overrides).toEqual([]);
    await page.evaluate(() => docsync.api.highlightOverrides(false));
  });
});

test.describe('79 default styles for new things', () => {
  test('new text boxes, shapes and tables wear the report\'s defaults; explicit keys still win', async ({ page }) => {
    await gotoEditor(page);
    await setLayout(page, () => {
      layout.textStyles = { ...(layout.textStyles || {}), Body: { size: 15 } };
      layout.objectStyles = { ...(layout.objectStyles || {}), Card: { kind: 'box', fill: '#EEEEEE' },
        Rule: { kind: 'shape', stroke: '#2F3E46', fill: '#FDCF21' }, Data: { kind: 'table', headerFill: '#1E6194' } };
    });
    let r = await page.evaluate(() => docsync.api.setDefaultStyle('box', 'Rule'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/dresses a shape/);
    r = await page.evaluate(() => docsync.api.batch([
      { verb: 'setDefaultStyle', args: ['text', 'Body'] }, { verb: 'setDefaultStyle', args: ['box', 'Card'] },
      { verb: 'setDefaultStyle', args: ['shape', 'Rule'] }, { verb: 'setDefaultStyle', args: ['table', 'Data'] }]));
    expect(r.ok).toBe(true);
    expect((await api(page, 'defaultStyles()')).defaults).toEqual({ text: 'Body', box: 'Card', shape: 'Rule', table: 'Data' });

    const a = await addBox(page, 'plain');
    expect(await page.evaluate(i => [boxOf(i).use, boxOf(i).style], a)).toEqual(['Card', { use: 'Body' }]);
    const b = await addBox(page, 'own fill and type', { y: 3, fill: '#FFFFFF', style: { size: 22 } });
    expect(await page.evaluate(i => [boxOf(i).use, boxOf(i).fill, boxOf(i).style], b)).toEqual(['Card', '#FFFFFF', { size: 22 }]);
    expect(await page.evaluate(i => getComputedStyle($('out').contentDocument.querySelector(`[data-el="${i}"]`)).fontSize, a))
      .toBe('15px');
    // A shape from the pilot and from the Shapes panel: the style's keys are
    // the style's, so the panel's stock green goes.
    const s = await page.evaluate(() => docsync.api.addShape({ kind: 'rect', page: 3, x: 1, y: 6, w: 1 }));
    expect(await page.evaluate(i => [shapeOf(i).use, shapeOf(i).fill, shapeOf(i).stroke], s.id)).toEqual(['Rule', undefined, undefined]);
    // The editor's own "+ Table" button.
    await page.evaluate(() => $('table').onclick());
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => tables()[tables().length - 1].use)).toBe('Data');
    // The editor's own text presets: a heading keeps its type, wears the box style.
    await page.evaluate(() => addTextBox('heading'));
    expect(await page.evaluate(() => { const x = boxes()[boxes().length - 1]; return [x.use, x.style.use]; })).toEqual(['Card', undefined]);
    // Dropping a style that is a default drops the default, so the report still opens.
    r = await page.evaluate(() => docsync.api.dropStyle('object', 'Card'));
    expect(r.ok).toBe(true);
    expect((await api(page, 'defaultStyles()')).defaults).toEqual({ text: 'Body', shape: 'Rule', table: 'Data' });
  });

  test('the object style pop sets the default for its kind', async ({ page }) => {
    await gotoEditor(page);
    const s = await page.evaluate(() => docsync.api.addShape({ kind: 'rect', page: 3, x: 1, y: 1, w: 1 }));
    await setLayout(page, i => {
      layout.objectStyles = { ...(layout.objectStyles || {}), Rule: { kind: 'shape', stroke: '#2F3E46' } };
      shapeOf(i).use = 'Rule';
    }, s.id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), s.id);
    await page.waitForTimeout(400);
    await page.click('#ar-style-more');
    await page.click('#ar-stylebody .tp-btn:text("Use for new shapes")');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => layout.defaultStyles)).toEqual({ shape: 'Rule' });
  });
});

test.describe('81 clear transformations', () => {
  test('rotation, skew, flip and scale go; place and size stay — pilot and right-click', async ({ page }) => {
    await gotoEditor(page);
    const s = await page.evaluate(() => docsync.api.addShape({ kind: 'rect', page: 3, x: 1, y: 1, w: 2, h: 1 }));
    const r0 = await page.evaluate(i => docsync.api.batch([
      { verb: 'rotate', args: [i, 30] }, { verb: 'skew', args: [i, 10] }, { verb: 'flip', args: [i, 'h'] }]), s.id);
    expect(r0.ok).toBe(true);
    const geo = await page.evaluate(i => { const x = shapeOf(i); return [x.x, x.y, x.w, x.h]; }, s.id);
    let r = await page.evaluate(i => docsync.api.clearTransforms(i), s.id);
    expect(r.cleared).toBe(1);
    expect(await page.evaluate(i => { const x = shapeOf(i); return [x.rot, x.skew, x.flip, x.x, x.y, x.w, x.h]; }, s.id))
      .toEqual([undefined, undefined, undefined, ...geo]);
    r = await page.evaluate(i => docsync.api.clearTransforms([i]), s.id);
    expect(r.cleared).toBe(0);                      // nothing left to clear

    // A text box, from the pilot.
    const id = await addBox(page, 'turned', { y: 4 });
    await page.evaluate(i => docsync.api.batch([{ verb: 'rotate', args: [i, 90] }, { verb: 'flip', args: [i, 'v'] }]), id);
    r = await page.evaluate(i => docsync.api.clearTransforms([i]), id);
    expect(r.cleared).toBe(1);
    expect(await page.evaluate(i => [boxOf(i).rot, boxOf(i).flip], id)).toEqual([undefined, undefined]);

    // The object menu (the strip's ⋯ is the same menu as right-click).
    await page.evaluate(i => docsync.api.batch([{ verb: 'rotate', args: [i, 45] }, { verb: 'flip', args: [i, 'hv'] }]), s.id);
    await page.evaluate(i => setSel($('out').contentDocument, [i]), s.id);
    await page.click('#ar-more');
    await page.waitForTimeout(400);
    const frame = page.frameLocator('#out');
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Rotate and flip' }).hover();
    await frame.locator('.ds-submenu button', { hasText: 'Clear transformations' }).click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(i => [shapeOf(i).rot, shapeOf(i).flip], s.id)).toEqual([undefined, undefined]);
    await page.evaluate(async () => { await undo(); });
    expect(await page.evaluate(i => [shapeOf(i).rot, shapeOf(i).flip], s.id)).toEqual([45, 'hv']);
  });
});

test.describe('78 span columns', () => {
  test('{span} puts a heading across both columns; it is a chip while typing and on the Insert special menu', async ({ page }) => {
    await gotoEditor(page);
    // A heading's words start after its ##, so that is where the token goes.
    const md = '## {span}Over both columns\n\nOne paragraph of the first column, long enough to wrap a little.\n\n{break:column}The second column.';
    const id = await addBox(page, md, { w: 5 });
    await page.evaluate(async i => { pushHistory(); boxOf(i).cols = 2; boxOf(i).h = 3; markDirty(); await render(); }, id);
    const got = await page.evaluate(i => {
      const box = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      const h = box.querySelector('h2'), ps = [...box.querySelectorAll('p')];
      const hr = h.getBoundingClientRect(), br = box.getBoundingClientRect();
      return { span: getComputedStyle(h).columnSpan, hw: hr.width, bw: br.width,
               p0: ps[0].getBoundingClientRect(), p1: ps[1].getBoundingClientRect(), hb: hr.bottom };
    }, id);
    expect(got.span).toBe('all');
    expect(got.hw).toBeGreaterThan(got.bw * 0.8);        // across both columns, not one
    expect(got.p0.top).toBeGreaterThanOrEqual(got.hb - 1);
    expect(got.p1.top).toBeGreaterThanOrEqual(got.hb - 1);   // both columns start under it
    expect(got.p1.left).toBeGreaterThan(got.p0.left + 20);
    // While typing it is a chip, and hands back exactly the token.
    const back = await page.evaluate(m => {
      const el = document.createElement('div');
      el.innerHTML = mdToHtml(m, { inline: true });
      const c = el.querySelector('.ds-varchip');
      return { label: c && c.textContent, md: htmlToMd(el, { inline: true }) };
    }, '{span}Over both');
    expect(back).toEqual({ label: '⇔ spans columns', md: '{span}Over both' });
    await page.evaluate(i => editBox($('out').contentDocument,
      $('out').contentDocument.querySelector(`[data-el="${i}"]`)), id);
    await frame(page).locator('.ds-edit p').first().click({ button: 'right' });
    await frame(page).locator('.ds-menu button.ds-sub', { hasText: 'Insert special' }).hover();
    await expect(frame(page).locator('.ds-submenu button', { hasText: 'Span columns' })).toBeVisible();
  });
});

const frame = page => page.frameLocator('#out');
