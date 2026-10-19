// A renderer's table is a real table object (layout.json `tables`, "flow":
// true), drawn in the page's own flow by L.flow_table, and the editor works on
// it exactly as on a placed one: cells edit in place, and the right-click menu
// adds and deletes rows and columns. The UHERO TRC summary's Table 1 was once
// div+CSS-grid, which is why a column of it could not be deleted here.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('flow tables', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
  });

  test('a renderer table is a real, selectable table with cell hooks', async ({ page }) => {
    const tbl = page.frameLocator('#out').locator('table.ds-flow[data-el="table.swaps"]');
    await tbl.scrollIntoViewIfNeeded();
    await expect(tbl.locator('th')).toHaveCount(2);
    await expect(tbl.locator('td[data-cell="1,0"]')).toHaveText('No GET on groceries');
    await expect(page.evaluate(() => layout.tables.find(t => t.id === 'swaps').flow)).resolves.toBe(true);
  });

  test('a column can be deleted from it in the editor', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const tbl = frame.locator('table.ds-flow[data-el="table.swaps"]');
    await tbl.scrollIntoViewIfNeeded();
    await tbl.locator('th[data-cell="0,1"]').click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Delete column' }).click();
    await expect(page.evaluate(() =>
      layout.tables.find(t => t.id === 'swaps').rows.every(r => r.length === 1))).resolves.toBe(true);
    await expect(frame.locator('table.ds-flow[data-el="table.swaps"] th')).toHaveCount(1);
  });

  test('a row can be added, and it stays a flow table', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const tbl = frame.locator('table.ds-flow[data-el="table.swaps"]');
    await tbl.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => layout.tables.find(t => t.id === 'swaps').rows.length);
    await tbl.locator('td[data-cell="1,0"]').click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Add row' }).click();
    await expect(page.evaluate(() =>
      layout.tables.find(t => t.id === 'swaps').rows.length)).resolves.toBe(before + 1);
    await expect(frame.locator('table.ds-flow[data-el="table.swaps"]')).toHaveCount(1);
  });
});
