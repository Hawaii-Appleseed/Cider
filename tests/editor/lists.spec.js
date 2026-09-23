// Bulleted + numbered lists (docsync/editor/edit.html + content.py block_html).
// The prose-editing toolbar gets "• List" / "1. List" buttons that convert the
// selected paragraph-level blocks to/from <li>s; the renderer's block_html()
// only gives '- '/'N. ' lines meaning for a +Section overflow block, so that's
// what these buttons are offered on (see buildTools's allowLists gate).
const { warmTest: test, expect, gotoEditor, fillDialog, submitDialog, clickAddSection } = require('./fixtures/editor-test');

// Enter in a contenteditable creates a new block per line (unlike a textarea,
// where '\n' is just a character within one value) — build the paragraphs
// directly so the list-toggle's per-block logic has real blocks to work with.
async function addSectionAndEdit(page, slug, lines) {
  await clickAddSection(page);
  await fillDialog(page, { page: 'basics', slug });
  await submitDialog(page);
  const frame = page.frameLocator('#out');
  const ta = frame.locator('.ds-edit');
  await ta.waitFor({ state: 'visible' });
  await ta.evaluate((el, lines) => {
    el.innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = el.ownerDocument.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, lines);
  return ta;
}

test.describe('lists', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the numbered-list button renders an <ol>', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const ta = await addSectionAndEdit(page, 'num-list', ['first', 'second', 'third']);
    await page.locator('#ty-mol').click();   // chrome bar — the inline toolbar is gone
    // Converted to a real <ol> right in the editor…
    await expect(ta.locator('ol > li')).toHaveCount(3);
    // …and after COMMITTING the edit (blur, not Escape which discards), the
    // renderer's own <ol> reflects it.
    await ta.evaluate(el => el.blur());
    const section = frame.locator('[data-slot="extra.basics.num-list"]');
    await expect(section.locator('ol.extra-numbers')).toHaveCount(1);
    await expect(section.locator('ol.extra-numbers li')).toHaveCount(3);
  });

  test('the bullet-list button renders a <ul>, and toggles back off', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const ta = await addSectionAndEdit(page, 'bul-list', ['apple', 'banana']);
    const bulletBtn = page.locator('#ty-mul');   // chrome bar — the inline toolbar is gone

    await bulletBtn.click();
    await expect(ta.locator('ul > li')).toHaveCount(2);

    // Toggle off — every targeted block is already that list type, so it
    // unwraps back to plain paragraphs.
    await ta.evaluate(el => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = el.ownerDocument.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await bulletBtn.click();
    await expect(ta.locator('ul')).toHaveCount(0);
    await expect(ta.locator('p')).toHaveCount(2);
  });

  // Regression: a C.list() bullets slot (the renderer stamps data-slot on the
  // <ul> itself) opened WITHOUT list support — its "- " source lines showed
  // as literal dashes, the list buttons stayed hidden, and a commit through
  // the list-less serializer would have flattened the list. The slot
  // element's own tag is the renderer's authoritative "this is a list".
  test('a designed bullets slot opens as a real list and round-trips', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const oha = frame.locator('[data-slot="basics.branch.oha.bullets"]');
    await oha.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await oha.dblclick({ force: true });
    const host = frame.locator('.ds-edit');
    await host.waitFor({ state: 'visible' });

    // Real <li>s, no literal markdown, and the list buttons offered.
    await expect(host.locator('ul > li')).toHaveCount(2);
    expect(await host.evaluate(el => /(^|\n)- /.test(el.innerText))).toBe(false);
    await expect(page.locator('#ty-mul')).toBeVisible();

    // Edit one bullet, commit, and the slot round-trips as "- " lines the
    // renderer's bullets() parser accepts — re-rendered as a two-item <ul>.
    await host.evaluate(el => {
      el.querySelectorAll('li')[1].textContent = 'Edited bullet two.';
    });
    await host.evaluate(el => el.blur());
    await frame.locator('.ds-edit').waitFor({ state: 'detached' });
    await expect(frame.locator('[data-slot="basics.branch.oha.bullets"] li')).toHaveCount(2);
    const committed = await page.evaluate(() => readSlot('basics.branch.oha.bullets'));
    expect(committed.split('\n').every(l => l.startsWith('- '))).toBe(true);
    expect(committed).toContain('Edited bullet two.');
  });
});
