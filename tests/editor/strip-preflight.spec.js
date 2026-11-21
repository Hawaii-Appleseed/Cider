// Two things that got in the way of everyday work, on the Wealth Tax Report.
//
// The page strip floats over the foot of the canvas and its chips take
// clicks, so a right-click menu's last rows (and a selected box's bottom
// handles, a note card, the words being typed) sat under it and a click meant
// for them picked a page. While such a thing reaches under the strip, the
// strip now slides away, and it comes back when nothing does.
//
// Preflight listed internal ids ("text.tpl-photo, text.tpl-logo") with no
// page, and a finding that is fine on purpose (the cover photo behind the
// title) could not be quieted, so the badge never cleared. Rows now say the
// page and what the thing is, and Ignore keeps a finding listed but uncounted,
// saved in the report.
const { test, expect, gotoEditor, clickTool, settled } = require('./fixtures/editor-test');

const Q = '?project=wealth-tax-report';
const count = page => page.evaluate(() => $('pf-count').hidden ? 0 : +$('pf-count').textContent);

test.describe('page strip steps aside', () => {
  test('a menu opened near the foot of the window: the strip goes, its last row takes the click, the strip comes back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoEditor(page, Q);
    await expect(page.locator('#rail')).toBeVisible();
    await expect(page.locator('#rail')).not.toHaveClass(/yield/);
    const railTop = await page.locator('#rail').evaluate(el => el.getBoundingClientRect().top);
    // Right-click a page close to the strip's top edge (the frame is 1:1 at
    // this width only by luck, so aim in the window's coordinates).
    const fr = await page.locator('#out').boundingBox();
    await page.mouse.click(fr.x + fr.width / 2, railTop - 30, { button: 'right' });
    const menu = page.frameLocator('#out').locator('.ds-menu').first();
    await expect(menu).toBeVisible();
    await expect(page.locator('#rail')).toHaveClass(/yield/);
    // And it STAYS away: measured from where it was drawn, a slid-away strip
    // found nothing under it and came back, on and off, four times a second.
    await page.waitForTimeout(1000);   // four of stripYield's 250 ms checks
    await expect(page.locator('#rail')).toHaveClass(/yield/);
    // The menu reaches under where the strip was, and the window hands a click
    // at the menu's foot to the report, not to a page chip. (A long menu
    // scrolls inside itself, so its foot is the box's, not its last row's.)
    const hit = await page.evaluate(() => {
      const f = $('out'), m = f.contentDocument.querySelector('.ds-menu');
      const b = m.getBoundingClientRect();
      const fr = f.getBoundingClientRect(), k = fr.width / f.offsetWidth;
      const y = fr.top + (b.bottom - 8) * k;
      const el = document.elementFromPoint(fr.left + (b.left + 20) * k, y);
      return { y, top: $('rail').getBoundingClientRect().top, el: el && (el.id || el.className) };
    });
    expect(hit.y).toBeGreaterThan(railTop);   // where the strip rests, measured before
    expect(hit.el).toBe('out');
    await page.keyboard.press('Escape');
    await page.mouse.click(fr.x + 20, fr.y + 200);   // the canvas's grey, away from any page
    await expect(page.frameLocator('#out').locator('.ds-menu')).toHaveCount(0);
    await expect(page.locator('#rail')).not.toHaveClass(/yield/);
  });
});

test.describe('preflight reads like a list for people', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, Q); });

  test('rows name the page and the thing, never an internal id', async ({ page }) => {
    await expect.poll(() => count(page)).toBeGreaterThan(0);
    await clickTool(page, 'preflight');
    const whats = await page.locator('#pf-list .pf-what').allTextContents();
    expect(whats.length).toBeGreaterThan(0);
    for (const w of whats) {
      expect(w).toMatch(/^Page \S+/);
      expect(w).not.toMatch(/\b(text|shape|table)\.[\w-]+/);
    }
    // The id is still there for anyone who wants it, on hover.
    expect(await page.locator('#pf-list .pf-what').first().getAttribute('title')).toMatch(/\./);
  });

  test('Ignore keeps a finding listed but uncounted, saved in the report; undo brings it back', async ({ page }) => {
    await expect.poll(() => count(page)).toBeGreaterThan(0);
    const n0 = await count(page);
    await clickTool(page, 'preflight');
    const row = page.locator('#pf-list > .pf-row').first();
    const what = await row.locator('.pf-what').textContent();
    await row.hover();
    await row.locator('.pf-ig').click();
    await settled(page);
    await expect.poll(() => count(page)).toBe(n0 - 1);
    expect(await page.evaluate(() => layout.preflight.ignore.length)).toBe(1);
    const off = page.locator('#pf-list .pf-off');
    await expect(off.locator('summary')).toHaveText('Ignored · 1');
    await expect(off.locator('.pf-what')).toHaveText(what);
    // Still ignored after an unrelated edit re-renders the report.
    await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2, md: 'Another box.' }));
    expect((await page.evaluate(() => docsync.api.preflight())).ignored).toBe(1);
    await page.evaluate(() => undo());   // the text box
    await page.evaluate(() => undo());   // the ignore
    await settled(page);
    expect(await page.evaluate(() => !!layout.preflight)).toBe(false);
    await expect.poll(() => count(page)).toBe(n0);
  });
});
