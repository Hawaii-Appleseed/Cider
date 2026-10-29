// ⌘Z after moving a text box whose words are open. A click on a box opens
// its words, so moving it by the grip or an edge with them open is common;
// ⌘Z then went to the field, which had nothing to undo, and the box stayed
// where it was dropped ("undoing a drag sometimes doesn't work",
// 2026-10-29). Local mode.
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

async function openBox(page, md = 'Drag me') {
  const r = await page.evaluate(md => docsync.api.addTextBox({ page: visiblePageId(), x: 1, y: 1.5, w: 3, md }), md);
  expect(r.ok).toBe(true);
  await settled(page);
  await page.evaluate(id => { const d = document.getElementById('out').contentDocument;
    const el = d.querySelector(`[data-el="${id}"]`); el.scrollIntoView({ block: 'center' });
    setSel(d, [id]); editBox(d, el); paintSel(d); }, r.id);
  await expect.poll(() => page.evaluate(() => editing), { timeout: 10_000 }).toBe(true);
  return r.id;
}
const at = (page, id) => page.evaluate(id => { const b = boxOf(id); return [b.x, b.y]; }, id);
const words = (page, id) => page.evaluate(id => boxOf(id).md, id);
async function dragGrip(page) {
  const g = await page.frameLocator('#out').locator('.ds-movegrip').boundingBox();
  const x = g.x + g.width / 2, y = g.y + g.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + 13 * i, y + 10 * i);
  await page.mouse.up(); await settled(page);
}

test.describe('⌘Z after a move with the words open', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('undoes the move', async ({ page }) => {
    const id = await openBox(page);
    const p0 = await at(page, id);
    await dragGrip(page);
    expect(await at(page, id)).not.toEqual(p0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => at(page, id), { timeout: 10_000 }).toEqual(p0);
  });

  test('words typed before the move survive its undo', async ({ page }) => {
    const id = await openBox(page);
    // The box opens with its words selected: this replaces them.
    await page.keyboard.type('Kept words');
    const p0 = await at(page, id);
    await dragGrip(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => at(page, id), { timeout: 10_000 }).toEqual(p0);
    expect(await words(page, id)).toBe('Kept words');
  });

  test('typing after the move gives ⌘Z back to the words', async ({ page }) => {
    const id = await openBox(page);
    await dragGrip(page);
    const moved = await at(page, id);
    await page.keyboard.type('x');
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(300);   // a native text undo has no render to wait on
    expect(await at(page, id)).toEqual(moved);
  });
});
