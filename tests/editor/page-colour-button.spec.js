// The bottom bar's colour swatch must open the colour panel for a SELECTED
// PAGE, not just a selected object.
//
// pageBar() (wired from paintSel) already shows #ar-fill for a page selection
// and labels it "Page colour" — the affordance is there. But its click
// handler read selEls(d), which is built from selIds (the object-selection
// set) and is always empty while a page is selected (setSelPage clears
// selIds; the two selections are one state, never both). So the button did
// nothing: `els.length !== 1` returned before openColorPanel ever ran, and
// nothing on screen told you why a visibly-enabled swatch was inert.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

async function bareSpot(page) {
  const pt = await page.evaluate(() => {
    const out = document.getElementById('out');
    const r = out.getBoundingClientRect();
    const d = out.contentDocument;
    const sc = r.width / out.offsetWidth;
    for (const pg of d.querySelectorAll('section.page')) {
      const pr = pg.getBoundingClientRect();
      if (pr.bottom < 0 || pr.top > d.defaultView.innerHeight) continue;
      for (let y = pr.bottom - 24; y > pr.top + 24; y -= 10) {
        for (let x = pr.right - 24; x > pr.left + 24; x -= 20) {
          if (y < 0 || y > d.defaultView.innerHeight) continue;
          if (hitPlaced(d, pg, { clientX: x, clientY: y })) continue;
          const el = d.elementFromPoint(x, y);
          if (!el || el.closest('a, button, input, .ds-menu')) continue;
          return { x: r.left + x * sc, y: r.top + y * sc };
        }
      }
    }
    return null;
  });
  if (!pt) throw new Error('no bare spot on any visible page');
  return pt;
}

test.describe('the colour swatch with a page selected', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(900);
  });

  test('opens the colour panel for the page, not for nothing', async ({ page }) => {
    const pt = await bareSpot(page);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(400);

    const pid = await page.evaluate(() => selPage);
    expect(pid).not.toBeNull();
    await expect(page.locator('#ar-fill')).toBeVisible();

    await page.click('#ar-fill');
    await page.waitForTimeout(300);

    await expect(page.locator('#side')).toBeVisible();
    await expect(page.locator('#side-title')).toHaveText('Color');
    // Not just any panel — one actually pointed at THIS page's fill.
    expect(await page.evaluate(() => sideFillId)).toBe(await page.evaluate(
      pid => 'page.' + pid, pid));
  });

  test('a swatch pick actually recolours the selected page', async ({ page }) => {
    const pt = await bareSpot(page);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(400);
    const pid = await page.evaluate(() => selPage);

    await page.click('#ar-fill');
    await page.waitForTimeout(300);
    await page.locator('#side-body .cdot[title$="#E23B3B"]').first().click();
    await page.waitForTimeout(900);

    const fill = await page.evaluate(pid => (layout.fill || {})['page.' + pid], pid);
    expect(fill).toBe('#E23B3B');
  });
});
