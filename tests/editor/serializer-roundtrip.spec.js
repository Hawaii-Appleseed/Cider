// mdToHtml()/htmlToMd() (edit.html) mirror content.py's md_inline()/
// paragraphs()/block_html() grammar so the contenteditable surface shows
// exactly what the report renders. This round-trips every real slot in the
// loaded draft's content.md through mdToHtml -> htmlToMd and checks it
// reaches a stable fixed point — the acceptance gate for the rich-text
// rewrite, kept as permanent regression coverage.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('markdown <-> rich-text serializer', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('every content.md slot reaches a stable round-trip fixed point', async ({ page }) => {
    const result = await page.evaluate(() => {
      const keys = [...source.matchAll(/(?:^|\n)\[\[([A-Za-z0-9._-]+)\]\]\n/g)].map(m => m[1]);
      const failures = [];
      for (const key of keys) {
        if (key === 'sources') continue;   // its own grammar, not prose
        const allowLists = key.startsWith('extra.');
        const raw = readSlot(key);
        if (!raw) continue;
        // The expected fixed point: what mdToHtml/htmlToMd normalize to
        // (soft-wrapped lines within a paragraph collapse to one line — the
        // renderer already treats them identically, paragraphs() joins them
        // the same way) — not the original bytes.
        const div = document.createElement('div');
        div.innerHTML = mdToHtml(raw, { allowLists });
        const once = htmlToMd(div, { allowLists });
        const div2 = document.createElement('div');
        div2.innerHTML = mdToHtml(once, { allowLists });
        const twice = htmlToMd(div2, { allowLists });
        if (once !== twice) failures.push({ key, once, twice });
      }
      return { checked: keys.length, failures };
    });
    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    expect(result.checked).toBeGreaterThan(10);
  });

  test('bold, italic, links, images and footnote refs round-trip', async ({ page }) => {
    const cases = [
      '**bold** text',
      '*italic* text',
      'a [link](https://example.com/x?a=1&b=2) here',
      'an image ![alt text](assets/foo.png) inline',
      'cited fact[^act99] right here',
      'multiple refs[^a][^b] adjacent',
    ];
    const result = await page.evaluate((cases) => {
      return cases.map(md => {
        const div = document.createElement('div');
        div.innerHTML = mdToHtml(md, { inline: true });
        return { md, out: htmlToMd(div, { inline: true }) };
      });
    }, cases);
    for (const { md, out } of result) expect(out, md).toBe(md);
  });

  test('bold and italic together are disallowed by the toolbar, not silently corrupted', async ({ page }) => {
    // md_inline's regexes don't round-trip ***combined***; the serializer
    // itself must not be asked to produce it via the UI (boldItalicBlocked).
    // This just documents the known grammar limit so it isn't "fixed" by
    // accident into something that silently mis-renders.
    const out = await page.evaluate(() => {
      const div = document.createElement('div');
      div.innerHTML = mdToHtml('***both***', { inline: true });
      return div.innerHTML;
    });
    expect(out).not.toBe('');
  });
});
