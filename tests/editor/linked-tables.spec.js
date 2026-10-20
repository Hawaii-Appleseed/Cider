// INDESIGN_PARITY.md 59 (linked text) and 53 (what tables still lacked).
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};
const cellEl = (page, tid, rc) => page.evaluate(([t, k]) => {
  const c = $('out').contentDocument.querySelector(`[data-el="${t}"] [data-cell="${k}"]`);
  if (!c) return null; const cs = getComputedStyle(c);
  return { tag: c.tagName, bg: cs.backgroundColor, fw: cs.fontWeight, br: cs.borderRightWidth, rs: c.rowSpan, cs: c.colSpan, h: c.getBoundingClientRect().height };
}, [tid, rc]);

test.describe('59 linked text', () => {
  test('a box repeats another box\'s words, follows its edits, and the chip says so', async ({ page }) => {
    await gotoEditor(page);
    const src = await addBox(page, 'Rents rose **12%** in a year.\n\nA second paragraph.');
    const use = await addBox(page, `As the summary says: {text:${src}}`, { y: 3 });
    const read = () => page.evaluate(i => { const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      return { text: el.textContent.trim(), linked: !!el.querySelector('.ds-linked[data-link]') }; }, use);
    expect(await read()).toEqual({ text: 'As the summary says: Rents rose 12% in a year.', linked: true });
    await page.evaluate(i => docsync.api.setBoxText(i, 'Rents rose 15% in a year.'), src);
    expect((await read()).text).toBe('As the summary says: Rents rose 15% in a year.');
    const chip = await page.evaluate(s => { const t = document.createElement('div'); t.innerHTML = mdInlineToHtml(`a {text:${s}} b`);
      return [t.querySelector('.ds-varchip').textContent, nodeToMdInline(t)]; }, src);
    expect(chip[0]).toContain('⇄ Rents rose 15%');
    expect(chip[1]).toBe(`a {text:${src}} b`);
  });
});

test.describe('53 table structure, continued', () => {
  test('split, header columns, alternating columns, cell styles, even rows, table to text, a picture in a cell', async ({ page }) => {
    await gotoEditor(page);
    const box = await addBox(page, '\tQ1\tQ2\tQ3\nRent\t1\t2\t3\nFood\t4\t5\t6');
    const tid = (await page.evaluate(i => docsync.api.textToTable(i), box)).id;
    // Split a plain cell horizontally: a row under it, its neighbours span both.
    let r = await page.evaluate(i => docsync.api.splitCell(i, 1, 1, 'h'), tid);
    expect(r.ok).toBe(true);
    expect(r.rows).toBe(4);
    expect((await cellEl(page, tid, '1,0')).rs).toBe(2);
    expect(await cellEl(page, tid, '2,1')).not.toBeNull();         // the new half
    // ...and splitting the merged neighbour gives its grid back.
    r = await page.evaluate(i => docsync.api.splitCell(i, 1, 0, 'v'), tid);
    expect((await cellEl(page, tid, '1,0')).rs).toBe(1);
    r = await page.evaluate(i => docsync.api.setTable(i, { headerCols: 1, bandCols: '#EEEEEE', bandColStroke: { w: 2, color: '#333333' } }), tid);
    expect(r.ok).toBe(true);
    expect((await cellEl(page, tid, '3,0')).tag).toBe('TH');
    const c2 = await cellEl(page, tid, '3,2');
    expect(c2.bg).toBe('rgb(238, 238, 238)');
    expect(parseFloat(c2.br)).toBeGreaterThan(1.4);
    // A cell style, worn by two cells; redefining it moves both; dropping it keeps the look.
    expect((await api(page, `defineCellStyle('Total', { fill: '#DDEEFF', bold: true })`)).ok).toBe(true);
    expect((await page.evaluate(i => docsync.api.cellStyle(i, [[3, 1], [3, 3]], 'Total'), tid)).ok).toBe(true);
    expect((await cellEl(page, tid, '3,3')).bg).toBe('rgb(221, 238, 255)');
    await api(page, `defineCellStyle('Total', { fill: '#FFEEDD', bold: true })`);
    expect((await cellEl(page, tid, '3,1')).bg).toBe('rgb(255, 238, 221)');
    await api(page, `defineCellStyle('Total', null)`);
    expect((await cellEl(page, tid, '3,1')).bg).toBe('rgb(255, 238, 221)');
    expect(await page.evaluate(() => layout.cellStyles)).toBeUndefined();
    // Even rows.
    await page.evaluate(async i => { pushHistory(); const t = tableOf(i); t.rows[1][1] = 'a long cell\nwith\nthree lines';
      markDirty(); await render(); const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      pushHistory(); tableDistributeRows(t, el); markDirty(); await render(); }, tid);
    const hs = await page.evaluate(i => tableOf(i).rowh, tid);
    expect(new Set(hs).size).toBe(1);
    // A picture in a cell renders as one.
    await page.evaluate(async i => { pushHistory(); tableOf(i).rows[0][0] = '![logo](assets/no-such.png)'; markDirty(); await render(); }, tid);
    expect(await page.evaluate(i => !!$('out').contentDocument.querySelector(`[data-el="${i}"] [data-cell="0,0"] img.inline-img`), tid)).toBe(true);
    // Table to text.
    r = await page.evaluate(i => docsync.api.tableToText(i), tid);
    expect(r.ok).toBe(true);
    const lines = await page.evaluate(i => boxOf(i).md.split('\n'), r.id);
    expect(lines.length).toBe(4);
    expect(lines[0].split('\t')[0]).toBe('![logo](assets/no-such.png)');
    expect(lines[1]).toContain('a long cell with three lines');
    expect(await page.evaluate(i => !!tableOf(i), tid)).toBe(false);
  });
});
