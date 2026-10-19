// Automatic formatting (INDESIGN_PARITY.md 29): InDesign's GREP and nested
// styles. A text style's `grep` puts a character style on every match of a
// pattern; its `nested` styles the start of each paragraph through a
// delimiter. layout.GREP_JS applies them after render, wrapping matches in
// the same span a hand-made run uses (span.ds-cs, plus ds-auto), and the
// markdown is never touched. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addBox(page, md, pg = 3, y = 1) {
  const r = await page.evaluate(([m, p, yy]) => docsync.api.addTextBox(
    { page: p, x: 1, y: yy, w: 4, md: m }), [md, pg, y]);
  expect(r.ok).toBe(true);
  return r.id;
}
const runs = (page, id) => page.evaluate(i => [...$('out').contentDocument
  .querySelectorAll(`[data-el="${i}"] span.ds-auto`)].map(s => ({
    text: s.textContent, cs: s.dataset.cs, color: getComputedStyle(s).color,
    italic: getComputedStyle(s).fontStyle })), id);

test.describe('automatic formatting', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Figure', color: '#C0392B' })`)).ok).toBe(true);
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Lead', italic: true })`)).ok).toBe(true);
  });

  test('a grep rule styles every match, and the words in the file stay plain',
    async ({ page }) => {
      const md = 'It cost $1,200 in 2025 and **$3.5 million** after.';
      const id = await addBox(page, md);
      expect((await page.evaluate(i => docsync.api.setStyle(i,
        { grep: [{ pattern: '\\$[\\d,.]+( million)?', style: 'Figure' }] }), id)).ok).toBe(true);
      const r = await runs(page, id);
      expect(r.map(x => x.text)).toEqual(['$1,200', '$3.5 million']);
      expect(r.every(x => x.cs === 'Figure' && x.color === 'rgb(192, 57, 43)')).toBe(true);
      expect(await page.evaluate(i => boxOf(i).md, id)).toBe(md);
    });

  test('a nested style runs from the start through its delimiter', async ({ page }) => {
    const id = await addBox(page, 'Bottom line: the tax falls hardest on the poor.\n\nSecond: also styled.');
    await page.evaluate(i => docsync.api.setStyle(i, { nested: [{ style: 'Lead', through: ':' }] }), id);
    const r = await runs(page, id);
    expect(r.map(x => x.text)).toEqual(['Bottom line:', 'Second:']);
    expect(r.every(x => x.italic === 'italic')).toBe(true);
  });

  test('case: false matches any case; sentence and words:N nest', async ({ page }) => {
    const a = await addBox(page, 'The get and the GET.');
    await page.evaluate(i => docsync.api.setStyle(i,
      { grep: [{ pattern: '\\bget\\b', style: 'Figure', case: false }] }), a);
    expect((await runs(page, a)).map(x => x.text)).toEqual(['get', 'GET']);
    const b = await addBox(page, 'One two three four. Then more.', 4);
    await page.evaluate(i => docsync.api.setStyle(i,
      { nested: [{ style: 'Lead', through: 'words:2' }, { style: 'Figure', through: 'sentence' }] }), b);
    expect((await runs(page, b)).map(x => [x.text, x.cs])).toEqual(
      [['One two', 'Lead'], [' three four.', 'Figure']]);
  });

  test('a named style carries its rules to everything wearing it', async ({ page }) => {
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Body', grep: [{ pattern: '\\\\d+%', style: 'Figure' }] })`)).ok).toBe(true);
    const a = await addBox(page, 'Up 12% on the year.');
    const b = await addBox(page, 'Down 3% since.', 4);
    for (const id of [a, b]) await page.evaluate(i => docsync.api.setStyle(i, { use: 'Body' }), id);
    expect((await runs(page, a)).map(x => x.text)).toEqual(['12%']);
    expect((await runs(page, b)).map(x => x.text)).toEqual(['3%']);
  });

  test('opening the words shows them plain, and closing gives back the same markdown',
    async ({ page }) => {
      const md = 'It cost $1,200 then.';
      const id = await addBox(page, md);
      await page.evaluate(i => docsync.api.setStyle(i, { grep: [{ pattern: '\\$[\\d,]+', style: 'Figure' }] }), id);
      await page.evaluate(i => editBox($('out').contentDocument,
        $('out').contentDocument.querySelector(`[data-el="${i}"]`)), id);
      const open = await page.evaluate(() => {
        const h = $('out').contentDocument.querySelector('.ds-edit');
        return { auto: h.querySelectorAll('.ds-auto').length, md: htmlToMd(h, { allowLists: true }) };
      });
      expect(open).toEqual({ auto: 0, md });
    });

  test('a run crossing a frame break is carried into the next frame', async ({ page }) => {
    const S = 'Spending rose by $12,345 this year, and the general excise tax rose with it. ';
    const a = await addBox(page, S.repeat(10));
    const b = await addBox(page, 'x', 4);
    await page.evaluate(([x, y]) => { boxOf(x).h = 1.2; boxOf(y).h = 4; boxOf(y).md = 'x'; }, [a, b]);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    await page.evaluate(i => docsync.api.setStyle(i, { grep: [{ pattern: '\\$[\\d,]+', style: 'Figure' }] }), a);
    const [ra, rb] = [await runs(page, a), await runs(page, b)];
    expect(ra.length).toBeGreaterThan(0);
    expect(rb.length).toBeGreaterThan(0);
    expect(ra.length + rb.length).toBe(10);
  });

  test('the panel adds a preset rule and removes it', async ({ page }) => {
    const id = await addBox(page, 'Up 12% and $5 million.');
    await page.evaluate(i => { setSel($('out').contentDocument, [i]); selected = i; showType(i); }, id);
    await page.evaluate(() => $('ty-parabtn').click());
    await page.selectOption('#ty-auto-st', 'Figure');
    await page.selectOption('#ty-auto-on', { label: 'percentages' });
    await page.click('#ty-auto-add');
    await expect.poll(() => runs(page, id).then(r => r.map(x => x.text))).toEqual(['12%']);
    await page.locator('#ty-auto .ty-auto-row button').first().click();
    await expect.poll(() => page.evaluate(i => 'grep' in styleOf(i), id)).toBe(false);
  });
});
