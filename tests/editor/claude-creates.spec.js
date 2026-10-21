// What Claude makes, a person can edit. Found 2026-10-20 by having Claude
// build complicated charts and tables through every route a report has —
// pilot verbs, layout.json, a renderer's blocks.chart — and then editing each
// one by hand. Each test here is one of the things that did not work: a
// chart a pilot could not make at all, a pilot call that reported ok over a
// draft that no longer built, a chart field drawn too small to read, a chart
// that swallowed clicks half an inch outside itself, a scatter plot whose
// numbers the panel could not show. The engine halves are in
// docsync/test_docsync.py ("what Claude builds stays editable").
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, fn, arg) => page.evaluate(fn, arg);
const status = page => page.locator('#stat');

/** A blank page to build on, in view, with nothing selected. */
async function freshPage(page) {
  const r = await api(page, () => docsync.api.addPage());
  await page.frameLocator('#out').locator(`section.page[data-page="${r.id}"]`).scrollIntoViewIfNeeded();
  await api(page, () => docsync.api.select(null));
  return r.id;
}

const COMBO = {
  type: 'bar', title: 'Spending against the cap',
  labels: ['FY24', 'FY25', 'FY26'],
  series: [{ name: 'Nominal', data: [10, 12, 15] },
           { name: 'Real', data: [10, 11, 12.5], type: 'line', axis: 'right' }],
  legend: true, format: { prefix: '$', suffix: 'M' },
  rules: [{ value: 11, label: 'Spending cap' }],
};

test.describe('Claude creates, a person edits', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('addChart places a chart the Chart panel opens and edits', async ({ page }) => {
    const P = await freshPage(page);
    const r = await api(page, ([P, c]) => docsync.api.addChart({ page: P, x: 0.75, y: 0.75, w: 7, h: 3.2, chart: c }), [P, COMBO]);
    expect(r.ok, r.error).toBe(true);
    const frame = page.frameLocator('#out');
    const g = frame.locator(`g[data-shape="${r.id}"]`);
    await g.scrollIntoViewIfNeeded();
    const b = await g.locator('rect').first().boundingBox();
    await page.mouse.click(b.x + 20, b.y + 20);
    await expect.poll(() => api(page, () => docsync.api.status().selected)).toEqual([r.id]);
    await page.click('#ar-chart');
    const v = page.locator('#chartpop .ch-grid input.ch-num').first();
    await v.fill('99'); await v.blur();
    await expect.poll(() => api(page, id => layout.shapes.find(s => s.id === id).chart.series[0].data[0], r.id)).toBe(99);
  });

  test('a chart\'s title field is drawn at a size you can read, and a paste keeps the title', async ({ page }) => {
    const P = await freshPage(page);
    const r = await api(page, ([P, c]) => docsync.api.addChart({ page: P, x: 0.75, y: 0.75, w: 7, h: 3.2, chart: c }), [P, COMBO]);
    const frame = page.frameLocator('#out');
    const t = frame.locator(`g[data-shape="${r.id}"] [data-ch="title"]`);
    await t.scrollIntoViewIfNeeded();
    await t.dblclick();
    const inp = frame.locator('.ds-ch-edit');
    await expect(inp).toBeVisible();
    // The chart's text is sized in INCHES; the field read that as px and drew
    // its words at 0.15px — an empty-looking box.
    expect(await inp.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Pasted two words');
    await page.keyboard.press('Enter');
    await expect.poll(() => api(page, id => layout.shapes.find(s => s.id === id).chart.title, r.id))
      .toBe('Pasted two words');
  });

  test('a reference line\'s label renames where it is drawn', async ({ page }) => {
    const P = await freshPage(page);
    const r = await api(page, ([P, c]) => docsync.api.addChart({ page: P, x: 0.75, y: 0.75, w: 7, h: 3.2, chart: c }), [P, COMBO]);
    const lab = page.frameLocator('#out').locator(`g[data-shape="${r.id}"] [data-ch="rule:0"]`);
    await lab.scrollIntoViewIfNeeded();
    await lab.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Statutory cap');
    await page.keyboard.press('Enter');
    await expect.poll(() => api(page, id => layout.shapes.find(s => s.id === id).chart.rules[0].label, r.id))
      .toBe('Statutory cap');
  });

  test('addTable places a merged, multi-row-header table that edits like a drawn one', async ({ page }) => {
    const P = await freshPage(page);
    const r = await api(page, P => docsync.api.addTable({
      page: P, x: 0.75, y: 1, w: 7, headerRows: 2, footerRows: 1,
      merges: [[0, 0, 2, 1], [0, 1, 1, 3]], colAlign: [null, 'decimal', 'decimal', 'decimal'],
      rows: [['Program', 'Budget ($M)', '', ''], ['', 'FY24', 'FY25', 'FY26'],
             ['SNAP', 12.4, 13.1, '14.75'], ['TANF', 52.1, 49.8, 47], ['Total', '64.5', '62.9', '61.75']],
    }), P);
    expect(r.ok, r.error).toBe(true);
    expect([r.rows, r.cols]).toEqual([5, 4]);
    const frame = page.frameLocator('#out');
    const tbl = frame.locator(`table[data-el="${r.id}"]`);
    await tbl.scrollIntoViewIfNeeded();
    await expect(tbl.locator('[data-cell="0,1"]')).toHaveAttribute('colspan', '3');
    // Numbers came in as numbers; a cell is words.
    expect(await api(page, id => layout.tables.find(t => 'table.' + t.id === id).rows[3][1], r.id)).toBe('52.1');
    await tbl.locator('[data-cell="3,2"]').dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('50.0');
    await page.keyboard.press('Enter');
    await expect.poll(() => api(page, id => layout.tables.find(t => 'table.' + t.id === id).rows[3][2], r.id)).toBe('50.0');
    await api(page, () => docsync.api.select(null));
    await page.keyboard.press('Escape');
    await frame.locator(`table[data-el="${r.id}"] [data-cell="2,1"]`).click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Add column' }).first().click();
    await expect.poll(() => api(page, id => layout.tables.find(t => 'table.' + t.id === id).rows[0].length, r.id)).toBe(5);
  });

  test('deleting the first row of a merged cell keeps the cell\'s words', async ({ page }) => {
    const P = await freshPage(page);
    const r = await api(page, P => docsync.api.addTable({
      page: P, x: 0.75, y: 1, w: 6, merges: [[1, 0, 3, 1]],
      rows: [['Group', 'Measure'], ['Families with keiki', 'Poverty'], ['', 'Food'], ['', 'Rent'], ['Kūpuna', 'Poverty']],
    }), P);
    const frame = page.frameLocator('#out');
    const tbl = frame.locator(`table[data-el="${r.id}"]`);
    await tbl.scrollIntoViewIfNeeded();
    await tbl.locator('[data-cell="1,1"]').click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Delete row' }).first().click();
    await expect.poll(() => api(page, id => {
      const t = layout.tables.find(x => 'table.' + x.id === id);
      return [t.rows[1][0], t.merges];
    }, r.id)).toEqual(['Families with keiki', [[1, 0, 2, 1]]]);
  });

  test('a chart, its caption and their group are one batch, and one undo', async ({ page }) => {
    const P = await freshPage(page);
    const before = await api(page, () => (layout.groups || []).length);
    const b = await api(page, P => docsync.api.batch([
      { verb: 'addChart', args: { page: P, x: 0.75, y: 1, w: 3.4, h: 2.2,
          chart: { type: 'pie', labels: ['A', 'B', 'C'], series: [{ name: 'S', data: [1, 2, 3] }] } }, as: 'c' },
      { verb: 'addTextBox', args: { page: P, x: 4.4, y: 1.2, w: 3.3, md: 'Figure 1. A caption.' }, as: 't' },
      { verb: 'group', args: [['@c', '@t']] },
    ]), P);
    expect(b.ok, b.error).toBe(true);
    const [c, t] = [b.results[0].id, b.results[1].id];
    expect(await api(page, () => layout.groups.at(-1))).toEqual([c, t]);
    await api(page, () => docsync.api.undo());
    expect(await api(page, id => layout.shapes.some(s => s.id === id), c)).toBe(false);
    expect(await api(page, () => (layout.groups || []).length)).toBe(before);
  });

  test('what the engine will not build is refused and rolled back, not reported ok', async ({ page }) => {
    const P = await freshPage(page);
    const n = await api(page, () => layout.shapes.length);
    // Passes the verb's own checks; only the engine knows legendPos.
    const r = await api(page, P => docsync.api.addChart({ page: P, chart: {
      type: 'bar', series: [{ name: 's', data: [1] }], legendPos: 'middle' } }), P);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('legendPos');
    await expect(status(page)).not.toHaveText(/does not build/);
    expect(await api(page, () => layout.shapes.length)).toBe(n);
    const t = await api(page, P => docsync.api.addTable({ page: P, rows: [['a', 'b'], ['1', '2']] }), P);
    const bad = await api(page, id => docsync.api.setTable(id, { colw: [1, 2, 3] }), t.id);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('colw');
    await expect(status(page)).not.toHaveText(/does not build/);
    // ...and refused up front where the verb can tell.
    const nn = await api(page, P => docsync.api.addChart({ page: P, chart: { type: 'bar', series: [{ name: 's', data: [1, 'two'] }] } }), P);
    expect(nn.error).toContain('"two" is not a number');
    expect((await api(page, () => docsync.api.addTable({ page: 'nope', rows: [['a']] }))).error).toContain("no page 'nope'");
  });

  test('a table set just under a chart takes clicks on its header row', async ({ page }) => {
    const P = await freshPage(page);
    await api(page, ([P, c]) => docsync.api.addChart({ page: P, x: 0.75, y: 0.75, w: 7, h: 3, chart: c }), [P, COMBO]);
    // 0.3in below the chart's box: inside the half-inch its hit rect used to
    // claim, because pointer-events:all hit-tests an inch-wide default stroke.
    const t = await api(page, P => docsync.api.addTable({ page: P, x: 0.75, y: 4.05, w: 7,
      rows: [['Department', 'FY26'], ['Health', '1.2']] }), P);
    const cell = page.frameLocator('#out').locator(`table[data-el="${t.id}"] [data-cell="0,0"]`);
    await cell.scrollIntoViewIfNeeded();
    await api(page, () => docsync.api.select(null));
    const b = await cell.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect.poll(() => api(page, () => docsync.api.status().selected)).toEqual([t.id]);
  });

  test('a scatter plot\'s points show in the panel, and + Row adds one', async ({ page }) => {
    const P = await freshPage(page);
    const r = await api(page, P => docsync.api.addChart({ page: P, x: 1, y: 1, w: 4, h: 3, chart: {
      type: 'scatter', series: [{ name: 'Income', data: [52, 61, 70, 74] }, { name: 'Burdened', data: [58, 55, 51, 49] }] } }), P);
    await api(page, id => docsync.api.select(id), r.id);
    await page.click('#ar-chart');
    // Rows came from labels alone, and a scatter has none: the grid was empty.
    const nums = page.locator('#chartpop .ch-grid input.ch-num');
    await expect(nums).toHaveCount(8);
    await nums.nth(1).fill('66'); await nums.nth(1).blur();
    await expect.poll(() => api(page, id => layout.shapes.find(s => s.id === id).chart.series[1].data[0], r.id)).toBe(66);
    await page.locator('#chartpop .tp-btn', { hasText: '+ Row' }).click();
    await expect.poll(() => api(page, id => layout.shapes.find(s => s.id === id).chart.series.map(s => s.data.length), r.id))
      .toEqual([5, 5]);
    await expect(status(page)).not.toHaveText(/does not build/);
  });

  test('a new chart starts in the report\'s colours, and a histogram of counts is pointed at a bar chart', async ({ page }) => {
    const P = await freshPage(page);
    const pal = await api(page, () => (M.palette || []).filter(c => !/^#f{3,6}$/i.test(c)));
    test.skip(!pal.length, 'this report has no palette');
    const r = await api(page, P => docsync.api.addChart({ page: P, x: 1, y: 1, w: 4, h: 3,
      chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 'S', data: [1, 2] }, { name: 'T', data: [2, 1], color: '#123456' }] } }), P);
    const c = await api(page, id => layout.shapes.find(s => s.id === id).chart, r.id);
    // The engine's sage was what a chart drawn into a tax-blue report got.
    expect(c.series[0].color.toUpperCase()).toBe(pal[0].toUpperCase());
    expect(c.series[1].color).toBe('#123456');          // a colour given stands
    const h = await api(page, P => docsync.api.addChart({ page: P, x: 1, y: 5, w: 4, h: 3,
      chart: { type: 'histogram', labels: ['<25K', '25-50K', '50K+'], series: [{ name: 'H', data: [61000, 72000, 70500] }] } }), P);
    expect(h.ok, h.error).toBe(true);
    expect(h.note).toContain('barGap: 0');
  });

  test('inventory reads back what a chart draws and what a table holds', async ({ page }) => {
    // The hub's connector cannot see the page: read_report relays this, and
    // without the numbers and cells a person's Claude could add a chart and
    // never read one back, or know what setChart / a cell edit would change.
    const P = await freshPage(page);
    const c = await api(page, ([P, c]) => docsync.api.addChart({ page: P, x: 0.75, y: 0.75, w: 7, h: 3, chart: c }), [P, COMBO]);
    const t = await api(page, P => docsync.api.addTable({ page: P, x: 0.75, y: 4.2, w: 6, headerRows: 1,
      merges: [[1, 0, 2, 1]], rows: [['Group', 'Rate'], ['Keiki', '11.2%'], ['', '10.8%']] }), P);
    const inv = await api(page, () => docsync.api.inventory());
    const els = inv.pages.flatMap(p => p.elements);
    const ch = els.find(e => e.id === c.id);
    expect(ch.kind).toBe('chart');
    expect(ch.chart.series.map(s => s.name)).toEqual(['Nominal', 'Real']);
    expect(ch.chart.series[0].data).toEqual([10, 12, 15]);
    expect(ch.chart.rules[0].label).toBe('Spending cap');
    const tb = els.find(e => e.id === t.id);
    expect(tb.kind).toBe('table');
    expect(tb.table.rows).toEqual([['Group', 'Rate'], ['Keiki', '11.2%'], ['', '10.8%']]);
    expect(tb.table.merges).toEqual([[1, 0, 2, 1]]);
    // A renderer's chart is a chart too, with the spec it actually draws.
    const fig = els.find(e => e.id === 'whopays.fig6');
    expect(fig.kind).toBe('chart');
    expect(fig.inline).toBe(true);
    expect(fig.chart.series[0].data.length).toBe(7);
    // Reading must not change anything.
    expect(await api(page, () => docsync.api.status().dirty)).toBe(true);   // the adds above
    const before = await api(page, () => JSON.stringify(layout));
    await api(page, () => docsync.api.inventory());
    expect(await api(page, () => JSON.stringify(layout))).toBe(before);
  });

  test('a renderer chart\'s labels rename on the page, and place() can size it', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const lab = frame.locator('[data-chart="whopays.fig6"] [data-ch="label:0"]');
    await lab.scrollIntoViewIfNeeded();
    // Bound only for shape charts before: a double-click here did nothing.
    await lab.dblclick();
    await expect(frame.locator('.ds-ch-edit')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Poorest fifth');
    await page.keyboard.press('Enter');
    await expect.poll(() => api(page, () => ((layout.charts || {})['whopays.fig6'] || {}).labels?.[0])).toBe('Poorest fifth');
    // A size alone on a designed element wrote {w} with no x/y, which the
    // engine refuses: the whole draft stopped building.
    const r = await api(page, () => docsync.api.place('whopays.fig6', { w: 5 }));
    expect(r.ok, r.error).not.toBe(false);
    await expect(status(page)).not.toHaveText(/does not build/);
    const pos = await api(page, () => layout.positions['whopays.fig6']);
    expect(pos.w).toBe(5);
    expect(typeof pos.x).toBe('number');
  });
});
