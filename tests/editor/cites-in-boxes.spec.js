// A citation counts wherever the engine numbers it: content.md, a text box's
// own md, a table's cells, and the boxes and tables of a shared layout.
//
// The editor and the server counted content.md alone. A report the composer
// lays out keeps all its words in text boxes, so on the Wealth Tax report
// (2026-11-09) audit() and the Check badge called 16 cited sources "never
// cited", the Sources panel read "unused" and offered Delete on each of them,
// a rename left every [^id] in its boxes pointing at nothing, and
// /__inventory (and the MCP server's uncited_sources, which reads it) agreed
// with the audit. /__inventory also skipped a source with no link.
// affected-by: report2027/tools/serve.py docsync/compose.py docsync/new.py
const { test, expect, gotoEditor, fillDialog, submitDialog, openSources } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-cites-in-boxes';
// Every citation the composer writes lands in a text box. [^cell] and [^idle]
// are declared and not cited in the words.
const TEXT = '# Spec Cites\n\nThe summary paragraph.[^summ]\n\n'
  + '## A section\n\nBody of the section.[^body] And a book.[^book]\n\n'
  + '[^summ]: Summary source — https://example.org/summ\n'
  + '[^body]: Body source — https://example.org/body\n'
  + '[^book]: A book with no link\n'
  + '[^cell]: Cited in a table cell — https://example.org/cell\n'
  + '[^idle]: Never cited — https://example.org/idle';

const uncited = page => page.evaluate(async () =>
  (await docsync.api.audit()).issues.filter(i => i.kind === 'uncited-source')
    .map(i => i.ids[0]).sort());
const row = (page, id) => page.locator('#srcpanel .srcrow',
  { has: page.locator('.srcid', { hasText: `[${id}]` }) });

test.describe.configure({ mode: 'serial' });

test.describe('a citation in a text box or a table cell', () => {
  test.beforeEach(async ({ request }) => {
    const j = await (await request.post('/__scaffold', { data: {
      slug: SLUG, template: 'appleseed-report', text: TEXT } })).json();
    expect(j.ok, j.error).toBe(true);
  });
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('counts in the audit and the Sources panel, and a rename follows it',
    async ({ page }) => {
    await gotoEditor(page, `?project=${SLUG}`);
    // The composer's citations are all in boxes, and none is in content.md.
    expect(await page.evaluate(() => /\[\^/.test(source.replace(/^\[\[sources\]\][\s\S]*$/m, ''))))
      .toBe(false);
    expect(await uncited(page)).toEqual(['cell', 'idle']);

    // A table cell is cited words too.
    const t = await page.evaluate(() => docsync.api.addTable({ page: 4, x: 1, y: 8, w: 4,
      rows: [['Year', 'Amount'], ['2026', '$1.2 billion[^cell]']] }));
    expect(t.ok, t.error).toBe(true);
    expect(await uncited(page)).toEqual(['idle']);

    // The panel says what is cited, and will not delete it from under its words.
    await openSources(page);
    await expect(row(page, 'body').locator('.srcuse')).toContainText('cited 1');
    await expect(row(page, 'body').locator('.srcdel')).toBeDisabled();
    await expect(row(page, 'cell').locator('.srcuse')).toContainText('cited 1');
    await expect(row(page, 'idle').locator('.srcuse')).toHaveText('unused');
    await expect(row(page, 'idle').locator('.srcdel')).toBeEnabled();

    // A rename reaches the box that cites it, so the note still resolves.
    await row(page, 'summ').locator('.srcren', { hasText: 'rename' }).click();
    await fillDialog(page, { id: 'summary' });
    await submitDialog(page);
    await expect(row(page, 'summary').locator('.srcuse')).toContainText('cited 1');
    expect(await page.evaluate(() => boxes().filter(b => /\[\^summ\]/.test(b.md || '')).length))
      .toBe(0);
    expect(await page.evaluate(() => boxes().filter(b => /\[\^summary\]/.test(b.md || '')).length))
      .toBe(1);
    // No red "?" (a citation naming no source) anywhere on the page.
    await expect(page.frameLocator('#out').locator('a.fn[title^="no source named"]')).toHaveCount(0);
    expect(await uncited(page)).toEqual(['idle']);
  });

  test('/__inventory lists every source and counts each where it is cited',
    async ({ request }) => {
    // A table cell and a shared layout's box, written into this throwaway
    // project the way the editor stores them (no editor is open on it).
    const lp = path.join(REPO, 'projects', SLUG, 'layout.json');
    const lay = JSON.parse(fs.readFileSync(lp, 'utf8'));
    lay.tables = [...(lay.tables || []), { id: 'spec-t', page: 4, x: 1, y: 8, w: 4,
      rows: [['Year', 'Amount'], ['2026', '$1.2 billion[^cell]']] }];
    lay.masters = { ...(lay.masters || {}), 'spec-m': {
      boxes: [{ id: 'spec-f', x: 1, y: 10, w: 3, md: 'A footer note.[^idle]' }] } };
    fs.writeFileSync(lp, JSON.stringify(lay, null, 2));

    const inv = await (await request.get(`/__inventory?project=${SLUG}&elements=0`)).json();
    expect(inv.ok, inv.error).toBe(true);
    const by = Object.fromEntries(inv.sources.map(s => [s.id, s]));
    // Every source is listed, the one with no link too.
    expect(Object.keys(by).sort()).toEqual(['body', 'book', 'cell', 'idle', 'summ']);
    expect(by.book.url).toBe('');
    expect(by.book.text).toBe('A book with no link');
    expect(by.body.url).toBe('https://example.org/body');
    expect(Object.fromEntries(inv.sources.map(s => [s.id, s.cites])))
      .toEqual({ summ: 1, body: 1, book: 1, cell: 1, idle: 1 });
  });
});
