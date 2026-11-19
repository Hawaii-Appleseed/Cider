// Character settings on the SELECTED words (INDESIGN_PARITY.md 90, the
// control-bar plan's phase 5). Pins: with words selected in an open text,
// the bar's size, leading and tracking write a run — `[words]{size=18 …}` —
// and not the box; the words stay open while the field is used, and the
// selection comes back; kerning at a caret is a one-character run (the pair
// kern InDesign makes); a run inside a named character style nests the one
// way the engine reads; a size under the floor is refused. The engine's half
// (content.py's CHAR_RUN_RE) is in test_docsync.py. Local mode.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

async function openBox(page, md) {
  const id = await page.evaluate(async m =>
    (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 5, md: m })).id, md);
  await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
  await settled(page);
  await page.click('#cb-mode [data-m="char"]');
  await page.frameLocator('#out').locator(`[data-el="${id}"]`).click();
  const host = page.frameLocator('#out').locator('.ds-edit');
  await host.waitFor({ state: 'visible' });
  return { id, host };
}
/** The selection over characters [from, to) of the open text. */
async function selectChars(page, from, to) {
  await page.evaluate(({ from, to }) => {
    const d = document.querySelector('#out').contentDocument;
    const host = d.querySelector('.ds-edit');
    const w = d.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let seen = 0; const r = d.createRange(); let s = false;
    while (w.nextNode()) {
      const n = w.currentNode, len = n.nodeValue.length;
      if (!s && from <= seen + len) { r.setStart(n, from - seen); s = true; }
      if (to <= seen + len) { r.setEnd(n, to - seen); break; }
      seen += len;
    }
    host.focus();
    const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, { from, to });
}
const md = page => page.evaluate(() =>
  htmlToMd(document.querySelector('#out').contentDocument.querySelector('.ds-edit'), { allowLists: true }));
// A press into the field, as a person makes it: the press is what holds the
// words open (fill() alone focuses with no press, and the words would close).
const setField = async (page, id, v) => {
  await page.locator(id).click();
  await page.locator(id).fill(v);
  await page.locator(id).press('Enter');
};

test.describe('character settings on selected words', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('size, leading and tracking on the selection are a run, and the words stay open', async ({ page }) => {
    const { id, host } = await openBox(page, 'Alpha beta gamma');
    await selectChars(page, 6, 10);                       // "beta"
    await setField(page, '#cb-size', '18');
    await expect(host.locator('span.ds-cr')).toHaveAttribute('data-cr', 'size=18');
    await expect(host).toBeVisible();                     // still typing
    expect(await md(page)).toBe('Alpha [beta]{size=18} gamma');
    // The selection came back: the next field acts on the same words.
    await setField(page, '#cb-track', '50');
    await setField(page, '#cb-lead', '24');
    await expect(host.locator('span.ds-cr')).toHaveAttribute('data-cr', 'size=18 lead=24 track=50');
    expect(await host.locator('span.ds-cr').count()).toBe(1);
    // The box itself did not change.
    expect(await page.evaluate(i => (styleOf(i) || {}).size ?? null, id)).toBe(null);
    // Leave the words: the file holds the run, and the page draws it.
    await page.waitForTimeout(50);                        // the field's let-go is a setTimeout 0
    await host.press('Escape');
    await settled(page);
    expect(await page.evaluate(i => boxOf(i).md, id.replace(/^text\./, '')))
      .toBe('Alpha [beta]{size=18 lead=24 track=50} gamma');
    const run = page.frameLocator('#out').locator(`[data-el="${id}"] span.ds-cr`);
    await expect(run).toHaveText('beta');
    expect(await run.evaluate(e => getComputedStyle(e).fontSize)).toBe('24px');
    // Reading the run back: the bar shows its values with the caret in it.
    await page.frameLocator('#out').locator(`[data-el="${id}"]`).click();
    await host.waitFor({ state: 'visible' });
    await selectChars(page, 7, 8);
    await expect(page.locator('#cb-size')).toHaveValue('18');
    await expect(page.locator('#cb-track')).toHaveValue('50');
  });

  test('the pickers act on the selection too: font, weight, case, small caps, strike, shift, colour', async ({ page }) => {
    const { id, host } = await openBox(page, 'Alpha beta gamma');
    // A pick from a list, as a person makes it: the press holds the words.
    const pick = async (sel, v) => {
      await page.waitForTimeout(50);                     // the last control's let-go
      await page.locator(sel).click();
      await page.locator(sel).selectOption(v);
    };
    await selectChars(page, 6, 10);                       // "beta"
    await pick('#ty-font', 'Lora');
    expect(await md(page)).toBe('Alpha [beta]{font="Lora"} gamma');
    await expect(host).toBeVisible();                     // still typing
    await pick('#ty-weight', '700');
    await pick('#ty-case', 'upper');
    await pick('#cb-smcp', 'small');
    await page.waitForTimeout(50);
    await page.locator('#cb-strike').click();
    await setField(page, '#cb-shift', '3');
    expect(await md(page)).toBe('Alpha [beta]{font="Lora" weight=700 case=upper smcp=small strike=1 shift=3} gamma');
    // Colour from the pop: the words, not the box.
    await page.waitForTimeout(50);
    await page.locator('#ty-colorbtn').click();
    const sw = page.locator('#ty-swgrid .sw[data-c]').first();
    const c = await sw.getAttribute('data-c');
    await sw.click();
    expect(await md(page)).toBe(`Alpha [beta]{font="Lora" weight=700 color=${c} case=upper smcp=small strike=1 shift=3} gamma`);
    expect(await host.locator('span.ds-cr').count()).toBe(1);
    // The box itself did not change.
    expect(await page.evaluate(i => { const s = styleOf(i) || {};
      return [s.font, s.weight, s.color, s.case, s.smallCaps, s.strike, s.shift].filter(x => x != null).length; }, id)).toBe(0);
    // Strike again takes it off.
    await page.waitForTimeout(50);
    await selectChars(page, 6, 10);
    await page.locator('#cb-strike').click();
    expect(await md(page)).toBe(`Alpha [beta]{font="Lora" weight=700 color=${c} case=upper smcp=small shift=3} gamma`);
    // Leave the words: the page draws the run.
    await page.waitForTimeout(50);
    await host.press('Escape');
    await settled(page);
    const run = page.frameLocator('#out').locator(`[data-el="${id}"] span.ds-cr`);
    const cs = await run.evaluate(e => { const s = getComputedStyle(e);
      return { fam: s.fontFamily, w: s.fontWeight, tt: s.textTransform, caps: s.fontVariantCaps }; });
    expect(cs.fam).toContain('Lora');
    expect(cs).toMatchObject({ w: '700', tt: 'uppercase', caps: 'small-caps' });
    // The caret in the run: the pickers read it; outside it, the box again.
    await page.frameLocator('#out').locator(`[data-el="${id}"]`).click();
    await host.waitFor({ state: 'visible' });
    await selectChars(page, 7, 8);
    await expect(page.locator('#ty-font')).toHaveValue('Lora');
    await expect(page.locator('#ty-weight')).toHaveValue('700');
    await expect(page.locator('#ty-case')).toHaveValue('upper');
    await selectChars(page, 1, 2);
    await expect(page.locator('#ty-font')).not.toHaveValue('Lora');
    await expect(page.locator('#ty-case')).toHaveValue('none');
  });

  test('with only a caret, a picker still sets the box', async ({ page }) => {
    const { id } = await openBox(page, 'Alpha beta gamma');
    await selectChars(page, 3, 3);
    await page.locator('#ty-font').click();
    await page.locator('#ty-font').selectOption('Lora');
    await settled(page);
    expect(await page.evaluate(i => (styleOf(i) || {}).font, id)).toBe('Lora');
    expect(await page.evaluate(i => boxOf(i).md, id.replace(/^text\./, ''))).toBe('Alpha beta gamma');
  });

  test('kerning at a caret is the pair either side of it; a selection takes it across', async ({ page }) => {
    const { id, host } = await openBox(page, 'AVATAR');
    await selectChars(page, 1, 1);                        // between A and V
    await setField(page, '#cb-kern', '-80');
    expect(await md(page)).toBe('[A]{kern=-80}VATAR');
    // Kern and tracking add up on the same run, as in InDesign.
    await page.waitForTimeout(50);
    await selectChars(page, 0, 1);
    await setField(page, '#cb-track', '20');
    expect(await md(page)).toBe('[A]{track=20 kern=-80}VATAR');
    const ls = await host.locator('span.ds-cr').evaluate(e => getComputedStyle(e).letterSpacing);
    expect(parseFloat(ls)).toBeLessThan(0);
    // Clearing kerning (0) leaves the tracking.
    await page.waitForTimeout(50);
    await selectChars(page, 1, 1);
    await setField(page, '#cb-kern', '0');
    expect(await md(page)).toBe('[A]{track=20}VATAR');
    expect(await page.evaluate(i => (styleOf(i) || {}).tracking ?? null, id)).toBe(null);
  });

  test('inside a named style the run nests the way the engine reads; under the floor is refused', async ({ page }) => {
    await page.evaluate(() => { layout.textStyles = { ...(layout.textStyles || {}), Accent: { color: '#C0392B' } }; });
    const { id, host } = await openBox(page, '[Pull words here]{.Accent} and more');
    await selectChars(page, 5, 10);                       // "words"
    await setField(page, '#cb-size', '14');
    expect(await md(page)).toBe('[Pull [words]{size=14} here]{.Accent} and more');
    // A selection across the style's edge: a run inside it, and one beside it.
    await page.waitForTimeout(50);
    await selectChars(page, 11, 19);                      // "here and"
    await setField(page, '#cb-track', '40');
    expect(await md(page)).toBe('[Pull [words]{size=14} [here]{track=40}]{.Accent} [and]{track=40} more');
    // 6pt: refused, nothing written.
    await page.waitForTimeout(50);
    await selectChars(page, 0, 4);
    await setField(page, '#cb-size', '6');
    await expect(page.locator('#stat')).toHaveText(/under the 7.875pt floor/);
    expect(await md(page)).toBe('[Pull [words]{size=14} [here]{track=40}]{.Accent} [and]{track=40} more');
    await page.waitForTimeout(50);
    await host.press('Escape');
    await settled(page);
    const page3 = page.frameLocator('#out').locator(`[data-el="${id}"]`);
    await expect(page3.locator('span.ds-cs > span.ds-cr')).toHaveCount(2);
  });
});
