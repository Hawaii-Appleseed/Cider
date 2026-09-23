// Detachable content cards (render_report.card(detachable=True)). A designed
// tile whose title and bullets are laid out inside it by default but are their
// OWN movable objects (data-el + ds-detachable), grouped so the tile moves as
// one — until the user Ungroups and pulls a piece out. The text still comes
// from content.md. The fixture's Operating Budget card (page 5) is detachable.
// Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const TILE = 'card.spent.cards.operating.bullets';
const TITLE = 'spent.cards.operating.title';
const BULLETS = 'spent.cards.operating.bullets';

test.describe('detachable content card', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${TILE}"]`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  test('renders the tile, title and bullets as three hooked, grouped pieces', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await expect(frame.locator(`[data-el="${TILE}"]`)).toHaveCount(1);
    await expect(frame.locator(`[data-el="${TITLE}"]`)).toHaveClass(/ds-detachable/);
    await expect(frame.locator(`[data-el="${BULLETS}"]`)).toHaveClass(/ds-detachable/);
    // title text still comes from content.md (its slot lives inside)
    await expect(frame.locator(`[data-el="${TITLE}"] [data-slot="${TITLE}"]`)).toHaveCount(1);
    // grouped by default
    const grouped = await page.evaluate(([a, b]) =>
      (layout.groups || []).some(g => g.includes(a) && g.includes(b)), [TITLE, BULLETS]);
    expect(grouped).toBe(true);
  });

  test('clicking the tile selects the whole group of three', async ({ page }) => {
    const frame = page.frameLocator('#out');
    // click the tile background, below the bullets, not on a child element
    const box = await frame.locator(`[data-el="${TILE}"]`).boundingBox();
    const bul = await frame.locator(`[data-el="${BULLETS}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, bul.y + bul.height + (box.y + box.height - bul.y - bul.height) / 2);
    const sel = await page.evaluate(() => [...selIds]);
    expect(sel.sort()).toEqual([TILE, TITLE, BULLETS].sort());
    await expect(page.locator('#ar-count')).toHaveText(/group of 3/);
  });

  // The bug this pins: a group drag used to pin ALL THREE members absolute.
  // The pieces are DOM children of the tile, so the instant the tile itself
  // went absolute it became their containing block — their page-inch
  // coordinates re-based against the tile and the text landed displaced by
  // exactly the tile's own offset: clipped by the page, white words on the
  // white page. "Moving the key points box makes the text inside disappear."
  test('moving the INTACT group keeps the text riding inside the tile', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const tile0 = await frame.locator(`[data-el="${TILE}"]`).boundingBox();
    const bul0 = await frame.locator(`[data-el="${BULLETS}"]`).boundingBox();
    // select the whole group via the tile background, then drag from there
    const gx = tile0.x + tile0.width / 2, gy = bul0.y + bul0.height + 6;
    await page.mouse.click(gx, gy);
    expect(await page.evaluate(() => selIds.size)).toBe(3);
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + 70, gy + 51, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const inside = (piece, tile) =>
      piece.x >= tile.x - 8 && piece.y >= tile.y - 8
      && piece.x + piece.width <= tile.x + tile.width + 8
      && piece.y + piece.height <= tile.y + tile.height + 8;

    // live, straight after the drop: the card moved and its words came along
    let tb = await frame.locator(`[data-el="${TILE}"]`).boundingBox();
    let hb = await frame.locator(`[data-el="${TITLE}"]`).boundingBox();
    let bb = await frame.locator(`[data-el="${BULLETS}"]`).boundingBox();
    expect(tb.x - tile0.x).toBeGreaterThan(30);
    expect(inside(hb, tb)).toBe(true);
    expect(inside(bb, tb)).toBe(true);

    // only the tile is pinned — the pieces ride its flow, no data written
    const pins = await page.evaluate(([t, ti, bu]) =>
      [!!layout.positions[t], !!layout.positions[ti], !!layout.positions[bu]],
      [TILE, TITLE, BULLETS]);
    expect(pins).toEqual([true, false, false]);

    // and the renderer reproduces the same geometry from what was saved
    await page.evaluate(() => render());
    await page.waitForTimeout(1500);
    tb = await frame.locator(`[data-el="${TILE}"]`).boundingBox();
    hb = await frame.locator(`[data-el="${TITLE}"]`).boundingBox();
    bb = await frame.locator(`[data-el="${BULLETS}"]`).boundingBox();
    expect(inside(hb, tb)).toBe(true);
    expect(inside(bb, tb)).toBe(true);
  });

  // The frame must also hold for a piece moved ON ITS OWN inside a tile that
  // has already been moved: the drag thinks in page inches, but the piece's
  // left/top resolve against the positioned tile. Without the frame
  // correction the piece leapt away from the cursor by the tile's offset.
  test('a piece dragged inside an already-moved tile lands under the cursor and stays', async ({ page }) => {
    const frame = page.frameLocator('#out');
    // Ungroup FIRST, then move the TILE alone: its pieces stay in flow inside
    // a tile that is now positioned. (A piece that was itself pinned takes the
    // already-absolute delta path, which always worked — the hole was the
    // in-flow piece whose left/top will resolve against the moved tile.)
    const tile0 = await frame.locator(`[data-el="${TILE}"]`).boundingBox();
    const bul0 = await frame.locator(`[data-el="${BULLETS}"]`).boundingBox();
    const gx = tile0.x + tile0.width / 2, gy = bul0.y + bul0.height + 6;
    await page.mouse.click(gx, gy);
    await page.locator('#ar-ungroup').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.mouse.click(gx, gy);
    expect(await page.evaluate(() => [...selIds])).toEqual([TILE]);
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + 43, gy + 37, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    const t = frame.locator(`[data-el="${TITLE}"]`);
    // Shift-click: select the title WITHOUT opening its words (a plain click
    // types into them now), so the drag below grabs the object.
    await t.click({ modifiers: ['Shift'] });
    const t0 = await t.boundingBox();
    await page.mouse.move(t0.x + t0.width / 2, t0.y + t0.height / 2);
    await page.mouse.down();
    await page.mouse.move(t0.x + t0.width / 2 + 37, t0.y + t0.height / 2 + 83, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // it is where the cursor put it — not leapt away by the tile's offset
    let t1 = await t.boundingBox();
    expect(Math.abs(t1.x - (t0.x + 37))).toBeLessThan(25);
    expect(Math.abs(t1.y - (t0.y + 83))).toBeLessThan(25);

    // and the renderer rebuilds it in the same spot from the saved frame
    await page.evaluate(() => render());
    await page.waitForTimeout(1500);
    t1 = await t.boundingBox();
    expect(Math.abs(t1.x - (t0.x + 37))).toBeLessThan(25);
    expect(Math.abs(t1.y - (t0.y + 83))).toBeLessThan(25);
  });

  test('Ungroup lets the title be grabbed and moved on its own', async ({ page }) => {
    const frame = page.frameLocator('#out');
    // select the group via the tile, then ungroup
    const box = await frame.locator(`[data-el="${TILE}"]`).boundingBox();
    const bul = await frame.locator(`[data-el="${BULLETS}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, bul.y + bul.height + 6);
    await page.locator('#ar-ungroup').click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => layout.groups || null)).toBeFalsy();

    // now the title alone drags to its own position
    await page.keyboard.press('Escape');
    const t = frame.locator(`[data-el="${TITLE}"]`);
    // Shift-click: select the title WITHOUT opening its words (a plain click
    // types into them now), so the drag below grabs the object.
    await t.click({ modifiers: ['Shift'] });
    expect(await page.evaluate(() => [...selIds])).toEqual([TITLE]);
    const tb = await t.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2 + 40, tb.y + tb.height / 2 + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const pos = await page.evaluate(k => layout.positions[k], TITLE);
    expect(pos).toBeTruthy();
    expect(pos.y).toBeGreaterThan(0);   // moved down, out of the tile
  });
});
