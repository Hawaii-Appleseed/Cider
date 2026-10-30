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

  test('undoes a resize made with the words open', async ({ page }) => {
    const id = await openBox(page);
    const w0 = await page.evaluate(id => boxOf(id).w, id);
    const h = await page.frameLocator('#out').locator('.ds-h-e').boundingBox();
    const x = h.x + h.width / 2, y = h.y + h.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x - 12 * i, y);
    await page.mouse.up(); await settled(page);
    expect(await page.evaluate(id => boxOf(id).w, id)).toBeLessThan(w0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => page.evaluate(id => boxOf(id).w, id), { timeout: 10_000 }).toBeCloseTo(w0, 2);
  });
});

test.describe('⌘Z with the words open, on a designed field in a section', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, '?project=uhero-trc-summary'); });
  const place = (page, id) => page.evaluate(id => JSON.stringify(layout.positions[id] || null), id);
  async function openField(page, id) {
    await page.evaluate(id => { const d = document.getElementById('out').contentDocument;
      const el = d.querySelector(`[data-el="${id}"]`); el.scrollIntoView({ block: 'center' });
      const slot = el.matches('[data-slot]') ? el : el.querySelector('[data-slot]');
      setSel(d, [id]); edit(d, slot.dataset.slot, slot); paintSel(d); }, id);
    await expect.poll(() => page.evaluate(() => editing), { timeout: 10_000 }).toBe(true);
  }
  async function dragAt(page, x, y, dx, dy) {
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + dx * i / 6, y + dy * i / 6);
    await page.mouse.up(); await settled(page);
  }

  test('a move by the edge band is undone', async ({ page }) => {
    const id = 'para.rec.p';
    await openField(page, id);
    const p0 = await place(page, id);
    // The band's left end: clear of the north resize handle in the middle.
    const b = await page.frameLocator('#out').locator('.ds-moveedge-n').boundingBox();
    await dragAt(page, b.x + 30, b.y + b.height / 2, 60, 40);
    expect(await place(page, id)).not.toBe(p0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => place(page, id), { timeout: 10_000 }).toBe(p0);
  });

  test('a resize by a handle is undone', async ({ page }) => {
    const id = 'para.rec.p';
    await openField(page, id);
    const p0 = await place(page, id);
    const h = await page.frameLocator('#out').locator('.ds-h-e').boundingBox();
    await dragAt(page, h.x + h.width / 2, h.y + h.height / 2, -80, 0);
    expect(await place(page, id)).not.toBe(p0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => place(page, id), { timeout: 10_000 }).toBe(p0);
  });
});
