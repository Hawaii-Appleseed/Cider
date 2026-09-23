// C.derived() — the third answer to "why can't I edit this?".
//
// data-slot says "you can edit these words", data-el says "you can move this
// thing", and a tally has always said nothing at all: click it and the editor
// ignored you, which reads as broken rather than as "not yours to type". A
// renderer now stamps measured values with the command that remakes them, and
// the editor reports that command instead of staying silent.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const SRC = 'python -m spec stats';

/** Put a derived span into the live report, the way a renderer's edit-mode
 *  build does. The fixture project's own renderer has none, so the hook is
 *  planted here rather than depending on one report's content. */
async function plantDerived(page) {
  return page.evaluate(src => {
    const d = document.getElementById('out').contentDocument;
    const host = d.querySelector('section.page');
    const s = d.createElement('span');
    s.id = 'spec-derived';
    s.setAttribute('data-fixed', src);
    s.textContent = '71';
    host.prepend(s);
    return !!d.getElementById('spec-derived');
  }, SRC);
}

test.describe('derived values', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('clicking a derived value names the command that remakes it', async ({ page }) => {
    expect(await plantDerived(page)).toBe(true);
    await page.frameLocator('#out').locator('#spec-derived').click({ force: true });
    await expect(page.locator('#stat')).toContainText(SRC);
    await expect(page.locator('#stat')).toContainText('derived');
  });

  test('it stays read-only: no inline editor opens, and the document is unchanged',
    async ({ page }) => {
      await plantDerived(page);
      const el = page.frameLocator('#out').locator('#spec-derived');
      await el.dblclick({ force: true });
      // Nothing to type into — a derived value is not a slot.
      await expect(page.frameLocator('#out').locator('.ds-edit')).toHaveCount(0);
      await expect(page.evaluate(() => editing)).resolves.toBe(false);
      await expect(el).toHaveText('71');
    });

  test('a derived value inside a movable still lets the movable be selected',
    async ({ page }) => {
      // The report's real shape: a tally sits inside a row that IS movable.
      // Reporting the source must not swallow the click the selection needs.
      const id = await page.evaluate(src => {
        const d = document.getElementById('out').contentDocument;
        const host = d.querySelector('section.page [data-el]');
        const s = d.createElement('span');
        s.setAttribute('data-fixed', src);
        s.textContent = '71';
        host.appendChild(s);
        return host.getAttribute('data-el');
      }, SRC);
      await page.frameLocator('#out').locator(`[data-fixed="${SRC}"]`)
        .click({ force: true });
      await expect(page.locator('#stat')).toContainText(SRC);
      expect(await page.evaluate(() => [...selIds])).toContain(id);
    });
});
