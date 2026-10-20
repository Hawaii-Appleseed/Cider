// A library of reusable pieces (INDESIGN_PARITY.md 50): save the selection
// with the styles and swatches it wears; drop it into another report.
// Local mode: the server's library file (a throwaway one under the suite).
const { warmTest: test, expect, gotoEditor, openFileMenu } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

test.describe('50 library', () => {
  test('a stat card saved in one report lands in another, styles and swatch along', async ({ page }) => {
    const name = `Stat card ${Date.now()}`;
    await gotoEditor(page, '?project=demo-report');
    const pid = await page.evaluate(() => pageOrder()[0]);
    const ids = await page.evaluate(async p => {
      pushHistory();
      layout.swatches = { ...(layout.swatches || {}), LibBrand: '#1E6194' };
      layout.textStyles = { ...(layout.textStyles || {}), LibBase: { size: 15 }, LibFigure: { from: 'LibBase', size: 28, color: '@LibBrand' } };
      markDirty(); await render();
      const s = await docsync.api.addShape({ page: p, kind: 'rect', x: 2, y: 3, w: 2.4, h: 1.2, fill: '@LibBrand 20%' });
      const b = await docsync.api.addTextBox({ page: p, x: 2.2, y: 3.2, w: 2, md: '42%', style: { use: 'LibFigure' } });
      return [s.id, b.id];
    }, pid);
    await api(page, `group(${JSON.stringify(ids)})`);
    await api(page, `select(${JSON.stringify(ids)})`);
    const saved = await api(page, `saveToLibrary(${JSON.stringify(name)})`);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(Object.keys(saved.styles.textStyles).sort()).toEqual(['LibBase', 'LibFigure']);   // `from` followed
    expect(Object.keys(saved.styles.swatches)).toEqual(['LibBrand']);

    // Another report: it has none of those styles.
    await gotoEditor(page);
    expect(await page.evaluate(() => !!(layout.textStyles || {}).LibFigure)).toBe(false);
    const placed = await api(page, `placeFromLibrary(${JSON.stringify(name)}, { x: 1, y: 2 })`);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
    expect(placed.ids.length).toBe(2);
    const r = await page.evaluate(ids => ({
      st: (layout.textStyles || {}).LibFigure, sw: (layout.swatches || {}).LibBrand,
      box: boxOf(ids.find(i => i.startsWith('text.'))), grouped: (layout.groups || []).some(g => ids.every(i => g.includes(i))),
    }), placed.ids);
    expect(r.st).toEqual({ from: 'LibBase', size: 28, color: '@LibBrand' });
    expect(r.sw).toBe('#1E6194');
    expect(r.box).toMatchObject({ x: 1.2, y: 2.2, md: '42%' });
    expect(r.grouped).toBe(true);
    // One undo step takes the objects and the styles away again.
    await page.evaluate(() => undo());
    expect(await page.evaluate(() => !!(layout.textStyles || {}).LibFigure)).toBe(false);
    expect((await api(page, `dropFromLibrary(${JSON.stringify(name)})`)).ok).toBe(true);
    expect((await api(page, 'library()')).pieces.some(p => p.name === name)).toBe(false);
  });

  test('the Library dialog places a piece and saves the selection', async ({ page }) => {
    const name = `Callout ${Date.now()}`;
    await gotoEditor(page);
    const b = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: 'A callout' }));
    await api(page, `select(${JSON.stringify(b.id)})`);
    await page.evaluate(() => { saveToLibraryDialog(); });
    await page.locator('dialog[open] input').fill(name);
    await page.locator('dialog[open] button', { hasText: 'Save' }).click();
    await expect(page.locator('#stat')).toContainText('is in the library');
    await openFileMenu(page);
    await page.click('#file-library');
    const row = page.locator('#library .lib-row', { hasText: name });
    await expect(row).toBeVisible();
    const before = await page.evaluate(() => boxes().length);
    await row.locator('button', { hasText: 'Place' }).click();
    await expect.poll(() => page.evaluate(() => boxes().length)).toBe(before + 1);
    await api(page, `dropFromLibrary(${JSON.stringify(name)})`);
  });
  test('opened from the File menu, Escape closes it, and its head reads on one line', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#file');
    await page.locator('#file-library').click();
    await expect(page.locator('#library')).toBeVisible();
    // The title and the note each on one line, not folded under wide buttons.
    expect(await page.evaluate(() => [...document.querySelectorAll('#library .st-head b, #library .st-note')]
      .map(e => e.getBoundingClientRect().height).every(h => h < 24))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#library')).toHaveCount(0);
  });
});
