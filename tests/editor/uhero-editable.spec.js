// The UHERO TRC summary's table and charts are editable — including in a
// stored copy saved before Table 1 moved into layout.json (the hub's).
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('uhero-trc-summary: the table and charts edit', () => {
  test('charts named chart.* open in the Chart panel and take an edit', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const r = await page.evaluate(async () => {
      const ids = inlineChartIds();
      const found = ids.map(i => !!chartOf(i));
      setSel($('out').contentDocument, ['chart.decile']);
      const button = !$('ar-chart').hidden;
      openChartPanel('chart.decile');
      await chartWrite(c => { c.title = 'What a household saves'; });
      return { ids, found, button, over: layout.charts['chart.decile'],
               drawn: $('out').contentDocument.querySelector('[data-chart="chart.decile"]').textContent.includes('What a household saves') };
    });
    expect(r.ids).toEqual(['chart.decile']);
    expect(r.found).toEqual([true]);
    expect(r.button).toBe(true);
    expect(r.over).toEqual({ title: 'What a household saves' });
    expect(r.drawn).toBe(true);
  });

  test('a copy with no Table 1 entry draws the whole table and seeds it on first touch', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const r = await page.evaluate(async () => {
      delete layout.tables;                       // the hub's stored copy
      await render();
      const d = $('out').contentDocument;
      const el = d.querySelector('[data-el="table.swaps"]');
      const before = { rows: el.querySelectorAll('tr').length, unseeded: el.hasAttribute('data-unseeded') };
      pushHistory();
      const t = tableOf('table.swaps');           // seeds
      tableDeleteRow(t, 6);
      markDirty(); await render();
      return { before, seeded: (layout.tables || []).map(x => x.id),
               after: $('out').contentDocument.querySelectorAll('[data-el="table.swaps"] tr').length,
               unseeded: $('out').contentDocument.querySelector('[data-el="table.swaps"]').hasAttribute('data-unseeded') };
    });
    expect(r.before).toEqual({ rows: 7, unseeded: true });
    expect(r.seeded).toEqual(['swaps']);
    expect(r.after).toBe(6);
    expect(r.unseeded).toBe(false);
  });
});
