// Numbered lists past one block (INDESIGN_PARITY.md 55): a start number, a
// list that counts on across boxes, and sub-levels. The printed numbers were
// checked with real Chrome (2026-10-19: "1. one 2. two 2.1. two-a" then
// "3. three" in a second box); these hold the editor's half.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};
const ol = (page, id) => page.evaluate(i => {
  const el = $('out').contentDocument.querySelector(`[data-el="${CSS.escape(i)}"] ol`);
  return el && { start: el.getAttribute('start'), marker: getComputedStyle(el.querySelector('li'), '::marker').content };
}, id);

test.describe('55 numbered lists', () => {
  test('while typing in a box, ¶ opens Paragraph (the card shifts as the words close)', async ({ page }) => {
    // The press on ¶ ends the typing; the card swaps its B/I/U group for a
    // narrower one and everything right of it slides 116px left before the
    // button is released, so the click landed on the strip itself. Case,
    // colour, spacing, ¶, effects and reset were all dead while typing.
    await gotoEditor(page, '?project=my-report');
    const id = await page.evaluate(async () => (await docsync.api.addTextBox({ page: 1, x: 0.6, y: 3, w: 4, md: 'Alpha.\n\n1. one\n2. two' })).id);
    await page.evaluate(id => $('out').contentDocument.querySelector(`[data-el="${id}"]`).scrollIntoView({ block: 'center' }), id);
    await page.waitForTimeout(600);
    const fr = await page.locator('#out').boundingBox();
    const b = await page.evaluate(id => { const r = $('out').contentDocument.querySelector(`[data-el="${id}"]`).getBoundingClientRect(); return [r.left, r.top]; }, id);
    await page.mouse.click(fr.x + b[0] + 6, fr.y + b[1] + 6);
    await expect.poll(() => page.evaluate(() => editing)).toBe(true);
    await page.locator('#ty-parabtn').scrollIntoViewIfNeeded();
    const pb = await page.locator('#ty-parabtn').boundingBox();
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await expect(page.locator('#ty-parapop')).toBeVisible();
    await expect(page.locator('#ty-llev')).toBeVisible();
  });

  test('a list typed from 4. starts at 4, and editing it keeps the start', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, '4. four\n5. five');
    expect((await ol(page, id)).start).toBe('4');
    const md = await page.evaluate(i => listToMd($('out').contentDocument.querySelector(`[data-el="${CSS.escape(i)}"] ol`), 0), id);
    expect(md).toBe('4. four\n5. five');
  });

  test('Numbering continues: two boxes wearing one list name count as one list', async ({ page }) => {
    await gotoEditor(page);
    const a = await addBox(page, '1. one\n2. two');
    const b = await addBox(page, '1. three', { y: 5 });
    await page.evaluate(([a, b]) => { pushHistory(); boxOf(a).style = { list: { continue: 'recs' } };
      boxOf(b).style = { list: { continue: 'recs' } }; markDirty(); return render(); }, [a, b]);
    for (const id of [a, b]) expect((await ol(page, id)).marker).toContain('counter(ds-lc-recs');
    // The panel field reads and writes it.
    await page.evaluate(i => docsync.api.select(i), a);
    await page.evaluate(() => fillParaPop(selected));
    await expect(page.locator('#ty-lcont')).toHaveValue('recs');
    await page.evaluate(() => { $('ty-lcont').value = ''; $('ty-lcont').dispatchEvent(new Event('change')); });
    await expect.poll(() => page.evaluate(i => (boxOf(i).style || {}).list || null, a)).toBe(null);
  });

  test('Sub-levels nested numbers a sub-list 1.1', async ({ page }) => {
    await gotoEditor(page);
    const a = await addBox(page, '1. one\n  1. one-a');
    await page.evaluate(a => { pushHistory(); boxOf(a).style = { list: { levels: 'nested' } }; markDirty(); return render(); }, a);
    const m = await page.evaluate(i => getComputedStyle($('out').contentDocument
      .querySelector(`[data-el="${CSS.escape(i)}"] ol ol li`), '::marker').content, a);
    expect(m).toContain('counters(list-item');
  });
});
