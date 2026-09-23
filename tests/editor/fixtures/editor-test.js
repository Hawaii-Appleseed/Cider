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
const { FakeGitHub } = require('./fake-github');
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
  await page.goto('edit.html' + query);
  await waitForFirstRender(page);
  // Local mode (serve.py answers /__ping) polls its live-reload stream and
  // can pick up one legitimate version bump moments after the first paint,
  // which swaps the iframe's srcdoc wholesale and re-wires every listener.
  // A click racing that swap can land on an element about to be discarded —
  // wait for it to settle before interacting with anything inside #out.
  await page.waitForTimeout(1500);
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
    const cdp = await _warmContext.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', {
      origin: new URL(baseURL).origin,
      storageTypes: 'local_storage,cache_storage,indexeddb,service_workers',
    });
    await cdp.detach();
    await use(page);
    await page.close();
  },
});
const warmTest = process.env.DS_IMPACT ? test : warm;

// Hosted editor test: forces local=false (blocks /__ping, exactly what
// detectLocal() treats as "no local server") and installs a fully in-memory
// fake GitHub so Save draft / Share / Publish / sign-in exercise the REAL
// gh()-based code path with zero network egress. Seeds a fake PAT so
// ensureAuth() resolves without a sign-in prompt, unless a test clears it.
const hostedTest = base.test.extend({
  github: async ({}, use) => {
    await use(new FakeGitHub());
  },
  context: async ({ context, github }, use) => {
    await blockDangerousLocalEndpoints(context);
    await context.route(PING, route => route.fulfill({ status: 404, body: 'no local server' }));
    // Hosted mode means NO local server: the SSE stream must be refused too,
    // or the editor keeps a live connection open to one that is right there.
    await context.route(EVENTS, route => route.fulfill({ status: 404, body: 'no local server' }));
    await github.install(context);
    await context.addInitScript(() => {
      window.localStorage.setItem('docsync-pat', 'fake-test-token');
    });
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

/** Sources and Share live in the File menu now, not on the bar — so reaching
 *  either one is two clicks, the way it is for a person. */
async function openSources(page) {
  await openFileMenu(page);
  await page.click('#sources');
}
async function openShare(page) {
  await openFileMenu(page);
  await page.click('#share');
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
  test, hostedTest, warmTest, expect: base.expect, gotoEditor, waitForFirstRender, PING, EVENTS, UPDATE, openFileMenu, openSources, openShare, clickAddSection,
  blockDangerousLocalEndpoints, dialog, fillDialog, submitDialog, cancelDialog,
  submitDialogIfPresent, selectWithoutTyping,
};
