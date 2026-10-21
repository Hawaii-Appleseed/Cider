// One click moves from the words being typed in one box into another
// (Devin, 2026-10-21: "it takes 2 clicks to click out of a content box into
// another one"). The press on the second box only blurred the first —
// dragify skipped every press while `editing` — so the click never landed.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const A = 'para.groc.lead', B = 'para.groc.pay.p';

async function clickWords(page, id) {
  const el = page.frameLocator('#out').locator(`[data-el="${id}"] [data-slot]`).first();
  const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width * 0.4, b.y + 8);
  await page.waitForTimeout(700);
}

const state = page => page.evaluate(() => ({
  editing, sel: [...selIds],
  open: richHost && (richHost.closest('[data-el]') || {}).dataset?.el,
}));

test.describe('one click from one box into another', () => {
  for (const typed of [false, true]) {
    test(`it lands in the second box${typed ? ', and keeps what was typed in the first' : ''}`, async ({ page }) => {
      await gotoEditor(page, '?project=uhero-trc-summary');
      await page.evaluate(id => $('out').contentDocument
        .querySelector(`[data-el="${id}"]`).scrollIntoView({ block: 'center' }), A);
      await page.waitForTimeout(300);
      await clickWords(page, A);
      expect(await state(page)).toEqual({ editing: true, sel: [A], open: A });
      if (typed) { await page.keyboard.type('Zq'); await page.waitForTimeout(200); }
      await clickWords(page, B);
      expect(await state(page)).toEqual({ editing: true, sel: [B], open: B });
      if (typed) expect(await page.evaluate(() => readSlot('groc.lead'))).toContain('Zq');
    });
  }

  test('a click on a chart while words are open selects the chart', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await page.evaluate(id => $('out').contentDocument
      .querySelector(`[data-el="${id}"]`).scrollIntoView({ block: 'center' }), A);
    await page.waitForTimeout(300);
    await clickWords(page, A);
    await page.frameLocator('#out').locator('[data-el="chart.decile"]').click();
    await page.waitForTimeout(700);
    expect(await state(page)).toEqual({ editing: false, sel: ['chart.decile'], open: null });
  });
});
