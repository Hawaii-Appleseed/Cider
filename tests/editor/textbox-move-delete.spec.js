// A section in hand moves from anywhere on it, and an open text box can be
// deleted without first leaving its words. Reported 2026-10-29: "it's hard
// to actually drag and drop text boxes", and the mini toolbar with Delete
// was "finicky" to get, because a click on a box opens its words and the
// toolbar never shows while they are open. Local mode.
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const frameOf = page => page.frameLocator('#out');

/** Select the recommendation panel and return a point on its words that the
 *  page really answers with them. Under parallel load the sheet can still be
 *  settling after a scroll, so measure, check the hit, and try again. */
async function holdRec(page) {
  const box = frameOf(page).locator('[data-el="rec.box"]');
  const words = box.locator('[data-slot]').last();
  for (let i = 0; i < 5; i++) {
    await box.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);   // the scroll's own settle, not a render
    await page.evaluate(() => setSel(document.getElementById('out').contentDocument, ['rec.box']));
    await settled(page);
    const wb = await words.boundingBox();
    const fb = await page.locator('#out').boundingBox();
    if (!wb || !fb) continue;
    const x = wb.x + wb.width / 2, y = wb.y + Math.min(wb.height / 2, 12);
    const ok = await page.evaluate(([fx, fy]) => {
      const d = document.getElementById('out').contentDocument;
      const t = d.elementFromPoint(fx, fy);
      return !!t && !!t.closest('[data-el="rec.box"]') && selIds.has('rec.box');
    }, [x - fb.x, y - fb.y]);
    if (ok) return { words, x, y };
  }
  throw new Error('could not get a clean point on rec.box');
}

test.describe('a held section moves from its words', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
  });

  test('a drag that starts on the words of a selected section moves the section', async ({ page }) => {
    const { words, x, y } = await holdRec(page);
    const y0 = await page.evaluate(() => (layout.positions['rec.box'] || {}).y ?? null);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + 10 * i);
    await page.mouse.up();
    await settled(page);
    const st = await page.evaluate(() => layout.positions['rec.box'] || null);
    expect(st).not.toBeNull();
    if (y0 != null) expect(st.y).toBeGreaterThan(y0);
    expect(await page.evaluate(() => editing)).toBe(false);
    // The words themselves did not come loose from the section.
    const inner = await words.evaluate(el => el.closest('[data-el]').dataset.el);
    expect(await page.evaluate(id => !!layout.positions[id], inner)).toBe(inner === 'rec.box');
  });

  test('a click (no travel) on those words still opens them', async ({ page }) => {
    const { x, y } = await holdRec(page);
    await page.mouse.click(x, y);
    await expect.poll(() => page.evaluate(() => editing), { timeout: 10_000 }).toBe(true);
    expect(await page.evaluate(() => layout.positions['rec.box'] || null)).toBeNull();
  });
});

test.describe('deleting an open text box', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  async function openNewBox(page) {
    const r = await page.evaluate(() => docsync.api.addTextBox({ page: visiblePageId(), x: 1, y: 2, w: 3, md: 'Delete me' }));
    expect(r.ok).toBe(true);
    await settled(page);
    const el = frameOf(page).locator(`[data-el="${r.id}"]`);
    await page.evaluate(id => { const d = document.getElementById('out').contentDocument;
      setSel(d, [id]); editBox(d, d.querySelector(`[data-el="${id}"]`)); paintSel(d); }, r.id);
    await expect.poll(() => page.evaluate(() => editing), { timeout: 10_000 }).toBe(true);
    await expect(el).toHaveCount(1);
    return r.id;
  }
  const exists = (page, id) => page.evaluate(id => !!boxOf(id), id);

  test('the delete grip beside an open box deletes it, and ⌘Z brings it back', async ({ page }) => {
    const id = await openNewBox(page);
    const grip = frameOf(page).locator('.ds-delgrip');
    await expect(grip).toHaveCount(1);
    await grip.click();
    await expect.poll(() => exists(page, id), { timeout: 10_000 }).toBe(false);
    expect(await page.evaluate(() => editing)).toBe(false);
    await page.evaluate(() => undo());
    await settled(page);
    expect(await exists(page, id)).toBe(true);
  });

  test('the open box’s right-click menu has Delete text box', async ({ page }) => {
    const id = await openNewBox(page);
    await frameOf(page).locator('.ds-edit').click({ button: 'right' });
    const item = frameOf(page).locator('.ds-menu button', { hasText: 'Delete text box' });
    await expect(item).toHaveCount(1);
    await item.click();
    await expect.poll(() => exists(page, id), { timeout: 10_000 }).toBe(false);
  });

  test('a designed field has no delete grip', async ({ page }) => {
    // Opened as a click would (edit + paintSel), not by a click: what is
    // under test is which grips an open designed field gets.
    await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const el = d.querySelector('[data-el="basics.h1"]');
      const slot = el.matches('[data-slot]') ? el : el.querySelector('[data-slot]');
      setSel(d, ['basics.h1']); edit(d, slot.dataset.slot, slot); paintSel(d);
    });
    await expect.poll(() => page.evaluate(() => editing), { timeout: 10_000 }).toBe(true);
    await expect(frameOf(page).locator('.ds-movegrip')).toHaveCount(1);
    await expect(frameOf(page).locator('.ds-delgrip')).toHaveCount(0);
  });
});

test.describe('a thin thing resized stays thin', () => {
  // The resize floor was 0.4in on BOTH axes, whichever handle moved: a thin
  // vertical bar dragged by its top or bottom went 0.4in wide, and a
  // one-line heading grew to 0.4in tall over the paragraph under it.
  async function dragHandle(page, handle, dx, dy) {
    const hb = await frameOf(page).locator(`.ds-h-${handle}`).boundingBox();
    const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + dx * i / 6, y + dy * i / 6);
    await page.mouse.up();
    await settled(page);
  }

  test('a thin vertical bar shortened from its bottom keeps its width', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => docsync.api.addShape({ page: visiblePageId(), kind: 'rect',
      x: 2, y: 1, w: 0.3, h: 1.5, fill: '#1E6194' }));
    expect(r.ok).toBe(true);
    await settled(page);
    await frameOf(page).locator(`[data-shape="${r.id}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);   // the scroll's own settle, not a render
    await page.evaluate(id => { const d = document.getElementById('out').contentDocument;
      setSel(d, [id]); paintSel(d); }, r.id);
    await frameOf(page).locator('.ds-h-s').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);   // the scroll's own settle, not a render
    await dragHandle(page, 's', 0, -60);
    const sh = await page.evaluate(id => layout.shapes.find(s => s.id === id), r.id);
    expect(sh.w).toBeCloseTo(0.3, 2);
    expect(sh.h).toBeLessThan(1.5);
  });

  test('a one-line heading dragged shorter does not grow', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const h = frameOf(page).locator('[data-el="rec.h"]');
    await h.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);   // the scroll's own settle, not a render
    await page.evaluate(() => { const d = document.getElementById('out').contentDocument;
      setSel(d, ['rec.h']); paintSel(d); });
    await settled(page);
    const before = (await h.boundingBox()).height;
    await dragHandle(page, 's', 0, -30);
    const after = (await frameOf(page).locator('[data-el="rec.h"]').boundingBox()).height;
    expect(after).toBeLessThanOrEqual(before + 1);
    expect(await page.evaluate(() => (layout.positions['rec.h'] || {}).h ?? null)).toBeNull();
  });
});
