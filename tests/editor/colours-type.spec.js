// INDESIGN_PARITY.md 80 (colours in use), 77 (type from the keyboard) and
// 75 (load styles from another report).
const { warmTest: test, expect, gotoEditor, clickTool } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};

test.describe('80 colours in use', () => {
  test('lists colours by value, names them as swatches, replaces one everywhere, and leaves words alone', async ({ page }) => {
    await gotoEditor(page);
    const a = await addBox(page, 'one', { fill: '#1E6194', style: { color: '#1e6194' } });
    const b = await addBox(page, 'two', { y: 3, fill: '#c0392b' });
    await page.evaluate(async () => { pushHistory(); tables().push({ id: 'zz', page: 3, x: 1, y: 6, w: 3, rows: [['#ADD', 'x']], headerFill: '#C0392B' }); markDirty(); await render(); });
    let c = (await api(page, 'colours()')).colours;
    const blue = c.find(x => x.hex === '#1E6194');
    expect(blue.uses).toEqual(expect.arrayContaining([a]));
    expect(blue.uses.length).toBe(2);
    expect(c.find(x => x.hex === '#C0392B').uses.length).toBe(2);
    expect(c.some(x => x.hex === '#AADDDD')).toBe(false);          // a table cell's words are not a colour
    let r = await page.evaluate(() => docsync.api.replaceColour('#C0392B', '#2F3E46'));
    expect(r.replaced).toBe(2);
    expect(await page.evaluate(i => boxOf(i).fill, b)).toBe('#2F3E46');
    expect(await page.evaluate(() => tableOf('table.zz').rows[0][0])).toBe('#ADD');
    r = await api(page, 'nameAllColours()');
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => [boxOf(i).fill, boxOf(i).style.color], a)).toEqual(['@1E6194', '@1E6194']);
    expect(await page.evaluate(i => getComputedStyle($('out').contentDocument.querySelector(`[data-el="${i}"]`)).backgroundColor, a))
      .toBe('rgb(30, 97, 148)');
    await clickTool(page, 'colours');
    expect(await page.locator('#cl-list .cl-row').count()).toBeGreaterThan(1);
  });
});

test.describe('77 type from the keyboard', () => {
  test('size steps with ⇧⌘> on a selected box; tracking, leading and shift with words selected while typing', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'Words to set.', { style: { size: 16 } });
    await page.evaluate(i => { const d = $('out').contentDocument; setSel(d, [i]);
      d.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', key: '>', metaKey: true, shiftKey: true, bubbles: true })); }, id);
    await page.waitForFunction(i => boxOf(i).style.size === 17, id);
    const st = await page.evaluate(async i => {
      const d = $('out').contentDocument;
      editBox(d, d.querySelector(`[data-el="${i}"]`));
      const host = d.querySelector('[contenteditable="true"]');
      host.focus();
      const r = d.createRange(); r.selectNodeContents(host); d.getSelection().removeAllRanges(); d.getSelection().addRange(r);
      const key = (k, o = {}) => host.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
      key('ArrowRight', { altKey: true }); key('ArrowRight', { altKey: true });
      key('ArrowDown', { altKey: true });
      key('ArrowUp', { altKey: true, shiftKey: true });
      return boxOf(i).style;
    }, id);
    expect(st.size).toBe(17);
    expect(st.tracking).toBe(0.5);
    expect(st.leading).toBeGreaterThan(1);
    expect(st.shift).toBe(1);
    // With nothing selected, ⌥→ is left to move the caret.
    const moved = await page.evaluate(i => { const d = $('out').contentDocument; const host = d.querySelector('[contenteditable="true"]');
      d.getSelection().collapseToStart();
      const e = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
      host.dispatchEvent(e); return e.defaultPrevented; }, id);
    expect(moved).toBe(false);
  });
});

test.describe('75 load styles from another report', () => {
  test('adds the styles this report lacks, and replaces same-named ones only when asked', async ({ page }) => {
    await gotoEditor(page);
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Mine', size: 14 })`)).ok).toBe(true);
    const src = { textStyles: { Mine: { size: 30 }, Theirs: { size: 11, italic: true } }, swatches: { Navy: '#1E3A4C' } };
    let r = await page.evaluate(s => _pilotOne('loadStylesFrom', [s, { textStyles: 'add', swatches: 'add' }]), src);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(() => [layout.textStyles.Mine.size, layout.textStyles.Theirs.size, layout.swatches.Navy])).toEqual([14, 11, '#1E3A4C']);
    await page.evaluate(s => _pilotOne('loadStylesFrom', [s, { textStyles: 'replace' }]), src);
    expect(await page.evaluate(() => layout.textStyles.Mine.size)).toBe(30);
    // And from a real report on disk, through the registry.
    const ids = await page.evaluate(() => Object.keys(REGISTRY || {}).filter(id => id !== PROJECT));
    expect(ids.length).toBeGreaterThan(0);
    const other = await page.evaluate(id => otherLayout(id).then(l => typeof l === 'object'), ids[0]);
    expect(other).toBe(true);
  });
});
