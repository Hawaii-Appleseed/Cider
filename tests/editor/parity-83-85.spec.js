// INDESIGN_PARITY.md 83 (a PDF of some pages) and 85 (layer housekeeping).
// Local mode; /__export is mocked by the fixture (STANDALONE.md §C), so the
// PDF test checks what the editor asks for — the server's own page pruning is
// covered in report2027/tools/test_render.py, and was checked with real Chrome.
const { test, expect, gotoEditor, openFileMenu, clickTool } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

test.describe('83 a PDF of some pages', () => {
  test('the pages field sends a range and names the file for it', async ({ page }) => {
    await gotoEditor(page);
    let sent = null;
    await page.route('**/__export', route => { sent = route.request().postDataJSON(); route.continue(); });
    await openFileMenu(page);
    await page.click('#download');
    await page.fill('#dl-pages', ' 2-3 ');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-pdf')]);
    expect(sent.pages).toBe('2-3');
    expect(dl.suggestedFilename()).toMatch(/-p2-3\.pdf$/);
  });

  test('"this page" fills in the page in view; a bad range is refused before anything runs', async ({ page }) => {
    await gotoEditor(page);
    let called = false;
    await page.route('**/__export', route => { called = true; route.continue(); });
    const want = await page.evaluate(() => {
      const pgs = [...$('out').contentDocument.querySelectorAll('section.page')];
      pgs[2].scrollIntoView({ block: 'center' });
      return 3;
    });
    await openFileMenu(page);
    await page.click('#download');
    await page.click('#dl-thispage');
    await expect(page.locator('#dl-pages')).toHaveValue(String(want));
    await page.fill('#dl-pages', '999');
    await page.click('#dl-pdf');
    await expect(page.locator('#stat')).toContainText('the report has');
    expect(called).toBe(false);
  });

  test('the server refuses a malformed range, and a range on a PNG', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(async () => Promise.all([
      fetch('/__export', { method: 'POST', body: JSON.stringify({ fmt: 'pdf', pages: '3-x' }) }).then(r => r.json()),
      fetch('/__export', { method: 'POST', body: JSON.stringify({ fmt: 'png', pages: '3' }) }).then(r => r.json()),
    ]));
    expect(r[0].error).toContain('a range like');
    expect(r[1].error).toContain('for a PDF');
  });
});

test.describe('85 layer housekeeping', () => {
  const setup = async page => {
    await gotoEditor(page);
    const a = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2, md: 'note A' }))).id;
    const b = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 3, w: 2, md: 'note B' }))).id;
    for (const n of ['Back', 'Notes', 'Spare']) expect((await api(page, `defineLayer('${n}')`)).ok).toBe(true);
    await page.evaluate(i => docsync.api.toLayer([i], 'Notes'), a);
    await page.evaluate(i => docsync.api.toLayer([i], 'Back'), b);
    return { a, b };
  };

  test('merge moves what is on a layer onto another and drops it, as one undo step', async ({ page }) => {
    const { a, b } = await setup(page);
    const r = await api(page, `mergeLayers(['Notes'], 'Back')`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await page.evaluate(([a, b]) => [boxOf(a).layer, boxOf(b).layer, layout.layers.map(L => L.name)], [a, b]))
      .toEqual(['Back', 'Back', ['Back', 'Spare']]);
    expect((await api(page, `mergeLayers(['Nope'], 'Back')`)).ok).toBe(false);
    await page.evaluate(() => undo());
    expect(await page.evaluate(a => [boxOf(a).layer, layout.layers.length], a)).toEqual(['Notes', 3]);
  });

  test('delete unused drops only the layers nothing is on', async ({ page }) => {
    await setup(page);
    const r = await api(page, 'dropUnusedLayers()');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await page.evaluate(() => layout.layers.map(L => L.name))).toEqual(['Back', 'Notes']);
  });

  test('select everything on a layer; a locked one says why it will not', async ({ page }) => {
    const { a } = await setup(page);
    const r = await api(page, `selectLayer('Notes')`);
    expect(r.selected).toEqual([a]);
    expect(await page.evaluate(() => [...selIds])).toEqual([a]);
    await api(page, `defineLayer('Notes', { locked: true })`);
    expect((await api(page, `selectLayer('Notes')`)).error).toContain('locked');
  });

  test('the Layers panel offers select, merge and delete unused', async ({ page }) => {
    const { a, b } = await setup(page);
    await clickTool(page, 'layers');
    await expect(page.locator('#layers-dropunused')).toHaveText('Delete 1 unused layer');
    // Rows read front first: Spare, Notes, Back. Select on Notes.
    await page.locator('#doclayers .dl-row').nth(1).locator('.dl-btn[title^="Select everything"]').click();
    await expect.poll(() => page.evaluate(() => [...selIds])).toEqual([a]);
    // Merge Notes into Back through the dialog.
    await page.locator('#doclayers .dl-row').nth(1).locator('.dl-btn[title^="Merge"]').click();
    await page.locator('dialog[open] select').selectOption('Back');
    await page.locator('dialog[open] button', { hasText: 'Merge' }).click();
    await expect.poll(() => page.evaluate(a => boxOf(a).layer, a)).toBe('Back');
    await page.locator('#layers-dropunused').click();
    await expect.poll(() => page.evaluate(() => layout.layers.map(L => L.name))).toEqual(['Back']);
    expect(await page.evaluate(b => boxOf(b).layer, b)).toBe('Back');
  });
});
