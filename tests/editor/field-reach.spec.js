// A field can be reached and keeps its shape when it opens — the cases the
// every-field-opens sweep of 2026-10-21 found and this change fixed. Each
// test failed on the editor before its fix.
//
//   * a click that opened an editor is not also the page's click: the Budget
//     Primer's department popover opened on the Table 1 header and took the
//     focus the same click had just given the field;
//   * a slot folded in a closed <details> is unfolded on the way in, so the
//     editor can take focus;
//   * a stand-in editor is held to the width the paragraph had (a cover deck
//     with a max-width opened in a box the width of the page);
//   * an EMPTY block slot keeps a clickable box instead of collapsing to
//     zero height;
//   * an icon's inventory box is its declared square, so place() by that box
//     moves it by exactly what was asked;
//   * inventory() says when an element is laid out but not shown;
//   * a throw while opening a field never leaves `editing` stuck.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const settle = page => page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = performance.now();
  while (performance.now() - t0 < 10000 && (renderRunning || editing)) await sleep(25);
  await sleep(60);
});

/** Top-level point on a slot's first glyph. */
const glyphPoint = (page, key) => page.evaluate((key) => {
  const fr = document.getElementById('out');
  const d = fr.contentDocument;
  const el = [...d.querySelectorAll(`[data-slot="${CSS.escape(key)}"]`)].find(e => e.getClientRects().length);
  el.scrollIntoView({ block: 'center' });
  const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let b = null;
  for (let n = walker.nextNode(); n && !b; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const r = d.createRange(); r.selectNodeContents(n);
    b = [...r.getClientRects()].find(x => x.width > 2);
  }
  if (!b) b = el.getBoundingClientRect();
  const fb = fr.getBoundingClientRect(), k = fb.width / fr.offsetWidth;
  return { x: fb.left + (b.left + Math.min(b.width / 2, 10)) * k, y: fb.top + (b.top + b.height / 2) * k };
}, key);

test.describe('the Budget Primer', () => {
  test('a click on the Table 1 header edits it; the page\'s popover does not take the field away', async ({ page }) => {
    await gotoEditor(page, '');
    const pt = await glyphPoint(page, 'table1.header.executive');
    await page.mouse.click(pt.x, pt.y);
    const host = page.frameLocator('#out').locator('.ds-edit[data-slot="table1.header.executive"]');
    await expect(host).toHaveCount(1);
    await expect(host).toBeFocused();
    await page.keyboard.press('Escape');
    await settle(page);
  });

  test('a slot in a closed details opens the panel and takes focus', async ({ page }) => {
    await gotoEditor(page, '');
    const r = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const d = document.getElementById('out').contentDocument;
      const det = d.querySelector('details.obligated');
      const was = det.open;
      const el = d.querySelector('[data-slot="obligated.panel.hint"]');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: d.defaultView }));
      await sleep(150);
      const host = d.querySelector('.ds-edit[data-slot="obligated.panel.hint"]');
      const out = { was, open: det.open, host: !!host, focused: !!host && (d.activeElement === host || host.contains(d.activeElement)) };
      if (host) host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return out;
    });
    await settle(page);
    expect(r.was, 'the panel starts closed').toBe(false);
    expect(r.open, 'opening the field unfolded the panel').toBe(true);
    expect(r.host && r.focused, 'the field is open and focused').toBe(true);
  });
});

test('a stand-in editor is no wider than the paragraph it replaced (retitc cover.deck)', async ({ page }) => {
  await gotoEditor(page, '?project=retitc');
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('out').contentDocument;
    const el = d.querySelector('[data-slot="cover.deck"]');
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: d.defaultView }));
    await sleep(150);
    const host = d.querySelector('.ds-edit[data-slot="cover.deck"]');
    const h = host.getBoundingClientRect();
    const out = { standIn: !host.classList.contains('ds-edit-in'), was: Math.round(b.width), now: Math.round(h.width), left: Math.round(b.left), hleft: Math.round(h.left) };
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return out;
  });
  await settle(page);
  expect(r.standIn, 'cover.deck opens in a stand-in (a C.html paragraph)').toBe(true);
  expect(Math.abs(r.now - r.was), `width ${r.was} -> ${r.now}`).toBeLessThanOrEqual(2);
  expect(Math.abs(r.hleft - r.left), `left ${r.left} -> ${r.hleft}`).toBeLessThanOrEqual(2);
});

test('an empty block slot keeps a box a click can land on (tfc eyebrow.p-1)', async ({ page }) => {
  await gotoEditor(page, '?project=tfc-2027-priorities');
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('out').contentDocument;
    const el = d.querySelector('[data-slot="eyebrow.p-1"]');
    const md = readSlot('eyebrow.p-1');
    const b = el.getBoundingClientRect();
    el.scrollIntoView({ block: 'center' });
    const r2 = el.getBoundingClientRect();
    const hit = d.elementFromPoint(r2.left + 5, r2.top + r2.height / 2);
    const out = { md, h: b.height, hitIsSlot: hit === el };
    el.dispatchEvent(new MouseEvent(el.closest('[data-el]') ? 'dblclick' : 'click', { bubbles: true, cancelable: true, view: d.defaultView }));
    await sleep(150);
    out.opened = !!d.querySelector('.ds-edit[data-slot="eyebrow.p-1"]');
    const h = d.querySelector('.ds-edit[data-slot="eyebrow.p-1"]');
    if (h) h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return out;
  });
  await settle(page);
  expect(r.md, 'the slot is empty in the document').toBe('');
  expect(r.h, 'an empty block slot has height').toBeGreaterThanOrEqual(10);
  expect(r.hitIsSlot, 'the pointer lands on it').toBe(true);
  expect(r.opened, 'and it opens').toBe(true);
});

test('an icon lists its declared box and place() moves it by exactly what was asked', async ({ page }) => {
  await gotoEditor(page, '?project=eviction-code-guide');
  const r = await page.evaluate(async () => {
    const id = 'p4-ok-ic';
    const inv = docsync.api.inventory().pages.flatMap(p => p.elements).find(e => e.id === id);
    const sh = shapeOf(id);
    const declared = { x: +sh.x, y: +sh.y, w: +sh.w, h: +sh.h };   // before the move writes sh.x
    const res = await docsync.api.place(id, { x: inv.box.x + 0.25, y: inv.box.y + 0.25 });
    const out = { kind: inv.kind, box: inv.box, declared, after: res.box };
    await undo();
    return out;
  });
  await settle(page);
  expect(r.kind).toBe('icon');
  expect(Math.abs(r.box.x - r.declared.x)).toBeLessThan(0.011);
  expect(Math.abs(r.box.w - r.declared.w)).toBeLessThan(0.011);
  expect(Math.abs(r.after.x - r.box.x - 0.25)).toBeLessThan(0.011);
  expect(Math.abs(r.after.y - r.box.y - 0.25)).toBeLessThan(0.011);
});

test.describe('rxkids', () => {
  test('the childcare income bars are charts whose labels are on the page', async ({ page }) => {
    await gotoEditor(page, '?project=rxkids');
    const r = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const inv = docsync.api.inventory().pages.flatMap(p => p.elements);
      return ['single', 'married'].map(k => {
        const id = `carousel.childcare.bar.${k}.meter`;
        const e = inv.find(x => x.id === id);
        const el = d.querySelector(`[data-el="${id}"]`);
        const txt = el && [...el.querySelectorAll('text')].map(t => t.textContent).join(' ');
        const label = el && el.querySelector('text');
        const lb = label && label.getBoundingClientRect();
        const cb = el && el.getBoundingClientRect();
        return { id, kind: e && e.kind, txt, inside: !!(lb && cb && lb.left >= cb.left - 1 && lb.right <= cb.right + 1 && lb.width > 0) };
      });
    });
    for (const m of r) {
      expect(m.kind, `${m.id} is a chart`).toBe('chart');
      expect(m.txt, `${m.id} shows its value`).toMatch(/\d\.\d%/);
      expect(m.inside, `${m.id}'s label is drawn inside the bar`).toBe(true);
    }
    const ok = await page.evaluate(() => {
      openChartPanel('carousel.childcare.bar.single.meter');
      const pop = $('chartpop');
      const r = sidePanelTool === 'chart' && pop && !pop.hidden && !!pop.querySelector('input, select');
      closeSide();
      return r;
    });
    expect(ok, 'the Chart panel opens on it').toBe(true);
  });

  test('inventory() marks an element in a tab not shown as hidden', async ({ page }) => {
    await gotoEditor(page, '?project=rxkids');
    const r = await page.evaluate(() => {
      const els = docsync.api.inventory().pages.flatMap(p => p.elements);
      const by = id => els.find(e => e.id === id);
      return { home: by('carousel.lead'), away: by('tanf.h2') };
    });
    expect(r.home && r.home.hidden, 'a home-tab element is shown').toBeFalsy();
    expect(r.away && r.away.hidden, 'a TANF-tab element is not').toBe(true);
  });
});

test('a throw while a field opens does not leave the editor stuck', async ({ page }) => {
  await gotoEditor(page, '?project=demo-report');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('out').contentDocument;
    const orig = caretOrAll;
    caretOrAll = () => { throw new Error('probe: no selection'); };
    const el = d.querySelector('[data-slot="page1.h1"]');
    el.dispatchEvent(new MouseEvent(el.closest('[data-el]') ? 'dblclick' : 'click', { bubbles: true, cancelable: true, view: d.defaultView }));
    await sleep(150);
    const stuck = editing;
    caretOrAll = orig;
    const stray = d.querySelector('.ds-edit');
    if (stray) stray.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    while (renderRunning || editing) await sleep(25);
    // and the next click opens as usual
    const d2 = document.getElementById('out').contentDocument;
    const el2 = d2.querySelector('[data-slot="page1.intro"]');
    el2.dispatchEvent(new MouseEvent(el2.closest('[data-el]') ? 'dblclick' : 'click', { bubbles: true, cancelable: true, view: d2.defaultView }));
    await sleep(150);
    const opened = !!d2.querySelector('.ds-edit[data-slot="page1.intro"]');
    const h = d2.querySelector('.ds-edit'); if (h) h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { stuck, opened };
  });
  await settle(page);
  expect(errors.some(e => /probe: no selection/.test(e)), 'the throw surfaced').toBe(true);
  expect(r.stuck, '`editing` was reset').toBe(false);
  expect(r.opened, 'the next field opens').toBe(true);
});

test('a picture keeps its height through an incremental render (primer onetime.photo)', async ({ page }) => {
  await gotoEditor(page, '');
  const r = await page.evaluate(async () => {
    const look = () => { const i = document.getElementById('out').contentDocument.querySelector('[data-el="onetime.photo"]');
      return { complete: i.complete, h: Math.round(i.getBoundingClientRect().height) }; };
    const before = look();
    const b = _pilotMeasure('onetime.photo');
    const res = await docsync.api.place('onetime.photo', { x: b.x + 0.25, y: b.y + 0.25 });
    const placed = look();
    await undo();
    const undone = look();
    return { before, placeH: res.box && res.box.h, placed, undone };
  });
  await settle(page);
  expect(r.before.h).toBeGreaterThan(100);
  expect(r.placed.complete, 'the picture is loaded the moment place() returns').toBe(true);
  expect(Math.abs(r.placed.h - r.before.h), 'and has its height').toBeLessThanOrEqual(2);
  expect(r.placeH, 'place() reports that height').toBeGreaterThan(3);
  expect(r.undone.complete && Math.abs(r.undone.h - r.before.h) <= 2, 'and after undo').toBe(true);
});

test('a click on a word drawn over by an invisible one opens the word you see (our-mission)', async ({ page }) => {
  await gotoEditor(page, '?project=our-mission');
  const pt = await glyphPoint(page, 'ha-w.span-1');
  const stacked = await page.evaluate(({ x, y }) => {
    const fr = document.getElementById('out'), d = fr.contentDocument;
    const fb = fr.getBoundingClientRect(), k = fb.width / fr.offsetWidth;
    const top = d.elementsFromPoint((x - fb.left) / k, (y - fb.top) / k).find(n => n.dataset && n.dataset.slot);
    return top && top.dataset.slot;
  }, pt);
  expect(stacked, 'an invisible slot sits over the visible one').not.toBe('ha-w.span-1');
  await page.mouse.click(pt.x, pt.y);
  await expect(page.frameLocator('#out').locator('.ds-edit[data-slot]')).toHaveAttribute('data-slot', 'ha-w.span-1');
  await page.keyboard.press('Escape');
  await settle(page);
});

test('an endnote entry has no resize handles, and a renderer\'s own <table> is not listed as a table object (dotax-itep)', async ({ page }) => {
  await gotoEditor(page, '?project=dotax-itep');
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('out').contentDocument;
    const en = d.querySelector('[data-el^="endnote."]');
    await docsync.api.select(en.dataset.el); await sleep(80);
    const handles = d.querySelectorAll(`.ds-handles[data-for="${CSS.escape(en.dataset.el)}"] .ds-h`).length;
    const frames = docsync.api.inventory().pages.flatMap(p => p.elements).find(e => e.id === 'table.frames');
    await docsync.api.select(null);
    return { id: en.dataset.el, handles, framesKind: frames && frames.kind, isObject: !!tableOf('table.frames') };
  });
  expect(r.handles, `${r.id} shows no handles`).toBe(0);
  expect(r.isObject).toBe(false);
  expect(r.framesKind, 'inventory kinds it by its store, not its name').toBe('designed');
});

test('the mini toolbar never lies across a small object near the top of the page (retitc cover.pill)', async ({ page }) => {
  await gotoEditor(page, '?project=retitc');
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const id = 'cover.pill';
    await docsync.api.select(id); await sleep(80);
    const d = document.getElementById('out').contentDocument;
    const el = d.querySelector(`[data-el="${id}"]`);
    const eb = el.getBoundingClientRect();
    const mini = d.querySelector('.ds-mini'); const mb = mini && mini.getBoundingClientRect();
    const h = d.querySelector(`.ds-handles[data-for="${CSS.escape(id)}"] .ds-h-e`); const hb = h.getBoundingClientRect();
    const top = d.elementFromPoint(hb.left + hb.width / 2, hb.top + hb.height / 2);
    await docsync.api.select(null);
    return { overlaps: !!(mb && mb.top < eb.bottom && mb.bottom > eb.top && mb.left < eb.right && mb.right > eb.left), handleReachable: top === h };
  });
  expect(r.overlaps, 'the bar is clear of the object').toBe(false);
  expect(r.handleReachable, 'the east handle takes the pointer').toBe(true);
});

test('the contextual card gets out of the way of a selection at the top of page 1 (tfc eyebrow)', async ({ page }) => {
  await gotoEditor(page, '?project=tfc-2027-priorities');
  const r = await page.evaluate(async (id) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await docsync.api.select(id); await sleep(120);
    const fr = document.getElementById('out'), d = fr.contentDocument;
    const hd = d.querySelector(`.ds-handles[data-for="${CSS.escape(id)}"] .ds-h-e`);
    const b = hd.getBoundingClientRect(), fb = fr.getBoundingClientRect(), k = fb.width / fr.offsetWidth;
    const top = document.elementFromPoint(fb.left + (b.left + b.width / 2) * k, fb.top + (b.top + b.height / 2) * k);
    const low = $('context').classList.contains('low');
    await docsync.api.select(null); await sleep(60);
    return { overFrame: top === fr, low, lowAfterClear: $('context').classList.contains('low') };
  }, 'field.eyebrow.p-1');
  expect(r.low, 'the card dropped to the foot').toBe(true);
  expect(r.overFrame, 'the east handle is reachable from the top-level document').toBe(true);
  expect(r.lowAfterClear, 'and the card goes home when nothing is selected').toBe(false);
});
