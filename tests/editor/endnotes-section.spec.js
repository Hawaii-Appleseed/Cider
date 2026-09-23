// The endnotes SECTION the editor can place, for reports whose renderer
// builds none of its own.
//
// Endnote numbering has always worked everywhere — [^id] resolves to a
// superscript in any report — but the LIST those numbers point at was
// hand-rolled per renderer (report2027's page 12), and docsync.scaffold /
// docsync.propose explicitly leave citations to human judgement. So a report
// that wasn't built with an endnotes page had citations pointing at nothing,
// and no way to ask for the list short of editing its renderer.
//
// Now a box with act:'endnotes' renders it (Layout.text_boxes ->
// Footnotes.endnotes_html), reachable from the Sources panel, and created
// automatically by the first citation in a report that has no list yet.
//
// The Budget Primer fixture is the SUPPRESSION case: its renderer already
// draws page 12, so the editor must not offer a second list that would
// renumber alongside the first.
const { warmTest: test, expect, gotoEditor, openSources: reachSources } = require('./fixtures/editor-test');

const openSources = async page => {
  await reachSources(page);
  await expect(page.locator('#srcpanel')).toBeVisible();
};

test.describe('endnotes section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(900);
  });

  test('is offered from the Sources panel, and adds a page at the end',
    async ({ page }) => {
      // This fixture's renderer owns page 12, so start from a report that has
      // no list of its own: drop the designed endnotes page out of the order.
      await page.evaluate(async () => {
        pushHistory();
        layout.pages = { order: pageOrder().filter(p => String(p) !== '12') };
        markDirty();
        await render();
      });
      await page.waitForTimeout(600);

      await openSources(page);
      const btn = page.locator('.src-endnotes');
      await expect(btn).toBeEnabled();
      await expect(btn).toHaveText('+ Endnotes section');

      const pagesBefore = await page.evaluate(() => pageOrder().length);
      await btn.click();
      await page.waitForTimeout(1500);

      // A page was appended, and the section sits on it.
      const st = await page.evaluate(() => {
        const b = boxes().find(x => x.act === 'endnotes');
        const order = pageOrder();
        return { n: order.length, last: String(order[order.length - 1]),
                 boxPage: b && String(b.page), md: b && b.md };
      });
      expect(st.n).toBe(pagesBefore + 1);
      expect(st.boxPage).toBe(st.last);      // on the LAST page, not mid-document
      expect(st.md).toContain('Endnotes');

      // And it rendered a real, numbered list — synced to what the prose cites.
      const sec = page.frameLocator('#out').locator('.ds-endnotes-sec');
      await expect(sec).toBeVisible();
      expect(await sec.locator('ol.ds-endnotes > li').count()).toBeGreaterThan(0);
      // Each entry carries the drag hook that makes reordering possible.
      await expect(sec.locator('ol.ds-endnotes > li').first())
        .toHaveAttribute('data-el', /^endnote\./);
      // Nothing was left unresolved in the output.
      expect(await page.evaluate(() =>
        $('out').contentDocument.body.innerHTML.includes('ds-endnotes-mount'))).toBe(false);

      // Offering it twice would produce two lists renumbering side by side.
      await expect(page.locator('.src-endnotes')).toBeDisabled();
    });

  test('is not offered when the report\'s own renderer already draws one',
    async ({ page }) => {
      // Untouched fixture: page 12 is the Budget Primer's endnotes page.
      await openSources(page);
      const btn = page.locator('.src-endnotes');
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveText('✓ Endnotes section');
      expect(await page.evaluate(() => !!boxes().find(x => x.act === 'endnotes')))
        .toBe(false);
    });

  test('the first citation in a report with no list creates the section itself',
    async ({ page }) => {
      await page.evaluate(async () => {
        pushHistory();
        layout.pages = { order: pageOrder().filter(p => String(p) !== '12') };
        markDirty();
        await render();
      });
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => !!boxes().find(x => x.act === 'endnotes')))
        .toBe(false);

      // Cite an existing source from inside a prose editor, the way the
      // right-click "cite" rows do, then commit the edit.
      await page.evaluate(async () => {
        const d = $('out').contentDocument;
        const el = d.querySelector('[data-slot="whopays.p1"]');
        el.scrollIntoView();
        edit(d, 'whopays.p1');
        const host = d.querySelector('.ds-edit');
        const range = d.createRange();
        range.selectNodeContents(host);
        range.collapse(false);
        await insertNodeAt(d, host, range, makeFnChip(d, sourceIds()[0]));
        wantEndnotesSection = true;
        richHost.blur();
      });
      await page.waitForTimeout(2000);

      expect(await page.evaluate(() => !!boxes().find(x => x.act === 'endnotes')))
        .toBe(true);
      await expect(page.frameLocator('#out').locator('.ds-endnotes-sec')).toBeVisible();
    });
});
