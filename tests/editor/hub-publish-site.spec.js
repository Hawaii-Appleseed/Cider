// The hub's Publish for a page that ALSO goes to a public site (docsync.yml
// `publish:` with home: hub, staged into the manifest as M.site). After the
// commit the editor follows the site job's report and says how the public page
// took it (docStoreAwaitSite / siteLine / docStoreSite), and the confirm must not
// claim the live page is untouched (docStorePublish).
//
// All plain top-level functions of the editor, driven with stubs: the real chain
// (Worker -> GitHub -> Actions -> site) is covered by docsync/test_docsync.py,
// collab/export.test.mjs and a real run. The editor waits 10 s between asks, so
// setTimeout is replaced by an immediate one for the duration of each test.
// affected-by: docsync/editor/edit.html docsync/stage.py
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('hub publish: how the public site took it', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('siteLine says updated, already matched, or why not', async ({ page }) => {
    const lines = await page.evaluate(() => ({
      updated: siteLine({ ok: true, changed: true, url: 'https://example.github.io/Site/p/' }),
      matched: siteLine({ ok: true, changed: false, url: '' }),
      failed: siteLine({ ok: false, message: 'SITE_PUBLISH_TOKEN is not set' }),
      failedBare: siteLine({ ok: false }),
    }));
    // [what the clipped toolbar shows, what its hover says]
    expect(lines.updated).toEqual(['site updated ✓', 'public site updated ✓ — https://example.github.io/Site/p/']);
    expect(lines.matched).toEqual(['site up to date ✓', 'public site already matched ✓']);
    expect(lines.failed).toEqual(['site NOT updated — hover for why', 'public site NOT updated: SITE_PUBLISH_TOKEN is not set']);
    expect(lines.failedBare[1]).toBe('public site NOT updated: the publish job failed');
    // ~24 characters show before the toolbar clips the line
    for (const l of Object.values(lines)) expect(l[0].length).toBeLessThanOrEqual(32);
  });

  test('a report is news, never a failure: docStoreSite is null on any trouble', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const realFetch = window.fetch;
      const answer = (status, body, type = 'application/json') =>
        () => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } }));
      const got = {};
      window.fetch = answer(200, { exported: null, site: { version: 'v1', ok: true } });
      got.report = await docStoreSite();
      window.fetch = answer(200, { exported: null, site: null });
      got.empty = await docStoreSite();
      window.fetch = answer(502, { error: 'the export service is unreachable' });
      got.bad = await docStoreSite();
      window.fetch = answer(200, '<html>sign in</html>', 'text/html');
      got.signedOut = await docStoreSite();
      window.fetch = () => Promise.reject(new Error('offline'));
      got.offline = await docStoreSite();
      window.fetch = realFetch;
      return got;
    });
    expect(out.report).toEqual({ version: 'v1', ok: true });
    expect([out.empty, out.bad, out.signedOut, out.offline]).toEqual([null, null, null, null]);
  });

  test('the status says publishing until the job reports THIS version, then how it went, site first', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const realSite = window.docStoreSite, realTimeout = window.setTimeout;
      window.setTimeout = f => realTimeout(f, 0);
      const stats = [];
      let n = 0;
      window.docStoreSite = async () => {
        stats.push(document.getElementById('stat').textContent);
        n++;
        if (n === 1) return null;                                                // the job has not reported
        if (n === 2) return { version: 'an-older-version', ok: true, changed: true };   // an earlier publish
        return { version: 'v2', ok: true, changed: true, url: 'https://example.github.io/Site/p/' };
      };
      const head = 'published ✓ — Hawaii-Appleseed/Cider@hub/p abc1234';
      await docStoreAwaitSite('v2', head, false);
      const stat = document.getElementById('stat');
      const result = { n, stats, last: stat.textContent, title: stat.title };
      window.docStoreSite = realSite; window.setTimeout = realTimeout;
      return result;
    });
    expect(out.n).toBe(3);
    expect(out.stats[1]).toBe('site: publishing…');
    expect(out.last).toBe('site updated ✓');          // short: the toolbar clips the line
    expect(out.title).toBe('public site updated ✓ — https://example.github.io/Site/p/ · published ✓ — Hawaii-Appleseed/Cider@hub/p abc1234');
  });

  test('an unchanged publish asks once; a job that never reports ends with where to look', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const realSite = window.docStoreSite, realTimeout = window.setTimeout;
      window.setTimeout = f => realTimeout(f, 0);
      let n = 0;
      window.docStoreSite = async () => { n++; return null; };
      const stat = document.getElementById('stat');
      await docStoreAwaitSite('v3', 'already published — hub/p is at abc1234', true);
      const unchanged = { n, last: stat.textContent, title: stat.title };
      n = 0;
      await docStoreAwaitSite('v4', 'published ✓ — x', false);
      const silent = { n, last: stat.textContent, title: stat.title };
      window.docStoreSite = realSite; window.setTimeout = realTimeout;
      return { unchanged, silent };
    });
    expect(out.unchanged.n).toBe(1);
    expect(out.unchanged.last).toBe('site: no report — hover');
    expect(out.unchanged.title).toContain('no report for this version');
    expect(out.silent.n).toBe(30);
    expect(out.silent.title).toContain('no report after 5 minutes');
    expect(out.silent.title).toContain('Actions tab');
  });

  test('the confirm says the public page is rebuilt, and keeps its old words for a page with none', async ({ page }) => {
    const text = await page.evaluate(async () => {
      const real = { confirm: window.dsConfirm, site: M.site, version: docVersion, wasDirty: dirty };
      const asked = [];
      window.dsConfirm = async t => { asked.push(t); return false; };       // decline: nothing is published
      docVersion = 'v1'; dirty = false;
      M.site = null;
      await docStorePublish();
      M.site = { repo: 'Hawaii-Appleseed/Site', url: 'https://example.github.io/Site/p/' };
      await docStorePublish();
      window.dsConfirm = real.confirm; M.site = real.site; docVersion = real.version; dirty = real.wasDirty;
      return asked;
    });
    expect(text).toHaveLength(2);
    expect(text[0]).toContain('The live report is not changed by this.');
    expect(text[1]).toContain('The public page (https://example.github.io/Site/p/) is then rebuilt from it.');
    expect(text[1]).not.toContain('The live report is not changed');
  });
});
