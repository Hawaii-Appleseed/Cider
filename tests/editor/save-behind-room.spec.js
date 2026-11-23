// A hub Save sends THIS tab's copy under a `base` that follows the room, so the
// store's own check cannot see a tab that kept its old words while its base
// moved on: it saved them over the newer version (2026-11-23, a tab open since
// before a run of Claude's layout edits autosaved its blank layout over four
// built pages). docStoreSave now asks collabBehindRoom() first: the editor's copy
// must agree with the room's document as the network delivered it. It waits a
// beat for a remote edit that is still reaching the page, then holds autosave
// (a question for a press of Save) rather than send an older copy.
//
// Driven in the static fixture with a stub session and fetch: the real room and
// store are covered by collab-hub.spec.js and a real run.
// affected-by: docsync/editor/edit.html
const { staticTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('a Save from a tab that is behind the room', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  /** Run `body(stub)` with a stub live session over the page's own layout, a
   *  hub store base and a counting fetch; put every global back after. */
  async function withRoom(page, body, arg = {}) {
    return page.evaluate(async ({ body, arg }) => {
      const saved = { collab, docStoreBase, docVersion, fetch: window.fetch, source, original, hold: hubAutosaveHold };
      const puts = [];
      window.fetch = async (url, init) => {
        if (init && init.method === 'PUT') puts.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ version: 'v-new', updated_by: 'me' }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const stub = { phase: 'ready', status: 'live', content: 'same words', layoutText: JSON.stringify(layout), netAfter: null };
      collab = {
        get state() { return { phase: stub.phase, status: stub.status }; },
        files: () => ({ content: 'same words', layoutText: stub.layoutText }),
        netFiles: () => stub.netAfter && Date.now() >= stub.netAfter.at ? stub.netAfter.files : { content: stub.content, layoutText: stub.layoutText },
        baseSha: () => 'v-room', setBaseSha() {},
      };
      docStoreBase = '/api/docs/o~r~p'; docVersion = 'v-room';
      try { return await (new Function('stub', 'puts', 'arg', `return (async () => { ${body} })()`))(stub, puts, arg); }
      finally {
        collab = saved.collab; docStoreBase = saved.docStoreBase; docVersion = saved.docVersion;
        window.fetch = saved.fetch; source = saved.source; original = saved.original; hubAutosaveHold = saved.hold;
      }
    }, { body, arg });
  }

  test('collabBehindRoom says nothing when the copies agree, and why when they do not', async ({ page }) => {
    const r = await withRoom(page, `
      const out = { agree: collabBehindRoom() };
      const other = JSON.parse(JSON.stringify(layout)); other.shapes = [{ id: 'sX', kind: 'rect', page: 1, x: 1, y: 1, w: 1, h: 1 }];
      stub.layoutText = JSON.stringify(other);                  // the room has a shape this tab has not
      const shadowSame = collab.files;
      collab.netFiles = () => ({ content: 'same words', layoutText: JSON.stringify(other) });
      out.layoutBehind = collabBehindRoom();
      collab.netFiles = () => ({ content: 'newer words', layoutText: JSON.stringify(layout) });
      out.contentBehind = collabBehindRoom();
      collab.netFiles = () => ({ content: '', layoutText: '{}' });
      out.unseeded = collabBehindRoom();
      stub.status = 'asleep'; collab.netFiles = () => ({ content: 'newer words', layoutText: '{}' });
      out.asleep = collabBehindRoom();
      return out;`);
    expect(r.agree).toBe('');
    expect(r.layoutBehind).toMatch(/layout differs/);
    expect(r.contentBehind).toMatch(/not taken in/);
    expect(r.unseeded).toBe('');       // an empty room says nothing
    expect(r.asleep).toBe('');         // only a live session can say
  });

  test('autosave from a tab that stays behind sends nothing and waits for a press of Save', async ({ page }) => {
    const r = await withRoom(page, `
      const other = JSON.parse(JSON.stringify(layout)); other.pages = { order: [1, 'p1', 'p2', 'p3'], blanks: [] };
      collab.netFiles = () => ({ content: 'same words', layoutText: JSON.stringify(other) });
      original = 'older words'; source = 'same words';          // there is something to save
      const t0 = Date.now();
      const sent = await docStoreSave(JSON.stringify(layout, null, 2) + '\\n', false, true);
      return { sent, puts: puts.length, hold: hubAutosaveHold, ms: Date.now() - t0, stat: document.getElementById('stat').textContent };`);
    expect(r.sent).toBe(false);
    expect(r.puts).toBe(0);
    expect(r.hold).toBe(true);
    expect(r.stat).toMatch(/not saved — this tab's page layout differs/);
    expect(r.ms).toBeGreaterThan(1000);       // it waited its beat first
  });

  test('a remote edit that is still reaching the page is waited for, and its result is what is saved', async ({ page }) => {
    const r = await withRoom(page, `
      const other = JSON.parse(JSON.stringify(layout)); other.shapes = [{ id: 'sR', kind: 'rect', page: 1, x: 1, y: 1, w: 1, h: 1 }];
      // The room has the shape from the start; this tab takes it in 300 ms later.
      collab.netFiles = () => ({ content: 'same words', layoutText: JSON.stringify(other) });
      setTimeout(() => { layout = other; }, 300);
      original = 'older words'; source = 'same words';
      const sent = await docStoreSave(JSON.stringify(layout, null, 2) + '\\n', false, true);
      return { sent, puts: puts.length, shapes: puts[0] && JSON.parse(puts[0].layout).shapes.map(s => s.id), hold: hubAutosaveHold };`);
    expect(r.puts).toBe(1);
    expect(r.shapes).toEqual(['sR']);          // the page it caught up to, not the copy it was handed
    expect(r.hold).toBe(false);
  });

  test('an agreeing tab saves as before; a tab on its way out saves nothing rather than an older copy', async ({ page }) => {
    const r = await withRoom(page, `
      original = 'older words'; source = 'same words';
      const fine = await docStoreSave(JSON.stringify(layout, null, 2) + '\\n', false, true);
      const finePuts = puts.length;
      const other = JSON.parse(JSON.stringify(layout)); other.shapes = [{ id: 'sZ', kind: 'rect', page: 1, x: 1, y: 1, w: 1, h: 1 }];
      collab.netFiles = () => ({ content: 'same words', layoutText: JSON.stringify(other) });
      original = 'older words 2';
      const leaving = await docStoreSave(JSON.stringify(layout, null, 2) + '\\n', false, true, true);
      return { fine, finePuts, leaving, putsAfter: puts.length, hold: hubAutosaveHold };`);
    expect(r.fine).toBe(true);
    expect(r.finePuts).toBe(1);
    expect(r.leaving).toBe(false);
    expect(r.putsAfter).toBe(1);               // nothing more went out
  });
});
