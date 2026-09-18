// Find & Change. There was no way to find a word in a report at all — a dozen
// pages of slots read through by eye, and "Fiscal Year 2026" becoming
// "FY2026" a manual pass. Words live in three places (content.md slots, a
// text box's own `md`, a table's cells) and a find that missed one of them
// would be worse than none.
//
// Everything works on the AUTHORED text, not the rendered HTML, because that
// is what a replace has to write back.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

test('⌘F opens it, and a word is found where it actually lives',
  async ({ page }) => {
    await gotoEditor(page);
    await page.keyboard.press('Meta+f');
    await page.waitForTimeout(600);
    await expect(page.locator('#side-title')).toHaveText('Find & Change');

    // A word the primer certainly contains.
    await page.locator('#find-needle').fill('budget');
    await page.waitForTimeout(700);
    const hits = await page.evaluate(() => findState.hits.length);
    expect(hits).toBeGreaterThan(3);
    // Grouped by where they are: "12 hits" is only useful if you can see
    // which slot each is in before changing all of them.
    expect(await page.locator('#find-list .find-group').count()).toBeGreaterThan(1);
    expect(await page.locator('#find-list mark').first().innerText())
      .toMatch(/budget/i);
  });

test('case and whole-word narrow it', async ({ page }) => {
  await gotoEditor(page);
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(600);
  await page.locator('#find-needle').fill('budget');
  await page.waitForTimeout(700);
  const loose = await page.evaluate(() => findState.hits.length);

  await page.locator('.find-opt:has-text("Match case") input').check();
  await page.waitForTimeout(500);
  const cased = await page.evaluate(() => findState.hits.length);
  expect(cased).toBeLessThan(loose);            // "Budget" drops out
  expect(await page.evaluate(() => findState.hits.every(h => h.hit === 'budget')))
    .toBe(true);

  // Whole words: "budgets" and "budgeting" stop counting.
  await page.locator('.find-opt:has-text("Match case") input').uncheck();
  await page.waitForTimeout(400);
  await page.locator('#find-needle').fill('budge');
  await page.waitForTimeout(700);
  const partial = await page.evaluate(() => findState.hits.length);
  expect(partial).toBeGreaterThan(0);
  await page.locator('.find-opt:has-text("Whole words") input').check();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => findState.hits.length)).toBeLessThan(partial);
});

test('Change all rewrites every hit as one undo step', async ({ page }) => {
  await gotoEditor(page);
  // A text box, so the change lands somewhere this spec fully controls and
  // does not depend on the fixture's prose.
  await page.evaluate(() => docsync.api.addTextBox(
    { page: 1, x: 1, y: 1, w: 3, md: 'Fiscal Year 2026 and Fiscal Year 2026' }));
  await page.waitForTimeout(1800);
  const id = await page.evaluate(() => layout.boxes[layout.boxes.length - 1].id);

  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(600);
  await page.locator('#find-needle').fill('Fiscal Year 2026');
  await page.locator('#find-repl').fill('FY2026');
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => findState.hits.length)).toBeGreaterThanOrEqual(2);

  await page.click('#find-all');
  await page.waitForTimeout(2200);
  expect(await page.evaluate(i => layout.boxes.find(b => b.id === i).md, id))
    .toBe('FY2026 and FY2026');
  // One undo step for the whole change — a find/replace that took forty undos
  // to back out would not be one anybody trusted.
  await page.evaluate(() => undo());
  await page.waitForTimeout(1800);
  expect(await page.evaluate(i => layout.boxes.find(b => b.id === i).md, id))
    .toBe('Fiscal Year 2026 and Fiscal Year 2026');
});

test('a table cell is searched too', async ({ page }) => {
  await gotoEditor(page);
  await page.evaluate(() => {
    layout.tables = layout.tables || [];
    layout.tables.push({ id: 'zz-find', page: 1, x: 1, y: 6, w: 3,
      rows: [['Widget', 'Sprocket'], ['Widget', '3']] });
  });
  await page.evaluate(() => render());
  await page.waitForTimeout(1800);
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(600);
  await page.locator('#find-needle').fill('Sprocket');
  await page.waitForTimeout(700);
  // Found, and named by its cell rather than just by the table.
  expect(await page.evaluate(() => findState.hits.map(h => h.target.label)))
    .toContain('zz-find r1c2');
  await page.locator('#find-repl').fill('Cog');
  await page.click('#find-all');
  await page.waitForTimeout(2200);
  expect(await page.evaluate(() =>
    layout.tables.find(t => t.id === 'zz-find').rows[0][1])).toBe('Cog');
});
