// INDESIGN_PARITY.md 47 and 52: the Preflight panel and the Hyperlinks panel.
const { warmTest: test, expect, gotoEditor, clickTool } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};

test.describe('47 preflight', () => {
  test('one list: low contrast, a missing picture, and the badge counts them', async ({ page }) => {
    await gotoEditor(page);
    const pale = await addBox(page, 'Pale words on white.', { style: { color: '#DDDDDD' } });
    const fine = await addBox(page, 'Dark words on white.', { y: 3, style: { color: '#222222' } });
    // White text on a dark placed shape behind it is fine — the shape is read off the paint stack.
    await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 5, w: 3, h: 1, fill: '#1E3A4C', z: 1 }));
    const onShape = await addBox(page, 'White on navy.', { y: 5.2, z: 5, style: { color: '#FFFFFF' } });
    await addBox(page, '![](assets/no-such-file.png)', { y: 7 });
    await page.evaluate(() => Promise.all([...$('out').contentDocument.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))));
    const r = await api(page, 'preflight()');
    expect(r.ok).toBe(true);
    const contrast = r.issues.filter(i => i.kind === 'low-contrast').map(i => i.ids[0]);
    expect(contrast).toContain(pale);
    expect(contrast).not.toContain(fine);
    expect(contrast).not.toContain(onShape);
    expect(r.issues.some(i => i.kind === 'missing-image' && i.severity === 'error')).toBe(true);
    // The badge and the panel. The count is on Preflight's row in Check ▾,
    // and Check itself wears it on the bar.
    await expect(page.locator('#check-count')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => page.evaluate(() => !$('pf-count').hidden
      && $('check-count').textContent === $('pf-count').textContent)).toBe(true);
    await clickTool(page, 'preflight');
    expect(await page.locator('#pf-list .pf-row[data-kind="low-contrast"]').count()).toBeGreaterThan(0);
    await page.locator('#pf-list .pf-row[data-kind="missing-image"]').first().click();
    expect(await page.evaluate(() => [...selIds].length)).toBe(1);
  });
});

test.describe('52 hyperlinks', () => {
  test('lists links, checks them through the server, changes one everywhere, links bare addresses', async ({ page }) => {
    await gotoEditor(page);
    const a = await addBox(page, 'See [the study](https://example.org/broken-page) and [ours](https://example.org/ok).');
    const b = await addBox(page, 'Again [here](https://example.org/broken-page). Also https://example.org/bare, plain.', { y: 3 });
    let h = await api(page, 'hyperlinks()');
    const bl = h.links.find(l => l.url === 'https://example.org/broken-page');
    expect(bl.uses.length).toBe(2);
    expect(bl.state).toBe('unchecked');
    const c = await api(page, 'checkLinks()');
    expect(c.ok).toBe(true);
    expect(c.links.find(l => l.url === 'https://example.org/broken-page').state).toBe('broken');
    expect(c.links.find(l => l.url === 'https://example.org/ok').state).toBe('ok');
    await clickTool(page, 'hyperlinks');
    expect(await page.locator('#hl-list .hl-row.broken').count()).toBe(1);
    const r = await page.evaluate(() => docsync.api.changeLink('https://example.org/broken-page', 'https://example.org/fixed'));
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(2);
    expect(await page.evaluate(i => boxOf(i).md, a)).toContain('](https://example.org/fixed)');
    const l = await api(page, 'linkBareUrls()');
    expect(l.linked).toBe(1);
    expect(await page.evaluate(i => boxOf(i).md, b)).toContain('[https://example.org/bare](https://example.org/bare), plain.');
    // Already-linked addresses are left alone.
    expect((await api(page, 'linkBareUrls()')).linked).toBe(0);
  });
});
