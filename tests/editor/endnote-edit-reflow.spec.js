// Opening prose for editing must not move the words. edit() replaces the
// rendered block with a contenteditable host ONE FOR ONE for exactly this
// reason (see the comment at blocks[0].replaceWith(host)) — but a citation
// broke the promise: the rendered marker is a <sup>, which reports neutralise
// with `sup { line-height: 0 }` so a raised superscript adds nothing to the
// line box, while the edit-mode chip was a <span> that rule could never reach.
// It inherited the paragraph's full line-height, vertical-align:super lifted
// it, and the line box grew ~4px. Every line carrying a citation stepped down
// the moment you clicked into it.
//
// The chip is a <sup> now, so whatever the report says about superscripts
// applies to it too. That has to stay a TAG choice, never hardcoded metrics:
// `sup { font-size: 11px }` is report2027's own stylesheet, and every report
// styles its superscripts differently.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

// The first slot whose rendered prose carries a citation marker.
async function citedSlot(page) {
  return page.evaluate(() => {
    const d = $('out').contentDocument;
    const el = [...d.querySelectorAll('[data-slot]')].find(e => e.querySelector('sup'));
    return el ? el.dataset.slot : null;
  });
}

const heightOf = (page, key) => page.evaluate(k => {
  const d = $('out').contentDocument;
  // While editing, the block has been replaced by the .ds-edit host.
  const chip = d.querySelector('.ds-fnchip');
  const el = (chip && chip.closest('.ds-edit')) || d.querySelector(`[data-slot="${k}"]`);
  return +el.getBoundingClientRect().height.toFixed(2);
}, key);

test.describe('editing prose that carries an endnote', () => {
  test('the paragraph keeps its exact rendered height', async ({ page }) => {
    await gotoEditor(page);
    const key = await citedSlot(page);
    expect(key, 'the fixture still has a cited paragraph').toBeTruthy();

    const rendered = await heightOf(page, key);
    await page.evaluate(k => edit($('out').contentDocument, k), key);
    await page.waitForTimeout(600);
    const editing = await heightOf(page, key);

    // Sub-pixel tolerance only. The bug was +4.03px.
    expect(Math.abs(editing - rendered)).toBeLessThan(0.5);
  });

  test('the chip inherits the report\'s own superscript metrics', async ({ page }) => {
    await gotoEditor(page);
    const key = await citedSlot(page);
    await page.evaluate(k => edit($('out').contentDocument, k), key);
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      const d = $('out').contentDocument;
      const chip = d.querySelector('.ds-fnchip');
      // What a bare <sup> computes to in THIS document — the report's rule,
      // whatever it happens to be, not a number this test knows.
      const probe = d.createElement('sup');
      chip.parentNode.appendChild(probe);
      const ref = getComputedStyle(probe), got = getComputedStyle(chip);
      const out = { tag: chip.tagName, refLh: ref.lineHeight, gotLh: got.lineHeight,
                    refFs: ref.fontSize, gotFs: got.fontSize };
      probe.remove();
      return out;
    });
    expect(m.tag).toBe('SUP');
    expect(m.gotLh).toBe(m.refLh);
    expect(m.gotFs).toBe(m.refFs);
  });

  test('the chip still round-trips back to its [^id] token', async ({ page }) => {
    await gotoEditor(page);
    const key = await citedSlot(page);
    const before = await page.evaluate(k => readSlot(k), key);
    await page.evaluate(k => edit($('out').contentDocument, k), key);
    await page.waitForTimeout(600);
    // Blur is what commits — the same path a click elsewhere takes.
    await page.evaluate(() => richHost.blur());
    await page.waitForTimeout(900);
    expect(await page.evaluate(k => readSlot(k), key)).toBe(before);
  });
});
