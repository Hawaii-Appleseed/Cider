// Every field on every bound report OPENS, TAKES WORDS, and every object MOVES
// — in the real editor, one by one, not a sample.
//
// The other nets say a thing HAS a hook (docsync.check reads the markup,
// every-element-has-a-handle.spec.js reads the drawn page, text-boxes-move
// drags ONE field per report). None of them opens every field. This one
// does, on every report docsync.yml binds, and holds each field to the
// whole promise of the report-editor skill:
//
//   open    — a click (a double-click inside a movable object) opens an
//             editor for exactly that slot, focused, that takes typing;
//   cancel  — Escape closes it and nothing was written;
//   commit  — a committed probe lands in the slot's markdown, and ⌘Z takes
//             it out again;
//   steady  — the field keeps its size while open (an inPlace editor that
//             reflows the page is the "fields change size when I click
//             them" glitch);
//   reach   — the pointer can land on it: the point a person would click
//             resolves to the field, not to something drawn over it;
//   move    — every unlocked object answers docsync.api.place() by moving.
//
// Findings are printed per report and the strict bindings are held to zero
// on open/cancel/commit/move; `shifted` and `covered` are reported and held
// to the KNOWN list (shrink-only, like text-legibility.spec.js).
//
// affected-by: docsync/editor/edit.html docsync/layout.py docsync/blocks.py docsync/content.py docsync.yml projects/**
const fs = require('fs');
const path = require('path');
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const REPO = path.resolve(__dirname, '../..');

const discover = () => {
  const yml = fs.readFileSync(path.join(REPO, 'docsync.yml'), 'utf8');
  const ids = [...yml.matchAll(/^ {2}- id: (\S+)$/gm)];
  return ids.map((m, i) => {
    const block = yml.slice(m.index, i + 1 < ids.length ? ids[i + 1].index : undefined);
    const lvl = (block.match(/^ {4}editability: (\S+)/m) || [, 'warn'])[1];
    const built = block.match(/^ {6}out: (\S+)$/m);
    return { id: m[1], strict: lvl === 'strict',
             built: !!built && fs.existsSync(path.join(REPO, built[1])) };
  }).filter(r => r.built);
};
// Opt-in: two tests per report and about twenty minutes for every report,
// which is more than a CI shard's budget. DS_ONLY=<id,id> runs those
// reports; DS_SWEEP=1 runs them all. Unasked, every test here skips.
const WANTED = process.env.DS_ONLY || process.env.DS_SWEEP;
const REPORTS = !WANTED ? []
  : (process.env.DS_ONLY ? discover().filter(r => process.env.DS_ONLY.split(',').includes(r.id)) : discover());

// Known and not yet fixed, by report: exact finding strings as printed.
// Shrink-only. NEVER add one to silence a new finding.
const KNOWN = new Map([
  // a stand-in or in-place host whose footnote chips (or an empty slot's
  // placeholder box) are a few px wider or taller than the rendered words
  ['rxkids', ['shifted steps.note: 589x38 → 593x38 (stand-in)']],
  ['tax-testimony', ['shifted chart.title: 28x19 → 28x29 (stand-in)', 'shifted footer.note: 20x13 → 20x21 (stand-in)',
                     'shifted p6.contd: 433x21 → 416x21 (stand-in)']],
  ['tfc-2027-priorities', ['shifted eyebrow.p-1: 912x12 → 912x18 (in place)', 'shifted gloss.span-2: 704x13 → 704x18 (in place)',
                           'shifted split.sub: 736x15 → 736x23 (in place)']],
  ['wfc-credits', ['shifted ha-est-section-inner.p-txt-12: 234x18 → 240x18 (in place)',
                   'shifted ha-est-section-inner.p-txt-1: 343x18 → 349x18 (in place)']],
]);

const PROBE = 'ZQXJ';

/** Open, type, cancel, commit and undo every visible slot. Runs inside the
 *  editor window (page.evaluate) so it sees the same globals the UI does. */
const sweepSlots = page => page.evaluate(async (PROBE) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 4000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (f()) return true; await sleep(25); }
    return f();
  };
  // A commit, cancel or undo ends in render(); the twin document swaps in
  // only once it has loaded, so wait for the render to be over and settle.
  const settled = async () => {
    await until(() => !renderRunning && !editing, 10000);
    await until(() => [...D().images].every(i => i.complete), 5000);   // a picture still loading has no height yet
    await sleep(60);
  };
  const D = () => document.getElementById('out').contentDocument;
  const esc = k => CSS.escape(k);
  // Shown as a person sees it: laid out with size, not at opacity 0, not in
  // a closed panel (a tab not chosen, a details folded away).
  const shown = e => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    return e.checkVisibility ? e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
      : getComputedStyle(e).visibility !== 'hidden';
  };
  const blocksOf = key => {
    const all = [...D().querySelectorAll(`[data-slot="${esc(key)}"]`)].filter(shown);
    const pg = all[0] && all[0].closest('section.page');    // one page's copies, not every page's
    return pg ? all.filter(b => b.closest('section.page') === pg) : all;
  };
  const visibleOf = key => blocksOf(key)[0];
  const union = els => {
    // consecutive paragraphs of one slot measure together; copies of a slot
    // drawn apart on the page (a running label, a repeated figure) are each
    // their own box, and the first is the one the sweep clicks
    const run = [els[0]];
    for (let i = 1; i < els.length; i++) {
      const a = run[run.length - 1].getBoundingClientRect(), b = els[i].getBoundingClientRect();
      if (b.top - a.bottom > 60) break;
      run.push(els[i]);
    }
    els = run;
    const rs = els.map(e => e.getBoundingClientRect());
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top));
    return { w: Math.round(Math.max(...rs.map(r => r.right)) - l), h: Math.round(Math.max(...rs.map(r => r.bottom)) - t) };
  };
  // The point a person clicks: on the first drawn glyph run, not the box's corner
  const glyphPt = el => {
    const d = el.ownerDocument;
    const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = d.createRange(); r.selectNodeContents(n);
      const b = [...r.getClientRects()].find(x => x.width > 2 && x.height > 2);
      if (b) return { x: b.left + Math.min(b.width / 2, 10), y: b.top + b.height / 2 };
    }
    const r0 = el.getBoundingClientRect();
    return { x: r0.left + Math.min(r0.width / 2, 12), y: r0.top + Math.min(r0.height / 2, 8) };
  };
  const hostOf = key => D().querySelector(
    `.ds-edit[data-slot="${esc(key)}"], input[data-slot="${esc(key)}"]`);
  // Append the probe as typing would: through the document the host lives in.
  const typeInto = host => {
    const od = host.ownerDocument;
    if (host.tagName === 'INPUT') {
      host.value = host.value + PROBE;
      host.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const s = od.getSelection(); const rg = od.createRange();
    rg.selectNodeContents(host); rg.collapse(false); s.removeAllRanges(); s.addRange(rg);
    od.execCommand('insertText', false, PROBE);
  };
  const keys = [...new Set([...D().querySelectorAll('section.page [data-slot]')]
    .map(e => e.dataset.slot))];
  const fails = [], shifted = [], covered = [], skipped = [], refused = [];
  let n = 0;
  for (const key of keys) {
    const d = D();
    const el = visibleOf(key);
    if (!el) { skipped.push(key); continue; }
    n++;
    el.scrollIntoView({ block: 'center' });
    const svg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    const inObj = !!el.closest('[data-el]');
    // reach: the point a person clicks must land on the field
    const { x: px, y: py } = glyphPt(el);
    const stack = [...d.elementsFromPoint(px, py)].filter(shown);
    const hit = stack.find(n => n.closest('[data-slot]') && shown(n.closest('[data-slot]'))) || stack[0] || null;
    if (!hit || !(el === hit || el.contains(hit) || hit.closest(`[data-slot="${esc(key)}"]`)))
      covered.push(`${key} ← ${hit ? hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(/\s+/)[0] : '') : 'nothing'}`);
    const before = union(blocksOf(key));
    const was = slotRe(key).test(source) ? readSlot(key) : null;
    // open
    el.dispatchEvent(new MouseEvent(inObj ? 'dblclick' : 'click',
      { bubbles: true, cancelable: true, view: d.defaultView, clientX: px, clientY: py }));
    await until(() => hostOf(key), 1500);
    let host = hostOf(key);
    if (!host) { fails.push(`${key}: no editor opened on ${inObj ? 'double-click' : 'click'}`); continue; }
    if (!(d.activeElement === host || host.contains(d.activeElement)))
      fails.push(`${key}: editor opened but is not focused (active: ${d.activeElement && d.activeElement.tagName})`);
    const isInput = host.tagName === 'INPUT';
    if (!isInput && host.contentEditable !== 'true') fails.push(`${key}: host is not contenteditable`);
    // steady (a button's words are edited in a span inside it: the button is the box)
    if (!svg) {
      const outer = host.parentElement && host.parentElement.tagName === 'BUTTON'
        && host.parentElement.dataset.slot === key ? host.parentElement : host;
      const r1 = outer.getBoundingClientRect();
      const dw = Math.round(r1.width) - before.w, dh = Math.round(r1.height) - before.h;
      if (Math.abs(dw) > 3 || Math.abs(dh) > 3)
        shifted.push(`${key}: ${before.w}x${before.h} → ${Math.round(r1.width)}x${Math.round(r1.height)}${host.classList.contains('ds-edit-in') ? ' (in place)' : ' (stand-in)'}`);
    }
    // type
    typeInto(host);
    const typedIn = isInput ? host.value.includes(PROBE) : host.textContent.includes(PROBE);
    if (!typedIn) fails.push(`${key}: typing did not land in the editor`);
    // cancel
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const closed = await until(() => !editing && !hostOf(key), 6000);
    if (!closed) { fails.push(`${key}: Escape did not close the editor`); continue; }
    await settled();
    await until(() => visibleOf(key), 6000);
    const after = slotRe(key).test(source) ? readSlot(key) : null;
    if (after !== was) fails.push(`${key}: Escape changed the markdown`);
    if (after && after.includes(PROBE)) fails.push(`${key}: Escape committed the probe`);
    // commit + undo (only a slot the document already holds; a defaulted
    // label's first commit writes a new block, which is its own test)
    if (was === null) continue;
    const el2 = visibleOf(key);
    if (!el2) { fails.push(`${key}: gone after cancel`); continue; }
    el2.scrollIntoView({ block: 'center' });
    const p2 = glyphPt(el2);
    el2.dispatchEvent(new MouseEvent(inObj ? 'dblclick' : 'click',
      { bubbles: true, cancelable: true, view: el2.ownerDocument.defaultView,
        clientX: p2.x, clientY: p2.y }));
    await until(() => hostOf(key), 1500);
    host = hostOf(key);
    if (!host) { fails.push(`${key}: did not reopen after cancel`); continue; }
    typeInto(host);
    host.blur();
    const committed = await until(() => !editing && !hostOf(key) && readSlot(key).includes(PROBE), 8000);
    await settled();
    if (committed && renderFailed) {
      // the renderer refused the words (a heading pinned to its data, say):
      // its own guard, said in the canvas — not an editor fault
      refused.push(`${key}: ${(renderError || 'the renderer refused the draft').split('\n')[0].slice(0, 100)}`);
      await undo(); await settled();
      continue;
    }
    if (!committed) {
      fails.push(`${key}: commit did not reach the markdown`);
      if (editing) { const h = hostOf(key); if (h) h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await until(() => !editing, 4000); }
      await settled();
      continue;
    }
    await settled();
    await until(() => visibleOf(key), 6000);
    if (blocksOf(key).length && !blocksOf(key).some(b => b.textContent.includes(PROBE)))
      fails.push(`${key}: committed words are not on the page`);
    await undo();
    const undone = await until(() => !readSlot(key).includes(PROBE), 8000);
    if (!undone) fails.push(`${key}: undo did not take the probe out`);
    else if (readSlot(key) !== was) fails.push(`${key}: undo left different markdown`);
    await settled();
    await until(() => visibleOf(key), 6000);
  }
  return { n, keys: keys.length, fails, shifted, covered, skipped, refused };
}, PROBE);

/** Move every unlocked object by the pilot API and put it back. */
const sweepMoves = page => page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 4000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (f()) return true; await sleep(25); }
    return f();
  };
  const inv = docsync.api.inventory();
  const fails = [], unmeasured = [];
  const D = () => document.getElementById('out').contentDocument;
  // An object a hidden tab or slide holds has nowhere to paint: not a move.
  const shown = id => { const el = D().querySelector(`[data-el="${CSS.escape(id)}"], [data-shape="${CSS.escape(id)}"]`);
    return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); };
  let n = 0, hidden = 0;
  for (const pg of inv.pages) {
    for (const e of pg.elements) {
      if (e.locked || e.hidden || e.kind === 'endnote') continue;   // an endnote entry reorders, it is not placed
      if (!shown(e.id)) { hidden++; continue; }
      if (!e.box) { unmeasured.push(e.id); continue; }
      n++;
      // A move clamps at the page edge, as a drag does: expect what a drag would give.
      const pageH = (layout.page && layout.page.h === null) ? Infinity : PAGE_H_IN;
      const clampX = x => Math.min(Math.max(x, Math.min(0, e.box.x)), Math.max(PAGE_W_IN - Math.min(e.box.w, PAGE_W_IN), e.box.x));
      const clampY = y => Math.min(Math.max(y, Math.min(0, e.box.y)), Math.max(pageH - Math.min(e.box.h, pageH), e.box.y));
      const ex = clampX(e.box.x + 0.25) - e.box.x, ey = clampY(e.box.y + 0.25) - e.box.y;
      const r = await docsync.api.place(e.id, { x: e.box.x + 0.25, y: e.box.y + 0.25 });
      await until(() => !renderRunning, 10000);
      await until(() => [...D().images].every(i => i.complete), 5000);
      if (!r || r.ok === false) { fails.push(`${e.id}: place refused — ${r && r.error}`); continue; }
      const b = _pilotMeasure(e.id);
      if (!b) { fails.push(`${e.id}: unmeasurable after place`); await undo(); continue; }
      const dx = b.x - e.box.x, dy = b.y - e.box.y;
      if (Math.abs(dx - ex) > 0.06 || Math.abs(dy - ey) > 0.06)
        fails.push(`${e.id} (${e.kind}): asked +0.25,+0.25 (expected ${ex.toFixed(2)},${ey.toFixed(2)}) and moved ${dx.toFixed(2)},${dy.toFixed(2)}`);
      await undo();
      await until(() => !renderRunning, 10000);
      await until(() => [...D().images].every(i => i.complete), 5000);
      const back = docsync.api.inventory().pages.flatMap(p => p.elements).find(x => x.id === e.id);
      if (!back || !back.box || Math.abs(back.box.x - e.box.x) > 0.02 || Math.abs(back.box.y - e.box.y) > 0.02)
        fails.push(`${e.id} (${e.kind}): undo did not put it back (${back && back.box ? `${back.box.x},${back.box.y}` : 'gone'} vs ${e.box.x},${e.box.y})`);
    }
  }
  return { n, hidden, fails, unmeasured };
});


// ---- the real mouse ------------------------------------------------------
// Synthetic events above exercise edit() directly. A person reaches a field
// through startDrag's release (typeOnClick) with a real pointer, through
// whatever is drawn over the words — so every slot is opened once more by
// a real click at a point on its own glyphs.

/** Top-level point on the first drawn glyph run of a slot, or null. */
const glyphPoint = (page, key) => page.evaluate((key) => {
  const fr = document.getElementById('out');
  const d = fr.contentDocument;
  const el = [...d.querySelectorAll(`[data-slot="${CSS.escape(key)}"]`)]
    .find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  if (!el) return null;
  const rr = el.getBoundingClientRect();
  if (!(rr.width > 0 && rr.height > 0)) return null;
  if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return null;
  el.scrollIntoView({ block: 'center' });
  const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let best = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    if (n.parentElement.closest('.ds-handles, .ds-mini')) continue;
    const r = d.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter(b => b.width > 2 && b.height > 2);
    if (rects.length) { best = rects[0]; break; }
  }
  if (!best) { const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return null; best = b; }
  const fb = fr.getBoundingClientRect();
  const k = fb.width / fr.offsetWidth;
  const x = best.left + Math.min(best.width / 2, 10), y = best.top + best.height / 2;
  const shownN = n => !n.checkVisibility || n.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const stack = [...d.elementsFromPoint(x, y)].filter(shownN);
  const hit = stack.find(n => n.closest('[data-slot]') && shownN(n.closest('[data-slot]'))) || stack[0] || null;
  const onIt = !!(hit && (el === hit || el.contains(hit) || hit.closest(`[data-slot="${CSS.escape(key)}"]`)));
  return { x: fb.left + x * k, y: fb.top + y * k, onIt,
           hit: hit ? hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' && hit.className.trim() ? '.' + hit.className.trim().split(/\s+/)[0] : '') : 'nothing',
           svg: el.namespaceURI === 'http://www.w3.org/2000/svg',
           inGroup: !!(el.closest('[data-el]') && (layout.groups || []).some(g => g.includes(el.closest('[data-el]').dataset.el))) };
}, key);

const openHost = page => page.evaluate(() => {
  const d = document.getElementById('out').contentDocument;
  const h = d.querySelector('.ds-edit[data-slot], input[data-slot], .ds-cell-edit');
  return h ? (h.dataset.slot || 'cell') : null;
});

const settle = page => page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = performance.now();
  while (performance.now() - t0 < 10000 && (renderRunning || editing)) await sleep(25);
  await sleep(60);
});

async function mouseSweep(page) {
  const keys = await page.evaluate(() => [...new Set([...document.getElementById('out').contentDocument
    .querySelectorAll('section.page [data-slot]')].map(e => e.dataset.slot))]);
  const fails = [], needsDouble = [], covered = [];
  let n = 0;
  for (const key of keys) {
    const pt = await glyphPoint(page, key);
    if (!pt) continue;
    n++;
    if (!pt.onIt) covered.push(`${key} ← ${pt.hit}`);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(120);
    let who = await openHost(page);
    let how = 'click';
    if (!who) {
      await page.mouse.dblclick(pt.x, pt.y);
      await page.waitForTimeout(120);
      who = await openHost(page);
      how = 'double-click';
    }
    if (!who) {
      // a group: click selects, a second click drills in, a third types
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(120);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(120);
      who = await openHost(page);
      how = 'three clicks';
    }
    if (!who) fails.push(`${key}: no editor opened under a real click, double-click or three clicks (pointer on ${pt.hit})`);
    else if (who !== key) fails.push(`${key}: the pointer opened ${who} instead (on ${pt.hit})`);
    else if (how !== 'click' && !pt.svg && !pt.inGroup) needsDouble.push(`${key}: needs a ${how}`);
    if (who) { await page.keyboard.press('Escape'); }
    await settle(page);
    await page.keyboard.press('Escape');     // clear the selection too
    await page.waitForTimeout(40);
  }
  return { n, fails, needsDouble, covered };
}

// ---- cells, panels, handles ----------------------------------------------
const cellSweep = page => page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 4000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (f()) return true; await sleep(25); }
    return f();
  };
  const D = () => document.getElementById('out').contentDocument;
  const cells = [...D().querySelectorAll('section.page [data-el^="table."] [data-cell]')]
    .filter(td => td.getClientRects().length)
    .map(td => ({ id: td.closest('[data-el^="table."]').dataset.el, cell: td.dataset.cell }));
  const fails = [];
  for (const c of cells) {
    const td = D().querySelector(`[data-el="${CSS.escape(c.id)}"] [data-cell="${c.cell}"]`);
    if (!td) { fails.push(`${c.id} ${c.cell}: cell gone`); continue; }
    td.scrollIntoView({ block: 'center' });
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: td.ownerDocument.defaultView }));
    const ok = await until(() => D().querySelector('.ds-cell-edit'), 1500);
    const host = D().querySelector('.ds-cell-edit');
    if (!ok || !host) { fails.push(`${c.id} ${c.cell}: double-click opened no cell editor`); continue; }
    if (!(D().activeElement === host || host.contains(D().activeElement))) fails.push(`${c.id} ${c.cell}: cell editor not focused`);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const closed = await until(() => !editing && !D().querySelector('.ds-cell-edit'), 6000);
    if (!closed) { fails.push(`${c.id} ${c.cell}: Escape did not close the cell editor`); }
    await until(() => !renderRunning && !editing, 10000); await sleep(40);
  }
  return { n: cells.length, fails };
});

const panelSweep = page => page.evaluate(async () => {
  const inv = docsync.api.inventory();
  const fails = [];
  let charts = 0, tables = 0;
  for (const pg of inv.pages) for (const e of pg.elements) {
    if (e.kind === 'chart') {
      charts++;
      openChartPanel(e.id);
      const pop = $('chartpop');
      if (sidePanelTool !== 'chart' || !pop || pop.hidden) fails.push(`${e.id}: Chart panel did not open`);
      else if (!pop.querySelector('input, select, textarea, button')) fails.push(`${e.id}: Chart panel opened with no controls`);
      closeSide();
    }
    if (e.kind === 'table') {
      tables++;
      openTablePanel(e.id);
      const pop = $('tablepop');
      if (sidePanelTool !== 'table' || !pop || pop.hidden) fails.push(`${e.id}: Table panel did not open`);
      else if (/No table selected/.test(pop.textContent)) fails.push(`${e.id}: Table panel says no table selected`);
      closeSide();
    }
  }
  return { charts, tables, fails };
});

/** Drag one resize handle of every unlocked object with the real mouse. */
async function handleSweep(page) {
  const ids = await page.evaluate(() => {
    const d = document.getElementById('out').contentDocument;
    const shown = id => { const el = d.querySelector(`[data-el="${CSS.escape(id)}"], [data-shape="${CSS.escape(id)}"]`);
      return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); };
    return docsync.api.inventory().pages
      .flatMap(p => p.elements).filter(e => !e.locked && !e.hidden && e.box && shown(e.id)).map(e => e.id);
  });
  const fails = [], noHandles = [];
  let n = 0;
  for (const id of ids) {
    const h = await page.evaluate(async (id) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      await docsync.api.select(id);
      await sleep(60);
      const fr = document.getElementById('out');
      const d = fr.contentDocument;
      const ov = d.querySelector(`.ds-handles[data-for="${CSS.escape(id)}"]`);
      if (!ov) return { none: true };
      const order = ['se', 'e', 's', 'ne', 'sw', 'nw', 'n', 'w'];
      let h = null, dir = null;
      for (const k of order) { h = ov.querySelector(`.ds-h-${k}`); if (h) { dir = k; break; } }
      if (!h) return { none: true, rot: !!ov.querySelector('.ds-rot, .ds-rot-corner') };
      h.scrollIntoView({ block: 'center' });
      const b = h.getBoundingClientRect(), fb = fr.getBoundingClientRect();
      const k = fb.width / fr.offsetWidth;
      const hit = d.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const m = _pilotMeasure(id);
      const pg = d.querySelector(`[data-el="${CSS.escape(id)}"], [data-shape="${CSS.escape(id)}"]`).closest('section.page');
      const pageH = (layout.page && layout.page.h === null) ? Infinity : PAGE_H_IN;
      // 30 screen px is this many page inches, through the stage's scale and the page's zoom
      const perPx = 1 / (96 * k * zoomOf(pg));
      return { x: fb.left + (b.left + b.width / 2) * k, y: fb.top + (b.top + b.height / 2) * k, dir,
               reach: hit === h, was: m ? { x: m.x, y: m.y, w: m.w, h: m.h } : null, perPx,
               // room to grow before the page edge; a box at or past the edge has none
               roomE: m && m.x + m.w < PAGE_W_IN - 0.05 ? PAGE_W_IN - (m.x + m.w) : 0,
               roomS: m && m.y + m.h < pageH - 0.05 ? pageH - (m.y + m.h) : 0 };
    }, id);
    if (h.none) { noHandles.push(id); continue; }
    n++;
    if (!h.reach) fails.push(`${id}: the ${h.dir} handle is drawn but the pointer cannot reach it`);
    const dx = h.dir.includes('e') ? 30 : h.dir.includes('w') ? -30 : 0;
    const dy = h.dir.includes('s') ? 30 : h.dir.includes('n') ? -30 : 0;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + dx / 2, h.y + dy / 2, { steps: 3 });
    await page.mouse.move(h.x + dx, h.y + dy, { steps: 3 });
    await page.mouse.up();
    await settle(page);
    const now = await page.evaluate(id => { const m = _pilotMeasure(id); return m ? { w: m.w, h: m.h } : null; }, id);
    // what the drag asked for in inches, less what the page edge allows
    const askW = Math.min(30 * h.perPx, Math.max(0, h.roomE)), askH = Math.min(30 * h.perPx, Math.max(0, h.roomS));
    const grewW = now && h.was && now.w > h.was.w + askW * 0.5;
    const grewH = now && h.was && now.h > h.was.h + askH * 0.5;
    // under a tenth of an inch of room is the clamp's rounding, not a resize
    const expectW = dx !== 0 && askW > 0.1, expectH = dy !== 0 && askH > 0.1;
    if (!now) fails.push(`${id}: unmeasurable after a ${h.dir} resize`);
    else if ((expectW && !grewW) && (expectH && !grewH))
      fails.push(`${id}: ${h.dir} handle dragged ${dx},${dy}px and the box stayed ${h.was.w}x${h.was.h} (now ${now.w.toFixed(2)}x${now.h.toFixed(2)})`);
    else if (expectW && !expectH && !grewW)
      fails.push(`${id}: ${h.dir} handle dragged and width stayed ${h.was.w} (now ${now.w.toFixed(2)}; x ${h.was.x}, room ${h.roomE.toFixed(2)}, asked ${askW.toFixed(2)})`);
    await page.evaluate(async () => { await undo(); });
    await settle(page);
    const back = await page.evaluate(id => { const m = _pilotMeasure(id); return m ? { w: m.w, h: m.h } : null; }, id);
    if (back && h.was && (Math.abs(back.w - h.was.w) > 0.03 || Math.abs(back.h - h.was.h) > 0.03))
      fails.push(`${id}: undo after resize left ${back.w.toFixed(2)}x${back.h.toFixed(2)}, was ${h.was.w}x${h.was.h}`);
    await page.keyboard.press('Escape');
  }
  return { n, fails, noHandles };
}

test('every bound report was discovered', () => {
  test.skip(!WANTED, 'opt-in: DS_ONLY=<id,…> or DS_SWEEP=1');
  expect(REPORTS.length, REPORTS.map(r => r.id).join(', ')).toBeGreaterThan(0);
});

for (const rep of REPORTS) {
  test(`${rep.id}: every field opens, takes words, and every object moves`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
    await gotoEditor(page, rep.id === 'budget-primer' ? '' : `?project=${rep.id}`);
    await page.evaluate(() => document.getElementById('out').contentDocument.fonts.ready);
    await page.waitForTimeout(500);
    const s = await sweepSlots(page);
    const m = await sweepMoves(page);
    const dirtyAfter = await page.evaluate(() => dirty);
    const lines = [
      `${rep.id}: ${s.n}/${s.keys} slots opened, ${m.n} objects moved; ${s.skipped.length} hidden slots and ${m.hidden} hidden objects skipped`,
      ...s.fails.map(f => `  FAIL slot ${f}`),
      ...m.fails.map(f => `  FAIL move ${f}`),
      ...s.shifted.map(f => `  shifted ${f}`),
      ...s.covered.map(f => `  covered ${f}`),
      ...s.refused.map(f => `  refused ${f}`),
      ...m.unmeasured.map(f => `  unmeasured ${f}`),
      ...errors.map(f => `  ${f}`),
    ];
    console.log(lines.join('\n'));
    const known = KNOWN.get(rep.id) || [];
    const soft = [...s.shifted.map(f => `shifted ${f}`), ...s.covered.map(f => `covered ${f}`)];
    const fresh = soft.filter(f => !known.includes(f));
    const gone = known.filter(f => !soft.includes(f));
    // A missing-file probe at boot (the editor asks for a staged manifest
    // and a demo page that may not exist) is reported, not failed.
    // A Python traceback is the renderer refusing a draft (listed under
    // `refused`); the editor's own errors are what must not happen.
    const hard = errors.filter(e => !/^http 404:|Failed to load resource/.test(e)
      && !(s.refused.length && /^pageerror: Traceback/.test(e)));
    expect(hard, 'no page errors or console errors during the sweep').toEqual([]);
    expect(s.fails, 'every slot opens, cancels, commits and undoes').toEqual([]);
    expect(m.fails, 'every object moves and undoes').toEqual([]);
    expect(dirtyAfter, 'the sweep left the document as it found it').toBe(false);
    if (rep.strict) {
      expect(fresh, `${rep.id}: fields that shift or are covered`).toEqual([]);
      expect(gone, `${rep.id}: fixed — delete these from KNOWN`).toEqual([]);
    }
  });
}

for (const rep of REPORTS) {
  test(`${rep.id}: a real pointer opens every field; cells, panels and handles work`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await gotoEditor(page, rep.id === 'budget-primer' ? '' : `?project=${rep.id}`);
    await page.evaluate(() => document.getElementById('out').contentDocument.fonts.ready);
    await page.waitForTimeout(500);
    const mo = await mouseSweep(page);
    const ce = await cellSweep(page);
    const pa = await panelSweep(page);
    const ha = await handleSweep(page);
    const dirtyAfter = await page.evaluate(() => dirty);
    const lines = [
      `${rep.id}: mouse opened ${mo.n} slots; ${ce.n} cells; ${pa.charts} charts, ${pa.tables} tables; ${ha.n} handles dragged, ${ha.noHandles.length} objects with no resize handle`,
      ...mo.fails.map(f => `  FAIL mouse ${f}`),
      ...ce.fails.map(f => `  FAIL cell ${f}`),
      ...pa.fails.map(f => `  FAIL panel ${f}`),
      ...ha.fails.map(f => `  FAIL handle ${f}`),
      ...mo.needsDouble.map(f => `  double ${f}`),
      ...mo.covered.map(f => `  covered ${f}`),
      ...ha.noHandles.map(f => `  no-handles ${f}`),
      ...errors.filter(e => !/Failed to load resource/.test(e)).map(f => `  ${f}`),
    ];
    console.log(lines.join('\n'));
    const hard = errors.filter(e => !/Failed to load resource/.test(e));
    expect(hard, 'no page errors or console errors').toEqual([]);
    expect(mo.fails, 'a real pointer opens every field').toEqual([]);
    expect(ce.fails, 'every table cell opens on a double-click').toEqual([]);
    expect(pa.fails, 'every chart and table opens its panel').toEqual([]);
    expect(ha.fails, 'every resize handle resizes').toEqual([]);
    expect(dirtyAfter, 'the sweep left the document as it found it').toBe(false);
  });
}
