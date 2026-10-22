// Four things that tripped anyone coming from InDesign (Devin, 2026-10-21):
// Escape threw away what was typed, ⌘S opened Chrome's "Save page as",
// Delete shape and Reset to its designed place could not be undone, and a
// right-click opened a menu about one thing while the selection — and the
// strip — stayed on another.
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const P = 'para.groc.lead', SLOT = 'groc.lead';

const center = (page, id) => page.evaluate(i => $('out').contentDocument
  .querySelector(`[data-el="${i}"]`).scrollIntoView({ block: 'center' }), id);
const select = (page, ids) => page.evaluate(i => {
  const d = $('out').contentDocument; setSel(d, i); paintSel(d);
}, ids);
async function clickWords(page, id) {
  const b = await page.frameLocator('#out').locator(`[data-el="${id}"] [data-slot]`).first().boundingBox();
  await page.mouse.click(b.x + b.width * 0.4, b.y + 8);
  await page.waitForTimeout(600);
}
async function rightClick(page, css) {
  const b = await page.frameLocator('#out').locator(css).first().boundingBox();
  await page.mouse.click(b.x + Math.min(40, b.width / 2), b.y + Math.min(10, b.height / 2), { button: 'right' });
  await page.waitForTimeout(700);
}
const menuItem = (page, label) => page.frameLocator('#out')
  .locator('.ds-menu button', { hasText: label }).first();

test.describe('Escape keeps what was typed', () => {
  test('in a paragraph: the words stay, it stays selected, and ⌘Z takes them back', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await center(page, P);
    const was = await page.evaluate(k => readSlot(k), SLOT);
    await clickWords(page, P);
    await page.keyboard.type('Zq');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    expect(await page.evaluate(k => ({ editing, sel: [...selIds], kept: readSlot(k).includes('Zq') }), SLOT))
      .toEqual({ editing: false, sel: [P], kept: true });
    await page.evaluate(() => undo());
    await settled(page);
    expect(await page.evaluate(k => readSlot(k), SLOT)).toBe(was);
  });

  test('opened and left with nothing typed, nothing is written', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await center(page, P);
    const src0 = await page.evaluate(() => source);
    await clickWords(page, P);
    expect(await page.evaluate(() => editing)).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    expect(await page.evaluate(src0 => ({ editing, same: source === src0, dirty }), src0))
      .toEqual({ editing: false, same: true, dirty: false });
  });

  test('in a text box and in a table cell', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const ids = await page.evaluate(async () => {
      const box = await docsync.api.addTextBox({ page: 2, x: 1, y: 1, w: 3, md: 'Note' });
      const tbl = await docsync.api.addTable({ page: 2, x: 1, y: 2, w: 4, headerRows: 1,
        rows: [['Program', 'FY26'], ['SNAP', '14.75']] });
      return { box: box.id, table: tbl.id };
    });
    await page.keyboard.press('Escape');
    await center(page, ids.box);
    const bb = await page.frameLocator('#out').locator(`[data-el="${ids.box}"]`).boundingBox();
    await page.mouse.click(bb.x + bb.width - 6, bb.y + bb.height / 2);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => editing)).toBe(true);
    await page.keyboard.press('End');
    await page.keyboard.type(' kept');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    expect(await page.evaluate(id => layout.boxes.find(b => 'text.' + b.id === id).md, ids.box))
      .toContain('kept');

    await page.frameLocator('#out').locator(`[data-el="${ids.table}"] td[data-cell="1,0"]`).dblclick();
    await page.waitForTimeout(500);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('WIC');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    expect(await page.evaluate(id => tableOf(id).rows[1][0], ids.table)).toBe('WIC');
  });
});

test.describe('⌘S saves', () => {
  test('with nothing to save it says so; while typing it keeps the words and saves', async ({ page }) => {
    const saves = [];
    page.on('request', r => { if (r.url().includes('/__save')) saves.push(r.url()); });
    await gotoEditor(page, '?project=uhero-trc-summary');
    await page.keyboard.press('ControlOrMeta+s');
    await page.waitForTimeout(500);
    expect(saves).toHaveLength(0);
    await expect(page.locator('#stat')).toContainText('nothing to save');

    await center(page, P);
    await clickWords(page, P);
    await page.keyboard.type('Zq');
    await page.keyboard.press('ControlOrMeta+s');      // from inside the words
    await expect.poll(() => saves.length, { timeout: 10000 }).toBe(1);
    expect(await page.evaluate(k => ({ editing, kept: readSlot(k).includes('Zq') }), SLOT))
      .toEqual({ editing: false, kept: true });
  });
});

test.describe('the menu actions that could not be undone', () => {
  test('Delete shape comes back on ⌘Z', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const id = await page.evaluate(async () =>
      (await docsync.api.addShape({ page: 2, kind: 'rect', x: 5, y: 1, w: 1.5, h: 1 })).id);
    await page.evaluate(i => $('out').contentDocument.querySelector(`[data-shape="${i}"]`)
      .scrollIntoView({ block: 'center' }), id);
    await rightClick(page, `[data-shape="${id}"]`);
    await menuItem(page, 'Delete shape').click();
    await page.waitForTimeout(800);
    expect(await page.evaluate(i => layout.shapes.some(s => s.id === i), id)).toBe(false);
    await page.evaluate(() => undo());
    await settled(page);
    expect(await page.evaluate(i => layout.shapes.some(s => s.id === i), id)).toBe(true);
  });

  test('Reset to its designed place comes back on ⌘Z', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await page.evaluate(async id => { await docsync.api.place(id, { x: 1, y: 3 }); }, P);
    await settled(page);
    const moved = await page.evaluate(id => JSON.stringify(layout.positions[id]), P);
    await center(page, P);
    await rightClick(page, `[data-el="${P}"]`);
    await menuItem(page, 'Reset to its designed place').click();
    await page.waitForTimeout(800);
    expect(await page.evaluate(id => layout.positions[id] || null, P)).toBeNull();
    await page.evaluate(() => undo());
    await settled(page);
    expect(await page.evaluate(id => JSON.stringify(layout.positions[id]), P)).toBe(moved);
  });
});

test.describe('right-click selects what it hits', () => {
  test('a paragraph right-clicked while a table is selected becomes the selection', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await center(page, P);
    await select(page, ['table.swaps']);
    await rightClick(page, `[data-el="${P}"]`);
    expect(await page.evaluate(() => [...selIds])).toEqual([P]);
    await expect(page.frameLocator('#out').locator('.ds-menu')).toBeVisible();
  });

  test('inside a selection of two, the selection stays', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await center(page, P);
    await select(page, [P, 'groc.h1']);
    await rightClick(page, `[data-el="${P}"]`);
    expect((await page.evaluate(() => [...selIds])).sort()).toEqual(['groc.h1', P].sort());
  });

  test('a table cell right-clicked selects its table', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await center(page, 'table.swaps');
    await select(page, [P]);
    await rightClick(page, '[data-el="table.swaps"] td[data-cell="1,0"]');
    expect(await page.evaluate(() => [...selIds])).toEqual(['table.swaps']);
    await expect(page.frameLocator('#out').locator('.ds-tmenu')).toBeVisible();
  });

  test('while typing, right-clicking another paragraph keeps the words and opens its menu', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await center(page, P);
    await clickWords(page, P);
    await page.keyboard.type('Zq');
    await rightClick(page, '[data-el="para.groc.pay.p"]');
    await page.waitForTimeout(500);
    expect(await page.evaluate(k => ({ editing, sel: [...selIds], kept: readSlot(k).includes('Zq') }), SLOT))
      .toEqual({ editing: false, sel: ['para.groc.pay.p'], kept: true });
    await expect(page.frameLocator('#out').locator('.ds-menu')).toBeVisible();
  });
});
