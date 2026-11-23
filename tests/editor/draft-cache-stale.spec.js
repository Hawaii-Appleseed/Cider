// A cached draft (IndexedDB, edit.html cacheDraft / restoreCachedDraft) is edits
// on top of the version they were made on. On the hub that version can move while
// the browser is away (another session, Claude's headless editor, a restore); a
// draft restored over it shows the OLDER layout, seeds an empty room with it and
// autosaves it over the newer version (2026-11-23, a report's headless layout
// edits "vanished" from a freshly opened editor). So the draft is restored only
// when it was made on the version now loaded.
//
// Driven in the static fixture with the hub's two variables set by hand: the real
// chain (store, room, Access) is covered by collab-hub.spec.js and a real run.
// affected-by: docsync/editor/edit.html
const { staticTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const V_OLD = '20261123T201832017Z-ww7q';
const V_NEW = '20261123T205509954Z-u2h5';
const T_BETWEEN = Date.UTC(2026, 10, 23, 20, 30, 0);   // after V_OLD, before V_NEW

test.describe('a cached draft older than the loaded version', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  /** Plant a draft whose layout carries one extra shape, then boot's restore step
   *  on a "hub" document at `version`. Reports what the editor ended up holding. */
  async function restore(page, { cache, version }) {
    return page.evaluate(async ({ cache, version }) => {
      const kv = await import('https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/dist/index.js');
      const key = cacheKey(), stale = 'draft-stale:' + M.id;
      await kv.del(key); await kv.del(stale);
      const draft = JSON.parse(JSON.stringify(layout));
      draft.shapes = [{ id: 's-draft', kind: 'rect', page: 1, x: 1, y: 1, w: 1, h: 1, fill: '#ff0000' }];
      await kv.set(key, { source, layout: JSON.stringify(draft), at: cache.at, ...(cache.base ? { base: cache.base } : {}) });
      const was = { base: docStoreBase, ver: docVersion };
      docStoreBase = '/api/docs/o~r~p'; docVersion = version;
      cachedRestored = false; cachedDropped = '';
      try { await restoreCachedDraft(); } finally { docStoreBase = was.base; docVersion = was.ver; }
      return {
        restored: cachedRestored, dropped: cachedDropped,
        draftShape: (layout.shapes || []).some(s => s.id === 's-draft'),
        stillCached: !!(await kv.get(key)), kept: !!(await kv.get(stale)),
      };
    }, { cache, version });
  }

  test('made on an older version: not restored, and kept aside', async ({ page }) => {
    const r = await restore(page, { cache: { base: V_OLD, at: T_BETWEEN }, version: V_NEW });
    expect(r.restored).toBe(false);
    expect(r.dropped).toMatch(/saved by someone else/);
    expect(r.draftShape).toBe(false);
    expect(r.stillCached).toBe(false);    // or it would come back on every boot
    expect(r.kept).toBe(true);            // …but not lost outright
  });

  test('made on the loaded version: restored as before', async ({ page }) => {
    const r = await restore(page, { cache: { base: V_NEW, at: Date.now() }, version: V_NEW });
    expect(r.restored).toBe(true);
    expect(r.dropped).toBe('');
    expect(r.draftShape).toBe(true);
  });

  test('a draft cached before versions were recorded is compared by time', async ({ page }) => {
    const old = await restore(page, { cache: { at: T_BETWEEN }, version: V_NEW });   // version saved after it
    expect(old.restored).toBe(false);
    expect(old.dropped).toMatch(/saved after/);
    const fresh = await restore(page, { cache: { at: Date.now() }, version: V_NEW });  // cached after the version
    expect(fresh.restored).toBe(true);
    expect(fresh.draftShape).toBe(true);
  });

  test('a document the store has never seen: the draft is restored (no version to compare)', async ({ page }) => {
    const r = await restore(page, { cache: { base: V_OLD, at: T_BETWEEN }, version: null });
    expect(r.restored).toBe(true);
  });
});
