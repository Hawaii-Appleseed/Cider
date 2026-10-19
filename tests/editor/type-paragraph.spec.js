// The Paragraph panel and its text-style keys (INDESIGN_PARITY.md 20-22):
// line breaking, hyphenation, keep options, OpenType figures/small caps/
// ligatures, drop caps and list looks. Each is a key on the one style the
// type bar edits, so each lands through text_css and can live in a named
// style. Drop caps and list looks need a pseudo-element, which an inline style
// cannot reach — TYPE_CSS rides out once, only when something asks for one.
// Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addBox(page, md) {
  const r = await page.evaluate(m => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 3, md: m }), md);
  expect(r.ok).toBe(true);
  return r.id;
}

test.describe('paragraph keys', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('each key lands as the CSS it means', async ({ page }) => {
    const id = await addBox(page, 'Revenue in 2026 was 1,234,567 and the GET rose.');
    const r = await page.evaluate(i => docsync.api.setStyle(i, {
      wrap: 'balance', hyphenate: true, keep: 'together', figures: 'tabular',
      smallCaps: 'all', ligatures: false }), id);
    expect(r.ok).toBe(true);
    const sty = await page.evaluate(i => {
      const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      return [...el.querySelectorAll('[style]'), el].map(n => n.getAttribute('style')).join(' ');
    }, id);
    for (const decl of ['text-wrap:balance', 'hyphens:auto', 'break-inside:avoid',
      'font-variant-numeric:tabular-nums', 'font-variant-caps:all-small-caps',
      'font-variant-ligatures:none'])
      expect(sty).toContain(decl);
    // And the browser took them: computed, not just written.
    const words = await page.evaluate(i => {
      const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      const t = [...el.querySelectorAll('*')].find(n => /tabular/.test(n.getAttribute('style') || '')) || el;
      const c = getComputedStyle(t);
      return { num: c.fontVariantNumeric, caps: c.fontVariantCaps, hy: c.hyphens };
    }, id);
    expect(words).toEqual({ num: 'tabular-nums', caps: 'all-small-caps', hy: 'auto' });
  });

  test('a drop cap sinks the first letter, and the rule ships only when asked',
    async ({ page }) => {
      const hasRule = () => page.evaluate(() =>
        [...$('out').contentDocument.querySelectorAll('style')]
          .some(s => s.textContent.includes('--ds-cap')));
      expect(await hasRule()).toBe(false);
      const id = await addBox(page, 'Once upon a time the budget balanced itself, and a long sentence follows it.');
      await page.evaluate(i => docsync.api.setStyle(i, { dropCap: 3 }), id);
      expect(await hasRule()).toBe(true);
      const il = await page.evaluate(i => {
        const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
        const host = el.querySelector('[style*="--ds-cap"]') || el;
        const p = host.querySelector('p') || host;
        return getComputedStyle(p, '::first-letter').getPropertyValue('initial-letter');
      }, id);
      expect(il.trim()).toMatch(/^3/);
      await api(page, 'undo()');
      expect(await hasRule()).toBe(false);
    });

  test('a list look: marker, marker colour and indent', async ({ page }) => {
    const id = await addBox(page, '- first point\n- second point');
    await page.evaluate(i => docsync.api.setStyle(i,
      { list: { marker: 'square', color: '#C0392B', indent: 0.4 } }), id);
    const got = await page.evaluate(i => {
      const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      const li = el.querySelector('li'), ul = el.querySelector('ul');
      if (!li) return null;
      return { type: getComputedStyle(li).listStyleType,
               mk: getComputedStyle(li, '::marker').color,
               pad: getComputedStyle(ul).paddingLeft };
    }, id);
    expect(got).not.toBeNull();
    expect(got.type).toBe('square');
    expect(got.mk).toBe('rgb(192, 57, 43)');
    expect(parseFloat(got.pad)).toBeCloseTo(0.4 * 96, 0);
  });

  test('the panel reads the style and writes through it', async ({ page }) => {
    const id = await addBox(page, 'Panel words');
    await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
    await page.evaluate(i => { selected = i; showType(i); }, id);
    await page.evaluate(() => $('ty-parabtn').click());
    await expect(page.locator('#ty-parapop')).toBeVisible();
    await page.selectOption('#ty-fig', 'tabular');
    await expect.poll(() => page.evaluate(i => (styleOf(i) || {}).figures, id)).toBe('tabular');
    await page.selectOption('#ty-dcap', '2');
    await expect.poll(() => page.evaluate(i => (styleOf(i) || {}).dropCap, id)).toBe(2);
    // Ligatures default ON: unchecking writes false, rechecking clears it.
    await page.locator('#ty-liga').uncheck();
    await expect.poll(() => page.evaluate(i => (styleOf(i) || {}).ligatures, id)).toBe(false);
    await page.locator('#ty-liga').check();
    await expect.poll(() => page.evaluate(i => 'ligatures' in (styleOf(i) || {}), id)).toBe(false);
  });

  test('a named style carries them, and everything wearing it follows',
    async ({ page }) => {
      const a = await addBox(page, '1,234 and 5,678');
      const b = await addBox(page, '9,999');
      const d = await api(page, `defineStyle({ scope: 'text', name: 'Figures', figures: 'tabular-lining' })`);
      expect(d.ok).toBe(true);
      for (const id of [a, b]) await page.evaluate(i => docsync.api.setStyle(i, { use: 'Figures' }), id);
      const nums = await page.evaluate(ids => ids.map(i => {
        const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
        const t = [...el.querySelectorAll('*'), el].find(n => /tabular/.test(n.getAttribute('style') || ''));
        return t ? getComputedStyle(t).fontVariantNumeric : null;
      }), [a, b]);
      for (const n of nums) expect((n || '').split(' ').sort()).toEqual(['lining-nums', 'tabular-nums']);
    });
});
