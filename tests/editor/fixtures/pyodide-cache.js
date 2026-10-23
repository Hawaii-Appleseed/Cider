// One on-disk copy of everything the editor pulls from cdn.jsdelivr.net
// (Pyodide's ~30MB of wasm, stdlib and lock file, plus the two small ES
// modules), shared by every browser context and every worker of a run.
//
// Why: a Playwright browser context has its OWN HTTP cache, so a spec that
// opens several contexts (collab-hub: two people, plus a context per test
// that wants a third or a fresh visitor) downloads Pyodide once per context,
// and under a parallel run those downloads stack on one connection until a
// boot overruns waitForFirstRender's 75s. The boots are not slow to COMPILE;
// they were slow to ARRIVE. Raising the timeout hides that; this removes it:
// the first request for a URL fetches it once (concurrent askers share that
// one fetch), writes it under os.tmpdir(), and every later one - any context,
// any worker - is answered from the file.
//
// Chromium only. The Firefox note in playwright.config.js (route interception
// wedging on a big streamed body) is why other engines go straight to the
// network, as before. An asset that cannot be fetched is passed through
// (route.continue()), never failed: this can only make a boot faster.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.PRIMER_PYODIDE_CACHE || path.join(os.tmpdir(), 'cider-cdn-cache');
const CDN = /^https:\/\/cdn\.jsdelivr\.net\//;
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
                '.wasm': 'application/wasm', '.zip': 'application/zip', '.whl': 'application/zip' };
const inflight = new Map();           // url -> Promise<file path | null>, per process

function fileFor(url) {
  return path.join(DIR, crypto.createHash('sha1').update(url).digest('hex')
    + path.extname(new URL(url).pathname).slice(0, 8));
}

/** The cached file for url, fetching it first if this run has none. */
function ensure(url) {
  const file = fileFor(url);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return Promise.resolve(file);
  if (!inflight.has(url)) {
    inflight.set(url, (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        fs.mkdirSync(DIR, { recursive: true });
        // Written beside, then renamed: another worker never reads half a file.
        const tmp = `${file}.${process.pid}.${Date.now()}.part`;
        fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
        fs.renameSync(tmp, file);
        return file;
      } catch (e) {
        return null;
      } finally {
        inflight.delete(url);
      }
    })());
  }
  return inflight.get(url);
}

/** Answer the CDN's GETs for this context from the shared disk copy.
 *  Returns { hits, misses } counters (misses: passed through to the network). */
async function cacheCdn(context, browserName = 'chromium') {
  const stats = { hits: 0, misses: 0 };
  if (browserName !== 'chromium') return stats;
  await context.route(CDN, async route => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    const file = await ensure(req.url());
    if (!file) { stats.misses++; return route.continue(); }
    stats.hits++;
    return route.fulfill({
      status: 200, body: fs.readFileSync(file),
      headers: {
        'content-type': TYPES[path.extname(new URL(req.url()).pathname)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });
  return stats;
}

/** browser.newContext() with the CDN cache on. */
async function newContext(browser, options) {
  const ctx = await browser.newContext(options);
  ctx.cdnCache = await cacheCdn(ctx, browser.browserType().name());
  return ctx;
}

module.exports = { cacheCdn, newContext, fileFor, CACHE_DIR: DIR };
