// A tab that slept (or lost its socket) and comes back must not carry its old
// copy into the room, and must end up agreeing with the room's document.
//
//  - collabBeforeWake: a sleeping tab with edits made WHILE AWAY is about to
//    rejoin. If the store holds another version than this tab does, the room was
//    rewritten under those edits and merging gives a mixture of both documents
//    (a simulated rewrite left 9 of 12 shapes and a page order of neither). The
//    tab puts its edits aside and reloads. Typing now, a dialog, or a store that
//    cannot be asked: merge, as before.
//  - collabReviveSoon: once live again, a tab that still disagrees with the room
//    takes the room's document, as anyone joining does.
//
// Driven in the static fixture with stubs (session, fetch, timers): the sockets
// themselves are covered by collab/client.test.mjs and collab-hub.spec.js.
// affected-by: docsync/editor/edit.html collab/client/session.mjs
const { staticTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('a tab back from sleep', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  /** Run `body(ctx)` with a hub store base, a fetch that answers `store`, and
   *  every global it touches put back after. */
  async function run(page, body, arg = {}) {
    return page.evaluate(async ({ body, arg }) => {
      const saved = { docStoreBase, docVersion, fetch: window.fetch, setTimeout: window.setTimeout, collab, collabAdopt: window.collabAdopt, editing };
      const timers = [], told = [];
      window.setTimeout = (f, ms) => { timers.push({ f, ms }); return 0; };      // nothing fires by itself (no reload)
      window.fetch = async () => {
        if (arg.storeFails) throw new Error('offline');
        return new Response(JSON.stringify(arg.store), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      docStoreBase = '/api/docs/o~r~p'; docVersion = arg.mine || 'v-mine';
      try { return await (new Function('ctx', `return (async () => { ${body} })()`))({ timers, told, arg }); }
      finally {
        docStoreBase = saved.docStoreBase; docVersion = saved.docVersion; window.fetch = saved.fetch;
        window.setTimeout = saved.setTimeout; collab = saved.collab; window.collabAdopt = saved.collabAdopt; editing = saved.editing;
      }
    }, { body, arg });
  }

  const reloadQueued = `ctx.timers.some(t => t.ms === 300)`;

  test('the store moved while the tab was away: its edits are put aside and it starts over', async ({ page }) => {
    const r = await run(page, `
      source = source + ' typed while away';
      const verdict = await collabBeforeWake({ awayMs: 14 * 60000, wroteAway: true });
      const kv = await import('https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/dist/index.js');
      const kept = await kv.get(cacheKey());
      await kv.del(cacheKey());
      return { verdict, reload: ${reloadQueued}, keptBase: kept && kept.base, keptHasWords: !!kept && kept.source.includes('typed while away'),
               stat: document.getElementById('stat').textContent };`,
      { store: { exists: true, version: 'v-newer' } });
    expect(r.verdict).toBe('restart');
    expect(r.reload).toBe(true);
    expect(r.keptBase).toBe('v-mine');          // the next boot sees it was made on an older version, and sets it aside
    expect(r.keptHasWords).toBe(true);
    expect(r.stat).toMatch(/away 14 minutes and the document was saved meanwhile/);
  });

  test('the same version, an open field, or a store that cannot be asked: it merges as before', async ({ page }) => {
    const same = await run(page, `return { v: await collabBeforeWake({ awayMs: 1, wroteAway: true }), reload: ${reloadQueued} };`,
      { store: { exists: true, version: 'v-mine' } });
    expect(same).toEqual({ v: 'go', reload: false });

    const typing = await run(page, `editing = true; return { v: await collabBeforeWake({ awayMs: 1, wroteAway: true }), reload: ${reloadQueued} };`,
      { store: { exists: true, version: 'v-newer' } });
    expect(typing).toEqual({ v: 'go', reload: false });

    const offline = await run(page, `return { v: await collabBeforeWake({ awayMs: 1, wroteAway: true }), reload: ${reloadQueued} };`,
      { storeFails: true });
    expect(offline).toEqual({ v: 'go', reload: false });

    const never = await run(page, `return { v: await collabBeforeWake({ awayMs: 1, wroteAway: true }) };`,
      { store: { exists: false } });
    expect(never.v).toBe('go');
  });

  test('live again but still behind the room: the room\'s document replaces the tab\'s', async ({ page }) => {
    const r = await run(page, `
      const other = JSON.parse(JSON.stringify(layout)); other.shapes = [{ id: 'sRoom', kind: 'rect', page: 1, x: 1, y: 1, w: 1, h: 1 }];
      collab = { state: { phase: 'ready', status: 'live' },
                 files: () => ({ content: 'same words', layout: other, layoutText: JSON.stringify(other) }),
                 netFiles: () => ({ content: 'same words', layoutText: JSON.stringify(other) }) };
      const adopted = [];
      window.collabAdopt = async (files, why) => { adopted.push({ why, shapes: files.layout.shapes.map(s => s.id) }); };
      collabReviveSoon();
      const t = ctx.timers.find(x => x.ms === 2500);
      await t.f();
      return { queued: !!t, adopted, stat: document.getElementById('stat').textContent };`);
    expect(r.queued).toBe(true);
    expect(r.adopted).toEqual([{ why: 'adopt', shapes: ['sRoom'] }]);
    expect(r.stat).toMatch(/caught up with the shared document/);
  });

  test('live again and in agreement, or typing: nothing is replaced', async ({ page }) => {
    const r = await run(page, `
      collab = { state: { phase: 'ready', status: 'live' },
                 files: () => ({ content: 'same words', layout, layoutText: JSON.stringify(layout) }),
                 netFiles: () => ({ content: 'same words', layoutText: JSON.stringify(layout) }) };
      const adopted = [];
      window.collabAdopt = async (files, why) => { adopted.push(why); };
      collabReviveSoon(); await ctx.timers.find(x => x.ms === 2500).f();
      const agreed = adopted.length;
      const other = JSON.parse(JSON.stringify(layout)); other.shapes = [{ id: 'sX', kind: 'rect', page: 1, x: 1, y: 1, w: 1, h: 1 }];
      collab.netFiles = () => ({ content: 'same words', layoutText: JSON.stringify(other) });
      editing = true;
      collabReviveSoon(); await ctx.timers.filter(x => x.ms === 2500).at(-1).f();
      return { agreed, typing: adopted.length };`);
    expect(r.agreed).toBe(0);
    expect(r.typing).toBe(0);
  });
});
