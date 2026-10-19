// Paragraph spacing and indents (INDESIGN_PARITY.md 14) and column alignment
// in a placed table, decimal included (15). Spacing acts on PARAGRAPHS — the
// slot when it is one, the paragraphs inside a text box — never on the placed
// box itself, which a margin would move. A decimal column splits each plain
// figure at the point so every point sits at the same x. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const IN = 96;

async function addBox(page, md) {
  const r = await page.evaluate(m => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 4, md: m }), md);
  expect(r.ok).toBe(true);
  return r.id;
}

async function addTable(page, extra = {}) {
  return page.evaluate(async x => {
    pushHistory();
    tables().push({ id: 'zz-dec', page: 3, x: 1, y: 5, w: 4, header: true,
      rows: [['Item', 'Amount'], ['a', '$1,234.5'], ['b', '12'], ['c', '-3.25%'], ['d', 'n/a']], ...x });
    markDirty(); await render();
    return 'table.zz-dec';
  }, extra);
}

test.describe('paragraph spacing and indents', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('a box\'s paragraphs take the spacing, and the box itself does not move',
    async ({ page }) => {
      const id = await addBox(page, 'First paragraph of words.\n\nSecond paragraph of words.');
      const before = await page.evaluate(i =>
        $('out').contentDocument.querySelector(`[data-el="${i}"]`).getBoundingClientRect().top, id);
      const r = await page.evaluate(i => docsync.api.setStyle(i,
        { spaceBefore: 0.25, spaceAfter: 0.125, indent: 0.5, indentRight: 0.2 }), id);
      expect(r.ok).toBe(true);
      const got = await page.evaluate(i => {
        const box = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
        const p = box.querySelectorAll('p')[1], c = getComputedStyle(p);
        return { top: box.getBoundingClientRect().top, mt: c.marginTop, mb: c.marginBottom,
                 ti: c.textIndent, mr: c.marginRight, boxMt: getComputedStyle(box).marginTop };
      }, id);
      expect(parseFloat(got.mt)).toBeCloseTo(0.25 * IN, 0);
      expect(parseFloat(got.mb)).toBeCloseTo(0.125 * IN, 0);
      expect(parseFloat(got.ti)).toBeCloseTo(0.5 * IN, 0);
      expect(parseFloat(got.mr)).toBeCloseTo(0.2 * IN, 0);
      expect(got.boxMt).toBe('0px');
      expect(got.top).toBeCloseTo(before, 0);
    });

  test('a hanging indent: the first line starts left of the rest', async ({ page }) => {
    const id = await addBox(page, 'Hanging paragraph words.');
    await page.evaluate(i => docsync.api.setStyle(i, { hang: 0.3, indentLeft: 0.2 }), id);
    const c = await page.evaluate(i => {
      const p = $('out').contentDocument.querySelector(`[data-el="${i}"] p`);
      const s = getComputedStyle(p);
      return { ml: parseFloat(s.marginLeft), ti: parseFloat(s.textIndent) };
    }, id);
    expect(c.ml).toBeCloseTo(0.5 * IN, 0);       // left indent + hang for the rest
    expect(c.ti).toBeCloseTo(-0.3 * IN, 0);      // the first line hangs back by `hang`
  });

  test('a slot paragraph wears it over the report\'s own margins', async ({ page }) => {
    const before = await page.evaluate(() => getComputedStyle(
      $('out').contentDocument.querySelector('p[data-slot="whopays.p1"]')).marginTop);
    expect((await api(page, `setStyle('whopays.p1', { spaceBefore: 0.4 })`)).ok).toBe(true);
    const after = await page.evaluate(() => getComputedStyle(
      $('out').contentDocument.querySelector('p[data-slot="whopays.p1"]')).marginTop);
    expect(parseFloat(after)).toBeCloseTo(0.4 * IN, 0);
    expect(after).not.toBe(before);
  });

  test('the Paragraph panel writes inches, and a value out of range is refused',
    async ({ page }) => {
      const id = await addBox(page, 'Panel words');
      await page.evaluate(i => { setSel($('out').contentDocument, [i]); selected = i; showType(i); }, id);
      await page.evaluate(() => $('ty-parabtn').click());
      await page.fill('#ty-sb', '0.15');
      await page.locator('#ty-sb').dispatchEvent('change');
      await expect.poll(() => page.evaluate(i => styleOf(i).spaceBefore, id)).toBe(0.15);
      await page.fill('#ty-sa', '9');
      await page.locator('#ty-sa').dispatchEvent('change');
      await expect.poll(() => page.evaluate(i => styleOf(i).spaceAfter, id)).toBe(3);   // clamped
    });
});

test.describe('column alignment', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('a decimal column puts every point at the same x', async ({ page }) => {
    const id = await addTable(page, { colAlign: [null, 'decimal'] });
    const xs = await page.evaluate(i => {
      const d = $('out').contentDocument;
      return [...d.querySelectorAll(`[data-el="${i}"] td .ds-dec`)].map(s => {
        const r = d.createRange();
        r.setStart(s.firstChild || s, 0); r.setEnd(s.firstChild || s, 0);
        return Math.round(s.getBoundingClientRect().left * 10) / 10;
      });
    }, id);
    expect(xs.length).toBe(3);                       // the three figures; "n/a" is words
    expect(new Set(xs).size).toBe(1);
    const align = await page.evaluate(i => [...$('out').contentDocument
      .querySelectorAll(`[data-el="${i}"] tr`)].map(tr => getComputedStyle(tr.children[1]).textAlign), id);
    expect(align.every(a => a === 'right')).toBe(true);   // header and words sit right too
  });

  test('a column alignment follows its column, and a cell\'s own beats it',
    async ({ page }) => {
      const id = await addTable(page, { colAlign: ['right', null],
        cells: { '1,0': { align: 'left' } } });
      const a = await page.evaluate(i => {
        const t = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
        return [getComputedStyle(t.rows[2].cells[0]).textAlign, getComputedStyle(t.rows[1].cells[0]).textAlign];
      }, id);
      expect(a).toEqual(['right', 'left']);
      // Insert a column before it: the alignment moves with its column.
      await page.evaluate(async () => {
        pushHistory(); tableInsertCol(tableOf('table.zz-dec'), 0); markDirty(); await render();
      });
      expect(await page.evaluate(() => tableOf('table.zz-dec').colAlign)).toEqual([null, 'right', null]);
      await page.evaluate(async () => {
        pushHistory(); const t = tableOf('table.zz-dec');
        tableDeleteCol(t, 1); markDirty(); await render();
      });
      expect(await page.evaluate(() => tableOf('table.zz-dec').colAlign)).toBeUndefined();
    });

  test('the table menu sets and clears a column\'s alignment', async ({ page }) => {
    const id = await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${id}"] [data-cell="2,1"]`).click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'decimal point' }).click();
    await expect.poll(() => page.evaluate(() => tableOf('table.zz-dec').colAlign)).toEqual([null, 'decimal']);
    await frame.locator(`[data-el="${id}"] [data-cell="2,1"]`).click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'decimal point' }).click();
    await expect.poll(() => page.evaluate(() => tableOf('table.zz-dec').colAlign)).toBeUndefined();
  });
});
