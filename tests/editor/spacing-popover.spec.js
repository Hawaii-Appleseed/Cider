// The Spacing popover on the text toolbar (docsync/editor/edit.html
// #ty-spacepop). Its two rows are a slider plus a number box, and with no
// override set BOTH used to read as nothing: the box was blank and the
// letter-spacing slider was parked at a hardcoded 0 regardless of what the
// text actually rendered. So a heading tracked at 0.5px opened claiming 0,
// and the first nudge jumped it. Now both start from the rendered value, the
// same rule the size stepper already followed.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

// What the popover shows for a slot, read straight off the controls.
async function spacing(page, key) {
  await page.evaluate(k => showType(k), key);
  return page.evaluate(() => ({
    trackBox: $('ty-track').placeholder, trackSlider: $('ty-track-r').value,
    leadBox: $('ty-lead').placeholder, leadSlider: $('ty-lead-r').value,
  }));
}

test.describe('spacing popover', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('untouched body text names its own spacing instead of showing blanks', async ({ page }) => {
    const s = await spacing(page, 'whopays.p1');
    // The rendered paragraph: no extra tracking, 21.75px leading on 14.5px type.
    expect(s.trackBox).toBe('0');
    expect(s.leadBox).toBe('1.5');
    expect(+s.leadSlider).toBeCloseTo(1.5, 2);
  });

  test('the letter-spacing slider starts where the text actually is, not at 0',
    async ({ page }) => {
      // This heading is tracked in the report's own stylesheet. The slider used
      // to sit at 0 for it — the bug this file exists for.
      const s = await spacing(page, 'basics.h1');
      const real = await page.evaluate(() => parseFloat(
        getComputedStyle($('out').contentDocument
          .querySelector('[data-slot="basics.h1"]')).letterSpacing));
      expect(real).toBeGreaterThan(0);          // guard: the fixture still tracks it
      expect(+s.trackSlider).toBeCloseTo(real, 2);
      expect(s.trackBox).toBe(String(real));
    });

  test('once set, the number box holds the real value, not a placeholder', async ({ page }) => {
    await page.evaluate(() => showType('whopays.p1'));
    await page.click('#ty-spacebtn');
    await page.locator('#ty-lead-r').fill('1.9');
    await page.locator('#ty-lead-r').dispatchEvent('input');
    await page.locator('#ty-lead-r').dispatchEvent('change');
    await page.waitForTimeout(900);
    expect(await page.locator('#ty-lead').inputValue()).toBe('1.9');
    expect(await page.evaluate(() => styleOf('whopays.p1').leading)).toBeCloseTo(1.9, 5);
  });
});
