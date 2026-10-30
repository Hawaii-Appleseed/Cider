// The compiled-engine cache (edit.html, pycRestore / pycKeepNow). Pyodide
// compiles layout.py from source on every open, about 300 ms; the first open
// keeps the bytecode in Cache Storage and the next puts it back. The entry is
// a HASH-BASED pyc, so Python re-hashes the source on load: a stale or
// tampered entry is refused and recompiled, never trusted.
// affected-by: docsync/editor/edit.html
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const pycFlags = (page) => page.evaluate(() => py.runPython(`
import importlib.util
p = importlib.util.cache_from_source('/repo/docsync/layout.py')
d = open(p, 'rb').read()
int.from_bytes(d[4:8], 'little')
`));
const state = (page) => page.evaluate(() => ({ ...window.__dsPyc }));


test.describe('compiled engine cache', () => {
  test('the first open keeps what Python compiled, the next puts it back', async ({ page }) => {
    await gotoEditor(page);
    const first = await state(page);
    expect(first.restored).toBe(0);
    expect(first.missed).toBeGreaterThan(0);
    // Kept on its own, once the page is painted and the thread idle.
    await expect.poll(async () => (await state(page)).kept, { timeout: 20_000 }).toBe(first.missed);

    await gotoEditor(page);                   // a second open in the same browser
    const second = await state(page);
    expect(second.missed).toBe(0);
    expect(second.restored).toBe(first.missed);
    // 3 = hash-based and checked: what came out of the cache, not Python's own.
    expect(await pycFlags(page)).toBe(3);
  });

  test('an entry whose hash no longer matches the source is refused, and the editor still builds', async ({ page }) => {
    await gotoEditor(page);
    await expect.poll(async () => (await state(page)).kept, { timeout: 20_000 }).toBeGreaterThan(0);
    // Corrupt the kept layout.py: flip a byte of the source hash in its header.
    const tampered = await page.evaluate(async () => {
      const c = await caches.open('ds-pyc-v1');
      const key = (await c.keys()).map(r => new URL(r.url).pathname).find(p => p.includes('/docsync/layout.py'));
      const bytes = new Uint8Array(await (await c.match(key)).arrayBuffer());
      bytes[8] ^= 0xff;
      await c.put(key, new Response(bytes));
      return !!key;
    });
    expect(tampered).toBe(true);

    await gotoEditor(page);
    expect((await state(page)).restored).toBeGreaterThan(0);   // it was put back…
    // …and Python refused it: the page rendered from source all the same.
    expect(await page.evaluate(() => document.getElementById('out').contentDocument.querySelectorAll('section.page').length))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => py.runPython('import docsync.layout as L\nlen(L.FONTS) > 0'))).toBe(true);
  });
});
