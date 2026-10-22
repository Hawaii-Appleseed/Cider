// A version bump must only cost a re-render when something actually MOVED.
//
// Every rebuild restages the whole engine, and any watched file anywhere in the
// repo bumps the version for every project. _pull() used to answer all of that
// by rewriting the engine into Pyodide's FS and re-rendering unconditionally —
// about a second of frozen main thread, per bump, usually for byte-identical
// bytes. The status row said "reloaded", which was exactly the branch where
// nothing had changed; scrolling through one reads as a stutter.
//
// Both halves are asserted in one test on purpose. A no-op bump proves itself
// by ABSENCE (the status row stays untouched), which would also "pass" if the
// bump never arrived at all — so the same test goes on to send a bump that DOES
// change an engine file and requires the render, proving the plumbing under the
// negative assertion was live the whole time.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const SENTINEL = 'sentinel — nothing re-rendered';
const seed = (page) => page.evaluate((s) => { document.getElementById('stat').textContent = s; }, SENTINEL);
const stat = (page) => page.locator('#stat').textContent();

/** Answer /__ping with a version far above anything the real server will
 *  reach, which is what the editor treats as "the disk changed". */
async function bumpTo(context, v) {
  await context.unroute('**/__ping*').catch(() => {});
  await context.route('**/__ping*', route => route.fulfill({
    json: { ok: true, v, ahead: 0, watchAge: 0.4 },
  }));
}

test('a bump that changes nothing does not re-render; one that changes the engine does', async ({ page, context }) => {
  await gotoEditor(page);

  // --- half one: a bump with identical bytes on disk -------------------------
  // The engine is re-fetched (the editor cannot know it is unchanged without
  // looking), finds every file byte-identical, and stops there.
  await seed(page);
  await bumpTo(context, 90001);
  await page.waitForTimeout(6000);          // several heartbeats' worth
  expect(await stat(page), 'a no-op bump must not re-render or touch the status row')
    .toBe(SENTINEL);

  // --- half two: the comparator still SEES a change --------------------------
  // The other half of the risk is over-skipping: a fingerprint too coarse to
  // notice a real engine edit would stop renderer changes reaching the page at
  // all, and the symptom would be silence. End-to-end coverage is out of reach
  // here (engine files arrive through the service worker, so they cannot be
  // intercepted, and the test server's watcher does not follow fixture edits),
  // so pin the comparator itself — including the appended-comment case that a
  // length-only or first-bytes check would wave through.
  const verdicts = await page.evaluate(() => {
    const f = window.__fileSig;
    if (!f) return null;
    const src = 'def render():\n    return 1\n';
    return {
      same:      f(src) === f(src),
      appended:  f(src) !== f(src + '# a trailing comment\n'),
      oneChar:   f(src) !== f(src.replace('1', '2')),
      bytes:     f(new Uint8Array([1, 2, 3])) !== f(new Uint8Array([1, 2, 4])),
      crossType: f('abc') === f('abc'),
    };
  });
  expect(verdicts, 'edit.html should expose __fileSig for this test').not.toBeNull();
  expect(verdicts).toEqual({ same: true, appended: true, oneChar: true, bytes: true, crossType: true });
});

// The engine import cache: a render purges sys.modules ONLY after the engine
// files really moved (engineDirty, set by refreshEngineFiles' verdict). It
// used to purge on EVERY render — re-importing and re-compiling the whole
// docsync package per committed edit, the biggest slice of a 12-page
// re-render — to buy a hot-reload that happens maybe once a session. Both
// directions matter: reuse when clean (the speed), purge when dirty (or a
// hot-reloaded engine silently keeps running the OLD Python forever).
test('renders reuse the imported engine until it really changes', async ({ page }) => {
  await gotoEditor(page);
  const moduleId = () => page.evaluate(() =>
    py.runPython("import sys; id(sys.modules.get('docsync.layout'))"));

  const a = await moduleId();
  expect(a).toBeTruthy();                       // the first render imported it
  await page.evaluate(async () => { await render(); });
  const b = await moduleId();
  expect(b).toBe(a);                            // clean engine: same module object

  await page.evaluate(async () => { engineDirty = true; await render(); });
  const c = await moduleId();
  expect(c).not.toBe(a);                        // dirty engine: really re-imported
  // and the flag is spent — the render after that reuses again
  await page.evaluate(async () => { await render(); });
  expect(await moduleId()).toBe(c);
});

// A file a rebuild ADDS to the engine must reach a tab that booted before it
// existed. refreshEngineFiles used to walk M.files — the manifest snapshot
// from boot — so the new module was never fetched, and the freshly
// hot-reloaded renderer that imported it died with ModuleNotFoundError in a
// tab doing everything right (docsync/okina.py was the live case).
test('an engine file added after boot arrives on the next refresh', async ({ page }) => {
  await gotoEditor(page);
  await settled(page);
  const r = await page.evaluate(async () => {
    const rel = 'docsync/okina.py';
    const url = Object.keys(M.files).find(u => M.files[u] === rel);
    if (!url) return { skip: 'okina not in this manifest' };
    // Rewind this tab to a boot that predates the file: not in the manifest,
    // not in Pyodide's filesystem, no signature on record.
    delete M.files[url];
    engineSig.delete('/repo/' + rel);
    try { py.FS.unlink('/repo/' + rel); } catch (e) {}
    const changed = await refreshEngineFiles();
    let back = true;
    try { py.FS.stat('/repo/' + rel); } catch (e) { back = false; }
    return { changed, back, listed: Object.values(M.files).includes(rel) };
  });
  expect(r.skip).toBeUndefined();
  expect(r.listed).toBe(true);   // the manifest itself was re-fetched
  expect(r.back).toBe(true);     // and the file it names is in the engine
  expect(r.changed).toBe(true);  // so the caller knows to re-render
});
