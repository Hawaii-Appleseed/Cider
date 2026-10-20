// Quick Apply (INDESIGN_PARITY.md 51): ⌘↩, a few letters, Enter — a text
// style, character style, object style, swatch or any editor command.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const setLayout = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  pushHistory(); (0, eval)(src)(a); markDirty(); await render();
}, [fn.toString(), arg]);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('51 Quick Apply', () => {
  test('⌘↩ opens the box; letters and Enter give a text box a text style, one undo step', async ({ page }) => {
    await gotoEditor(page);
    await setLayout(page, () => { layout.textStyles = { ...(layout.textStyles || {}), 'Pull Quote': { size: 18, italic: true } }; });
    const id = await addBox(page, 'quote me');
    await api(page, `select(${JSON.stringify(id)})`);
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(page.locator('#qa-in')).toBeFocused();
    await page.keyboard.type('pull q');
    await expect(page.locator('#qa-list li.on .qa-k')).toHaveText('text style');
    await expect(page.locator('#qa-list li.on .qa-n')).toHaveText('Pull Quote');
    await page.keyboard.press('Enter');
    await expect(page.locator('#qa')).toHaveCount(0);
    await expect.poll(() => page.evaluate(i => (boxOf(i).style || {}).use, id)).toBe('Pull Quote');
    await page.evaluate(() => undo());
    expect(await page.evaluate(i => (boxOf(i).style || {}).use || null, id)).toBe(null);
  });

  test('a swatch fills the selected shape; an object style dresses it', async ({ page }) => {
    await gotoEditor(page);
    await setLayout(page, () => {
      layout.swatches = { ...(layout.swatches || {}), Teal: '#1F8A80' };
      layout.objectStyles = { ...(layout.objectStyles || {}), 'Callout Card': { kind: 'shape', fill: '#FDCF21' } };
    });
    const r = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 1, h: 1 }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await api(page, `select(${JSON.stringify(r.id)})`);
    const items = (await api(page, `quickApplyItems('teal')`)).items;
    expect(items[0]).toEqual({ kind: 'swatch', label: 'Teal — fill' });
    expect((await api(page, `quickApply('teal')`)).ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).fill, r.id)).toBe('@Teal');
    expect((await api(page, `quickApply('callout card')`)).applied.kind).toBe('object style');
    expect(await page.evaluate(i => [shapeOf(i).use, 'fill' in shapeOf(i)], r.id)).toEqual(['Callout Card', false]);
  });

  test('commands are there by their words, and run as a click would', async ({ page }) => {
    await gotoEditor(page);
    const items = (await api(page, `quickApplyItems('layers')`)).items;
    expect(items.some(i => i.kind === 'command')).toBe(true);
    await page.keyboard.press(`${MOD}+Enter`);
    await page.keyboard.type('layers');
    // The best command match for "layers" is the Layers panel's own button.
    const label = await page.locator('#qa-list li.on .qa-n').textContent();
    expect(label.toLowerCase()).toContain('layers');
    await page.keyboard.press('Enter');
    await expect(page.locator('#layerspop')).toBeVisible();
  });

  test('Escape closes it and nothing changes; nothing by that name says so', async ({ page }) => {
    await gotoEditor(page);
    const before = await page.evaluate(() => JSON.stringify(layout));
    await page.keyboard.press(`${MOD}+Enter`);
    await page.keyboard.type('zzqqxx');
    await expect(page.locator('#qa-list')).toContainText('nothing by that name');
    await page.keyboard.press('Escape');
    await expect(page.locator('#qa')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(layout))).toBe(before);
  });

  test('while typing in words, a character style goes on the selected words', async ({ page }) => {
    await gotoEditor(page);
    await setLayout(page, () => { layout.textStyles = { ...(layout.textStyles || {}), Stress: { bold: true } }; });
    const id = await addBox(page, 'one two three');
    await page.evaluate(i => {
      const d = $('out').contentDocument;
      const el = d.querySelector(`[data-el="${CSS.escape(i)}"]`);
      editBox(d, el, null);
      const host = d.activeElement;
      const tn = [...host.querySelectorAll('*'), host].map(n => [...n.childNodes].find(c => c.nodeType === 3 && c.textContent.includes('two'))).find(Boolean);
      const r = d.createRange(); const at = tn.textContent.indexOf('two');
      r.setStart(tn, at); r.setEnd(tn, at + 3);
      d.getSelection().removeAllRanges(); d.getSelection().addRange(r);
    }, id);
    await page.evaluate(() => quickApply());
    await page.keyboard.type('stress');
    await expect(page.locator('#qa-list li.on .qa-k')).toHaveText('character style');
    await page.keyboard.press('Enter');
    // Close the words; the run is written as [two]{.Stress}.
    await page.evaluate(() => $('out').contentDocument.activeElement.blur());
    await expect.poll(() => page.evaluate(i => boxOf(i).md, id)).toBe('one [two]{.Stress} three');
  });
});
