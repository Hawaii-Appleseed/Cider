// Canva-style "Add text" presets (docsync/editor/edit.html): the Text button
// opens a popover offering Heading / Subheading / Body, each creating a text
// box pre-styled with the right size/weight. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('add text presets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the Text button opens a preset popover', async ({ page }) => {
    await page.click('#text');
    await expect(page.locator('#textpop')).toBeVisible();
    await expect(page.locator('#textpop .txtpreset')).toHaveCount(5);
  });

  test('"Add a heading" creates a large, bold text box', async ({ page }) => {
    await page.click('#text');
    await page.click('#textpop .txtpreset[data-k="heading"]');
    await page.frameLocator('#out').locator('.ds-textbox').first().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(600);

    const style = await page.evaluate(() => {
      const b = layout.boxes[layout.boxes.length - 1];
      return { md: b.md, size: b.style && b.style.size, weight: b.style && b.style.weight };
    });
    expect(style.md).toBe('Heading');
    expect(style.size).toBe(30);
    expect(style.weight).toBe(700);
    // Rendered large: the box's computed font-size reflects the preset.
    const fs = await page.frameLocator('#out').locator('.ds-textbox').last()
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThan(28);   // 30px at fit-scale, clearly heading-sized
  });

  test('"Add body text" creates a plain box with no heading style', async ({ page }) => {
    await page.click('#text');
    await page.click('#textpop .txtpreset[data-k="body"]');
    await page.frameLocator('#out').locator('.ds-textbox').first().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(600);
    const hasStyle = await page.evaluate(() => {
      const b = layout.boxes[layout.boxes.length - 1];
      return !!(b.style && Object.keys(b.style).length);
    });
    expect(hasStyle).toBe(false);
  });
});
