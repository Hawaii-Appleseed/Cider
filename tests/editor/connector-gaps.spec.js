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

// removePage: the connector could add and duplicate a page and not take one out,
// so dropping a page meant a script in the editor's own page.
test.describe('removePage', () => {
  test('a blank page goes with what is on it, as one undo step', async ({ page }) => {
    await gotoEditor(page);
    const before = await page.evaluate(() => pageOrder().map(String));
    const a = await page.evaluate(() => docsync.api.addPage());
    expect(a.ok).toBe(true);
    const s = await page.evaluate(id => docsync.api.addShape({ page: id, kind: 'rect', x: 1, y: 1, w: 1, h: 1 }), a.id);
    expect(s.ok).toBe(true);
    const r = await page.evaluate(id => docsync.api.removePage(id), a.id);
    expect(r.ok).toBe(true);
    expect(r.removed).toContain(s.id);
    expect(r.pageOrder.map(String)).toEqual(before);
    expect(await page.evaluate(i => !!shapeOf(i), s.id)).toBe(false);
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(i => !!shapeOf(i), s.id)).toBe(true);
    expect(await page.evaluate(() => pageOrder().map(String))).toContain(String(a.id));
  });

  test('a designed page is left out of the order, and the strip can show it again', async ({ page }) => {
    await gotoEditor(page);
    const before = await page.evaluate(() => pageOrder().map(String));
    const r = await page.evaluate(() => docsync.api.removePage('2'));
    expect(r.ok).toBe(true);
    expect(r.hidden).toBe(true);
    expect(r.pageOrder.map(String)).toEqual(before.filter(p => p !== '2'));
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(() => pageOrder().map(String))).toEqual(before);
  });

  test('a page that is not there is refused, and so is the relay\'s single-verb list missing it', async ({ page }) => {
    await gotoEditor(page);
    const bad = await page.evaluate(() => docsync.api.removePage('nope'));
    expect(bad.ok).toBe(false);
    expect(await page.evaluate(() => PILOT_SINGLE_VERBS.has('removePage'))).toBe(true);
  });
});

// Step 4 of CONNECTOR_PARITY.md: the page strip's drag, the Hidden group's eye
// and File > Page size as verbs, and the library by id.
test.describe('page verbs', () => {
  test('movePage puts a page at a place in the order, as one undo step', async ({ page }) => {
    await gotoEditor(page);
    const before = await page.evaluate(() => pageOrder().map(String));
    const last = before[before.length - 1];
    const r = await page.evaluate(p => docsync.api.movePage(p, 0), last);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.pageOrder.map(String)).toEqual([last, ...before.slice(0, -1)]);
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(() => pageOrder().map(String))).toEqual(before);
    const same = await page.evaluate(p => docsync.api.movePage(p, 0), before[0]);
    expect(same.unchanged).toBe(true);
    expect((await page.evaluate(() => docsync.api.movePage('nope', 0))).ok).toBe(false);
    expect((await page.evaluate(p => docsync.api.movePage(p, 99), before[0])).error).toMatch(/toIndex/);
  });

  test('showPage brings back a page removePage left out, where it was designed', async ({ page }) => {
    await gotoEditor(page);
    const before = await page.evaluate(() => pageOrder().map(String));
    expect((await page.evaluate(() => docsync.api.removePage('2'))).hidden).toBe(true);
    const r = await page.evaluate(() => docsync.api.showPage('2'));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.pageOrder.map(String)).toEqual(before);
    expect((await page.evaluate(() => docsync.api.showPage('2'))).unchanged).toBe(true);
    expect((await page.evaluate(() => docsync.api.showPage('nope'))).error).toMatch(/no page is hidden/);
  });

  test('setPageSize takes a size by name or in inches, and undo puts it back', async ({ page }) => {
    await gotoEditor(page);
    const w0 = await page.evaluate(() => PAGE_W_IN);
    let r = await page.evaluate(() => docsync.api.setPageSize('a4'));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.page.w).toBeCloseTo(8.27, 2);
    r = await page.evaluate(() => docsync.api.setPageSize({ w: 6, h: 9 }));
    expect(r.page).toEqual({ w: 6, h: 9 });
    expect((await page.evaluate(() => docsync.api.setPageSize('huge'))).ok).toBe(false);
    expect((await page.evaluate(() => docsync.api.setPageSize({ w: 100, h: 9 }))).ok).toBe(false);
    await page.evaluate(() => docsync.api.undo());
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(() => PAGE_W_IN)).toBeCloseTo(w0, 2);
  });

  test('saveToLibrary takes ids, and leaves the selection as it was', async ({ page }) => {
    await gotoEditor(page);
    const s = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 1, h: 1 }));
    await page.evaluate(() => { selIds.clear(); });
    const r = await page.evaluate(id => docsync.api.saveToLibrary('Test piece ' + Date.now(), [id]), s.id);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.items).toBe(1);
    expect(await page.evaluate(() => selIds.size)).toBe(0);
    expect((await page.evaluate(() => docsync.api.saveToLibrary('x', ['nope']))).error).toMatch(/no shape/);
  });

  test('the relay goes alone for each, and a relayed undo needs a shared session', async ({ page }) => {
    await gotoEditor(page);
    for (const v of ['movePage', 'showPage', 'setPageSize', 'continueEndnotes', 'saveToLibrary', 'placeFromLibrary', 'loadStyles', 'undo', 'redo'])
      expect(await page.evaluate(x => PILOT_SINGLE_VERBS.has(x) && !PILOT_BATCH_VERBS[x], v), v).toBe(true);
    const r = await page.evaluate(() => hubPilot({ ops: [{ verb: 'undo' }] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shared session/);
  });
});
