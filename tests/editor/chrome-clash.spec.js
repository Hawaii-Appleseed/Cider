// Chrome clash matrix: the editor's own chrome (menu bar, Control bar, rulers,
// left rail and its trays, right dock and its panel, page strip, comments and
// history gutter, the floating card, pop-ups) opened together, at every window
// size, must not cover, push or clip one another. Each state below is a thing
// a person does; for each window size the pieces that are SHOWN are measured
// (bounding boxes, and what answers a press at each box's corners) and no two
// may overlap, every open tray must be wholly inside the window, and no piece
// may be hit-tested away by another.
//
// CLASH_SHOTS=<dir> also writes one screenshot per state and size, which is how
// the audit table was made (a finding is looked at, not only measured).
const fs = require('fs');
const path = require('path');
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const SHOTS = process.env.CLASH_SHOTS || '';
const DUMP = process.env.CLASH_DUMP || '';
const WIDTHS = (process.env.CLASH_W || '760,1100,1280,1440,1920').split(',').map(Number);
const HEIGHTS = (process.env.CLASH_H || '600,720,900').split(',').map(Number);

// What counts as a piece of chrome, and how to find the part of it that is
// actually drawn. A band that passes clicks through (the page strip, the
// floating card) is measured by its CONTROLS: the band itself covers nothing.
const PIECES = {
  bar: '#bar',
  ctl: '#ctl',
  rail: '#leftrail',
  tray: '#side:not([hidden]):not(.folded)',
  trayFold: '#side-fold',
  ruleT: '#ruler-t:not([hidden])',
  ruleL: '#ruler-l:not([hidden])',
  ruleC: '#ruler-c:not([hidden])',
  dockIcons: '#dock:not([hidden]) #dock-icons',
  dockPanel: '#dock:not([hidden]) #dock-panel:not([hidden])',
  strip: '#rail:not([hidden]) #rail-fold, #rail:not([hidden]) #rail-head, #rail:not([hidden]) #rail-list > *, #rail:not([hidden]) #rail-add',
  cpanel: '#cpanel:not([hidden])',
  hpanel: '#hpanel:not([hidden])',
  card: '#context:not([hidden]) > :not([hidden])',
  palette: '#palette:not([hidden]) #pal-card',
  pop: '.pop:not([hidden]):not(.docked)',
  railTab: '#rail-tab:not([hidden])',
  dockTab: '#dock-tab:not([hidden])',
  pill: '#focus-pill:not([hidden])',
};
// Pairs that are SUPPOSED to share pixels. The rulers are drawn over the stage,
// not over each other's chrome; nothing else is allowed.
const OK_PAIRS = new Set([
  // the rulers are one assembly (the corner sits where they meet), and a tray
  // or a fly-out is drawn over a ruler it crosses: the rulers are canvas
  // furniture, the tray is a panel
  'ruleL|ruleT', 'ruleC|ruleT', 'ruleC|ruleL', 'ruleT|tray', 'ruleL|tray', 'ruleC|tray',
  // a tray's own fold tab hangs on its edge
  'tray|trayFold',
  // the dock's fly-out is drawn over a ruler it crosses, as a tray is
  'dockPanel|ruleT', 'dockPanel|ruleL',
]);

/** Everything shown, as {name, box}; run in the page. A strip chip scrolled out
 *  of the strip is clipped to the strip (it is not drawn there). Also every
 *  control of the fixed chrome, and what answers a press at its centre. */
function measureChrome(PIECES) {
  const out = [], blocked = [];
  const strip = document.getElementById('rail');
  for (const [name, sel] of Object.entries(PIECES)) {
    document.querySelectorAll(sel).forEach((el, i) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const b = el.getBoundingClientRect();
      let l = b.left, t = b.top, r = b.right, bt = b.bottom;
      if (name === 'strip' && strip && !el.matches('#rail-fold, #rail-head')) {
        const q = strip.getBoundingClientRect();
        l = Math.max(l, q.left); r = Math.min(r, q.right);
      }
      if (r - l < 2 || bt - t < 2) return;
      out.push({ name: name + (i ? '#' + i : ''), kind: name, id: el.id || String(el.className).split(' ')[0] || el.tagName,
                 l, t, r, b: bt });
    });
  }
  const own = new Set(['leftrail', 'side', 'dock-icons', 'dock-panel']);
  document.querySelectorAll('#leftrail button, #dock-icons button, #bar > button, #ctl button, #rail-fold, #rail-add, #side-fold, #side-x, #dock-head button, #rail-tab, #dock-tab, #focus-pill')
    .forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) return;
      if (el.closest('[hidden]')) return;
      if (document.querySelector('#palette:not([hidden])')) return;      // a modal: it is meant to cover them
      // Every control is probed at its top edge, centre, both sides and foot, not only
      // its middle: the top ruler once covered only the first few pixels of the
      // Select tool, which a centre or corner probe never saw (PR 171).
      const pts = [[0.5, 0.08], [0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.92]];
      for (const [fx, fy] of pts) {
        const x = b.left + b.width * fx, y = b.top + b.height * fy;
        if (strip && strip.contains(el)) {          // scrolled out of the strip: not drawn, so not blocked
          const q = strip.getBoundingClientRect();
          if (x < q.left || x > q.right) continue;
        }
        const crow = el.closest('.ctl-row');         // a row of the Control bar scrolls: out of its box is not drawn
        if (crow) { const q = crow.getBoundingClientRect(); if (x < q.left || x > q.right) continue; }
        const name = el.id || el.getAttribute('aria-label') || el.className || el.tagName;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) { blocked.push(name + ' is outside the window'); break; }
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit) || hit.contains(el) && hit.tagName === 'LABEL')) {
          blocked.push(`${name} at (${fx}, ${fy}) is under ${hit && (hit.id || hit.className || hit.tagName)}`);
          break;
        }
      }
    });
  return { items: out, blocked };
}

// --- the states ------------------------------------------------------------
// Each one is reset by `rest`, so a state is only ever what it says it is.
async function rest(page) {
  await page.evaluate(async () => {
    if (typeof closePalette === 'function') closePalette();
    setRailFolded(false);
    document.querySelectorAll('.pop').forEach(p => { if (!p.classList.contains('docked')) p.hidden = true; });
    if (typeof closeSide === 'function') closeSide();
    if (typeof dockClose === 'function') { dockPinned = false; dockStore('ds-dockpin', '0'); dockClose(); }
    if (!dockOn) toggleDock(true);
    if (!ctlOn) toggleCtlBar(true);
    if (!railOn) toggleRail(true);
    if (focusOn) toggleFocus(false);
    if (guidesOn) toggleGuides();
    const c = $('cpanel'), h = $('hpanel');
    if (c) { c.hidden = true; c.classList.remove('margin'); }
    if (h) { h.hidden = true; h.classList.remove('gutter'); }
    document.body.classList.remove('cmt-margin');
    const d = $('out').contentDocument;
    if (d && d.activeElement && d.activeElement.blur) d.activeElement.blur();
    setSel(d, []);
  });
  await settled(page);
}

/** Click into the words of the first field of the page, with the real pointer. */
async function openWords(p) {
  const at = await p.evaluate(() => {
    const out = $('out'), d = out.contentDocument;
    const f = [...d.querySelectorAll('[data-slot]')].find(e => e.textContent.trim().length > 12 && e.getBoundingClientRect().width > 60);
    if (!f) return null;
    f.scrollIntoView({ block: 'center' });
    const r = f.getBoundingClientRect(), or = out.getBoundingClientRect(), sc = or.width / out.offsetWidth;
    return { x: or.left + (r.left + Math.min(r.width / 2, 40)) * sc, y: or.top + (r.top + r.height / 2) * sc };
  });
  if (at) await p.mouse.click(at.x, at.y);
}

const STATES = {
  base: async () => {},
  rulers: async p => { await p.evaluate(() => { toggleGuides(); }); },
  'tray-colors': async p => { await p.click('#colors'); },
  'tray-colors+rulers': async p => { await p.evaluate(() => toggleGuides()); await p.click('#colors'); },
  'tray-shape': async p => { await p.click('#shape'); },
  'tray-text': async p => { await p.click('#text'); },
  palette: async p => { await p.click('#insert'); },
  'dock-layers': async p => { await p.evaluate(() => dockShow('layers')); },
  'dock-pinned': async p => { await p.evaluate(() => { dockPinned = true; dockShow('layers'); }); },
  'dock-pinned+tray+rulers': async p => {
    await p.evaluate(() => { toggleGuides(); dockPinned = true; dockShow('layers'); });
    await p.click('#colors');
  },
  'dock-flyout+tray': async p => { await p.evaluate(() => dockShow('layers')); await p.click('#colors'); },
  'tray+gutter': async p => {
    await p.click('#colors');
    await p.evaluate(() => { const c = $('cpanel'); c.hidden = false; c.classList.add('margin'); hubGutterSync(); });
  },
  'gutter+dock-pinned': async p => {
    await p.evaluate(() => { dockPinned = true; dockShow('layers'); const c = $('cpanel'); c.hidden = false; c.classList.add('margin'); hubGutterSync(); });
  },
  history: async p => {
    await p.evaluate(() => { const h = $('hpanel'); h.hidden = false; hubGutterSync(); });
  },
  'history+dock-pinned+tray': async p => {
    await p.evaluate(() => { dockPinned = true; dockShow('layers'); const h = $('hpanel'); h.hidden = false; hubGutterSync(); });
    await p.click('#colors');
  },
  selected: async p => {
    await p.evaluate(async () => {
      const inv = docsync.api.inventory();
      const el = (inv.elements || []).find(e => e.kind !== 'page' && e.box) || null;
      if (el) await docsync.api.select(el.id);
    });
  },
  'selected+tray+dock+rulers': async p => {
    await p.evaluate(async () => {
      toggleGuides();
      const inv = docsync.api.inventory();
      const el = (inv.elements || []).find(e => e.kind !== 'page' && e.box) || null;
      if (el) await docsync.api.select(el.id);
      dockShow('xform');
    });
    await p.click('#colors');
  },
  editing: async p => { await openWords(p); },
  'editing+tray+dock+rulers': async p => {
    await p.evaluate(() => { toggleGuides(); dockShow('para'); });
    await openWords(p);
    await p.click('#shape');
  },
  'strip-folded+tray': async p => { await p.evaluate(() => setRailFolded(true)); await p.click('#colors'); },
  'view-menu': async p => { await p.click('#view'); },
  'rail-off+rulers': async p => { await p.evaluate(() => { toggleGuides(); toggleRail(false); }); },
  'dock-off+rulers+gutter': async p => {
    await p.evaluate(() => { toggleGuides(); toggleDock(false); const c = $('cpanel'); c.hidden = false; c.classList.add('margin'); hubGutterSync(); });
  },
  'rail-off+dock-off+rulers': async p => { await p.evaluate(() => { toggleGuides(); toggleRail(false); toggleDock(false); }); },
  'rail-off+palette': async p => { await p.evaluate(() => { toggleRail(false); openPalette(); }); },
  focus: async p => { await p.evaluate(() => { toggleGuides(); toggleFocus(true); }); },
  'no-ctl+rulers+tray': async p => {
    await p.evaluate(() => { toggleCtlBar(false); toggleGuides(); });
    await p.click('#colors');
  },
};

function findClashes(items, vw, vh) {
  const bad = [];
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 3 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 3;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.kind === b.kind && !['rail'].includes(a.kind) && a.kind === 'strip') continue;   // siblings in one strip
    const key = [a.kind, b.kind].sort().join('|');
    // a menu hung from the bar is an overlay by nature (its top is checked below)
    if (OK_PAIRS.has(key) || a.kind === 'palette' || b.kind === 'palette' || a.kind === 'pop' || b.kind === 'pop') continue;
    // a pop-up is hung FROM something: it may cover its parent's neighbours,
    // but is what is on top there (checked by the hit test), so only report
    // the ones that sit under another piece
    if (hit(a, b)) bad.push(`${a.kind} (${a.id}) overlaps ${b.kind} (${b.id})`);
  }
  // wholly inside the window
  for (const it of items) {
    if (['pop', 'tray', 'dockPanel', 'palette', 'cpanel', 'hpanel'].includes(it.kind)
        && (it.l < -1 || it.t < -1 || it.r > vw + 1 || it.b > vh + 1)) {
      bad.push(`${it.kind} (${it.id}) is not wholly in the window: ${[it.l, it.t, it.r, it.b].map(Math.round)} in ${vw}x${vh}`);
    }
  }
  return bad;
}

test.describe('chrome clash matrix', () => {
  // one test per window height, so a run shares its work out across workers
  for (const h of HEIGHTS) for (const w of WIDTHS) {
    test(`every state in a ${w}x${h} window: nothing covers anything`, async ({ page }) => {
      test.setTimeout(180_000);
      await gotoEditor(page);
      const rows = [];
      {
        await page.setViewportSize({ width: w, height: h });
        await settled(page);
        for (const [name, act] of Object.entries(STATES)) {
          // the hub's panels sit beside the page only on a wide window; on a narrow one they
          // float over it, so only the one on its own is a state a person can be in
          if (w < 1100 && ['tray+gutter', 'gutter+dock-pinned', 'history+dock-pinned+tray', 'dock-off+rulers+gutter'].includes(name)) continue;
          await rest(page);
          await act(page);
          await page.waitForTimeout(150);   // the rail's fit and the strip's height settle in a frame or two
          const { items, blocked } = await page.evaluate(measureChrome, PIECES);
          const m = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, vh: window.innerHeight,
                                                 docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight }));
          const bad = findClashes(items, m.vw, m.vh);
          blocked.forEach(b => bad.push('control ' + b));
          if (m.docW > m.vw + 1) bad.push(`page scrolls sideways: ${m.docW} > ${m.vw}`);
          if (m.docH > m.vh + 1) bad.push(`page scrolls down: ${m.docH} > ${m.vh}`);
          rows.push({ state: name, w, h, bad });
          if (SHOTS && (bad.length || process.env.CLASH_ALL)) {
            fs.mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: path.join(SHOTS, `${name.replace(/[^a-z0-9+-]/gi, '_')}-${w}x${h}.png`) });
          }
        }
      }
      await rest(page);
      if (DUMP) { fs.mkdirSync(path.dirname(DUMP), { recursive: true }); fs.writeFileSync(DUMP + '.' + w + 'x' + h + '.json', JSON.stringify(rows, null, 1)); }
      const fails = rows.filter(r => r.bad.length);
      expect(fails.map(r => `${r.state} @${r.w}x${r.h}: ${r.bad.join('; ')}`), 'clashes').toEqual([]);
    });
  }
});
