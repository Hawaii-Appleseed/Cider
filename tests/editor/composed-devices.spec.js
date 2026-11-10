// A report laid out from text places its figures, tables, callouts and its
// endnotes page as the editor's own objects (docsync.compose).
//
// The composer used to lay out words only. On 2026-11-09 the Wealth Tax
// report's four figures, its table, its callout and its endnotes page were
// placed by hand afterwards: placeholder quotes reserved the space, then some
// twenty-five pilot steps swapped in caption, picture and source boxes,
// grouped them, built the table, restyled the callout, and placed the
// endnotes section on a page added and deleted around it.
// affected-by: docsync/compose.py docsync/new.py docsync/templates/__init__.py report2027/tools/serve.py
const { test, expect, gotoEditor } = require('./fixtures/editor-test');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-composed-devices';
// A picture twice as wide as it is tall, so its frame is half the column.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">'
  + '<rect width="400" height="200" fill="#354F52"/></svg>';
const TEXT = `# Spec Devices
Date: November 2026

## Introduction

The opening paragraph of the report.[^a]

## Who pays

The words before the figure.[^b]

Figure 1. A wide test picture (2026)

![A dark green band](band.svg)

Source: Made for this test.

Table 1. Wealth by tier (2024)

| Tier | People | Wealth |
|---|---|---|
| $20 million or more | 1,245 | $95.6 billion |
| $50 million or more | 365 | $69.3 billion |

> [!NOTE] The estate tax
> It is assessed once.
>
> And it is easy to avoid.[^c]

[^a]: A — https://example.org/a
[^b]: B — https://example.org/b
[^c]: C, a book`;

test.describe('a report laid out from text', () => {
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test("places its figures, tables, callouts and endnotes as the editor's own objects",
    async ({ page, request }) => {
    const j = await (await request.post('/__scaffold', { data: {
      slug: SLUG, template: 'appleseed-report', scheme: 'slate', text: TEXT,
      assets: { 'band.svg': Buffer.from(SVG).toString('base64') } } })).json();
    expect(j.ok, j.error).toBe(true);
    await gotoEditor(page, `?project=${SLUG}`);
    const frame = page.frameLocator('#out');

    // The figure: caption, picture and source grouped; the picture drawn,
    // its frame as tall as the file's shape at the column's width.
    const fig = await page.evaluate(() => {
      const pic = layout.boxes.find(b => (b.md || '').includes('band.svg'));
      const group = (layout.groups || []).find(g => g.includes('text.' + pic.id));
      return { id: pic.id, w: pic.w, h: pic.h, group };
    });
    expect(fig.h).toBeCloseTo(fig.w / 2, 2);
    expect(fig.group.length).toBe(3);
    const img = frame.locator(`[data-el="text.${fig.id}"] img`);
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);

    // The table is a real table object (the Table panel's), numbers right-aligned.
    const t = await page.evaluate(() => (layout.tables || []).find(x => x.id.startsWith('txt-tbl-')));
    expect(t.rows.length).toBe(3);
    expect(t.colAlign).toEqual(['left', 'right', 'right']);
    await expect(frame.locator(`[data-el="table.${t.id}"]`)).toHaveCount(1);

    // The callout is ONE box wearing the house panel.
    const co = await page.evaluate(() => layout.boxes.find(b => b.use === 'Callout panel'));
    expect(co.md.startsWith('[The estate tax]{.Callout head}')).toBe(true);
    await expect(frame.locator(`[data-el="text.${co.id}"]`)).toContainText('easy to avoid');

    // The endnotes: the engine's section, placed on the last page, holding
    // every note; nothing left in the renderer's stand-in after the sheets.
    const notes = await page.evaluate(() => {
      const all = [...$('out').contentDocument.querySelectorAll('[data-el^="endnote."]')];
      return { placed: all.filter(el => el.closest('.ds-endnotes-sec')).length,
               elsewhere: all.filter(el => !el.closest('.ds-endnotes-sec')).length };
    });
    expect(notes).toEqual({ placed: 3, elsewhere: 0 });
    await expect(frame.locator('[data-el="text.tpl-toc2"]')).toContainText(/Endnotes — \d+/);
    await expect(frame.locator('[data-el="text.tpl-toc2"]')).toContainText('Introduction — 3');

    // Nothing the composer placed clashes, sits off the sheet or past the
    // print cut, and no source is called uncited. (The template's own cover
    // photo sits under its title by design; that is not the composer's.)
    const a = await page.evaluate(() => docsync.api.audit());
    const mine = id => /^(text|table)\.txt-|^txt-/.test(id);
    expect(a.issues.filter(i => ['overlap', 'off-sheet', 'print-overflow', 'covers-flow',
      'orphaned-group-member'].includes(i.kind) && (i.ids || []).some(mine))).toEqual([]);
    expect(a.issues.filter(i => i.kind === 'uncited-source')).toEqual([]);
  });
});
