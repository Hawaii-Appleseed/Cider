// Special characters and breaks (INDESIGN_PARITY.md 31). White space and
// hyphens are the plain Unicode characters in the file and on the page, shown
// as chips only while typing so an invisible one can be seen; breaks are
// tokens in the variables grammar — {break:line} {break:optional}
// {break:column} {break:frame}. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const NBSP = ' ', NBHY = '‑', SHY = '­', EM = ' ';

async function addBox(page, md, extra = {}, pg = 3) {
  const r = await page.evaluate(([m, x, p]) => docsync.api.addTextBox(
    { page: p, x: 1, y: 1, w: 4, md: m, ...x }), [md, extra, pg]);
  expect(r.ok).toBe(true);
  return r.id;
}

test.describe('special characters and breaks', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('special characters are chips while typing and themselves in the file', async ({ page }) => {
    const md = `$1.2${NBSP}million, a${NBHY}b, re${SHY}form, wide${EM}gap {break:line} next`;
    const back = await page.evaluate(m => {
      const el = document.createElement('div');
      el.innerHTML = mdToHtml(m, { inline: true });
      return { sp: el.querySelectorAll('.ds-spchip').length, br: el.querySelectorAll('.ds-varchip').length,
               md: htmlToMd(el, { inline: true }) };
    }, md);
    expect(back).toEqual({ sp: 4, br: 1, md });
  });

  test('on the page they are the characters, and a line break is a <br>', async ({ page }) => {
    const id = await addBox(page, `PO Box 3${NBSP}Honolulu{break:line}Hawaiʻi 96813`);
    const got = await page.evaluate(i => {
      const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      return { text: el.textContent, br: el.querySelectorAll('br').length,
               chips: el.querySelectorAll('.ds-spchip, .ds-varchip').length };
    }, id);
    expect(got.text).toContain(`3${NBSP}Honolulu`);
    expect(got.br).toBe(1);
    expect(got.chips).toBe(0);
  });

  test('a column break starts its paragraph in the next column', async ({ page }) => {
    const id = await addBox(page, 'One short paragraph.\n\n{break:column}Two, which starts the next column.');
    // addTextBox takes no columns; the Box panel's key is set directly.
    await page.evaluate(async i => { pushHistory(); boxOf(i).cols = 2; boxOf(i).h = 2; markDirty(); await render(); }, id);
    const xs = await page.evaluate(i => [...$('out').contentDocument
      .querySelectorAll(`[data-el="${i}"] p`)].map(p => p.getBoundingClientRect().left), id);
    expect(xs.length).toBe(2);
    expect(xs[1]).toBeGreaterThan(xs[0] + 20);
  });

  test('a frame break starts its paragraph in the next frame', async ({ page }) => {
    const a = await addBox(page, 'First.\n\n{break:frame}Second goes on.\n\nThird.', { h: 3 });
    const b = await addBox(page, 'x', { h: 3 }, 4);
    await page.evaluate(i => { boxOf(i).md = 'x'; }, b);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    const t = await page.evaluate(([x, y]) => [x, y].map(i =>
      $('out').contentDocument.querySelector(`[data-el="${i}"]`).textContent.trim()), [a, b]);
    expect(t[0]).toBe('First.');
    expect(t[1]).toMatch(/^Second goes on\.\s*Third\.\s*x?$/);
  });

  test('Insert special puts a nonbreaking space at the caret', async ({ page }) => {
    const id = await addBox(page, 'ab');
    await page.evaluate(i => editBox($('out').contentDocument,
      $('out').contentDocument.querySelector(`[data-el="${i}"]`)), id);
    const frame = page.frameLocator('#out');
    await frame.locator('.ds-edit p').click({ button: 'right' });
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Insert special' }).hover();
    await frame.locator('.ds-submenu button', { hasText: 'Nonbreaking space' }).click();
    // Inside the paragraph, where the right-click put the caret — not beside
    // it (an insert that lands between blocks steps into one: insertNodeAt).
    // That it serializes as the character is the first test's round trip.
    const chip = await page.evaluate(() => {
      const c = $('out').contentDocument.querySelector('.ds-edit .ds-spchip');
      return c && { inP: c.parentElement.tagName, ch: c.dataset.ch };
    });
    expect(chip).toEqual({ inP: 'P', ch: 'nbsp' });
  });
});
