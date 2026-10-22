// Export's failure paths and stills (docsync/editor/edit.html exportAnswer /
// doExport / mediaFeature; report2027/tools/serve.py _default_registry).
// Found by the 2026-10-22 second audit pass (WEAK-POINTS-2026-10-22.md,
// export items). Each test fails on the editor before its fix.
const { test, expect, gotoEditor, PING, openFileMenu } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');

const EXPORT = /\/__export(\?|$)/;

/** Count what the export tries to save, instead of saving it. */
async function armDownloadCounter(page) {
  await page.evaluate(() => {
    window.__dls = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__dls.push(this.download); return; }
      return realClick.call(this);
    };
  });
}
async function pressPdf(page) {
  await openFileMenu(page);
  await page.click('#download');
  await page.click('#dl-pdf');
}

test.describe('a failed export is never announced as downloaded', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.route(PING, route => route.fulfill({ json: { ok: true, v: 1, ahead: 0 } }));
    await gotoEditor(page);
    await armDownloadCounter(page);
  });

  for (const [what, answer] of [
    ['a crash page (500, HTML)', { status: 500, contentType: 'text/html', body: '<h1>Internal Server Error</h1><p>Traceback…</p>' }],
    ['a 404 from some other server', { status: 404, contentType: 'text/html', body: '<html>Not Found</html>' }],
    ['an empty 200', { status: 200, contentType: 'application/pdf', body: '' }],
    ['plain text where a file should be', { status: 200, contentType: 'text/plain', body: 'hello' }],
  ]) {
    test(what, async ({ page, context }) => {
      await context.route(EXPORT, r => r.fulfill(answer));
      await pressPdf(page);
      const stat = page.locator('#stat');
      await expect(stat).toContainText('export failed', { timeout: 10000 });
      await expect(stat).toContainText('nothing was downloaded');
      await expect(stat).not.toContainText('downloaded Budget');
      expect(await page.evaluate(() => window.__dls)).toEqual([]);   // no junk file saved
    });
  }

  test('a real PDF still downloads, named for the report', async ({ page, context }) => {
    await context.route(EXPORT, r => r.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 fake') }));
    await pressPdf(page);
    await expect(page.locator('#stat')).toContainText('downloaded', { timeout: 10000 });
    expect(await page.evaluate(() => window.__dls)).toHaveLength(1);
    expect((await page.evaluate(() => window.__dls))[0]).toMatch(/\.pdf$/);
  });
});

test.describe('the Squarespace block is a still', () => {
  test('reduced-motion rules are inlined and dark-scheme rules dropped at export', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => ({
      motion: flattenMedia('@media (prefers-reduced-motion: reduce){.tfc-reveal{opacity:1!important}}', 1200),
      motionBare: flattenMedia('@media (prefers-reduced-motion){.x{opacity:1}}', 1200),
      noPref: flattenMedia('@media (prefers-reduced-motion: no-preference){.x{animation:spin 1s}}', 1200),
      dark: flattenMedia('@media (prefers-color-scheme: dark){.page{color:#eee}}', 1200),
      light: flattenMedia('@media (prefers-color-scheme: light){.page{color:#222}}', 1200),
      still: flattenMedia('@media (hover: hover){a:hover{color:red}}', 1200),
    }));
    // A scroll-reveal that waits for an observer the pasted block never runs
    // was thirteen sections at opacity 0: the reduced-motion end state wins.
    expect(r.motion).toBe('.tfc-reveal{opacity:1!important}');
    expect(r.motionBare).toBe('.x{opacity:1}');
    expect(r.noPref).toBe('');
    // The block shows the editor's light sheet; a dark-mode host must not
    // flip its words light on white.
    expect(r.dark).toBe('');
    expect(r.light).toBe('.page{color:#222}');
    // Still undecidable, still left standing.
    expect(r.still).toMatch(/^@media \(hover: hover\)\{/);
  });
});

// The registry the start page and the export filename read gives each
// project the title its binding gives itself, not a title-cased id.
// affected-by: report2027/tools/serve.py
test('the registry names a project as its binding does', async ({ request }) => {
  const yml = fs.readFileSync(path.resolve(__dirname, '..', '..', 'docsync.yml'), 'utf8');
  const m = /- id: rxkids\n\s+name: "([^"]+)"/.exec(yml);
  expect(m, 'rxkids carries a name: in docsync.yml').toBeTruthy();
  const reg = await (await request.get('/primer/projects.json')).json();
  expect(reg.rxkids.name).toBe(m[1]);          // "RxKids Hawaiʻi", not "Rxkids"
});
