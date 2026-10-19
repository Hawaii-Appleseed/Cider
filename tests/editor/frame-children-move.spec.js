// A section carries what is in it, but the things in it are their own
// objects, and the section moves only when you mean it to.
//
// Reported on the UHERO summary's cover (2026-10-18): its masthead, title,
// rule and deck sit in one slate band (an L.frame), and "I can't move the top
// text boxes without simultaneously moving the entire section they're in."
// The band took the gesture four ways:
//   - hover ringed the band whenever the pointer was on anything in it
//     (:hover matches every ancestor), so the band read as the thing in hand;
//   - its pieces with no words (the rule) were glued to it — a press on one
//     dragged the whole band;
//   - a press on the band's own surface dragged it at once, and on a cover
//     band that runs edge to edge that is every press that misses the words;
//   - a rubber band that touched it took it, and with it everything inside,
//     so the text boxes could never be banded on their own.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const FIELD = '[data-el="cover.field"]';
const TITLE = '[data-el="cover.h1"]';
const RULE = '[data-el="cover.rule"]';

/** Screen coordinates of a point on `sel`: (fx, fy) of its box, or on its
 *  words (the slot inside it) when fx is null. */
const pointOf = (page, sel, fx = null, fy = 0.5, dx = 0, dy = 0) => page.evaluate(
  ([sel, fx, fy, dx, dy]) => {
    const fr = document.getElementById('out');
    const el = fr.contentDocument.querySelector(sel);
    const t = fx === null ? (el.querySelector('[data-slot]') || el) : el;
    const b = t.getBoundingClientRect(), fb = fr.getBoundingClientRect();
    const s = fb.width / fr.offsetWidth;
    const x = b.left + (fx === null ? Math.min(b.width / 2, 40) : b.width * fx) + dx;
    const y = b.top + b.height * fy + dy;
    return { x: fb.left + x * s, y: fb.top + y * s };
  }, [sel, fx, fy, dx, dy]);

/** Where an element is on its page, in report px. */
const boxOf = (page, sel) => page.evaluate(sel => {
  const d = document.getElementById('out').contentDocument;
  const pg = d.querySelector('section.page').getBoundingClientRect();
  const b = d.querySelector(sel).getBoundingClientRect();
  return { x: b.left - pg.left, y: b.top - pg.top };
}, sel);

const outline = (page, sel) => page.evaluate(sel => {
  const d = document.getElementById('out').contentDocument;
  return d.defaultView.getComputedStyle(d.querySelector(sel)).outlineStyle;
}, sel);

const selected = page => page.evaluate(() => [...selIds].sort());
const placed = page => page.evaluate(() => Object.keys(layout.positions).sort());

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x * 2 + to.x) / 3, (from.y * 2 + to.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}
const by = (p, dx, dy) => ({ x: p.x + dx, y: p.y + dy });

test.describe('a section and the things in it (uhero-trc-summary cover)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    await page.evaluate(() => document.getElementById('out').contentDocument
      .querySelector('section.page').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  });

  test('pointing at words in a section rings those words, not the section', async ({ page }) => {
    const words = await pointOf(page, TITLE);
    await page.mouse.move(words.x, words.y);
    await page.waitForTimeout(150);
    expect(await outline(page, TITLE)).toBe('dashed');
    expect(await outline(page, FIELD), 'the section is not what a press here takes').toBe('none');
    // On the section's own surface, the section is what is under the pointer.
    const surface = await pointOf(page, FIELD, 0.96, 0.5);
    await page.mouse.move(surface.x, surface.y);
    await page.waitForTimeout(150);
    expect(await outline(page, FIELD)).toBe('dashed');
  });

  test('a piece of a section with no words of its own moves on its own', async ({ page }) => {
    const field = await boxOf(page, FIELD);
    const at = await pointOf(page, RULE, 0.5, 0.5);
    await drag(page, at, by(at, 40, 30));
    expect(await placed(page)).toEqual(['cover.rule']);
    expect(await boxOf(page, FIELD), 'the section stayed put').toEqual(field);
  });

  test('a drag across a section\'s surface bands what it crosses and moves nothing', async ({ page }) => {
    const field = await boxOf(page, FIELD);
    // From the band's empty top-right corner to just past the title's left
    // edge, short of its last line: brand, stamp and title, not the deck.
    const from = await pointOf(page, FIELD, 0.98, 0.03);
    const to = await pointOf(page, TITLE, 0, 0.8, -8);
    await drag(page, from, to);
    expect(await placed(page), 'nothing moved').toEqual([]);
    expect(await boxOf(page, FIELD)).toEqual(field);
    expect(await selected(page)).toEqual(['cover.brand', 'cover.h1', 'cover.pill']);
  });

  test('a click on a section\'s surface selects it, and then it drags with what is in it', async ({ page }) => {
    const surface = await pointOf(page, FIELD, 0.96, 0.5);
    await page.mouse.click(surface.x, surface.y);
    await page.waitForTimeout(250);
    expect(await selected(page)).toEqual(['cover.field']);
    const field = await boxOf(page, FIELD);
    const title = await boxOf(page, TITLE);
    await drag(page, surface, by(surface, 0, 24));
    expect(await placed(page)).toEqual(['cover.field']);
    const f2 = await boxOf(page, FIELD), t2 = await boxOf(page, TITLE);
    expect(f2.y - field.y, 'the section moved').toBeGreaterThan(10);
    expect(Math.abs((t2.y - f2.y) - (title.y - field.y)), 'the title rode along').toBeLessThanOrEqual(1.5);
  });

  test('a band from outside a section that reaches into it takes the pieces, not the section', async ({ page }) => {
    // Start in the page's empty left margin just under the band and pull up
    // over the title: the band crosses the section without taking all of it.
    const from = await pointOf(page, FIELD, 0, 1, 12, 14);
    const to = await pointOf(page, TITLE, 0.5, 0.4);
    await drag(page, from, to);
    expect(await placed(page), 'nothing moved').toEqual([]);
    const sel = await selected(page);
    expect(sel).not.toContain('cover.field');
    expect(sel).toEqual(expect.arrayContaining(['cover.h1', 'cover.rule', 'para.cover.deck']));
  });
});
