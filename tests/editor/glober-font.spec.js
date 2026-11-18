// Glober: a licensed face whose files live ONLY on the private staff hub.
// Pins: it is in the font picker with every weight Fontfabric ships; locally it
// adds no @font-face and makes no request (the report's stack falls back to
// Barlow, no console errors); on the hub it adds one rule per file, pointing at
// the hub's own path, and the browser asks for the face a text box uses.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const WEIGHTS = ['100', '300', '400', '500', '600', '700', '800', '900', '950'];

async function boxWithGlober(page, weight) {
  const id = await page.evaluate(async w => {
    const r = await docsync.api.addTextBox({ page: 1, x: 1, y: 1, w: 4, md: 'Glober sample' });
    const id = r.id || r;
    setStyle(id, { font: 'Glober', weight: w, size: 24 });
    markDirty();
    await render();
    return id;
  }, weight);
  await settled(page);
  return id;
}

test.describe('Glober (hub-only font)', () => {
  test('is in the font picker with all its weights', async ({ page }) => {
    await gotoEditor(page);
    const fams = await page.locator('#ty-font option').allTextContents();
    expect(fams).toContain('Glober');
    const ws = await page.evaluate(() => { fillWeights('Glober', null);
      return [...document.querySelectorAll('#ty-weight option')].map(o => o.value).filter(Boolean); });
    expect(ws).toEqual(WEIGHTS);
  });

  test('locally: no @font-face, no request, falls back to Barlow, no errors', async ({ page }) => {
    const errors = [], hits = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (/fonts\/glober/.test(r.url())) hits.push(r.url()); });
    await gotoEditor(page);
    const id = await boxWithGlober(page, 700);
    const r = await page.evaluate(id => {
      const d = $('out').contentDocument, el = d.querySelector(`[data-el="${id}"]`);
      return { stack: getComputedStyle(el).fontFamily,
               rules: d.querySelectorAll('style[data-ds-hubfonts]').length,
               link: [...d.querySelectorAll('link[href*="fonts.googleapis"]')].map(l => l.href).join(' ') };
    }, id);
    expect(r.stack).toMatch(/Glober.*Barlow/);
    expect(r.rules).toBe(0);
    expect(r.link).not.toContain('Glober');
    expect(hits).toEqual([]);
    expect(errors.filter(e => /glober/i.test(e))).toEqual([]);
  });

  test('on the hub: one rule per file from the hub path, and the face is requested', async ({ page }) => {
    const hits = [];
    await page.route(/\/assets\/fonts\/glober\//, route => { hits.push(route.request().url()); route.fulfill({ status: 404 }); });
    await gotoEditor(page);
    await page.evaluate(() => { M.collab = { path: '/api/collab/x' }; });   // onHub() reads this when the registry has no entry
    await boxWithGlober(page, 700);
    const css = await page.evaluate(() =>
      [...$('out').contentDocument.querySelectorAll('style[data-ds-hubfonts]')].map(s => s.textContent).join(''));
    expect((css.match(/@font-face/g) || []).length).toBe(13);
    expect(css).toContain('/assets/fonts/glober/Glober-Bold.woff2');
    expect(css).toMatch(/font-weight:950;font-style:normal/);
    await expect.poll(() => hits.some(u => /Glober-Bold\.woff2/.test(u))).toBe(true);
    expect(hits.some(u => /Glober-Thin/.test(u))).toBe(false);   // unused faces cost nothing
  });
});
