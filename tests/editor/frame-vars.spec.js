// INDESIGN_PARITY.md 49, 54, 56, 60: text frame options, page numbering
// sections, widows / orphans / word spacing, and text variables. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};
const text = (page, id) => page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).textContent.trim(), id);

test.describe('60 text variables', () => {
  test('a variable is its text everywhere, and changes in one place', async ({ page }) => {
    await gotoEditor(page);
    expect((await api(page, `setVariable('bill', 'HB 1234')`)).ok).toBe(true);
    const id = await addBox(page, 'See {var:bill} and {var:nope}.');
    expect(await text(page, id)).toBe('See HB 1234 and {var:nope}.');
    await api(page, `setVariable('bill', 'SB 99')`);
    expect(await text(page, id)).toBe('See SB 99 and {var:nope}.');
    // The text editor shows it as a chip naming its text, and gives the token back.
    const chip = await page.evaluate(() => { const t = document.createElement('div'); t.innerHTML = mdInlineToHtml('a {var:bill} b');
      const c = t.querySelector('.ds-varchip'); return [c.textContent, nodeToMdInline(t)]; });
    expect(chip).toEqual(['SB 99', 'a {var:bill} b']);
    expect((await api(page, `setVariable('a b', 'x')`)).ok).toBe(false);
  });
});

test.describe('54 page numbering sections', () => {
  test('front matter in roman, the body from 1, and the page strip agrees', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'Page {page}');
    expect((await api(page, `setPageSection(1, { style: 'lower-roman' })`)).ok).toBe(true);
    expect((await api(page, `setPageSection(3, { start: 1 })`)).ok).toBe(true);
    const got = await page.evaluate(i => {
      const d = $('out').contentDocument;
      const el = d.querySelector(`[data-el="${i}"]`);
      const n = [...d.querySelectorAll('section.page')].indexOf(el.closest('section.page')) + 1;
      return { n, shown: el.textContent.trim(), want: sectionLabel(n), strip: [1, 2, 3, 4].map(k => sectionLabel(k)) };
    }, id);
    expect(got.strip).toEqual(['i', 'ii', '1', '2']);
    expect(got.shown).toBe('Page ' + got.want);
    // Reordering the pages keeps the numbering.
    await page.evaluate(() => writeOrder(pageOrder(), pageBlanks()));
    expect(await page.evaluate(() => pageSections().length)).toBe(2);
    expect((await api(page, `setPageSection(1, { style: 'greek' })`)).ok).toBe(false);
  });
});

test.describe('49 text frame options and 56 widows, orphans, word spacing', () => {
  test('a box centres its words, trims to the cap height, and paragraphs keep lines', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'Short.', { h: 3 });
    await page.evaluate(async i => { pushHistory(); boxOf(i).vAlign = 'middle'; boxOf(i).firstBaseline = 'cap'; markDirty(); await render(); }, id);
    const g = await page.evaluate(i => {
      const box = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      const p = box.querySelector('p');
      const b = box.getBoundingClientRect(), r = p.getBoundingClientRect();
      const cs = getComputedStyle(box);
      return { above: r.top - b.top, below: b.bottom - r.bottom, ac: cs.alignContent, trim: cs.textBoxTrim || cs.getPropertyValue('text-box-trim') };
    }, id);
    expect(g.ac).toBe('center');
    expect(Math.abs(g.above - g.below)).toBeLessThan(6);
    expect(g.trim).toBe('trim-start');
    expect((await page.evaluate(i => docsync.api.setStyle(i, { widows: 3, orphans: 2, wordSpacing: 0.1 }), id)).ok).toBe(true);
    const ps = await page.evaluate(i => { const p = $('out').contentDocument.querySelector(`[data-el="${i}"] p`); const cs = getComputedStyle(p);
      return [cs.widows, cs.orphans, cs.wordSpacing]; }, id);
    expect(ps[0]).toBe('3'); expect(ps[1]).toBe('2'); expect(parseFloat(ps[2])).toBeGreaterThan(0);
  });
});
