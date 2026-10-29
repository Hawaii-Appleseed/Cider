// INDESIGN_PARITY.md 61 (notes), 66 (change case, placeholder, plain paste),
// 68 (rotate and flip) and 70 (hidden characters and text threads).
const { warmTest: test, expect, gotoEditor, clickTool } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};

test.describe('61 notes', () => {
  test('a note sits with its slot, is marked in the editor, never reaches the page, and edits', async ({ page }) => {
    await gotoEditor(page);
    const key = await page.evaluate(() => [...$('out').contentDocument.querySelectorAll('[data-slot]')]
      .map(n => n.dataset.slot).find(k => readSlot(k).trim().length > 20));
    const words = await page.evaluate(k => readSlot(k), key);
    const r = await page.evaluate(k => docsync.api.setNotes(k, ['Check this figure against DOTAX', 'Ask Genevieve']), key);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(k => readSlot(k), key)).toBe(words);          // the words are untouched
    const n = await api(page, 'notes()');
    expect(n.notes.filter(x => x.key === key).map(x => x.text)).toEqual(['Check this figure against DOTAX', 'Ask Genevieve']);
    const g = await page.evaluate(k => { const d = $('out').contentDocument;
      return { mark: d.querySelectorAll('.ds-notemark').length, text: d.querySelector(`[data-slot="${k}"]`).textContent.includes('DOTAX'),
               count: $('notes-count').textContent }; }, key);
    expect(g.mark).toBeGreaterThan(0);
    expect(g.text).toBe(false);
    await clickTool(page, 'notes');
    expect(await page.locator('#notes-list .nt-row').count()).toBeGreaterThanOrEqual(2);
    await page.evaluate(k => docsync.api.setNotes(k, ['Ask Genevieve']), key);
    expect((await api(page, 'notes()')).notes.filter(x => x.key === key).length).toBe(1);
    expect(await page.evaluate(k => readSlot(k), key)).toBe(words);
  });
});

test.describe('61 notes: where the mark sits', () => {
  test('on a slot that is not drawn, no mark in the page corner', async ({ page }) => {
    // our-mission's note is on words in a carousel panel the page hides.
    await gotoEditor(page, '?project=our-mission');
    const marks = await page.evaluate(() => [...$('out').contentDocument.querySelectorAll('.ds-notemark')]
      .map(m => [m.style.left, m.style.top]));
    expect(marks).toEqual([]);
  });
  test('the mark is beside its words once the page has settled', async ({ page }) => {
    // rxkids' mark was placed before the fonts and pictures moved the
    // paragraph, and stayed 30px above it.
    await gotoEditor(page, '?project=rxkids');
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const d = $('out').contentDocument, m = d.querySelector('.ds-notemark');
      const el = d.querySelector('[data-slot="partner.statement"]');
      return m && [m.getBoundingClientRect().top + 6, el.getBoundingClientRect().top];
    });
    expect(r).not.toBeNull();
    expect(Math.abs(r[0] - r[1])).toBeLessThan(2);
  });
});

test.describe('66 change case, placeholder text, paste without formatting', () => {
  test('case rewrites words, placeholder fills a frame, ⇧⌘V pastes plain', async ({ page }) => {
    await gotoEditor(page);
    expect(await page.evaluate(() => [changeCase('the cost of living in hawaiʻi', 'title'),
      changeCase('WHO PAYS. THE TAX FALLS ON RENTERS.', 'sentence'), changeCase('ab', 'upper')]))
      .toEqual(['The Cost of Living in Hawaiʻi', 'Who pays. The tax falls on renters.', 'AB']);
    const id = await addBox(page, 'x', { h: 2 });
    await page.evaluate(async i => { pushHistory(); boxOf(i).md = placeholderText(3, 2); markDirty(); await render(); }, id);
    expect(await page.evaluate(i => boxOf(i).md.length, id)).toBeGreaterThan(600);
    const html = await page.evaluate(async i => {
      const d = $('out').contentDocument;
      editBox(d, d.querySelector(`[data-el="${i}"]`));
      const host = d.querySelector('[contenteditable="true"]');
      host.focus();
      const r = d.createRange(); r.selectNodeContents(host); r.collapse(false);
      d.getSelection().removeAllRanges(); d.getSelection().addRange(r);
      d.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'V', metaKey: true, shiftKey: true, bubbles: true }));
      const dt = new DataTransfer(); dt.setData('text/html', '<b>Bold words</b>'); dt.setData('text/plain', 'Bold words');
      host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return host.innerHTML;
    }, id);
    expect(html).toContain('Bold words');
    expect(html).not.toContain('<b>Bold words');
  });
});

test.describe('68 rotate and flip, 70 hidden characters and threads', () => {
  test('quarter turns and flips land on shapes and boxes; ¶ and thread lines show and hide', async ({ page }) => {
    await gotoEditor(page);
    const sh = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 2, h: 1 }))).id;
    const a = await addBox(page, 'First frame words that run on.', { y: 3, h: 0.5 });
    const b = await addBox(page, 'more', { y: 5, h: 0.5 });
    expect((await page.evaluate(() => docsync.api.addTextBox({ page: 3, md: '' }))).ok).toBe(false);
    await page.evaluate(([s, x]) => turnObjects($('out').contentDocument, [s, x], { rot: 90 }), [sh, a]);
    await page.evaluate(([s, x]) => turnObjects($('out').contentDocument, [s, x], { flip: 'h' }), [sh, a]);
    const st = await page.evaluate(([s, x]) => ({ s: [shapeOf(s).rot, shapeOf(s).flip], b: [boxOf(x).rot, boxOf(x).flip],
      tf: getComputedStyle($('out').contentDocument.querySelector(`[data-el="${x}"]`)).transform }), [sh, a]);
    expect(st.s).toEqual([90, 'h']);
    expect(st.b).toEqual([90, 'h']);
    expect(st.tf).toMatch(/matrix\(-1/);
    expect((await page.evaluate(i => docsync.api.flip(i, null), a)).ok).toBe(true);
    expect(await page.evaluate(i => boxOf(i).flip, a)).toBeUndefined();
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    await page.evaluate(() => toggleHidden());
    const on = await page.evaluate(() => ({ p: $('out').contentDocument.querySelectorAll('.ds-pilcrow').length,
      t: $('out').contentDocument.querySelectorAll('.ds-threadline').length }));
    expect(on.p).toBeGreaterThan(5);
    expect(on.t).toBe(1);
    await page.evaluate(() => toggleHidden());
    expect(await page.evaluate(() => $('out').contentDocument.querySelectorAll('.ds-pilcrow, .ds-threadline').length)).toBe(0);
  });
});
