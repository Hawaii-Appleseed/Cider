// Paragraph rules, borders and shading (INDESIGN_PARITY.md 28). A rule over a
// heading used to be a placed shape, which stays where it was put while the
// words move; as a text-style key it is the paragraph's own ::before/::after
// and moves with it. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addBox(page, md) {
  const r = await page.evaluate(m => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 4, md: m }), md);
  expect(r.ok).toBe(true);
  return r.id;
}
const pseudo = (page, sel, which) => page.evaluate(([s, w]) => {
  const el = $('out').contentDocument.querySelector(s);
  const c = getComputedStyle(el, w);
  return { content: c.content, top: c.borderTopWidth, color: c.borderTopColor, width: c.width };
}, [sel, which]);

test.describe('paragraph rules, borders and shading', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('a rule above and below are the paragraph\'s own, at the weight and length asked',
    async ({ page }) => {
      const id = await addBox(page, 'A heading-like paragraph');
      await page.evaluate(i => docsync.api.setStyle(i, {
        ruleAbove: { weight: 2, color: '#1E6194', length: 1.5 },
        ruleBelow: { weight: 0.5, color: '#C0392B' } }), id);
      const a = await pseudo(page, `[data-el="${id}"] p`, '::before');
      expect(a.content).toBe('""');
      expect(a.color).toBe('rgb(30, 97, 148)');
      expect(parseFloat(a.width)).toBeCloseTo(1.5 * 96, -1);
      const b = await pseudo(page, `[data-el="${id}"] p`, '::after');
      // Relative, not exact: borders snap to device pixels at the editor's zoom.
      expect(parseFloat(a.top)).toBeGreaterThan(parseFloat(b.top));
      expect(parseFloat(b.top)).toBeGreaterThan(0);
      expect(b.color).toBe('rgb(192, 57, 43)');
    });

  test('the rule moves with its paragraph when the text above it grows', async ({ page }) => {
    const id = await addBox(page, 'Short first.\n\nSecond, ruled.');
    await page.evaluate(i => docsync.api.setStyle(i, { ruleAbove: { weight: 2 } }), id);
    const top = () => page.evaluate(i => $('out').contentDocument
      .querySelectorAll(`[data-el="${i}"] p`)[1].getBoundingClientRect().top, id);
    const before = await top();
    const long = 'A much longer first paragraph that now runs to several lines of words. '.repeat(5);
    await page.evaluate(([i, m]) => docsync.api.setBoxText(i, m), [id, `${long}\n\nSecond, ruled.`]);
    expect(await top()).toBeGreaterThan(before + 20);
    const a = await pseudo(page, `[data-el="${id}"] p:nth-of-type(2)`, '::before');
    expect(a.content).toBe('""');                         // still the paragraph's own
  });

  test('shading, a border and padding land on the paragraph, never the box',
    async ({ page }) => {
      const id = await addBox(page, 'First.\n\nSecond.');
      await page.evaluate(i => docsync.api.setStyle(i, {
        shade: '#FFF6D8', paraPad: 0.1, paraBorder: { weight: 1, color: '#333333', sides: 'topbottom' } }), id);
      const got = await page.evaluate(i => {
        const box = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
        const p = getComputedStyle(box.querySelector('p')), b = getComputedStyle(box);
        return { bg: p.backgroundColor, pad: p.paddingTop, bt: p.borderTopWidth, bl: p.borderLeftWidth,
                 boxBt: b.borderTopWidth, boxPad: b.paddingTop };
      }, id);
      expect(got.bg).toBe('rgb(255, 246, 216)');
      expect(parseFloat(got.pad)).toBeCloseTo(0.1 * 96, 0);
      // Borders snap to whole device pixels in a zoomed page: there, not exact.
      expect(parseFloat(got.bt)).toBeGreaterThan(0);
      expect(got.bl).toBe('0px');
      expect(got.boxBt).toBe('0px');
      expect(got.boxPad).toBe('0px');
    });

  test('the Paragraph panel draws a rule and takes it away', async ({ page }) => {
    const id = await addBox(page, 'Panel words');
    await page.evaluate(i => { setSel($('out').contentDocument, [i]); selected = i; showType(i); }, id);
    await page.evaluate(() => $('ty-parabtn').click());
    await page.selectOption('#ty-raw', '2');
    await expect.poll(() => page.evaluate(i => styleOf(i).ruleAbove, id)).toEqual({ weight: 2 });
    await page.selectOption('#ty-shade', { index: 1 });
    await expect.poll(() => page.evaluate(i => !!styleOf(i).shade, id)).toBe(true);
    await page.selectOption('#ty-raw', '');
    await expect.poll(() => page.evaluate(i => 'ruleAbove' in styleOf(i), id)).toBe(false);
  });

  test('a named style carries a rule to everything wearing it', async ({ page }) => {
    const a = await addBox(page, 'One');
    const b = await addBox(page, 'Two');
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Ruled', ruleBelow: { weight: 3, color: '#1E6194' } })`)).ok).toBe(true);
    for (const id of [a, b]) await page.evaluate(i => docsync.api.setStyle(i, { use: 'Ruled' }), id);
    for (const id of [a, b]) {
      const r = await pseudo(page, `[data-el="${id}"] p`, '::after');
      expect(parseFloat(r.top)).toBeGreaterThan(1);
    }
  });
});
