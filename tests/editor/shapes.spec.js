// Shape creation, fill, and duplicate (docsync/editor/edit.html). A new shape
// is a SOLID visible object (sage), recolourable from the toolbar Fill control
// — not a near-invisible pale outline. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

async function addShape(page, kind) {
  await page.click('#shape');
  await page.click(`#shapepop .shp[data-k="${kind}"]`);
  // Shape creation renders through Pyodide; wait for the SVG node to land.
  await page.frameLocator('#out').locator(`[data-shape]`).first().waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(800);
}

test.describe('shapes', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('a new rectangle is a solid, visibly-filled shape (not an outline)', async ({ page }) => {
    await addShape(page, 'rect');
    const rect = page.frameLocator('#out').locator('rect[data-shape]').first();
    await expect(rect).toHaveAttribute('fill', '#6B9E78');   // sage, not near-white #E8EDE6
    await expect(rect).toHaveAttribute('stroke', 'none');
  });

  test('the Fill control appears for a selected shape and recolours it', async ({ page }) => {
    await addShape(page, 'rect');
    // Creating selects the shape, so the arrange row + Fill button are live.
    await expect(page.locator('#ar-fill')).toBeVisible();

    // Fill opens the left panel now — colour outgrew a popover.
    await page.click('#ar-fill');
    await expect(page.locator('#side')).toBeVisible();
    const swatch = page.locator('#side-body .cgrid .cdot[title^="#"]').first();
    const chosen = (await swatch.getAttribute('title')).toLowerCase();
    await swatch.click();
    await page.waitForTimeout(900);

    const rect = page.frameLocator('#out').locator('rect[data-shape]').first();
    await expect(rect).toHaveAttribute('fill', new RegExp(chosen, 'i'));
  });

  test('duplicate creates a second shape', async ({ page }) => {
    await addShape(page, 'rect');
    const shapes = page.frameLocator('#out').locator('[data-shape]');
    await expect(shapes).toHaveCount(1);

    await expect(page.locator('#ar-dup')).toBeEnabled();
    await page.click('#ar-dup');
    await expect(shapes).toHaveCount(2);
    await expect(page.locator('#stat')).toContainText('duplicated');
  });

  test('a line is created as a stroked line, not a filled box', async ({ page }) => {
    await addShape(page, 'line');
    const line = page.frameLocator('#out').locator('line[data-shape]').first();
    await expect(line).toHaveAttribute('fill', 'none');
    await expect(line).toHaveAttribute('stroke', '#52796F');
  });
});
