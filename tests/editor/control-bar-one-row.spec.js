// The docked Control bar is ONE row, 44px, at every window width and for every
// selection. Whatever the width cannot hold moves, one whole control at a time
// and least important first, into the pop-up under "More" at the row's right
// end (ctlFit, CTL_KEEP). The nodes move, they are not copied, so a field in
// More types, scrubs and answers a pilot verb exactly as one in the row does.
// Pinned here: the height; that nothing the bar draws reaches the rulers, the
// left rail or the right-hand dock, or runs off the window; that the canvas
// never moves when the selection changes; that a wide window has no More; that
// a control in More works, and More closes like the editor's other pop-ups;
// and that every control the bar can show has a place in the priority lists.
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
const geometry = page => page.evaluate(() => {
  const bar = $('ctl').getBoundingClientRect();
  const top = id => $(id).getBoundingClientRect().top;
  // every control the row draws (the pop-up is a fixed layer of its own)
  const out = [...$('ctl').querySelectorAll('input, select, button, label')]
    .filter(e => e.offsetParent !== null && !e.closest('.pop') && e.id !== 'ctl-more-btn')
    .filter(e => { const b = e.getBoundingClientRect(); return b.right > innerWidth + 1 || b.bottom > bar.bottom + 1 || b.top < bar.top - 1; })
    .map(e => e.id || e.className);
  // a divider only ever stands between two controls of the row
  const drawn = [...$('ctl').querySelectorAll('.ty-sep, input, select, button, label, .cb-refgrid, .ty-seg, .ty-key, .ar-count')]
    .filter(e => e.offsetParent !== null && !e.closest('.pop') && e.id !== 'ctl-more-btn'
      && !(e.parentElement && e.parentElement.closest('label, .ty-seg, .ty-step, .cb-refgrid')))
    .map(e => ({ sep: e.classList.contains('ty-sep'), x: e.getBoundingClientRect().left }))
    .sort((a, b) => a.x - b.x);
  const strays = drawn.filter((e, i) => e.sep && (i === 0 || i === drawn.length - 1 || drawn[i - 1].sep)).length;
  return { h: Math.round(bar.height), bottom: Math.round(bar.bottom), out, strays, dockTop: Math.round(top('dock-icons')),
    rulerT: Math.round(top('ruler-t')), rulerL: Math.round(top('ruler-l')), rail: Math.round(top('leftrail')),
    work: Math.round(top('work')),
    more: !$('ctl-more-btn').hidden, moreN: +$('ctl-more-n').textContent };
});

test.describe('control bar: one row', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });      // the rulers
  });

  test('44px in every mode at 760, 1280 and 1920, nothing off the window, the dock below it', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const w of [760, 1280, 1920]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const [mode] of MODES) {
        await inMode(page, mode, ids);
        const g = await geometry(page);
        expect(g.h, `${w} ${mode}`).toBe(44);
        expect(g.out, `${w} ${mode}`).toEqual([]);
        expect(g.strays, `${w} ${mode} stray dividers`).toBe(0);
        expect(g.dockTop, `${w} ${mode} dock`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(await page.evaluate(() => $('ctl').scrollWidth <= $('ctl').clientWidth + 1), `${w} ${mode} scrolls`).toBe(true);
      }
    }
  });

  test('the bar covers neither ruler nor the rail, in any mode, at any width', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const w of [760, 1100, 1440]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const [mode] of MODES) {
        await inMode(page, mode, ids);
        const g = await geometry(page);
        expect(g.rulerT, `${w} ${mode} top ruler`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.rulerL, `${w} ${mode} left ruler`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.rail, `${w} ${mode} rail`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.work, `${w} ${mode} canvas`).toBeGreaterThanOrEqual(g.bottom - 1);
      }
    }
  });

  test('a window wide enough for everything has no More button', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    await page.setViewportSize({ width: 1920, height: 800 });
    for (const [mode] of MODES) {
      await inMode(page, mode, ids);
      expect((await geometry(page)).more, mode).toBe(false);
      await expect(page.locator('#ctl-more-btn')).toBeHidden();
    }
    // and a narrow one has it, with the count of what it holds
    await page.setViewportSize({ width: 1100, height: 800 });
    await inMode(page, 'char', ids);
    await expect(page.locator('#ctl-more-btn')).toBeVisible();
    const shown = await page.evaluate(() => [...$('ctl-more-body').children]
      .filter(e => getComputedStyle(e).display !== 'none').length);
    expect(+(await page.locator('#ctl-more-n').textContent())).toBe(shown);
    expect(shown).toBeGreaterThan(0);
  });

  test('changing what is selected never moves the canvas or changes the bar', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const w of [900, 1280]) {
      await page.setViewportSize({ width: w, height: 800 });
      const seen = [];
      for (const [mode] of [...MODES, ['obj', 'rect']]) {
        await inMode(page, mode, ids);
        const g = await geometry(page);
        seen.push([g.h, g.bottom, g.work, g.rulerT, g.rulerL, g.rail].join());
      }
      await page.evaluate(() => setSel($('out').contentDocument, []));        // nothing selected
      await settled(page);
      const g = await geometry(page);
      seen.push([g.h, g.bottom, g.work, g.rulerT, g.rulerL, g.rail].join());
      expect(new Set(seen).size, `${w}: ${seen.join(' | ')}`).toBe(1);
    }
  });

  test('a control in More works as it does in the row: type, Enter, undo', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await settled(page);
    // Shear is among the least important of an object's controls: at this width it is in More.
    expect(await page.evaluate(() => !!$('cb-skew').closest('#ctl-more-body'))).toBe(true);
    await expect(page.locator('#cb-skew')).toBeHidden();                      // shut
    const f = await barField(page, '#cb-skew');
    await expect(page.locator('#ctl-more-pop')).toBeVisible();
    await expect(f).toBeVisible();
    const steps = await page.evaluate(() => past.length);
    await f.fill('20');
    await f.press('Enter');
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew)).toBe(20);
    expect(await page.evaluate(() => past.length)).toBe(steps + 1);
    await expect(f).toHaveValue('20');                                         // ctlPaint reads it back
    await page.evaluate(() => undo());
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew || 0)).toBe(0);
  });

  test('a number in More scrubs from its icon, and names itself on hover', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 900, height: 800 });
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

  test('More closes on Escape and on a click away, and says so', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await settled(page);
    const btn = page.locator('#ctl-more-btn'), pop = page.locator('#ctl-more-pop');
    // what the row draws, and where: opening and closing More must not move any of it
    const row = () => page.evaluate(() => [...$('ctl').querySelectorAll('input, select, button')]
      .filter(e => e.offsetParent !== null && !e.closest('.pop'))
      .map(e => `${e.id || e.className}@${Math.round(e.getBoundingClientRect().left)}`).join(' '));
    const before = await row();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(pop).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(await row()).toBe(before);
    // it opens below the button, whole, inside the window
    const r = await page.evaluate(() => {
      const p = $('ctl-more-pop').getBoundingClientRect(), b = $('ctl-more-btn').getBoundingClientRect();
      return { top: p.top, btnBottom: b.bottom, left: p.left, right: p.right, bottom: p.bottom, w: innerWidth, h: innerHeight };
    });
    expect(r.top).toBeGreaterThanOrEqual(r.btnBottom);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(r.w);
    expect(r.bottom).toBeLessThanOrEqual(r.h);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(await row()).toBe(before);
    await btn.click();
    await expect(pop).toBeVisible();
    // a click away on the editor's chrome (as for every pop-up here, a click on the page
    // itself leaves pop-ups open: the colour and stroke panels are used while working there)
    await page.locator('#stat').click({ force: true });
    await expect(pop).toBeHidden();
    await btn.click();                                                          // a second press of More shuts it
    await expect(pop).toBeVisible();
    await btn.click();
    await expect(pop).toBeHidden();
  });

  test('a panel opened from a control in More lands under More, on screen', async ({ page }) => {
    const id = await addText(page);
    await pick(page, id);
    await page.setViewportSize({ width: 900, height: 800 });
    await page.click('#cb-mode [data-m="char"]');
    await settled(page);
    const opener = await barField(page, '#ty-spacebtn');
    expect(await page.evaluate(() => !!$('ty-spacebtn').closest('#ctl-more-body'))).toBe(true);
    await opener.click();
    const pop = page.locator('#ty-spacepop');
    await expect(pop).toBeVisible();
    const r = await page.evaluate(() => {
      const p = $('ty-spacepop').getBoundingClientRect(), b = $('ctl-more-btn').getBoundingClientRect();
      return { top: p.top, btnBottom: b.bottom, right: p.right, w: innerWidth };
    });
    expect(r.top).toBeGreaterThanOrEqual(r.btnBottom - 1);                       // not at the window's corner
    expect(r.right).toBeLessThanOrEqual(r.w);
  });

  test('a control that comes back to the row when the window widens keeps its handlers', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await settled(page);
    expect(await page.evaluate(() => !!$('cb-skew').closest('#ctl-more-body'))).toBe(true);
    await page.setViewportSize({ width: 1920, height: 800 });
    await expect(page.locator('#cb-skew')).toBeVisible();
    expect(await page.evaluate(() => $('cb-skew').closest('#ctl-more-body'))).toBeNull();
    // back in its own strip, in its own place: after rotation, before the flip buttons
    expect(await page.evaluate(() => $('cb-skew').closest('#cb-obj') !== null)).toBe(true);
    await page.locator('#cb-skew').fill('10');
    await page.locator('#cb-skew').press('Enter');
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew)).toBe(10);
  });

  test('every control the bar can show has a place in the priority lists', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    const unranked = [];
    for (const [mode] of MODES) {
      await inMode(page, mode, ids);
      unranked.push(...await page.evaluate(m => {
        // a control no list names would be the first to go to More, whatever it is: say which
        return ctlU.filter(u => {
          const ctlMode = $('ctl').dataset.mode;
          const here = getComputedStyle(u.el).display !== 'none'
            && [...(function* () { for (let a = u.ph.parentNode; a && a.id !== 'ctl'; a = a.parentNode) yield a; })()]
              .every(a => getComputedStyle(a).display !== 'none');
          return here && u.rk[ctlMode] === 999;
        }).map(u => `${m}: ${u.el.id || u.el.className}`);
      }, mode));
    }
    expect(unranked).toEqual([]);
  });

  test('the bar turned off puts every control back in its strip, and on again refits', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 900, height: 800 });
    await settled(page);
    expect(await page.evaluate(() => $('ctl-more-body').children.length)).toBeGreaterThan(0);
    await page.evaluate(() => toggleCtlBar(false));
    expect(await page.evaluate(() => $('ctl-more-body').children.length)).toBe(0);
    await page.evaluate(() => toggleCtlBar(true));
    await settled(page);
    expect(await page.evaluate(() => $('ctl-more-body').children.length)).toBeGreaterThan(0);
    expect((await geometry(page)).h).toBe(44);
  });
});
