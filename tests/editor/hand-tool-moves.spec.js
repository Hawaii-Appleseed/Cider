// The Hand tool moves items (Devin, 2026-11-19: "the hand tool should move
// items"). With the Hand tool a drag that starts on an unlocked item is the
// Select tool's own drag (snapping, guides, undo, collab); a drag on empty
// page still pans; a locked item (or one in a locked layer) pans instead of
// moving. Space-drag stays a pure pan. docsync/editor/edit.html: handGrabs,
// wirePan, typeOnClick.
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const PROJ = '?project=blank-document';

/** Put one text box on the (empty) page and return its id and a screen point on it. */
async function boxOnPage(page) {
  const r = await page.evaluate(() => docsync.api.addTextBox({ page: 1, x: 1, y: 1, w: 3, md: 'Move me' }));
  expect(r.ok, r.error).not.toBe(false);
  await settled(page);
  return page.evaluate(() => layout.boxes[layout.boxes.length - 1].id);
}
const boxPos = (page, id) => page.evaluate(i => {
  const b = layout.boxes.find(x => x.id === i);
  return { x: b.x, y: b.y };
}, id);
/** Screen centre of the box, after scrolling it into view. */
async function centreOf(page, id) {
  await page.evaluate(i => {
    const el = $('out').contentDocument.querySelector(`[data-el="text.${i}"]`);
    el.scrollIntoView({ block: 'center' });
  }, id);
  await settled(page);
  return page.evaluate(i => {
    const el = $('out').contentDocument.querySelector(`[data-el="text.${i}"]`);
    const r = el.getBoundingClientRect(), f = $('out').getBoundingClientRect();
    return { x: f.x + r.left + Math.min(r.width / 2, 30), y: f.y + r.top + r.height / 2 };
  }, id);
}
/** A screen point on the sheet with nothing placed on it. */
const emptySpot = page => page.evaluate(() => {
  const d = $('out').contentDocument, pg = d.querySelector('section.page'), r = pg.getBoundingClientRect();
  const f = $('out').getBoundingClientRect();
  const taken = [...pg.querySelectorAll('[data-el], [data-slot]')].map(e => e.getBoundingClientRect());
  for (let y = Math.max(r.top, 0) + 40; y < Math.min(r.bottom, innerHeight) - 40; y += 24)
    for (let x = r.left + 40; x < r.right - 40; x += 24)
      if (!taken.some(b => x > b.left - 8 && x < b.right + 8 && y > b.top - 8 && y < b.bottom + 8))
        return { x: f.x + x, y: f.y + y };
  return null;
});
const scrollY = page => page.evaluate(() => $('out').contentWindow.scrollY);
async function drag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await settled(page);
}

test.describe('the Hand tool moves items', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, PROJ); });
  test.afterEach(async ({ page }) => { await page.evaluate(() => setTool('select', true)).catch(() => {}); });

  test('a drag on an item moves it, and one undo puts it back', async ({ page }) => {
    const id = await boxOnPage(page);
    const p0 = await boxPos(page, id);
    await page.click('#tool-hand');
    const at = await centreOf(page, id);
    const y0 = await scrollY(page);
    await drag(page, at, 60, 40);
    const p1 = await boxPos(page, id);
    expect(p1.x).toBeGreaterThan(p0.x + 0.2);
    expect(p1.y).toBeGreaterThan(p0.y + 0.1);
    expect(await scrollY(page), 'moving an item does not pan').toBe(y0);
    expect(await page.evaluate(() => [...selIds])).toEqual(['text.' + id]);
    await page.evaluate(() => docsync.api.undo());
    await settled(page);
    expect(await boxPos(page, id)).toEqual(p0);
  });

  test('a plain click selects the item and does not open its words', async ({ page }) => {
    const id = await boxOnPage(page);
    await page.click('#tool-hand');
    const at = await centreOf(page, id);
    await page.mouse.click(at.x, at.y);
    await settled(page);
    expect(await page.evaluate(() => [...selIds])).toEqual(['text.' + id]);
    expect(await page.evaluate(() => editing)).toBe(false);
  });

  test('a drag on empty page pans and moves nothing', async ({ page }) => {
    const id = await boxOnPage(page);
    const p0 = await boxPos(page, id);
    await page.click('#tool-hand');
    const spot = await emptySpot(page);
    test.skip(!spot, 'no empty spot on this page');
    const y0 = await scrollY(page);
    await drag(page, spot, 0, -150);
    expect(await scrollY(page)).toBeGreaterThan(y0 + 50);
    expect(await boxPos(page, id)).toEqual(p0);
    expect(await page.evaluate(() => selIds.size)).toBe(0);
  });

  test('a locked item pans instead of moving', async ({ page }) => {
    const id = await boxOnPage(page);
    await page.evaluate(i => { layout.locked = ['text.' + i]; render(); }, id);
    await settled(page);
    const p0 = await boxPos(page, id);
    await page.click('#tool-hand');
    const at = await centreOf(page, id);
    const y0 = await scrollY(page);
    await drag(page, at, 0, -150);
    expect(await boxPos(page, id)).toEqual(p0);
    expect(await scrollY(page), 'the drag panned').toBeGreaterThan(y0 + 50);
  });

  test('Space-drag over an item is a pure pan, whatever the tool', async ({ page }) => {
    const id = await boxOnPage(page);
    const p0 = await boxPos(page, id);
    const at = await centreOf(page, id);
    const y0 = await scrollY(page);
    await page.evaluate(() => $('out').contentWindow.focus());
    await page.keyboard.down('Space');
    await drag(page, at, 0, -150);
    await page.keyboard.up('Space');
    expect(await boxPos(page, id)).toEqual(p0);
    expect(await scrollY(page)).toBeGreaterThan(y0 + 50);
  });

  test('the tool says what it does', async ({ page }) => {
    await expect(page.locator('#tool-hand')).toHaveAttribute('data-tip', /drag items to move them.*pan/);
    await page.click('#tool-hand');
    await expect(page.locator('#stat')).toContainText('drag items to move them');
  });
});
