// Presentation mode (#present, top-right of the bar): fullscreen-style view of
// one page at a time with every toolbar gone; arrows or click advance, the
// left edge or ← goes back, Esc exits. Runs on the editor's own iframe and
// zoom pipeline — nothing re-renders on entry. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const state = (page) => page.evaluate(() => {
  const d = document.getElementById('out').contentDocument;
  const shown = [...d.querySelectorAll('section.page')]
    .filter(p => getComputedStyle(p).display !== 'none');
  return {
    presenting: document.body.classList.contains('ds-present'),
    barGone: getComputedStyle(document.getElementById('bar')).display === 'none',
    railGone: getComputedStyle(document.getElementById('leftrail')).display === 'none',
    overlay: !!document.getElementById('present-ov'),
    shown: shown.map(p => p.dataset.page),
    counter: (document.getElementById('present-n') || {}).textContent || '',
  };
});

test.describe('presentation mode', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(800);
    await page.click('#present');
    await page.waitForTimeout(500);
  });

  test('entering hides every toolbar and shows exactly one page', async ({ page }) => {
    const s = await state(page);
    expect(s.presenting).toBe(true);
    expect(s.barGone).toBe(true);
    expect(s.railGone).toBe(true);
    expect(s.overlay).toBe(true);
    expect(s.shown).toHaveLength(1);
    expect(s.counter).toMatch(/^1 \/ \d+$/);
    // Fitted WHOLE: the stage resize that hiding the bars causes must not
    // recompute the auto zoom over the presentation scale (fit-to-width
    // showed the page clipped at the bottom).
    const fit = await page.evaluate(() => {
      const out = document.getElementById('out');
      const d = out.contentDocument;
      const pg = d.querySelector('section.page.ds-present-on');
      const r = pg.getBoundingClientRect();
      // r.height includes the primer's 125% screen zoom; curScale is the
      // editor's own transform on the iframe. Their product is on-screen px.
      return { h: r.height * curScale, win: window.innerHeight };
    });
    expect(fit.h).toBeLessThanOrEqual(fit.win + 2);
  });

  test('arrows advance and go back; the deck does not wrap', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    let s = await state(page);
    expect(s.counter).toMatch(/^2 \//);
    const second = s.shown[0];
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    s = await state(page);
    expect(s.counter).toMatch(/^1 \//);
    expect(s.shown[0]).not.toBe(second);
    // already at the start: back is a no-op, not a wrap to the end
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    expect((await state(page)).counter).toMatch(/^1 \//);
  });

  test('click advances; the left edge goes back', async ({ page }) => {
    const w = await page.evaluate(() => window.innerWidth);
    const h = await page.evaluate(() => window.innerHeight);
    await page.mouse.click(w * 0.6, h * 0.5);
    await page.waitForTimeout(250);
    expect((await state(page)).counter).toMatch(/^2 \//);
    await page.mouse.click(30, h * 0.5);
    await page.waitForTimeout(250);
    expect((await state(page)).counter).toMatch(/^1 \//);
  });

  test('Escape restores the editor exactly as it was', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const s = await state(page);
    expect(s.presenting).toBe(false);
    expect(s.barGone).toBe(false);
    expect(s.overlay).toBe(false);
    // every page back in the document flow
    expect(s.shown.length).toBeGreaterThan(1);
    await expect(page.locator('#present')).toBeVisible();
  });

  test('a live re-render mid-presentation keeps the deck up', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    await page.evaluate(() => render());
    await page.waitForTimeout(2500);
    const s = await state(page);
    expect(s.presenting).toBe(true);
    expect(s.shown).toHaveLength(1);
    expect(s.counter).toMatch(/^2 \//);
  });
});
