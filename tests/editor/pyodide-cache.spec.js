// Pyodide comes from one shared on-disk copy, not once per browser context
// from the CDN (tests/editor/fixtures/pyodide-cache.js). collab-hub's boots
// timed out at 75s under parallel load because every context downloaded the
// ~30MB again; the fix is to stop downloading, not to wait longer.
const fs = require('fs');
const { test, expect, waitForFirstRender } = require('./fixtures/editor-test');
const { newContext, fileFor } = require('./fixtures/pyodide-cache');

const WASM = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.asm.wasm';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'the cache is Chromium-only by design');

async function boot(browser, baseURL) {
  const ctx = await newContext(browser, { baseURL });
  const page = await ctx.newPage();
  await page.goto('edit.html');
  await waitForFirstRender(page);
  return { ctx, page };
}

test('a second context boots with no network request to the CDN', async ({ browser, baseURL }) => {
  const a = await boot(browser, baseURL);          // may be the one that fills the cache
  expect(fs.existsSync(fileFor(WASM)), 'the wasm is on disk once a context has booted').toBe(true);
  await a.ctx.close();
  const b = await boot(browser, baseURL);
  expect(b.ctx.cdnCache.misses, 'nothing went to the network').toBe(0);
  expect(b.ctx.cdnCache.hits, 'Pyodide was answered from disk').toBeGreaterThan(0);
  await b.ctx.close();
});

test('several contexts booting at once share one download and all boot', async ({ browser, baseURL }) => {
  const all = await Promise.all([1, 2, 3].map(() => boot(browser, baseURL)));
  for (const { ctx } of all) {
    expect(ctx.cdnCache.misses).toBe(0);
    await ctx.close();
  }
});
