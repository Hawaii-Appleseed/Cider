// A tab whose session is asleep, or reconnecting after sleep, holds the copy it
// left with. The hub counts nobody in, so a headless edit goes ahead and saves,
// and the tab, on waking, autosaved its older, still-dirty copy over that
// version about 40 seconds later (2026-11-23, twice; the stale-save guard only
// asks when the session is live). So an automatic Save from a session that is
// asleep or reconnecting is put off (it goes once the session is live and agrees
// with the room), and a pressed Save asks first. A session still starting up, or
// one whose relay is down, is not that: the document must still save.
//
// Driven in the static fixture with a stub session and fetch.
// affected-by: docsync/editor/edit.html
const { staticTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('a Save from a session that is away from the room', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  async function save(page, { phase = 'ready', status, auto = true, confirm = null }) {
    return page.evaluate(async ({ phase, status, auto, confirm }) => {
      const saved = { collab, docStoreBase, docVersion, fetch: window.fetch, source, original, hold: hubAutosaveHold, confirm: window.dsConfirm };
      const puts = [], asked = [];
      window.fetch = async (url, init) => {
        if (init && init.method === 'PUT') puts.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ version: 'v-new', updated_by: 'me' }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      window.dsConfirm = async msg => { asked.push(msg); return confirm === true; };
      const text = JSON.stringify(layout);
      collab = { state: { phase, status }, files: () => ({ content: 'same words', layoutText: text }),
                 netFiles: () => ({ content: 'same words', layoutText: text }), baseSha: () => 'v-room', setBaseSha() {} };
      docStoreBase = '/api/docs/o~r~p'; docVersion = 'v-room';
      original = 'older words'; source = 'same words';
      try {
        const sent = await docStoreSave(JSON.stringify(layout, null, 2) + '\n', false, auto);
        return { sent, puts: puts.length, force: puts[0] && puts[0].force, asked: asked.length, hold: hubAutosaveHold };
      } finally {
        collab = saved.collab; docStoreBase = saved.docStoreBase; docVersion = saved.docVersion; window.fetch = saved.fetch;
        source = saved.source; original = saved.original; hubAutosaveHold = saved.hold; window.dsConfirm = saved.confirm;
      }
    }, { phase, status, auto, confirm });
  }

  test('an automatic Save waits while the session is asleep or reconnecting, without a hold', async ({ page }) => {
    for (const status of ['asleep', 'connecting']) {
      const r = await save(page, { status });
      expect(r, status).toMatchObject({ sent: false, puts: 0, asked: 0, hold: false });
    }
  });

  test('it goes once the session is live and agrees with the room', async ({ page }) => {
    const r = await save(page, { status: 'live' });
    expect(r).toMatchObject({ sent: true, puts: 1, hold: false });
  });

  test('a session still starting up, or with its relay down, saves as before', async ({ page }) => {
    expect(await save(page, { phase: 'sync', status: 'connecting' })).toMatchObject({ sent: true, puts: 1 });
    expect(await save(page, { status: 'offline' })).toMatchObject({ sent: true, puts: 1 });
  });

  test('a pressed Save from an asleep tab asks, and an answer of yes sends it without forcing the store', async ({ page }) => {
    const no = await save(page, { status: 'asleep', auto: false, confirm: false });
    expect(no).toMatchObject({ sent: false, puts: 0, asked: 1 });
    const yes = await save(page, { status: 'asleep', auto: false, confirm: true });
    expect(yes).toMatchObject({ sent: true, puts: 1, asked: 1 });
    expect(yes.force).toBe(false);          // the store's own check of the base still applies
  });
});
