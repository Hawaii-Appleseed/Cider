// The docked Control bar is TWO rows, --ctl-h (80px) tall: the same in every mode and with
// nothing selected, at every window width. Row 1 holds the primary fields and row 2 the
// secondary ones (ctlFit, CTL_ROWS); each row scrolls sideways inside itself when the
// window is narrower than its fields, so nothing wraps, nothing grows and nothing hides
// behind a menu. The nodes are laid in the rows, not copied, so a field in row 2 types,
// scrubs and answers a pilot verb exactly as it did in its strip.
// Pinned here: the height (equal across every mode, both rows equal); that the bar covers
// neither ruler nor the rail (every control probed at its top edge, centre, sides and foot);
// that rulers, rail, dock and the comments/history panels start exactly at the bar's foot
// (--ctl-bottom); that the canvas never moves when the selection changes; that a narrow window
// makes each row scroll rather than the page grow; that a field in row 2 works; that a pop-up
// from the bar opens whole, on top of the rulers; and that every control the bar can show has a
// place in CTL_ROWS.
const { test, expect, gotoEditor, settled, barField } = require('./fixtures/editor-test');

async function addRect(page) {
  await page.evaluate(async () => {
    pushHistory();
    layout.shapes.push({ id: 'cb-rect', page: 3, kind: 'rect', x: 1, y: 1,
                         w: 2, h: 1, fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
    markDirty();
    await render();
    setSel($('out').contentDocument, ['cb-rect']);
  });
  await settled(page);
}
async function addText(page) {
  return page.evaluate(async () =>
    (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words to set in the bar.' })).id);
}
async function pick(page, id) {
  await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
  await settled(page);
}
const MODES = [['obj', 'rect'], ['frame', 'text'], ['char', 'text'], ['para', 'text']];
async function inMode(page, mode, ids) {
  await pick(page, mode === 'obj' ? ids.rect : ids.text);
  if (mode !== 'obj') await page.click(`#cb-mode [data-m="${mode}"]`);
  await settled(page);
}
const MODES_ALL = [...MODES, ['empty', null]];
async function inAnyMode(page, mode, ids) {
  if (mode === 'empty') { await page.evaluate(() => setSel($('out').contentDocument, [])); await settled(page); }
  else await inMode(page, mode, ids);
}
const geometry = page => page.evaluate(() => {
  const bar = $('ctl').getBoundingClientRect();
  const r1 = $('ctl-r1').getBoundingClientRect(), r2 = $('ctl-r2').getBoundingClientRect();
  const top = id => $(id).getBoundingClientRect().top;
  // every control the rows draw, whole, inside its own row's box vertically (sideways a row scrolls)
  const out = [...$('ctl').querySelectorAll('input, select, button, label')]
    .filter(e => e.offsetParent !== null && !e.closest('.pop'))
    .filter(e => { const b = e.getBoundingClientRect(), row = e.closest('.ctl-row').getBoundingClientRect();
      return b.bottom > row.bottom + 1 || b.top < row.top - 1; })
    .map(e => e.id || e.className);
  // a divider only ever stands between two controls of its row
  const strays = ['ctl-r1', 'ctl-r2'].reduce((n, id) => {
    const k = [...$(id).children].filter(c => c.offsetParent !== null);
    return n + k.filter((c, i) => c.classList.contains('ctl-gsep') && (i === 0 || i === k.length - 1 || k[i - 1].classList.contains('ctl-gsep'))).length;
  }, 0);
  return { h: Math.round(bar.height), h1: Math.round(r1.height), h2: Math.round(r2.height), bottom: Math.round(bar.bottom),
    r1Bottom: Math.round(r1.bottom), r2Top: Math.round(r2.top), out, strays,
    dockTop: Math.round(top('dock-icons')), rulerT: Math.round(top('ruler-t')), rulerL: Math.round(top('ruler-l')),
    rail: Math.round(top('leftrail')), work: Math.round(top('work')),
    cssH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h')),
    ctlBottom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-bottom')),
    pageW: document.documentElement.scrollWidth, winW: innerWidth, pageH: document.documentElement.scrollHeight, winH: innerHeight };
});
const inRow = (page, id) => page.evaluate(i => { const r = $(i).closest('.ctl-row'); return r ? r.id : null; }, id);

test.describe('control bar: two rows', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });      // the rulers
  });

  test('the same --ctl-h in every mode, and with nothing selected, from a phone to a wide window', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    const seen = new Set();
    for (const [w, h] of [[390, 780], [760, 800], [1280, 720], [1920, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [mode] of MODES_ALL) {
        await inAnyMode(page, mode, ids);
        const g = await geometry(page);
        seen.add(g.h);
        expect(g.h, `${w} ${mode}`).toBe(g.cssH);
        expect(g.cssH, `${w} ${mode} --ctl-h`).toBe(80);
        expect(Math.abs(g.h1 - g.h2), `${w} ${mode}: the rows are the same height`).toBeLessThanOrEqual(1);
        expect(g.r2Top, `${w} ${mode}: row 2 starts where row 1 ends`).toBeGreaterThanOrEqual(g.r1Bottom - 1);
        expect(g.out, `${w} ${mode}`).toEqual([]);
        expect(g.strays, `${w} ${mode} stray dividers`).toBe(0);
        expect(g.pageW, `${w} ${mode}: the page grew sideways`).toBeLessThanOrEqual(g.winW);
        expect(g.pageH, `${w} ${mode}: the page grew taller`).toBeLessThanOrEqual(g.winH);
        expect(await page.evaluate(() => $('ctl').scrollWidth <= $('ctl').clientWidth + 1), `${w} ${mode}: the bar itself scrolls`).toBe(true);
        expect(await page.evaluate(() => $('ctl').scrollHeight <= $('ctl').clientHeight + 1), `${w} ${mode}: the bar overflows downward`).toBe(true);
      }
    }
    expect([...seen]).toEqual([80]);
  });

  test('row 1 holds the primary fields and row 2 the secondary ones, in each mode', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const want = {
      obj:   { 'ctl-r1': ['cb-x', 'cb-y', 'cb-w', 'cb-h', 'cb-rot', 'cb-skew'], 'ctl-r2': ['ar-fill', 'ar-border', 'ar-alpha', 'cb-align', 'ar-dup'] },
      frame: { 'ctl-r1': ['cb-x', 'cb-y', 'cb-w', 'cb-h', 'cb-rot'], 'ctl-r2': ['cb-align', 'cb-cols', 'ty-box'] },
      char:  { 'ctl-r1': ['ty-font', 'ty-weight', 'cb-size', 'cb-lead', 'cb-track', 'cb-kern', 'ty-colorbtn'], 'ctl-r2': ['cb-shift', 'cb-smcp', 'ty-case', 'ty-spacebtn', 'ty-parabtn', 'ty-box'] },
      para:  { 'ctl-r1': ['ty-alseg', 'cb-il', 'cb-ti', 'cb-ir', 'cb-sb', 'cb-sa'], 'ctl-r2': ['cb-dcap', 'cb-lmark', 'cb-hyph', 'ty-parabtn', 'ty-box'] },
    };
    for (const [mode] of MODES) {
      await inMode(page, mode, ids);
      for (const [row, list] of Object.entries(want[mode]))
        for (const id of list) expect(await inRow(page, id), `${mode}: ${id}`).toBe(row);
    }
  });

  test('the bar covers neither ruler nor the rail: every control probed at its edge, centre, sides and foot', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const [w, h] of [[760, 720], [1280, 720], [1440, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [mode] of MODES_ALL) {
        await inAnyMode(page, mode, ids);
        const g = await geometry(page);
        // the page's furniture starts exactly where the bar ends: nothing under it, no gap over it
        expect(g.work, `${w} ${mode} canvas`).toBe(g.bottom);
        expect(g.rail, `${w} ${mode} rail`).toBe(g.bottom);
        expect(g.rulerT, `${w} ${mode} top ruler`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.rulerL, `${w} ${mode} left ruler`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.dockTop, `${w} ${mode} dock`).toBeGreaterThanOrEqual(g.bottom - 1);
        // each control the bar draws answers a press at five points of itself: nothing covers it,
        // and it covers nothing (the probe is the topmost element there)
        const blocked = await page.evaluate(() => {
          const bad = [];
          document.querySelectorAll('#ctl .ctl-row > *').forEach(el => {
            const cs = getComputedStyle(el); if (cs.display === 'none' || el.classList.contains('ctl-gsep')) return;
            const b = el.getBoundingClientRect(), row = el.closest('.ctl-row').getBoundingClientRect();
            if (b.width < 4 || b.height < 4) return;
            for (const [fx, fy] of [[0.5, 0.08], [0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.92]]) {
              const x = b.left + b.width * fx, y = b.top + b.height * fy;
              if (x < row.left || x > row.right) continue;          // scrolled out of its row: not drawn
              const hit = document.elementFromPoint(x, y);
              if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) { bad.push(`${el.id || el.className} (${fx},${fy}) under ${hit && (hit.id || hit.className)}`); break; }
            }
          });
          // and the other way: the rulers and the rail are never what answers a press on the bar
          for (const id of ['ruler-t', 'ruler-l', 'ruler-c', 'leftrail']) {
            const e = $(id); if (!e || e.hidden || e.offsetParent === null) continue;
            const b = e.getBoundingClientRect(), c = $('ctl').getBoundingClientRect();
            if (b.top < c.bottom - 1 && b.bottom > c.top + 1) bad.push(id + ' overlaps the bar');
          }
          return bad;
        });
        expect(blocked, `${w}x${h} ${mode}`).toEqual([]);
      }
    }
  });

  test('rulers, rail, dock and the comments and history panels all start at --ctl-bottom', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    await page.evaluate(() => { const c = $('cpanel'), h = $('hpanel'); c.hidden = false; h.hidden = false; });
    const at = () => page.evaluate(() => {
      const top = id => Math.round($(id).getBoundingClientRect().top);
      return { bottom: Math.round($('ctl').getBoundingClientRect().bottom), v: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-bottom')),
        c: top('cpanel'), h: top('hpanel'), rail: top('leftrail'), work: top('work') };
    });
    let g = await at();
    expect(g.v).toBe(g.bottom);
    expect(g.c).toBe(g.bottom);
    expect(g.h).toBe(g.bottom);
    expect(g.rail).toBe(g.bottom);
    expect(g.work).toBe(g.bottom);
    // the bar off: everything follows it up, to the menu bar's foot
    await page.evaluate(() => toggleCtlBar(false));
    await settled(page);
    g = await at();
    const barFoot = await page.evaluate(() => Math.round($('bar').getBoundingClientRect().bottom));
    expect(g.v).toBe(barFoot);
    expect(g.c).toBe(barFoot);
    expect(g.h).toBe(barFoot);
    expect(g.rail).toBe(barFoot);
    await page.evaluate(() => toggleCtlBar(true));
    await settled(page);
    g = await at();
    expect(g.c).toBe(g.bottom);
    expect(g.rail).toBe(g.bottom);
  });

  test('changing what is selected never moves the canvas or changes the bar', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const w of [390, 900, 1280]) {
      await page.setViewportSize({ width: w, height: 800 });
      const seen = [];
      for (const [mode] of [...MODES, ['obj', 'rect'], ['empty', null]]) {
        await inAnyMode(page, mode, ids);
        const g = await geometry(page);
        seen.push([g.h, g.bottom, g.work, g.rulerT, g.rulerL, g.rail].join());
      }
      expect(new Set(seen).size, `${w}: ${seen.join(' | ')}`).toBe(1);
    }
  });

  test('a narrow window scrolls each row inside itself, and the page does not grow', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    await page.setViewportSize({ width: 390, height: 780 });
    for (const [mode] of MODES) {
      await inMode(page, mode, ids);
      const r = await page.evaluate(() => ['ctl-r1', 'ctl-r2'].map(id => { const e = $(id);
        return { id, over: e.scrollWidth > e.clientWidth + 1, overflowX: getComputedStyle(e).overflowX, wrap: getComputedStyle(e).flexWrap,
          h: Math.round(e.getBoundingClientRect().height) }; }));
      // a row may be as wide as it likes inside itself; none wraps, and the bar keeps its height
      for (const row of r) { expect(row.overflowX).toBe('auto'); expect(row.wrap).toBe('nowrap'); }
      expect(r.some(x => x.over), `${mode}: something to scroll to at 390px`).toBe(true);
      const g = await geometry(page);
      expect(g.h).toBe(80);
      expect(g.pageW).toBeLessThanOrEqual(g.winW);
    }
    // a row scrolls with the pointer's wheel, and says so by fading its edge
    await inMode(page, 'char', ids);
    const row = page.locator('#ctl-r1');
    await row.evaluate(e => { e.scrollLeft = 120; e.dispatchEvent(new Event('scroll')); });
    await expect(row).toHaveClass(/ctl-fade-l/);
    await expect(row).toHaveClass(/ctl-fade-r/);
    expect((await geometry(page)).h).toBe(80);
    // a control that was scrolled out of sight is reachable: it scrolls into view and answers
    const kern = await barField(page, '#cb-kern');
    await kern.fill('25');
    await kern.press('Enter');
    await settled(page);
    expect(await page.evaluate(() => $('ctl').scrollTop)).toBe(0);
  });

  test('a field in row 2 works as it did in its strip: type, Enter, undo', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    expect(await inRow(page, 'cb-r')).toBe('ctl-r2');
    expect(await inRow(page, 'cb-skew')).toBe('ctl-r1');
    const f = await barField(page, '#cb-skew');
    await expect(f).toBeVisible();
    const steps = await page.evaluate(() => past.length);
    await f.fill('20');
    await f.press('Enter');
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew)).toBe(20);
    expect(await page.evaluate(() => past.length)).toBe(steps + 1);
    await expect(f).toHaveValue('20');                                         // ctlPaint reads it back
    await page.evaluate(() => undo());
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew || 0)).toBe(0);
    // and a row-2 colour button opens its panel
    await page.click('#ar-border');
    await expect(page.locator('#ar-borderpop')).toBeVisible();
  });

  test('a number scrubs from its icon, and names itself on hover', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    await barField(page, '#cb-skew');
    const lab = page.locator('#cb-skew').locator('xpath=..');
    await lab.hover({ position: { x: 4, y: 8 } });
    await expect(page.locator('#tt')).toBeVisible();
    await expect(page.locator('#tt')).toContainText('Shear');
    const box = await lab.boundingBox();
    const x0 = box.x + 4, y0 = box.y + box.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 40, y0, { steps: 6 });
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew || 0)).not.toBe(0);
  });

  test('a pop-up from either row opens whole, below its button, on top of the rulers, inside the window', async ({ page }) => {
    const id = await addText(page);
    await pick(page, id);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.click('#cb-mode [data-m="char"]');
    await settled(page);
    // a row must never mask, filter or transform what it holds: the pop-ups its controls open are its
    // fixed-position descendants, and any of these cuts them off from the pointer (the character-style
    // pop of B / I / U did exactly that under a mask)
    expect(await page.evaluate(() => ['ctl', 'ctl-r1', 'ctl-r2'].map(i => { const c = getComputedStyle($(i));
      return [c.maskImage, c.webkitMaskImage, c.filter, c.transform, c.clipPath, c.contain].join('|'); })))
      .toEqual(Array(3).fill('none|none|none|none|none|none'));
    for (const [btn, pop] of [['#ty-colorbtn', '#ty-colorpop'], ['#ty-spacebtn', '#ty-spacepop'], ['#ty-style-more', '#ty-stylepop']]) {
      const opener = await barField(page, btn);
      await opener.click();
      await expect(page.locator(pop)).toBeVisible();
      const r = await page.evaluate(([b, p]) => {
        const pr = $(p.slice(1)).getBoundingClientRect(), br = $(b.slice(1)).getBoundingClientRect();
        // the pop-up's own top-left and centre answer a press: no ruler, rail or bar row is over it
        const probe = [[pr.left + 4, pr.top + 4], [pr.left + pr.width / 2, pr.top + 20]].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y); return !!hit && $(p.slice(1)).contains(hit); });
        return { top: pr.top, btnBottom: br.bottom, left: pr.left, right: pr.right, bottom: pr.bottom, w: innerWidth, h: innerHeight, probe };
      }, [btn, pop]);
      expect(r.top, pop).toBeGreaterThanOrEqual(r.btnBottom);
      expect(r.left, pop).toBeGreaterThanOrEqual(0);
      expect(r.right, pop).toBeLessThanOrEqual(r.w);
      expect(r.bottom, pop).toBeLessThanOrEqual(r.h);
      expect(r.probe, `${pop} is under something`).toEqual([true, true]);
      await page.keyboard.press('Escape');
      await expect(page.locator(pop)).toBeHidden();
    }
  });

  test('every control the bar can show has a place in CTL_ROWS', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    const unplaced = [];
    for (const [mode] of MODES_ALL) {
      await inAnyMode(page, mode, ids);
      unplaced.push(...await page.evaluate(m => {
        // a control no list names lands at the end of row 2, whatever it is: say which
        return ctlU.filter(u => {
          const ctlMode = $('ctl').dataset.mode;
          const here = getComputedStyle(u.el).display !== 'none'
            && [...(function* () { for (let a = u.ph.parentNode; a && a.id !== 'ctl'; a = a.parentNode) yield a; })()]
              .every(a => getComputedStyle(a).display !== 'none');
          return here && u.at[ctlMode][1] === 99;
        }).map(u => `${m}: ${u.el.id || u.el.className}`);
      }, mode));
    }
    expect(unplaced).toEqual([]);
  });

  test('a page selected has its own two rows, and the same height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { setSelPage($('out').contentDocument, 3); });
    await settled(page);
    const g = await geometry(page);
    expect(g.h).toBe(80);
    expect(g.out).toEqual([]);
    expect(await inRow(page, 'ar-pagelabel')).toBe('ctl-r1');
    expect(await inRow(page, 'ar-fill')).toBe('ctl-r2');
  });

  test('the bar turned off puts every control back in its strip, and on again lays the rows out', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    const laid = () => page.evaluate(() => [...$('ctl-r1').children, ...$('ctl-r2').children].filter(c => c.__cu).length);
    expect(await laid()).toBeGreaterThan(0);
    await page.evaluate(() => toggleCtlBar(false));
    expect(await laid()).toBe(0);
    await page.evaluate(() => toggleCtlBar(true));
    await settled(page);
    expect(await laid()).toBeGreaterThan(0);
    expect((await geometry(page)).h).toBe(80);
  });
});
