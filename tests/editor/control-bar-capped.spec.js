// The Control bar's content is a column of at most 1500px, centred in a bar whose own surface stays
// full width; the fields in it keep the width of what they hold and never grow into a wide window
// (they used to stretch to fill it: an X box 130px wide holding "0.81", a style list 300px). What
// the window has beyond the area is margin, what the area has beyond its columns is the gaps
// between groups. Pinned here, at 1280, 1440, 1920 and 2560, in all four modes: the content is
// centred (margins within 2px) and never wider than 1500px; no field is wider than its ceiling
// (a number 120px, the size stepper 126px, a list 220px) nor, at the wide sizes, narrower than its
// floor; an icon button is 24px; every field is 24px tall; a number is right-aligned in its field;
// the gap between groups is clearly larger than the gap inside one; the bar itself is still the
// window's full width and 58px tall.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

async function setUp(page) {
  await gotoEditor(page);
  await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
  await page.evaluate(async () => {
    pushHistory();
    layout.shapes.push({ id: 'cb-rect', page: 3, kind: 'rect', x: 1, y: 1, w: 2, h: 1, fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
    markDirty();
    await render();
  });
  return page.evaluate(async () => (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words to set in the bar.' })).id);
}
async function inMode(page, mode, textId) {
  await page.evaluate(i => setSel($('out').contentDocument, [i]), mode === 'obj' ? 'cb-rect' : textId);
  await settled(page);
  if (mode !== 'obj') await page.click(`#cb-mode [data-m="${mode}"]`);
  await settled(page);
}
const MODES = ['obj', 'frame', 'char', 'para'];

test.describe('control bar: centred and capped', () => {
  test('the content is centred, never wider than 1500px, and the bar keeps its full width', async ({ page }) => {
    const text = await setUp(page);
    for (const w of [1280, 1440, 1920, 2560]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const mode of MODES) {
        await inMode(page, mode, text);
        const r = await page.evaluate(() => {
          const bar = $('ctl').getBoundingClientRect(), cs = [...$('ctl-cols').children].map(c => c.getBoundingClientRect());
          const l = cs[0].left - bar.left, rr = bar.right - cs[cs.length - 1].right;
          return { barW: Math.round(bar.width), winW: innerWidth, l, r: rr, span: cs[cs.length - 1].right - cs[0].left,
                   scroll: $('ctl-cols').scrollWidth - $('ctl-cols').clientWidth, h: Math.round(bar.height) };
        });
        const tag = `${w} ${mode}`;
        expect(Math.abs(r.l - r.r), `${tag}: margins ${r.l.toFixed(1)} / ${r.r.toFixed(1)}`).toBeLessThanOrEqual(2);
        expect(r.span, `${tag}: content ${r.span}px`).toBeLessThanOrEqual(1502);
        expect(r.scroll, `${tag}: scrolls`).toBeLessThanOrEqual(0);
        expect(r.barW, `${tag}: the bar is the window's width`).toBe(r.winW);
        expect(r.h, tag).toBe(58);
        if (w >= 1920) expect(r.span, `${tag}: content ${r.span}px should fill its 1500px area`).toBeGreaterThanOrEqual(1496);
      }
    }
  });

  test('no field is wider than its ceiling or narrower than its floor, and the rest is uniform', async ({ page }) => {
    const text = await setUp(page);
    for (const w of [1920, 2560]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const mode of MODES) {
        await inMode(page, mode, text);
        const r = await page.evaluate(() => {
          const bad = [];
          const live = e => e.offsetParent !== null && !e.closest('.pop') && !e.closest('#ctl-home');
          const note = (e, why) => bad.push(`${e.id || e.className}: ${why}`);
          document.querySelectorAll('#ctl .ctl-cell > .cb-f').forEach(e => { if (!live(e)) return;
            const b = e.getBoundingClientRect();
            if (b.width > 120.5) note(e, `number field ${Math.round(b.width)}px`);
            if (b.width < 70) note(e, `number field ${Math.round(b.width)}px, under its floor`);
            if (Math.round(b.height) !== 24) note(e, `${b.height}px tall`);
            const i = e.querySelector('input');
            if (i && getComputedStyle(i).textAlign !== 'right') note(e, 'number not right-aligned'); });
          document.querySelectorAll('#ctl .ctl-cell > .ty-step').forEach(e => { if (!live(e)) return;
            const b = e.getBoundingClientRect();
            if (b.width > 126.5) note(e, `stepper ${Math.round(b.width)}px`);
            if (Math.round(b.height) !== 24) note(e, `${b.height}px tall`); });
          document.querySelectorAll('#ctl .ctl-cell select').forEach(e => { if (!live(e)) return;
            const b = e.getBoundingClientRect();
            if (b.width > 220.5) note(e, `list ${Math.round(b.width)}px`);
            if (Math.round(b.height) !== 24) note(e, `${b.height}px tall`);
            const cs = getComputedStyle(e);
            if (cs.appearance !== 'none' || !/svg/.test(cs.backgroundImage)) note(e, 'not the shared chevron'); });
          // an icon-only button is a 24px square
          document.querySelectorAll('#ctl .ctl-cell button').forEach(e => { if (!live(e)) return;
            if (e.textContent.trim() !== '' || !e.querySelector('svg')) return;
            const b = e.getBoundingClientRect();
            if (e.closest('.cb-refgrid')) return;
            if (Math.round(b.height) !== 24) note(e, `icon button ${Math.round(b.height)}px tall`);
            if (b.width < 23.5 || b.width > 32) note(e, `icon button ${Math.round(b.width)}px wide`); });
          return bad;
        });
        expect(r, `${w} ${mode}`).toEqual([]);
      }
    }
  });

  test('the space between groups is clearly more than the space inside one', async ({ page }) => {
    const text = await setUp(page);
    for (const w of [1280, 1920, 2560]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const mode of MODES) {
        await inMode(page, mode, text);
        const r = await page.evaluate(() => {
          const cs = [...$('ctl-cols').children];
          let minBetween = 1e9;
          cs.forEach((c, i) => { if (!i) return; const a = c.getBoundingClientRect(), p = cs[i - 1].getBoundingClientRect();
            // between the last control of one column and the first of the next
            const last = [...cs[i - 1].querySelectorAll('.ctl-cell > *')].filter(e => e.offsetParent).reduce((m, e) => Math.max(m, e.getBoundingClientRect().right), 0);
            const first = [...c.querySelectorAll('.ctl-cell > *')].filter(e => e.offsetParent).reduce((m, e) => Math.min(m, e.getBoundingClientRect().left), 1e9);
            minBetween = Math.min(minBetween, first - last); });
          const inside = parseFloat(getComputedStyle(document.querySelector('#ctl .ctl-cell')).columnGap);
          return { minBetween, inside, rule: getComputedStyle(cs[cs.length - 1]).borderLeftWidth };
        });
        expect(r.minBetween, `${w} ${mode}: groups ${r.minBetween}px apart, inside a group ${r.inside}px`).toBeGreaterThanOrEqual(r.inside * 3);
        expect(r.rule, `${w} ${mode}: a hairline between groups`).toBe('1px');
      }
    }
  });
});
