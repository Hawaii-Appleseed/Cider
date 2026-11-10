// A report docsync.new made (the composer's, or a blank canvas somebody cited
// in) prints its citations as a STAND-IN list after the last page until an
// endnotes section is placed: docsync/new.py's renderer puts the engine's own
// ol.ds-endnotes outside every sheet, so that no citation dangles. The editor
// took that list for one the renderer DESIGNED and refused the section:
// addEndnotesSection answered "this report already draws its own endnotes
// list", the Sources panel's button read "✓ Endnotes section", and the first
// citation typed in the editor never brought a section either. On 2026-11-09
// the Wealth Tax report's 16 notes had to be placed through a page function
// and a blank page deleted by hand.
//
// The Budget Primer's own page 12 stays the case that must still refuse
// (pilot-api.spec.js, endnotes-section.spec.js).
//
// Since 2026-11-09 the composer places an endnotes page itself, so a report
// made from text has no stand-in. The case stays for a template report cited
// in afterwards (citations a pilot or a paste adds bring no section; only the
// prose editor makes one) and for every report composed before then.
// affected-by: docsync/new.py docsync/compose.py docsync/content.py
const { test, expect, gotoEditor, openSources } = require('./fixtures/editor-test');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-endnotes-standin';

/** Endnote entries on the page: in a placed section, and anywhere else. */
const notes = page => page.evaluate(() => {
  const all = [...$('out').contentDocument.querySelectorAll('[data-el^="endnote."]')];
  const placed = all.filter(el => el.closest('.ds-endnotes-sec'));
  return { placed: placed.length, elsewhere: all.length - placed.length };
});

test.describe("a composed report's stand-in endnotes", () => {
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('do not stop an endnotes section being placed, and the section retires them',
    async ({ page, request }) => {
    const j = await (await request.post('/__scaffold', { data: {
      slug: SLUG, name: 'Spec Endnotes', template: 'appleseed-report' } })).json();
    expect(j.ok, j.error).toBe(true);
    await gotoEditor(page, `?project=${SLUG}`);
    const cited = await page.evaluate(() => docsync.api.batch([
      { verb: 'addSource', args: ['first', 'First source', 'https://example.org/first'] },
      { verb: 'addSource', args: ['second', 'Second source', 'https://example.org/second'] },
      { verb: 'addTextBox', args: { page: 4, x: 0.7, y: 8.2, w: 4,
        md: 'Cited words.[^first] And more.[^second]' } },
    ]));
    expect(cited.ok, cited.error).toBe(true);

    // The stand-in: both notes, outside every sheet, and no section yet.
    expect(await notes(page)).toEqual({ placed: 0, elsewhere: 2 });

    // The Sources panel offers the section ...
    await openSources(page);
    const btn = page.locator('.src-endnotes');
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText('+ Endnotes section');

    // ... and the pilot places it, on a new last page.
    const pagesBefore = await page.evaluate(() => pageOrder().length);
    const r = await page.evaluate(() => docsync.api.addEndnotesSection());
    expect(r.ok, r.error).toBe(true);
    expect(r.id).toMatch(/^text\./);
    expect(await page.evaluate(() => pageOrder().length)).toBe(pagesBefore + 1);

    // One list now: the placed section holds both notes, the stand-in is gone.
    expect(await notes(page)).toEqual({ placed: 2, elsewhere: 0 });
    // Asking again is the same section, not a second.
    const again = await page.evaluate(() => docsync.api.addEndnotesSection());
    expect(again.ok, again.error).toBe(true);
    expect(again.id).toBe(r.id);
  });
});
