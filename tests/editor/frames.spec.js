// A card moves as one, and the words in it are still their own objects.
//
// Every painted card on tfc-2027-priorities (a family card, a bucket card, a
// tier row) used to have no handle: its fields moved, the card could not. A
// card handle on its own would have glued its fields to it — the editor
// treated any movable inside a movable as part of the outer one — trading one
// frozen thing for many. Now a container is an L.frame (⟦F⟧ in an imported
// page): a click on its words takes that field, a click on its padding takes
// the card, and a field already moved inside a card rides the card without
// leaping, because the frame is positioned from birth.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const CARD = '[data-el="frame.fam-1"]';
const FIELD = '[data-el="field.fam.h3-1"]';

/** A point on the page for `sel`: its middle, or `dx` px in from its left edge. */
const pointOf = (page, sel, dx = null) => page.evaluate(([sel, dx]) => {
  const fr = document.getElementById('out');
  const el = fr.contentDocument.querySelector(sel);
  el.scrollIntoView({ block: 'center' });
  const b = el.getBoundingClientRect(), fb = fr.getBoundingClientRect();
  const s = fb.width / fr.offsetWidth;
  const x = dx === null ? b.left + b.width / 2 : b.left + dx;
  return { x: fb.left + x * s, y: fb.top + (b.top + b.height / 2) * s };
}, [sel, dx]);

/** Where `inner` sits inside `outer`, in report px. */
const offsetIn = (page, inner, outer) => page.evaluate(([i, o]) => {
  const d = document.getElementById('out').contentDocument;
  const a = d.querySelector(i).getBoundingClientRect();
  const b = d.querySelector(o).getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top };
}, [inner, outer]);

async function drag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 3, from.y + dy / 3, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function shiftClick(page, at) {
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
}

test.describe('a card is a frame (tfc-2027-priorities)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, '?project=tfc-2027-priorities');
  });

  test('a click on words in a card takes the field; on its padding, the card', async ({ page }) => {
    await shiftClick(page, await pointOf(page, FIELD));
    expect(await page.evaluate(() => [...selIds])).toEqual(['field.fam.h3-1']);
    // A plain click: shift adds to the selection, and the padding has no
    // words to open, so a click there only selects.
    const pad = await pointOf(page, CARD, 4);
    await page.mouse.click(pad.x, pad.y);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => [...selIds])).toEqual(['frame.fam-1']);
    expect(await page.evaluate(() => editing)).toBe(false);
  });

  test('the card drags as one, and a field moved inside it rides along', async ({ page }) => {
    // Move the field first, then the card: the order that re-based the field
    // when a container only became positioned on its first drag.
    await drag(page, await pointOf(page, FIELD), 30, 20);
    expect(await page.evaluate(() => layout.positions['field.fam.h3-1'])).toBeTruthy();
    const before = await offsetIn(page, FIELD, CARD);
    await drag(page, await pointOf(page, CARD, 4), 0, 90);
    expect(await page.evaluate(() => layout.positions['frame.fam-1']), 'the card moved').toBeTruthy();
    const live = await offsetIn(page, FIELD, CARD);
    expect(Math.abs(live.x - before.x), 'x, live').toBeLessThanOrEqual(1.5);
    expect(Math.abs(live.y - before.y), 'y, live').toBeLessThanOrEqual(1.5);
    await page.evaluate(() => render());
    await page.waitForTimeout(400);
    const drawn = await offsetIn(page, FIELD, CARD);
    expect(Math.abs(drawn.x - before.x), 'x, rendered').toBeLessThanOrEqual(1.5);
    expect(Math.abs(drawn.y - before.y), 'y, rendered').toBeLessThanOrEqual(1.5);
  });
});
