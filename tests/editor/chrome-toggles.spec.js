// Showing and hiding the chrome: the rulers, the tool rail, the panel dock, the
// Control bar, the page strip, and focus mode (all of it at once). Each has one
// obvious switch (a handle on the toolbar's own foot, a tab on the window's
// edge, the rulers' corner square), a shortcut, a ticked row in View that
// follows the real state, and is remembered per editor. A toolbar that is put
// away always leaves something visible to bring it back, and the canvas fits
// the room that is left.
const fs = require('fs');
const path = require('path');
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const SHOTS = process.env.CHROME_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};
const box = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s); if (!e) return null;
  const cs = getComputedStyle(e), b = e.getBoundingClientRect();
  return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, shown: cs.display !== 'none' && b.width > 0 };
}, sel);
const shown = async (page, sel) => !!((await box(page, sel)) || {}).shown;
/** The element that answers a press at the centre of `sel`. */
const answers = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s), b = e.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !!hit && (e === hit || e.contains(hit));
}, sel);
const MOD = 'Control+Alt';        // ⌥⌘ on a Mac is Ctrl+Alt here: the chord table takes either
const tick = (page, id) => page.evaluate(i => $(i).classList.contains('on'), id);
const viewTicks = async page => {
  await page.click('#view');
  const t = await page.evaluate(() => Object.fromEntries(['guides', 'ctlbar', 'railbtn', 'dockbtn', 'stripbtn', 'focusbtn']
    .map(i => [i, $(i).classList.contains('on')])));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { $('viewpop').hidden = true; });
  return t;
};
async function reload(page) { await gotoEditor(page); }
async function drag(page, from, dx, steps = 6) {
  const b = await box(page, from), x = b.l + b.w / 2, y = b.t + b.h / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + dx * i / steps, y);
  await page.mouse.up();
}

test.describe('show and hide the chrome', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoEditor(page);
  });

  test('tool rail: handle, tab, shortcut, View tick, remembered', async ({ page }) => {
    expect(await shown(page, '#leftrail')).toBe(true);
    expect(await shown(page, '#rail-hide')).toBe(true);
    expect(await answers(page, '#rail-hide')).toBe(true);
    expect(await shown(page, '#rail-tab')).toBe(false);
    await page.click('#rail-hide');
    await settled(page);
    expect(await shown(page, '#leftrail')).toBe(false);
    // a way back is on screen, on the window's left edge, and takes the press
    const tab = await box(page, '#rail-tab');
    expect(tab.shown).toBe(true);
    expect(tab.l).toBeLessThan(2);
    expect(await answers(page, '#rail-tab')).toBe(true);
    expect((await viewTicks(page)).railbtn).toBe(false);
    await shot(page, 'rail-hidden');
    // remembered
    await reload(page);
    expect(await shown(page, '#leftrail')).toBe(false);
    expect(await shown(page, '#rail-tab')).toBe(true);
    await page.click('#rail-tab');
    await settled(page);
    expect(await shown(page, '#leftrail')).toBe(true);
    expect(await shown(page, '#rail-tab')).toBe(false);
    expect((await viewTicks(page)).railbtn).toBe(true);
    await reload(page);
    expect(await shown(page, '#leftrail')).toBe(true);
    // the shortcut, both ways
    await page.keyboard.press(`${MOD}+1`);
    expect(await shown(page, '#leftrail')).toBe(false);
    await page.keyboard.press(`${MOD}+1`);
    expect(await shown(page, '#leftrail')).toBe(true);
    // and View
    await page.click('#view'); await page.click('#railbtn');
    expect(await shown(page, '#leftrail')).toBe(false);
    await page.click('#rail-tab');
  });

  test('tool rail: hiding it takes its tray with it, and the left ruler stands at the window edge', async ({ page }) => {
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
    await page.click('#colors');
    await expect(page.locator('#side')).toBeVisible();
    const x0 = await page.evaluate(() => $('ruler-l').getBoundingClientRect().left);
    expect(x0).toBeGreaterThan(40);                  // clear of the rail
    await page.click('#side-x');
    await page.click('#rail-hide');
    await page.waitForTimeout(150);
    expect(await shown(page, '#side')).toBe(false);
    expect(await page.evaluate(() => $('ruler-l').getBoundingClientRect().left)).toBeLessThan(2);
    // a tray the palette opens with the rail away does not land under the window edge
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    expect((await box(page, '#pal-card')).l).toBeGreaterThanOrEqual(8);
    await page.keyboard.press('Escape');
  });

  test('dragging the rail handle toward the edge puts it away; a short drag springs back', async ({ page }) => {
    await drag(page, '#rail-hide', -20);
    await settled(page);
    expect(await shown(page, '#leftrail')).toBe(true);            // under the threshold
    expect(await page.evaluate(() => $('leftrail').style.transform)).toBe('');
    await drag(page, '#rail-hide', -60);
    await settled(page);
    expect(await shown(page, '#leftrail')).toBe(false);
    expect(await shown(page, '#rail-tab')).toBe(true);
    // drag the tab back out, away from the edge
    await drag(page, '#rail-tab', 50);
    await settled(page);
    expect(await shown(page, '#leftrail')).toBe(true);
    // a click on the handle is a click, not a drag
    await page.click('#rail-hide');
    expect(await shown(page, '#leftrail')).toBe(false);
    await page.click('#rail-tab');
  });

  test('panel dock: handle, tab, shortcut, View tick, remembered; the canvas takes the room', async ({ page }) => {
    const st0 = await box(page, '#stage');
    expect(await shown(page, '#dock')).toBe(true);
    expect(await answers(page, '#dock-hide')).toBe(true);
    await page.click('#dock-hide');
    await settled(page);
    expect(await shown(page, '#dock')).toBe(false);
    const st1 = await box(page, '#stage');
    expect(st1.w).toBeGreaterThan(st0.w + 30);
    expect(st1.r).toBeCloseTo(1280, 0);
    // the page is fitted into the wider stage, not left at the old width
    const fit = await page.evaluate(() => {
      const s = $('stage').getBoundingClientRect(), o = $('out').getBoundingClientRect();
      return { outR: o.right, outL: o.left, stR: s.right, stL: s.left };
    });
    expect(fit.outR).toBeLessThanOrEqual(fit.stR + 1);
    const tab = await box(page, '#dock-tab');
    expect(tab.shown).toBe(true);
    expect(tab.r).toBeGreaterThan(1278);
    expect(await answers(page, '#dock-tab')).toBe(true);
    expect((await viewTicks(page)).dockbtn).toBe(false);
    await shot(page, 'dock-hidden');
    await reload(page);
    expect(await shown(page, '#dock')).toBe(false);
    await page.click('#dock-tab');
    await settled(page);
    expect(await shown(page, '#dock')).toBe(true);
    expect((await box(page, '#stage')).w).toBeCloseTo(st0.w, 0);
    await page.keyboard.press(`${MOD}+2`);
    expect(await shown(page, '#dock')).toBe(false);
    await page.keyboard.press(`${MOD}+2`);
    expect(await shown(page, '#dock')).toBe(true);
    // a drag
    await drag(page, '#dock-hide', 60);
    await settled(page);
    expect(await shown(page, '#dock')).toBe(false);
    await drag(page, '#dock-tab', -50);
    await settled(page);
    expect(await shown(page, '#dock')).toBe(true);
  });

  test('the dock\'s fly-out closes with the dock, and the tab stands clear of a comments gutter', async ({ page }) => {
    await page.evaluate(() => dockShow('layers'));
    await expect(page.locator('#dock-panel')).toBeVisible();
    await page.evaluate(() => toggleDock(false));
    await expect(page.locator('#dock-panel')).toBeHidden();
    await page.evaluate(() => { document.body.classList.add('cmt-margin'); });
    const tab = await box(page, '#dock-tab');
    expect(tab.r).toBeLessThan(1280 - 300);
    await page.evaluate(() => { document.body.classList.remove('cmt-margin'); toggleDock(true); });
  });

  test('page strip: shortcut, View tick; folded it still leaves its handle', async ({ page }) => {
    expect(await tick(page, 'stripbtn')).toBe(true);
    expect((await viewTicks(page)).stripbtn).toBe(true);
    const h0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--strip-h'));
    expect(parseFloat(h0)).toBeGreaterThan(60);
    await page.keyboard.press(`${MOD}+4`);
    await settled(page);
    expect(await page.evaluate(() => $('rail').classList.contains('folded'))).toBe(true);
    expect((await viewTicks(page)).stripbtn).toBe(false);
    expect(await shown(page, '#rail-fold')).toBe(true);
    expect(await answers(page, '#rail-fold')).toBe(true);
    const h1 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--strip-h'));
    expect(parseFloat(h1)).toBeLessThan(parseFloat(h0));
    // remembered
    await reload(page);
    expect(await page.evaluate(() => $('rail').classList.contains('folded'))).toBe(true);
    await page.click('#view'); await page.click('#stripbtn');
    expect(await page.evaluate(() => $('rail').classList.contains('folded'))).toBe(false);
  });

  test('control bar: shortcut, View tick, remembered; the canvas gets the 44px back', async ({ page }) => {
    const st0 = await box(page, '#stage');
    expect((await viewTicks(page)).ctlbar).toBe(true);
    await page.keyboard.press(`${MOD}+6`);
    await settled(page);
    expect(await shown(page, '#ctl')).toBe(false);
    expect((await box(page, '#stage')).t).toBeLessThan(st0.t - 30);
    expect((await viewTicks(page)).ctlbar).toBe(false);
    await reload(page);
    expect(await shown(page, '#ctl')).toBe(false);
    await page.keyboard.press(`${MOD}+6`);
    expect(await shown(page, '#ctl')).toBe(true);
  });

  test('rulers: the corner square hides them, ⌘; and View bring them back, remembered', async ({ page }) => {
    expect((await viewTicks(page)).guides).toBe(false);
    await page.keyboard.press('Control+;');
    await page.waitForTimeout(150);
    expect(await shown(page, '#ruler-t')).toBe(true);
    expect(await shown(page, '#ruler-c')).toBe(true);
    expect(await page.evaluate(() => getComputedStyle($('ruler-c')).cursor)).toBe('pointer');
    expect((await viewTicks(page)).guides).toBe(true);
    await reload(page);
    expect(await shown(page, '#ruler-t')).toBe(true);
    await page.mouse.click((await box(page, '#ruler-c')).l + 8, (await box(page, '#ruler-c')).t + 8);
    await page.waitForTimeout(150);
    expect(await shown(page, '#ruler-t')).toBe(false);
    expect(await shown(page, '#ruler-l')).toBe(false);
    expect(await shown(page, '#ruler-c')).toBe(false);
    expect((await viewTicks(page)).guides).toBe(false);
    await page.click('#view'); await page.click('#guides');
    await page.waitForTimeout(150);
    expect(await shown(page, '#ruler-t')).toBe(true);
  });

  test('focus mode puts every toolbar away at once and leaves a pill; the individual choices are kept', async ({ page }) => {
    // one choice made first: the dock is put away on purpose
    await page.click('#dock-hide');
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
    await settled(page);
    const st0 = await box(page, '#stage');
    await page.keyboard.press('Control+\\');
    await settled(page);
    for (const sel of ['#ctl', '#leftrail', '#dock', '#rail', '#side', '#rail-tab', '#dock-tab', '#ruler-t', '#ruler-l', '#ruler-c'])
      expect(await shown(page, sel), sel).toBe(false);
    expect(await shown(page, '#bar')).toBe(true);                  // the menu bar stays: View is the way back too
    const pill = await box(page, '#focus-pill');
    expect(pill.shown).toBe(true);
    expect(await answers(page, '#focus-pill')).toBe(true);
    const st1 = await box(page, '#stage');
    expect(st1.t).toBeLessThan(st0.t - 30);                         // the Control bar's row went to the canvas
    expect(st1.b).toBeGreaterThan(st0.b - 1);
    expect((await viewTicks(page)).focusbtn).toBe(true);
    await shot(page, 'focus');
    // not remembered: an editor never opens bare
    await reload(page);
    expect(await shown(page, '#ctl')).toBe(true);
    expect(await shown(page, '#focus-pill')).toBe(false);
    // and the way out restores what was there, which is not the dock
    await page.keyboard.press('Control+\\');
    await expect(page.locator('#focus-pill')).toBeVisible();
    await page.click('#focus-pill');
    await settled(page);
    expect(await shown(page, '#ctl')).toBe(true);
    expect(await shown(page, '#leftrail')).toBe(true);
    expect(await shown(page, '#dock')).toBe(false);
    expect(await shown(page, '#dock-tab')).toBe(true);
    expect(await shown(page, '#ruler-t')).toBe(true);
    await page.click('#dock-tab');
  });

  test('present mode keeps its own rules: the edge tabs and the pill stay away', async ({ page }) => {
    await page.evaluate(() => { toggleRail(false); toggleDock(false); });
    expect(await shown(page, '#rail-tab')).toBe(true);
    await page.evaluate(() => enterPresent());
    await page.waitForTimeout(150);
    for (const sel of ['#rail-tab', '#dock-tab', '#focus-pill', '#bar', '#leftrail'])
      expect(await shown(page, sel), sel).toBe(false);
    await page.evaluate(() => exitPresent());
    await page.evaluate(() => { toggleRail(true); toggleDock(true); });
  });

  test('every way of putting chrome away leaves a visible way back', async ({ page }) => {
    // every combination of the three side switches: whatever is hidden has a tab,
    // inside the window, that answers a press
    for (const [railAway, dockAway] of [[true, false], [false, true], [true, true]]) {
      await page.evaluate(([r, d]) => { toggleRail(!r); toggleDock(!d); }, [railAway, dockAway]);
      await page.waitForTimeout(80);
      if (railAway) { expect(await shown(page, '#rail-tab')).toBe(true); expect(await answers(page, '#rail-tab')).toBe(true); }
      if (dockAway) { expect(await shown(page, '#dock-tab')).toBe(true); expect(await answers(page, '#dock-tab')).toBe(true); }
    }
    await page.evaluate(() => { toggleRail(true); toggleDock(true); });
  });

  test('the chords are rows of the table, and collide with none', async ({ page }) => {
    const names = await page.evaluate(() => window.__dsChords());
    for (const n of ['tool rail', 'panel dock', 'page strip', 'focus mode', 'control bar', 'rulers & guides'])
      expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });
});
