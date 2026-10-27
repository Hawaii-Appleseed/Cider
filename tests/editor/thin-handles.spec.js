// A narrow shape (an accent bar) must be grabbable to MOVE: its side handles sit
// beside it and used to win the press, so a drag widened it instead. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const handles = (page, id) => page.evaluate(async i => {
  await docsync.api.select(i);
  await new Promise(r => setTimeout(r, 80));
  const d = $('out').contentDocument;
  const ov = d.querySelector(`.ds-handles[data-for="${CSS.escape(i)}"]`);
  return ov ? [...ov.querySelectorAll('.ds-h')].map(h => h.className.match(/ds-h-(\w+)/)).filter(Boolean).map(m => m[1]).sort() : null;
}, id);

test.describe('handles on thin shapes', () => {
  test('a 0.06in bar keeps only its end handles; a normal box keeps all eight', async ({ page }) => {
    await gotoEditor(page);
    const bar = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 0.06, h: 1.2 }))).id;
    const wide = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 2, y: 1, w: 1.5, h: 1.2 }))).id;
    const dot = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 4, y: 1, w: 0.09, h: 0.09 }))).id;
    const rule = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 3, w: 3, h: 0.02 }))).id;
    expect(await handles(page, bar)).toEqual(['n', 's']);
    expect(await handles(page, wide)).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(await handles(page, dot)).toEqual(['se']);
    expect(await handles(page, rule)).toEqual(['e', 'w']);
  });
});
