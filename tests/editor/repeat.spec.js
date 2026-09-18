// "On every page": a text box, shape or table with every:true is drawn on
// every page from its one store entry — the editor's master page — with
// {page}/{pages} tokens for a folio. Off-home copies are inert in the editor
// (data-repeat, no data-el); the home instance is the one thing to edit.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const frame = page => page.frameLocator('#out');

test.describe('repeat on every page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('a repeated footer lands on every page with its ordinal, from one live instance', async ({ page }) => {
    const r = await api(page, `addTextBox({ page: 3, x: 0.5, y: 10.4, w: 6, md: 'Page {page} of {pages}', every: true })`); // w 7.5 leaves 1in of slack
    expect(r.ok).toBe(true);
    const id = r.id;
    const npages = await frame(page).locator('section.page').count();
    expect(npages).toBeGreaterThan(3);
    await expect(frame(page).locator(`[data-el="${id}"]`)).toHaveCount(1);
    await expect(frame(page).locator(`[data-repeat="${id}"]`)).toHaveCount(npages - 1);
    // The home instance says its own number; a copy says the number of ITS page.
    await expect(frame(page).locator(`[data-el="${id}"]`)).toContainText(`Page 3 of ${npages}`);
    const fifth = frame(page).locator('section.page').nth(4).locator(`[data-repeat="${id}"]`);
    await expect(fifth).toContainText(`Page 5 of ${npages}`);
    // A copy cannot be grabbed; the home one can.
    expect(await fifth.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    // The inventory lists it once, flagged.
    const inv = await api(page, 'inventory()');
    const hits = inv.pages.flatMap(p => p.elements).filter(e => e.id === id);
    expect(hits).toHaveLength(1);
    expect(hits[0].every).toBe(true);
    // Moving the home instance moves every copy.
    await page.evaluate(i => docsync.api.place(i, { x: 1.25 }), id);
    const lefts = await frame(page).locator(`[data-repeat="${id}"]`).evaluateAll(els => [...new Set(els.map(e => e.style.left))]);
    expect(lefts).toEqual(['1.25in']);
    // Undo the move, then unrepeat: only the home page keeps it.
    await api(page, 'undo()');
    const off = await page.evaluate(i => docsync.api.repeat(i, false), id);
    expect(off.every).toBe(false);
    await expect(frame(page).locator(`[data-repeat="${id}"]`)).toHaveCount(0);
    await expect(frame(page).locator(`[data-el="${id}"]`)).toHaveCount(1);
    expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).every, id)).toBeUndefined();
  });

  test('skip keeps a copy off named pages; a shape repeats too; refusals', async ({ page }) => {
    const box = (await api(page, `addTextBox({ page: 2, x: 1, y: 1, w: 2, md: 'hdr' })`)).id;
    const r = await page.evaluate(i => docsync.api.repeat(i, true, [1]), box);
    expect(r).toMatchObject({ ok: true, every: true, skip: [1] });
    await expect(frame(page).locator('section.page').first().locator(`[data-repeat="${box}"]`)).toHaveCount(0);
    await expect(frame(page).locator('section.page').nth(2).locator(`[data-repeat="${box}"]`)).toHaveCount(1);
    const shape = (await api(page, `addShape({ page: 2, kind: 'rect', x: 0.5, y: 10.3, w: 7.5, h: 0.02, fill: '#000000' })`)).id;
    await page.evaluate(i => docsync.api.repeat(i), shape);
    await expect(frame(page).locator(`[data-shape="${shape}"]`)).toHaveCount(1);
    expect(await frame(page).locator(`[data-repeat="${shape}"]`).count()).toBeGreaterThan(1);
    // A designed element cannot repeat; an unknown id refuses.
    expect((await api(page, `repeat('basics.h1')`)).ok).toBe(false);
    expect((await api(page, `repeat('text.999')`)).ok).toBe(false);
    // batch: create and repeat in one undo step via a ref.
    const b = await api(page, `batch([
      { verb: 'addTextBox', args: { page: 2, x: 6, y: 0.4, w: 2, md: '{page}' }, as: 'folio' },
      { verb: 'repeat', args: ['@folio', true, [1]] },
    ])`);
    expect(b.ok).toBe(true);
    const folio = await page.evaluate(() => layout.boxes[layout.boxes.length - 1]);
    expect(folio).toMatchObject({ every: true, skip: [1] });
    await api(page, 'undo()');
    expect(await page.evaluate(() => layout.boxes.some(x => x.md === '{page}'))).toBe(false);
  });

  test('the element menu toggles it, and the page menu hides copies on one page', async ({ page }) => {
    const id = (await api(page, `addTextBox({ page: 2, x: 1, y: 9, w: 3, md: 'running foot' })`)).id;
    const el = frame(page).locator(`[data-el="${id}"]`);
    await el.click({ button: 'right' });
    await frame(page).locator('.ds-menu button', { hasText: 'Show on every page' }).click();
    expect(await frame(page).locator(`[data-repeat="${id}"]`).count()).toBeGreaterThan(1);
    // Right-click empty space on page 1: hide the repeats there.
    const pg1 = frame(page).locator('section.page').first();
    await pg1.click({ button: 'right', position: { x: 5, y: 5 } });
    await frame(page).locator('.ds-menu button', { hasText: 'Hide repeated items on this page' }).click();
    await expect(pg1.locator(`[data-repeat="${id}"]`)).toHaveCount(0);
    expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).skip, id)).toEqual([1]);
    await pg1.click({ button: 'right', position: { x: 5, y: 5 } });
    await frame(page).locator('.ds-menu button', { hasText: 'Show repeated items on this page' }).click();
    await expect(pg1.locator(`[data-repeat="${id}"]`)).toHaveCount(1);
    // Back to one page from the menu on the home instance.
    await frame(page).locator(`[data-el="${id}"]`).click({ button: 'right' });
    await frame(page).locator('.ds-menu button', { hasText: 'Show on this page only' }).click();
    await expect(frame(page).locator(`[data-repeat="${id}"]`)).toHaveCount(0);
  });
});
