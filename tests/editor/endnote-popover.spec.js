// The report's own footnote card (#fnpop, report2027/web/primer.js) has to be
// usable INSIDE the editor: hover the marker, cross the gap, click the source
// link. deafenStickyChrome() used to silence it along with the report's sticky
// toolbar — every fixed child of <body> — so the pointer passed straight
// through the card and it read as "closes before I can reach it". Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const popState = (page) => page.evaluate(() => {
  const f = document.getElementById('out').contentDocument.querySelector('#fnpop');
  return { open: !f.hidden, pointer: getComputedStyle(f).pointerEvents };
});

test.describe('endnote popover', () => {
  test('is reachable, and stays open once the pointer is on it', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');
    const fn = frame.locator('a.fn').first();
    await fn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await fn.hover();
    await page.waitForTimeout(250);

    const pop = frame.locator('#fnpop');
    await expect(pop).toBeVisible();
    // The card must actually take the pointer — this is the whole bug.
    expect((await popState(page)).pointer).toBe('auto');

    const pb = await pop.boundingBox();
    // Dawdling in the gap between the marker and the card must not lose it:
    // the card is offset 8px from its marker and #fnpop's hover bridges
    // (primer.css) cover that, on top of a grace period long enough for a
    // hand that is not in a hurry.
    await page.mouse.move(pb.x + pb.width / 2, pb.y - 4, { steps: 3 });
    await page.waitForTimeout(1200);
    expect((await popState(page)).open).toBe(true);

    // and once on the card it stays put indefinitely, so the link is clickable
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 3 });
    await page.waitForTimeout(1500);
    expect((await popState(page)).open).toBe(true);
    await frame.locator('#fnpop .fn-cta').hover();
    await page.waitForTimeout(400);
    expect((await popState(page)).open).toBe(true);
    await expect(frame.locator('#fnpop .fn-cta')).toBeVisible();
  });

  test('the report’s standing sticky chrome is still deafened', async ({ page }) => {
    await gotoEditor(page);
    // Exempting HIDDEN fixed elements must not exempt the visible toolbar the
    // sweep exists for — charts.spec.js guards the consequence, this guards
    // the mechanism.
    const tb = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const el = d.querySelector('body > .toolbar');
      return el ? getComputedStyle(el).pointerEvents : 'absent';
    });
    expect(tb).toBe('none');
  });
});
