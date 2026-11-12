// Shared fixtures for the draft-editor suite.
//
// Safety net: EVERY test — no exceptions — gets /__save, /__push and /__export
// blocked before it can navigate. Those three endpoints are served by the real
// report2027/tools/serve.py dev server and, unmocked, run actual `git commit` /
// `git push origin HEAD` + `HEAD:main` against this machine's real GitHub
// remote (see serve.py's _save()/_push()). A single spec that forgets to mock
// them would push a test commit to the live repo. Blocking happens here, once,
// so no individual spec file can opt out by omission.
//
// THE GAP THESE ROUTES DO NOT COVER: Playwright's `request` fixture is its own
// APIRequestContext, and browser-context routes never touch it. A spec that
// POSTs to /__save, /__push, /__export or /__upload through `request` reaches
// the REAL endpoint — and for the default project that means a real render, a
// real commit, or a real write inside /Users/…/BudgetPrimerFinal. Use `request`
// against the harmless endpoints only (/__ping, /__inventory, /__pilot, and
// argument-validation paths that refuse before doing any work).
//
// Routes are registered on the BROWSER CONTEXT, not the page: a page-level
// page.route() races the very first requests of an immediately-following
// goto() (Chromium's boot() fires /__ping, the Pyodide fetch, etc. before
// Playwright always finishes wiring page-level interception), so an early
// request can slip through unmocked. Context-level routes are attached before
// any page or navigation exists, so nothing can outrace them.
const base = require('@playwright/test');
const { impactFixtures } = require('./impact');

// Match /__ping WITH OR WITHOUT its query string. The editor appends
// ?project=<id> to every live-reload call, and a glob of '**/__ping' matches
// the bare path only — so every mock written that way silently stopped
// matching, the real dev server answered instead, and tests that meant to
// pin `ahead` (or to have no local server at all) quietly ran against this
// machine's actual repository. They then passed or failed according to how
// many unpushed commits happened to be sitting in it. One shared matcher, so
// there is no per-file spelling to get wrong again.
const PING = /\/__ping(\?|$)/;
const EVENTS = /\/__events(\?|$)/;
const UPDATE = /\/__update(\?|$)/;

async function blockDangerousLocalEndpoints(context) {
  // Now a NO-OP, kept so call sites and imports stay valid. The guard lives
  // in serve.py behind PRIMER_TEST_SAFE=1 (set on the suite webServer): the
  // context.route() blocks that used to live here turned on full request
  // interception, and Firefox's interception pipe wedges streaming the ~30MB
  // Pyodide fetch on a second boot — every multi-boot spec timed out at
  // first render, on an app that was fine. Server-side answering needs no
  // interception, and it also covers the `request`-fixture gap the old
  // comment above warns about: those POSTs never touched browser routes,
  // but they do hit the server. Specs that need a DIFFERENT response (e.g.
  // content-update's real scratch-clone pulls) still page.route() their own.
}

/** Wait for Pyodide to finish the first render: the report's page divs land
 *  inside the #out iframe via srcdoc once render() completes. Generous
 *  timeout — a cold Pyodide CDN fetch (~30MB) can take a while in CI.
 *
 *  data-ds-live FIRST, and it is load-bearing: the warm-boot preview (the
 *  last render, painted read-only while the engine compiles) contains the
 *  same .page divs, so waiting on those alone returned during the preview —
 *  and the whole test then raced the real first render, which replaces the
 *  document wholesale. The attribute is stamped only by render()'s swap. */
async function waitForFirstRender(page) {
  // 75s is calibrated to Chromium. Firefox compiles the same Pyodide WASM
  // noticeably slower, and under a fullyParallel run several boots compile at
  // once — the project-switching specs (a SECOND full boot inside one test)
  // were the ones that blew the budget, while the identical boot passed in
  // isolation with a minute to spare. Same code, slower clock: a cross-engine
  // run gets double the allowance rather than a skewed pass/fail line.
  const T = base.test.info().project.name === 'chromium' ? 75_000 : 150_000;
  await page.waitForSelector('#out[data-ds-live]', {
    state: 'attached', timeout: T,
  });
  await page.frameLocator('#out').locator('.page').first().waitFor({
    state: 'visible', timeout: T,
  });
}

async function gotoEditor(page, query = '') {
  // DS_CPU_THROTTLE=6 npx playwright test … — slow this page's CPU by that
  // factor, to reproduce CI-only timing failures on a fast dev machine. The
  // endnotes-page "execution context destroyed" race only shows above ~6x.
  if (process.env.DS_CPU_THROTTLE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.DS_CPU_THROTTLE) });
  }
  // A second gotoEditor inside one test means a real reload (a test of what
  // survives one), so only a test's first call may reset instead.
  const sh = SHARED.get(page);
  const testId = sh && base.test.info().testId;
  const first = sh && sh.lastTest !== testId;
  if (sh) sh.lastTest = testId;
  if (sh && first && sh.query === query && sh.fingerprint) {
    // Words left open, or a menu: Escape is how a person leaves either.
    if (await page.evaluate(() => editing).catch(() => false)) {
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    }
    const r = await page.evaluate(() => window.__dsTestReset ? window.__dsTestReset() : { ok: false })
      .catch(e => ({ ok: false, error: e.message }));
    if (r.ok) {
      await settled(page);
      const fp = await fingerprint(page);
      if (fp === sh.fingerprint) { sharedStats.resets++; return; }
      sharedStats.leaks++;
      console.log(`[shared editor] ${base.test.info().titlePath.join(' › ')}: the reset left ${whatDiffers(sh.fingerprint, fp)} behind, booting again`);
    }
  }
  if (sh) {
    sh.fingerprint = null;
    // Leave the old editor completely before the next one boots: navigating
    // straight from one report's editor to another's in the same tab left the
    // second's first nudge measuring against the first's page.
    // A test's own second open is a reload, and a reload keeps what the
    // origin stored (that is often what it tests); only a new test starts clean.
    if (first) {
      if (page.url() !== 'about:blank') await page.goto('about:blank');
      await wipeOrigin(sh.ctx, page, sh.baseURL);
    }
  }
  await page.goto('edit.html' + query);
  await waitForFirstRender(page);
  // Local mode (serve.py answers /__ping) polls its live-reload stream and
  // can pick up one legitimate version bump moments after the first paint,
  // which swaps the iframe's srcdoc wholesale and re-wires every listener.
  // A click racing that swap can land on an element about to be discarded.
  // This used to be a fixed 1.5s sleep — a quarter of a typical test, a
  // thousand times a run; the editor now says when it is settled.
  await settled(page);
  if (sh) { sharedStats.boots++; sh.query = query; sh.fingerprint = await fingerprint(page); }
}

/** Wait until the editor has nothing on its way: the local probe answered,
 *  its first catch-up ping applied (and any pull that ping started done),
 *  no render running, no twin iframe mid-load. Asked twice, 40ms apart, so
 *  a render that is about to start on the far side of a microtask (a click
 *  whose commit renders on the next tick) is not mistaken for quiet. */
async function settled(page, timeout = 30_000) {
  const quiet = () => page.waitForFunction(() => !window.__dsSettled || window.__dsSettled(),
                                           null, { timeout, polling: 25 });
  for (let i = 0; i < 4; i++) {
    await quiet();
    await page.waitForTimeout(40);
    if (await page.evaluate(() => !window.__dsSettled || window.__dsSettled())) return;
  }
}

/** Run `act` and wait for the render it causes to finish, then for the page
 *  to settle. Replaces "click, then sleep 800ms": the wait is exactly as
 *  long as the render. An action that may render nothing (opening words,
 *  selecting) passes `maybe: true` and gets a short grace instead of a
 *  failure when no render comes. */
async function afterRender(page, act, { maybe = false, timeout = 15_000 } = {}) {
  const s0 = await page.evaluate(() => window.__dsRenderSeq ? window.__dsRenderSeq() : 0);
  await act();
  try {
    await page.waitForFunction(s => window.__dsRenderSeq && window.__dsRenderSeq() > s, s0,
                               { timeout: maybe ? 350 : timeout, polling: 25 });
  } catch (e) {
    if (!maybe) throw e;
  }
  await settled(page);
}

// Plain editor test: real local dev server (serve.py answers /__ping, so the
// app runs in "local" mode — Save/Discard write through /__save, which is
// mocked above). Right for anything that only needs the editing surface
// itself: sections, sources, undo/redo, download's local branch, standalone
// chrome. Never touches GitHub.
const test = base.test.extend({
  context: async ({ context }, use) => {
    await blockDangerousLocalEndpoints(context);
    await use(context);
  },
  ...impactFixtures,
});

// Warm editor test: one browser context per WORKER instead of per test, so
// the ~5.5MB Pyodide download and the engine files stay in that context's
// HTTP cache and every boot after a worker's first is served from memory.
// Each test still gets its own page, and the origin's storage (localStorage,
// the warm-preview Cache Storage, IndexedDB) is wiped before it, so no draft,
// zoom or cached render carries over — only the HTTP cache does.
//
// For specs that never touch `context` (no context.route, addInitScript,
// exposeBinding, grantPermissions…): those would pile up on the shared
// context and leak into the next test. Such a spec stays on `test`.
// An impact-map run (DS_IMPACT) records per test through the context, so it
// falls back to `test` there and the map stays exact.
const KEEP_CACHE = 'ds-pyc-v1';         // edit.html's PYC_CACHE
/** Wipe the origin's storage before a test, all but the compiled engine. */
async function wipeOrigin(ctx, page, baseURL) {
  const cdp = await ctx.newCDPSession(page);
  const origin = new URL(baseURL).origin;
  await cdp.send('Storage.clearDataForOrigin', {
    origin, storageTypes: 'local_storage,indexeddb,service_workers',
  });
  // Every Cache Storage cache goes but the compiled engine (edit.html's
  // PYC_CACHE). Without it every boot compiled the engine's .py files from
  // source again — layout.py alone is ~300 ms on a laptop, more on a CI
  // runner, a thousand boots a run. Keeping it is safe for the same reason
  // it is in the app: each entry is a hash-checked pyc, refused and
  // recompiled if the source changed. pyc-cache.spec.js, which needs an
  // empty cache, is on plain `test` (a fresh context each time).
  // Cache Storage is cleared from inside a page at the origin: the CDP
  // CacheStorage domain refuses a tab that has no frame there yet (a new one
  // is about:blank), so a blank tab first opens a path the server 404s.
  await cdp.detach();
  if (!page.url().startsWith(origin)) await page.goto(origin + '/__test-blank', { waitUntil: 'commit' });
  await page.evaluate(async keep => {
    try { sessionStorage.clear(); } catch (e) {}   // per tab: a reused one keeps it
    for (const n of await caches.keys()) if (n !== keep) await caches.delete(n);
  }, KEEP_CACHE);
}

const warm = base.test.extend({
  _warmContext: [async ({ browser }, use, workerInfo) => {
    const { baseURL, serviceWorkers, viewport, userAgent, deviceScaleFactor,
            isMobile, hasTouch, locale } = workerInfo.project.use;
    const ctx = await browser.newContext({ baseURL, serviceWorkers, viewport, userAgent,
                                           deviceScaleFactor, isMobile, hasTouch, locale });
    await use(ctx);
    await ctx.close();
  }, { scope: 'worker' }],
  context: async ({ _warmContext }, use) => {
    await use(_warmContext);
  },
  page: async ({ _warmContext, baseURL }, use) => {
    const page = await _warmContext.newPage();
    await wipeOrigin(_warmContext, page, baseURL);
    await use(page);
    // Keep what this boot compiled now rather than at the editor's next idle
    // moment, which a short test closes before it comes.
    await page.evaluate(() => window.__dsPycKeepNow && window.__dsPycKeepNow()).catch(() => {});
    await page.close();
  },
});
const warmTest = process.env.DS_IMPACT ? test : warm;

// Shared-editor test: one booted editor per WORKER, put back as it opened
// between tests (window.__dsTestReset — Discard plus the undo stack, the
// selection and any open dialog) instead of reloaded. A boot is most of a
// typical test (~5 of ~7 s on a CI runner); a reset is a render.
//
// Only for specs that drive the editor through docsync.api and read the page
// back: nothing that clicks, types, routes, listens (page.on) or opens a
// second page, all of which can leave state a reset does not know about.
// Belt and braces: after each reset the document and inventory() are compared
// with what the fresh boot had, and anything different boots again (and says
// so in the log) — a leak costs a boot, never a wrong result. A failed test
// restarts its worker, which discards the shared page with it. A different
// gotoEditor query (another project) boots for real.
// Not test state: timers and pulses (previewT, hubAutosaveFlush), what the
// engine is asked once and kept (ANCHOR_SRC, OBJ_KEYS), and the snap distance,
// which every drag works out again from the zoom it starts at.
const LET_CLOCKS = /(Seq|seq|At|Time|Times|Stamp|Timer|timer)$|^(historySeq|scrollTopWas|lastPing\w*|stalled\w*|previewT|hubAutosaveFlush|ANCHOR_SRC|VARS_SRC|VARS_KEY|GREP_SRC|THREAD_SRC|OBJ_KEYS|SNAP_IN|SNAP_DENSE_IN|thumbSheetText)$/;
const SHARED = new WeakMap();           // page -> { query, fingerprint }
// Every top-level `let` in edit.html: the editor's own state (which tab the
// Chart panel is on, what the Text panel last applied…). A reset that misses
// one would hand the next test a different editor, so the fingerprint holds
// each one's value (a Map or Set by its size, other objects not at all), and
// a difference boots again. A few are clocks and counters, not state.
const EDITOR_LETS = (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../docsync/editor/edit.html'), 'utf8');
  const names = new Set();
  for (const line of src.split('\n')) {
    if (!line.startsWith('let ')) continue;
    // `let a = 1, b = 2;` - names at the top level of the line only
    let depth = 0, cut = '';
    for (const ch of line.slice(4)) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      cut += depth ? ' ' : ch;
      if (ch === ';' && !depth) break;
    }
    for (const m of cut.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?:=|,|;|$)/g)) names.add(m[1]);
  }
  return [...names].filter(n => !LET_CLOCKS.test(n));
})();

const sharedStats = { boots: 0, resets: 0, leaks: 0 };
// What a reset must give back: the document, everything on the page, and the
// editor's own chrome — which of its elements are showing (an open panel,
// menu or bar), whether words are open, and what it keeps in storage.
const fingerprint = page => page.evaluate(lets => {
  const val = n => { try {
    // eslint-disable-next-line no-eval
    const v = (0, eval)(n);
    if (v instanceof Map || v instanceof Set) return 'size:' + v.size;
    return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v) ? v ?? null : '(object)';
  } catch (e) { return '(unreadable)'; } };
  // Tabs of one report elect a leader and stamp the time in localStorage
  // (primer-live-leader:<id> …): a clock, not state a test left.
  const store = st => { try {
    return Object.entries(st).filter(([k]) => !/^primer-(live|preview)-(event|leader):/.test(k)).sort();
  } catch (e) { return null; } };
  return JSON.stringify({
    doc: snapshot(), inv: docsync.api.inventory(), editing, presenting,
    body: document.body.className,
    shown: [...document.querySelectorAll('[id]')].filter(e => e.offsetParent !== null
      || getComputedStyle(e).position === 'fixed' && getComputedStyle(e).display !== 'none'
         && getComputedStyle(e).visibility !== 'hidden').map(e => e.id).filter(id => id !== 'tt').sort(),   // tt: a tooltip under the pointer
    local: store(localStorage), session: store(sessionStorage),
    lets: Object.fromEntries(lets.map(n => [n, val(n)])),
    scroll: (() => { const se = document.getElementById('out').contentDocument.scrollingElement;
      return [se.scrollTop, se.scrollLeft, scrollX, scrollY]; })(),
  });
}, EDITOR_LETS);

const shared = warm.extend({
  _sharedPage: [async ({ _warmContext }, use) => {
    const slot = { page: null };
    await use(slot);
    if (sharedStats.boots + sharedStats.resets) {
      console.log(`[shared editor] worker ${process.env.TEST_WORKER_INDEX}: ${sharedStats.boots} boots, `
        + `${sharedStats.resets} resets, ${sharedStats.leaks} leaks`);
    }
    if (slot.page && !slot.page.isClosed()) await slot.page.close();
  }, { scope: 'worker' }],
  page: async ({ _warmContext, _sharedPage, baseURL }, use) => {
    if (!_sharedPage.page || _sharedPage.page.isClosed()) {
      _sharedPage.page = await _warmContext.newPage();
      await wipeOrigin(_warmContext, _sharedPage.page, baseURL);
      SHARED.set(_sharedPage.page, { query: null, fingerprint: null, baseURL, ctx: _warmContext });
    }
    await use(_sharedPage.page);
  },
});
const sharedTest = process.env.DS_IMPACT ? test : shared;
/** Which parts of two fingerprints differ, for the log line. */
function whatDiffers(a, b) {
  a = JSON.parse(a); b = JSON.parse(b);
  return Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => {
    if (k === 'shown') {
      const x = new Set(a[k]), y = new Set(b[k]);
      return `shown(+${b[k].filter(i => !x.has(i)).join('+')} -${a[k].filter(i => !y.has(i)).join('-')})`;
    }
    if (k === 'lets') return `lets(${Object.keys(a[k]).filter(i => JSON.stringify(a[k][i]) !== JSON.stringify(b[k][i])).join(',')})`;
    if (k === 'local' || k === 'session') {
      const x = new Map(a[k]), y = new Map(b[k]);
      return `${k}(${[...new Set([...x.keys(), ...y.keys()])].filter(i => x.get(i) !== y.get(i)).join(',')})`;
    }
    return k;
  }).join(' ') || 'nothing';
}

// Static-viewer test: forces local=false (blocks /__ping, which detectLocal()
// treats as "no local server") and refuses the SSE stream too. Neither a local
// server nor the staff hub is present, so the editor boots as a static viewer:
// it renders and edits in memory, but Save is disabled and Share/Publish/Push
// are hidden. No network is faked; there is nothing for it to talk to.
const staticTest = base.test.extend({
  context: async ({ context }, use) => {
    await blockDangerousLocalEndpoints(context);
    await context.route(PING, route => route.fulfill({ status: 404, body: 'no local server' }));
    await context.route(EVENTS, route => route.fulfill({ status: 404, body: 'no local server' }));
    await use(context);
  },
  ...impactFixtures,
});

/** Select an element in the report WITHOUT opening its words. A plain click
 *  on text selects on the press and, when that leaves it the one selection,
 *  types on the release (click-to-type), so a test that meant "select it,
 *  then press Delete / drag a handle / read the toolbar" was racing an open
 *  editor: Delete ate a character, and a render never swaps over open words.
 *  Shift-click selects without typing, but it TOGGLES, so an element already
 *  selected would be deselected: clear the selection first. A group selects
 *  whole, as a plain click would. */
async function selectWithoutTyping(page, target) {
  await page.evaluate(() => clearSel(document.getElementById('out').contentDocument));
  await target.click({ modifiers: ['Shift'] });
  await base.expect.poll(() => page.evaluate(() => editing)).toBe(false);
}

/** Download and Token live in the File menu now, so reaching either means
 *  opening it first — which is what a person does too. */
async function openFileMenu(page) {
  await page.click('#file');
  await page.locator('#filepop').waitFor({ state: 'visible' });
}

/** Sources lives in the File menu, not on the bar — so reaching it is two
 *  clicks, the way it is for a person. Share went back to the bar once View ▾
 *  and Check ▾ made the room (2026-10-28). */
async function openSources(page) {
  await openFileMenu(page);
  await page.click('#sources');
}
async function openShare(page) {
  await page.click('#share');
}

/** The tools that were icons at the far end of the bar — Rulers, Hidden
 *  characters, Layers, Undo history, Present, Reload in View ▾; the print
 *  warning, Preflight, Hyperlinks, Picture links, Colours, Notes in Check ▾ —
 *  kept their ids. Pressing one is its menu, then its row: the menu is
 *  whichever .pop.menu holds the row (data-owner names its button). */
async function clickTool(page, id) {
  const owner = await page.evaluate(i => {
    const m = document.getElementById(i).closest('.pop.menu');
    return m && m.hidden ? m.dataset.owner : null;
  }, id);
  if (owner) {
    await page.click('#' + owner);
    await page.locator('#' + id).waitFor({ state: 'visible' });
  }
  await page.click('#' + id);
}
/** Open the menu that holds a tool without pressing it (to look at the row). */
async function openToolMenu(page, id) {
  const owner = await page.evaluate(i => document.getElementById(i).closest('.pop.menu').dataset.owner, id);
  if (await page.locator('#' + id).isHidden()) await page.click('#' + owner);
  await page.locator('#' + id).waitFor({ state: 'visible' });
}

/** +Section is hidden from the toolbar for now (#add { display:none }), but
 *  still wired. Playwright cannot click a control with no box, so drive it the
 *  way the app does. The day it comes back this becomes page.click again. */
const clickAddSection = (page) => page.evaluate(() => document.getElementById('add').click());

// --- native <dialog> helpers ------------------------------------------------
// prompt()/confirm() were replaced by dsForm/dsConfirm/dsPrompt over a native
// <dialog class="dsdlg"> in the PARENT document (not the iframe). These drive
// them: fill named fields, then submit (OK) or cancel.
async function dialog(page) {
  const d = page.locator('dialog.dsdlg');
  await d.waitFor({ state: 'visible' });
  return d;
}
async function fillDialog(page, values) {
  const d = await dialog(page);
  for (const [name, value] of Object.entries(values)) {
    const f = d.locator(`[name="${name}"]`);
    const tag = await f.evaluate(el => el.tagName);
    if (tag === 'SELECT') await f.selectOption(value);
    else await f.fill(value);
  }
  return d;
}
async function submitDialog(page) {
  const d = await dialog(page);
  await d.locator('.dsdlg-ok').click();
  await d.waitFor({ state: 'hidden' });
}
async function cancelDialog(page) {
  const d = await dialog(page);
  await d.locator('.dsdlg-cancel').click();
  await d.waitFor({ state: 'hidden' });
}
/** Submit a dialog only if one opens within `timeout` — for confirms that are
 *  conditional (e.g. the print-fit-cut warning on Save, which appears only when
 *  content overflows a page). Returns whether a dialog was handled. */
async function submitDialogIfPresent(page, timeout = 3000) {
  const d = page.locator('dialog.dsdlg');
  try { await d.waitFor({ state: 'visible', timeout }); } catch (e) { return false; }
  await d.locator('.dsdlg-ok').click();
  await d.waitFor({ state: 'hidden' });
  return true;
}

module.exports = {
  settled, afterRender,
  test, staticTest, warmTest, sharedTest, expect: base.expect, gotoEditor, waitForFirstRender, PING, EVENTS, UPDATE, openFileMenu, openSources, openShare, clickTool, openToolMenu, clickAddSection,
  blockDangerousLocalEndpoints, dialog, fillDialog, submitDialog, cancelDialog,
  submitDialogIfPresent, selectWithoutTyping,
};
