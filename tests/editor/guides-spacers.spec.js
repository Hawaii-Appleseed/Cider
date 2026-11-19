// Guides and spacers, as a person uses them (real pointer throughout): pulling a
// guide out of a ruler shows where it is and snaps to the page's centre, edges,
// margins and other guides; a guide has a hover state and a cursor, thickens
// under the pointer, and goes by Delete, a right-click, a drag back onto the
// ruler or View ▸ Clear all guides; a double-click on a ruler adds one at that
// tick and on a guide retypes it; View shows, hides, locks and clears them; and
// a guide is out of the way while words are open or the Type tool is picked.
// Spacers go in from the Insert palette and from a right-click, say what gap
// they hold, and are not content (never published or printed).
// GUIDE_SHOTS=<dir> also saves a screenshot of each step.
const fs = require('fs');
const path = require('path');
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const SHOTS = process.env.GUIDE_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};

async function setup(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoEditor(page);
  await page.evaluate(() => { if (!guidesOn) toggleGuides(); setZoom('1'); });
  await page.evaluate(() => $('out').contentDocument.querySelector('section.page[data-page="3"]').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
}
/** Window coordinates of page 3's inch (x, y). */
const win = (page, x, y) => page.evaluate(([X, Y]) => {
  const out = $('out'), or = out.getBoundingClientRect(), sc = or.width / out.offsetWidth;
  const pg = out.contentDocument.querySelector('section.page[data-page="3"]');
  const r = pg.getBoundingClientRect(), px = DPI * zoomOf(pg);
  return { x: or.left + (r.left + X * px) * sc, y: or.top + (r.top + Y * px) * sc };
}, [x, y]);
const guides = page => page.evaluate(() => JSON.parse(JSON.stringify(layout.guides || {})));
const tip = page => page.evaluate(() => { const t = $('guide-tip'); return t.hidden ? null : t.textContent; });
const rulerTop = page => page.evaluate(() => { const r = $('ruler-t').getBoundingClientRect(); return { x: r.left + 300, y: r.top + 9 }; });
const rulerLeft = page => page.evaluate(() => { const r = $('ruler-l').getBoundingClientRect(); return { x: r.left + 9, y: r.top + 300 }; });
/** Pull a guide out of the top ruler to page-inch y, optionally holding Alt; return the readout seen while still held. */
async function pullDown(page, y, { alt = false, x = 4 } = {}) {
  const from = await rulerTop(page), to = await win(page, x, y);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y - 30, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  const seen = await tip(page);
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  return seen;
}
/** Pull a guide out of the LEFT ruler to page-inch x (a vertical guide). */
async function pullAcross(page, x, { alt = false, y = 4 } = {}) {
  const from = await rulerLeft(page), to = await win(page, x, y);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x - 30, to.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  const seen = await tip(page);
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  return seen;
}
const frame = page => page.frameLocator('#out');
const p3 = page => frame(page).locator('section.page[data-page="3"]');

test.describe('guides', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('pulling one out shows where it is, and snaps to the page centre; Alt turns that off', async ({ page }) => {
    // 5.5in is the middle of the page; 0.03in off it lands there, and the readout says so
    const seen = await pullDown(page, 5.53);
    expect(seen).toMatch(/^5\.5 in · centre$/);
    expect((await guides(page)).y).toEqual([5.5]);
    expect(await tip(page)).toBeNull();                              // let go: the readout goes
    await shot(page, 'guide-snapped');
    await page.evaluate(() => { setGuides([], []); drawGuideLayer($('out').contentDocument); });
    // Alt held: it goes where the pointer is
    const free = await pullDown(page, 5.53, { alt: true });
    expect(free).toMatch(/^5\.5[2-4] in$/);
    const ys = (await guides(page)).y;
    expect(ys.length).toBe(1);
    expect(ys[0]).not.toBe(5.5);
  });

  test('it snaps to the page edge, the margins and another guide, and names each', async ({ page }) => {
    expect(await pullAcross(page, 0.03)).toMatch(/^0 in · page edge$/);
    await page.evaluate(() => { setGuides([], []); setMargins({ left: 0.75, right: 0.75, top: 0.75, bottom: 0.75, columns: 1, gutter: 0.25 });
                                drawGuideLayer($('out').contentDocument); });
    expect(await pullAcross(page, 0.78)).toMatch(/^0\.75 in · margin$/);
    await page.evaluate(() => { setGuides([3], []); drawGuideLayer($('out').contentDocument); });
    // a second guide near the one at 3in lands on it (and so is not a second one)
    expect(await pullAcross(page, 3.04)).toMatch(/^3 in · guide$/);
    await page.evaluate(() => setMargins(null));
  });

  test('hovering a guide says where it is and thickens it, with the cursor of what it does', async ({ page }) => {
    await page.evaluate(() => { setGuides([2], [3]); drawGuideLayer($('out').contentDocument); });
    const at = await win(page, 6, 3);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(100);
    expect(await tip(page)).toMatch(/^3 in · drag to move/);
    const css = await p3(page).locator('.ds-gd.h').evaluate(e => ({ cur: getComputedStyle(e).cursor, bg: getComputedStyle(e).backgroundSize }));
    expect(css.cur).toBe('row-resize');
    expect(css.bg).toMatch(/100% 3px/);                              // 3px under the pointer, 1px at rest
    expect(await p3(page).locator('.ds-gd.v').evaluate(e => getComputedStyle(e).cursor)).toBe('col-resize');
    await shot(page, 'guide-hover');
    const away = await win(page, 6, 4.5);
    await page.mouse.move(away.x, away.y);
    expect(await tip(page)).toBeNull();
  });

  test('five ways to take one away: Delete, right-click, back onto the ruler, Clear all, undo', async ({ page }) => {
    await page.evaluate(() => { setGuides([2, 5], [3, 4]); drawGuideLayer($('out').contentDocument); });
    // click then Delete
    const a = await win(page, 6, 4);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.press('Delete');
    expect((await guides(page)).y).toEqual([3]);
    // right-click ▸ Delete guide
    const b = await win(page, 6, 3);
    await page.mouse.click(b.x, b.y, { button: 'right' });
    await shot(page, 'guide-menu');
    await expect(frame(page).locator('.ds-menu-head')).toHaveText('Horizontal guide · 3 in');
    await frame(page).locator('.ds-menu button', { hasText: 'Delete guide' }).click();
    expect((await guides(page)).y).toBeUndefined();
    // drag back onto the left ruler
    const c = await win(page, 5, 3.5);
    const rl = await rulerLeft(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 40, c.y, { steps: 3 });
    await page.mouse.move(rl.x, rl.y, { steps: 8 });
    expect(await tip(page)).toMatch(/release to delete/);
    await page.mouse.up();
    expect((await guides(page)).x).toEqual([2]);
    // View ▸ Clear all guides, and ⌘Z brings them back
    await page.evaluate(() => { setGuides([1, 2], [3]); drawGuideLayer($('out').contentDocument); });
    await page.click('#view'); await page.click('#guideclear');
    expect(await guides(page)).toEqual({});
    await page.evaluate(() => undo());
    expect((await guides(page)).x).toEqual([1, 2]);
  });

  test('a double-click on a ruler adds a guide at that tick; on a guide it types a new place', async ({ page }) => {
    const top = await page.evaluate(() => { const r = $('ruler-t').getBoundingClientRect(); return r; });
    const at4 = await win(page, 4, 1);
    await page.mouse.dblclick(at4.x, top.top + 9);
    const xs = (await guides(page)).x;
    expect(xs.length).toBe(1);
    expect(xs[0]).toBeCloseTo(4, 1);
    // on the left ruler: a horizontal guide at that distance down the page
    const left = await page.evaluate(() => $('ruler-l').getBoundingClientRect());
    const at7 = await win(page, 1, 7);
    const vis = await page.evaluate(() => $('stage').getBoundingClientRect().bottom);
    if (at7.y < vis - 120) {
      await page.mouse.dblclick(left.left + 9, at7.y);
      expect(((await guides(page)).y || [])[0]).toBeCloseTo(7, 1);
    }
    // double-click the vertical guide: a dialog, typed
    const g = await win(page, xs[0], 2);
    await page.mouse.dblclick(g.x, g.y);
    const dlg = page.locator('dialog.dsdlg');
    await expect(dlg).toBeVisible();
    await dlg.locator('input[name="at"]').fill('2.5');
    await shot(page, 'guide-move-dialog');
    await dlg.locator('.dsdlg-ok').click();
    expect((await guides(page)).x).toEqual([2.5]);
  });

  test('View: show, lock, add at a typed place, clear; and they are remembered', async ({ page }) => {
    await page.click('#view'); await page.click('#guideadd');
    const dlg = page.locator('dialog.dsdlg');
    await dlg.locator('select[name="axis"]').selectOption('h');
    await dlg.locator('input[name="at"]').fill('4.25');
    await dlg.locator('.dsdlg-ok').click();
    expect((await guides(page)).y).toEqual([4.25]);
    await expect(p3(page).locator('.ds-gd.h')).toBeAttached();
    // an out-of-range place is refused with words
    await page.click('#view'); await page.click('#guideadd');
    await dlg.locator('input[name="at"]').fill('40');
    await dlg.locator('.dsdlg-ok').click();
    await expect(dlg.locator('.dsdlg-err')).toContainText('from 0 to');
    await dlg.locator('.dsdlg-cancel, [value="cancel"], button[type="button"]').first().click();
    // hide, show
    await page.click('#view'); await page.click('#guideshow');
    expect(await frame(page).locator('.ds-gd').count()).toBe(0);
    expect(await page.evaluate(() => guidesOn)).toBe(true);           // the rulers stay
    await page.click('#view');
    expect(await page.evaluate(() => $('guideshow').classList.contains('on'))).toBe(false);
    await page.click('#guideshow');
    expect(await frame(page).locator('.ds-gd').count()).toBeGreaterThan(0);
    // lock: it takes no press
    await page.click('#view'); await page.click('#guidelock');
    expect(await p3(page).locator('.ds-gd.h').evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
    await page.click('#view'); await page.click('#guidelock');
    expect(await p3(page).locator('.ds-gd.h').evaluate(e => getComputedStyle(e).pointerEvents)).not.toBe('none');
    // remembered
    await page.click('#view'); await page.click('#guideshow');
    await gotoEditor(page);
    expect(await page.evaluate(() => guidesShown)).toBe(false);
    await page.evaluate(() => { guidesShown = true; localStorage.removeItem('ds-guides-vis'); });
  });

  test('a guide is out of the way while words are open and with the Type or Hand tool', async ({ page }) => {
    await page.evaluate(() => { setGuides([], [3]); drawGuideLayer($('out').contentDocument); });
    const pe = () => p3(page).locator('.ds-gd.h').evaluate(e => getComputedStyle(e).pointerEvents);
    expect(await pe()).not.toBe('none');
    await page.evaluate(() => setTool('type'));
    expect(await pe()).toBe('none');
    await page.evaluate(() => setTool('hand'));
    expect(await pe()).toBe('none');
    await page.evaluate(() => setTool('select'));
    expect(await pe()).not.toBe('none');
    // words open in a field: the line over them does not take the click
    await page.evaluate(() => {
      const d = $('out').contentDocument;
      const f = [...d.querySelectorAll('[data-slot]')].find(e => e.textContent.trim().length > 12);
      f.scrollIntoView({ block: 'center' });
      edit(d, f.dataset.slot);
    });
    await page.waitForTimeout(200);
    if (await page.evaluate(() => editing)) expect(await pe()).toBe('none');
  });

  test('right-click the page: a guide or a spacer goes where you clicked', async ({ page }) => {
    // blank margin at the page's left, clear of each guide the earlier steps add
    const menu = async (x, y, label) => {
      const at = await win(page, x, y);
      await page.mouse.click(at.x, at.y, { button: 'right' });
      await shot(page, 'menu-' + label.split(' ')[2]);
      await frame(page).locator('.ds-menu button', { hasText: label }).click();
    };
    await menu(0.3, 3, 'Add a vertical guide here');
    expect(((await guides(page)).x || [])[0]).toBeCloseTo(0.3, 0);
    await menu(0.6, 4, 'Add a horizontal guide here');
    expect(((await guides(page)).y || [])[0]).toBeCloseTo(4, 0);
    await menu(0.6, 4.7, 'Add a spacer here');
    await settled(page);
    const sp = await page.evaluate(() => layout.shapes.filter(s => s.kind === 'spacer'));
    expect(sp.length).toBe(1);
    expect(sp[0].y).toBeCloseTo(4.7, 0);
    expect(sp[0].h).toBe(0.25);
    expect(await page.evaluate(() => [...selIds])).toEqual([sp[0].id]);
    await expect(frame(page).locator('.ds-spacer-lbl')).toHaveText('0.25 in');
  });
});

test.describe('spacers', () => {
  test.beforeEach(async ({ page }) => { await setup(page); });

  test('from the Insert palette, and from a right-click: a quiet dashed box saying the gap it holds', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.locator('#pal-q').fill('spacer');
    await page.keyboard.press('Enter');
    await settled(page);
    expect(await page.evaluate(() => layout.shapes.filter(s => s.kind === 'spacer').length)).toBe(1);
    const sp = await page.evaluate(() => layout.shapes.find(s => s.kind === 'spacer'));
    // it lands across the text column, in the part of the page you are looking at
    expect(sp.x).toBeCloseTo(0.75, 1);
    expect(sp.w).toBeCloseTo(7, 0);
    const where = await page.evaluate(id => {
      const out = $('out'), r = out.contentDocument.querySelector(`[data-shape="${id}"]`).getBoundingClientRect(), or = out.getBoundingClientRect();
      const y = or.top + (r.top + r.height / 2) * (or.height / out.offsetHeight), S = $('stage').getBoundingClientRect();
      return y > S.top && y < S.bottom;
    }, sp.id);
    expect(where).toBe(true);
    // quiet: the box is the faint kind, not a block of colour
    const look = await frame(page).locator(`[data-shape="${sp.id}"] rect`).evaluate(e => {
      const cs = getComputedStyle(e); return { fo: +cs.fillOpacity, so: +cs.strokeOpacity, dash: cs.strokeDasharray };
    });
    expect(look.fo).toBeLessThan(0.1);
    expect(look.so).toBeLessThan(0.7);
    expect(look.dash).not.toBe('none');
    await shot(page, 'spacer');
    // it is not content: never in a published build or a print
    const pub = await page.evaluate(async () => {
      const html = (await exportHtml(true)) || '';
      return { gap: /data-gapmark|ds-gapmark/.test(html), lbl: /ds-spacer-lbl/.test(html) };
    });
    expect(pub).toEqual({ gap: false, lbl: false });
    const printed = await frame(page).locator('body').evaluate(() => [...document.styleSheets].some(ss => {
      try { return [...ss.cssRules].some(r => r.media && /print/.test(r.media.mediaText) && /gapmark/.test(r.cssText)); } catch (e) { return false; }
    }));
    expect(printed).toBe(true);
  });
});
