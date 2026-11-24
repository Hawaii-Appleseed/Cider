// The staff hub keeps the fact ledger itself (its Facts page, a D1 store), and
// docsync.hub writes each hub manifest to fetch the ledger's files from
// /api/facts/area/<area>.json instead of the copies vendored with the engine
// (live_ledger). This holds the editor's half: a manifest file named by an
// absolute address is fetched from there (withBase), it still lands at its
// engine path for Pyodide, and ledgerAdopt knows it by that path — so the
// page and the chip both show the hub's number, not the vendored one.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

test('a manifest that fetches the ledger from the hub reads the hub\'s number', async ({ page }) => {
  const asked = [];
  await page.route(/\/engine\/manifest\.json(\?|$)/, async route => {
    const r = await route.fetch();
    const m = await r.json();
    const files = {};
    for (const [u, p] of Object.entries(m.files || {})) {
      files[/^docsync\/ledger\/.+\.json$/.test(p) ? '/api/facts/area/' + p.split('/').pop() : u] = p;
    }
    await route.fulfill({ response: r, json: { ...m, files } });
  });
  await page.route(/\/api\/facts\/area\/[a-z-]+\.json(\?|$)/, async route => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    const name = path.split('/').pop();
    const area = name.replace(/\.json$/, '');
    const facts = area === 'tax-and-budget'
      ? [{ id: 'capgains-share-over-400k', says: 'Share of capital gains, $400,000 and up', value: 80, unit: 'pct',
           shown: '80 percent', since: '2026-11-24', source: 'The hub', status: 'confirmed' }]
      : [];
    await route.fulfill({ json: { area, facts } });
  });

  await gotoEditor(page);
  // From the hub's address itself, not under the report's base.
  expect(asked).toContain('/api/facts/area/tax-and-budget.json');
  const led = await page.evaluate(() => ({
    n: Object.keys(LEDGER.facts).length,
    v: LEDGER.facts['capgains-share-over-400k'] && LEDGER.facts['capgains-share-over-400k'].value,
  }));
  expect(led).toEqual({ n: 1, v: 80 });

  const r = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 4, md: 'Over {fact:capgains-share-over-400k} of gains.' }));
  expect(r.ok).toBe(true);
  const words = await page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).textContent.trim(), r.id);
  expect(words).toBe('Over 80 percent of gains.');
});
