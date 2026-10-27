// Things the staff-hub connector (docsync.api.batch) used to refuse or could not do:
// a page given as the string "3", setStyle on a table, a cell style used in the batch
// that defines it, one table cell's words, and an inline editor that is open for a moment.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const table = page => page.evaluate(() => docsync.api.addTable({ page: 3, x: 1, y: 1, w: 4,
  rows: [['A', 'B'], ['1', '2'], ['3', '4']] }));

test.describe('connector gaps', () => {
  test('a page named as a string is the page', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => docsync.api.addShape({ page: '3', kind: 'rect', x: 1, y: 5, w: 1, h: 1 }));
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).page, r.id)).toBe(3);
  });

  test('setStyle styles a table, and setCell rewrites one cell', async ({ page }) => {
    await gotoEditor(page);
    const t = await table(page);
    expect(t.ok).toBe(true);
    const s = await page.evaluate(id => docsync.api.setStyle(id, { size: 11, color: '#4A5568' }), 'table.' + t.id.replace(/^table\./, ''));
    expect(s.ok).toBe(true);
    const c = await page.evaluate(id => docsync.api.setCell(id, 0, 1, 'Difference'), 'table.' + t.id.replace(/^table\./, ''));
    expect(c.ok).toBe(true);
    expect(await page.evaluate(i => tableOfId(i).rows[0], 'table.' + t.id.replace(/^table\./, ''))).toEqual(['A', 'Difference']);
    const bad = await page.evaluate(id => docsync.api.setCell(id, 9, 9, 'x'), 'table.' + t.id.replace(/^table\./, ''));
    expect(bad.ok).toBe(false);
  });

  test('a cell style is applied in the batch that defines it', async ({ page }) => {
    await gotoEditor(page);
    const t = await table(page);
    const id = 'table.' + t.id.replace(/^table\./, '');
    const r = await page.evaluate(i => docsync.api.batch([
      { verb: 'defineCellStyle', args: ['Pop', { fill: '#DCE8F7', bold: true }] },
      { verb: 'cellStyle', args: [i, [[1, 1], [2, 1]], 'Pop'] },
    ]), id);
    expect(r.ok).toBe(true);
    // and a name nothing defines is still refused
    const bad = await page.evaluate(i => docsync.api.batch([{ verb: 'cellStyle', args: [i, [[1, 1]], 'Nope'] }]), id);
    expect(bad.ok).toBe(false);
  });

  test('an inline editor that closes within a few seconds does not refuse the batch', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(async () => {
      editing = true;
      setTimeout(() => { editing = false; }, 600);
      return docsync.api.batch([{ verb: 'addShape', args: [{ page: 3, kind: 'rect', x: 1, y: 7, w: 1, h: 1 }] }]);
    });
    expect(r.ok).toBe(true);
  });
});
