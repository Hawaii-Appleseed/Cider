// Character styles (INDESIGN_PARITY.md 17): a named text style on a run of
// words inside a paragraph, written `[words]{.Name}`. The span names the
// style and carries no CSS of its own; Layout._char_once emits one rule per
// style used, so redefining the style moves every run that wears it. Only the
// letterform keys apply (layout.CHAR_KEYS) — alignment and leading are the
// paragraph's. Local mode.
const { warmTest: test, expect, gotoEditor, fillDialog, submitDialog,
        clickAddSection } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addBox(page, md) {
  const r = await page.evaluate(m => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 4, md: m }), md);
  expect(r.ok).toBe(true);
  return r.id;
}
const runStyle = (page, id) => page.evaluate(i => {
  const s = $('out').contentDocument.querySelector(`[data-el="${i}"] span.ds-cs`);
  if (!s) return null;
  const c = getComputedStyle(s), p = getComputedStyle(s.parentElement);
  return { color: c.color, italic: c.fontStyle, num: c.fontVariantNumeric,
           align: p.textAlign, words: s.textContent };
}, id);

test.describe('character styles', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('a run wears the style, and a redefine moves it', async ({ page }) => {
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Accent', color: '#C0392B', italic: true, align: 'center', leading: 3 })`)).ok).toBe(true);
    const id = await addBox(page, 'Plain words and [a **red** run]{.Accent} after.');
    await expect.poll(() => runStyle(page, id).then(r => r && r.color)).toBe('rgb(192, 57, 43)');
    const r = await runStyle(page, id);
    expect(r.italic).toBe('italic');
    expect(r.words).toBe('a red run');
    // The paragraph keys stay the paragraph's: the rule carries none of them.
    const rule = await page.evaluate(() => [...$('out').contentDocument.querySelectorAll('style')]
      .map(s => s.textContent).find(t => t.includes('.ds-cs[data-cs="Accent"]')) || '');
    expect(rule).toContain('color:#C0392B');
    expect(rule).not.toContain('text-align');
    expect(rule).not.toContain('line-height');

    expect((await api(page, `defineStyle({ scope: 'text', name: 'Accent', color: '#1E6194' })`)).ok).toBe(true);
    await expect.poll(() => runStyle(page, id).then(x => x && x.color)).toBe('rgb(30, 97, 148)');
  });

  test('no run, no rule — and an unknown name is just the paragraph\'s words',
    async ({ page }) => {
      const rules = () => page.evaluate(() => [...$('out').contentDocument.querySelectorAll('style')]
        .some(s => s.textContent.includes('.ds-cs[')));
      expect(await rules()).toBe(false);
      const id = await addBox(page, 'a [run]{.Nobody} here');
      expect(await rules()).toBe(false);
      expect((await runStyle(page, id)).words).toBe('run');
    });

  test('the markdown round-trips through the text editor', async ({ page }) => {
    for (const md of ['Plain [a **bold** run]{.Accent} after',
                      'see [the [GET report](https://example.org/a_(b)) now]{.Pull Quote}',
                      'two [one]{.A} and [two]{.B}']) {
      const back = await page.evaluate(m => {
        const el = document.createElement('div');
        el.innerHTML = mdToHtml(m, { inline: true });
        return htmlToMd(el, { inline: true });
      }, md);
      expect(back).toBe(md);
    }
  });

  test('the words toolbar puts a style on the selection, and takes it off',
    async ({ page }) => {
      expect((await api(page, `defineStyle({ scope: 'text', name: 'Accent', color: '#C0392B' })`)).ok).toBe(true);
      await clickAddSection(page);
      await fillDialog(page, { page: 'basics', slug: 'cs-1' });
      await submitDialog(page);
      const ta = page.frameLocator('#out').locator('.ds-edit');
      await ta.waitFor({ state: 'visible' });
      await ta.evaluate(el => { el.innerHTML = '<p>alpha beta gamma</p>'; });
      const select = (from, to) => page.evaluate(([f, t]) => {
        const d = $('out').contentDocument, host = d.querySelector('.ds-edit');
        const n = host.querySelector('p').firstChild;
        const r = d.createRange(); r.setStart(n, f); r.setEnd(n, t);
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); host.focus();
      }, [from, to]);
      const md = () => page.evaluate(() =>
        htmlToMd($('out').contentDocument.querySelector('.ds-edit'), { allowLists: true }));
      await select(6, 10);                         // "beta"
      await page.locator('#ty-mcs').click();
      await page.locator('#ty-csbody button', { hasText: 'Accent' }).click();
      expect(await md()).toBe('alpha [beta]{.Accent} gamma');
      // Taking it off part of the run splits it, like un-bolding part of bold.
      await page.evaluate(() => {
        const d = $('out').contentDocument, s = d.querySelector('.ds-edit span.ds-cs');
        const r = d.createRange(); r.setStart(s.firstChild, 0); r.setEnd(s.firstChild, 2);
        const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      });
      await page.locator('#ty-mcs').click();
      await page.locator('#ty-csbody button', { hasText: 'No style' }).click();
      expect(await md()).toBe('alpha be[ta]{.Accent} gamma');
    });

  test('styles() counts runs, and dropping the style leaves their words',
    async ({ page }) => {
      expect((await api(page, `defineStyle({ scope: 'text', name: 'Accent', color: '#C0392B' })`)).ok).toBe(true);
      const id = await addBox(page, 'x [one]{.Accent} y [two]{.Accent}');
      const st = await api(page, 'styles()');
      expect(st.text.Accent.runs).toBe(2);
      expect(st.text.Accent.wornBy).toBeGreaterThanOrEqual(2);
      const d = await api(page, `dropStyle('text', 'Accent')`);
      expect(d.ok).toBe(true);
      expect(d.runs).toBe(2);
      expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).md, id))
        .toBe('x one y two');
    });
});
