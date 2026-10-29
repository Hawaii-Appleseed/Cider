// A report's BUILT page and the editor's service worker (2026-10-28).
//
// The worker's scope is the editor's whole directory. On the hub that is
// /primer/, and each report is a directory under it: /primer/<id>/, plus the
// /primer/<id>/index.html that Cloudflare Pages answers with a 308 to it. Two
// failures, measured on the hub right after f92185b deployed, in a browser
// that had opened the editor:
//   1. /primer/our-mission/ came from the worker's cache: the page from the
//      visit before the ship, on two loads in a row.
//   2. A tab opened on /primer/our-mission/index.html showed Chrome's error
//      page. The hub door fetches <id>/index.html to draw each preview; the
//      worker stored what that fetch followed the redirect to, under the
//      index.html URL, and a response that has been redirected may not answer
//      a navigation.
// So this file serves a report the way Pages does, from a server of its own,
// registers the real docsync/editor/sw.js over it, and checks what a browser
// gets. The report is sent `no-cache`, so the HTTP cache always asks the
// server: a stale page here can only have come from the worker.
// affected-by: docsync/editor/sw.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { claimPort } = require('./fixtures/ports');

const SW = path.resolve(__dirname, '..', '..', 'docsync', 'editor', 'sw.js');

// The ship: bump it and the server has the next build of the report.
let build = 1;

// Cloudflare Pages, as much of it as these tests touch. Clean URLs: x.html is
// a 308 to x, and a directory's index.html a 308 to the directory.
// /primer/start is an editor page (it registers the worker, as start.html and
// edit.html do), and /primer/report/ is a report's built page.
function pages() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://pages.test');
    const send = (type, body) => {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(body);
    };
    if (pathname.endsWith('.html')) {
      res.writeHead(308, { Location: pathname.replace(/(index)?\.html$/, '') });
      return res.end();
    }
    if (pathname === '/primer/sw.js') return send('text/javascript', fs.readFileSync(SW));
    if (pathname === '/primer/start') {
      return send('text/html', '<!doctype html><title>editor</title>'
        + "<script>navigator.serviceWorker.register('sw.js')</script>");
    }
    if (pathname === '/primer/report/') {
      return send('text/html', '<!doctype html><title>report</title>'
        + `<section class="page"><h1 id="build">build ${build}</h1></section>`);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}

// The rest of the suite blocks service workers (playwright.config.js); this
// file is about one.
test.use({ serviceWorkers: 'allow' });

let server, origin;
test.beforeAll(async () => {
  const port = await claimPort('sw_pages', 8806);
  server = pages();
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  origin = `http://127.0.0.1:${port}`;
});
test.afterAll(() => new Promise(r => server.close(r)));
test.beforeEach(() => { build = 1; });

/** A browser that has opened the editor: the worker installed and in charge
 *  of the page. Each test has a context of its own, so nothing carries over. */
async function openEditor(page) {
  await page.goto(`${origin}/primer/start`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}

test('a report page is the deployed one on every load, never the worker\'s copy', async ({ page }) => {
  await openEditor(page);
  const open = async () => {
    const res = await page.goto(`${origin}/primer/report/`);
    return { text: await page.locator('#build').textContent(), worker: res.fromServiceWorker() };
  };
  const before = await open();
  build = 2;
  const after = await open();
  expect([before.text, after.text]).toEqual(['build 1', 'build 2']);
  // Untouched, not network-first: the page reaches this browser exactly as it
  // reaches a reader who never opened the editor.
  expect([before.worker, after.worker]).toEqual([false, false]);
});

test("the door's preview fetch of <id>/index.html gets the deployed page", async ({ page }) => {
  await openEditor(page);
  // What the hub's primer/index.html does for each report tile it draws.
  const preview = () => page.evaluate(() => fetch('report/index.html').then(r => r.text()));
  expect(await preview()).toContain('build 1');
  build = 2;
  expect(await preview()).toContain('build 2');
});

test('a tab opened on <id>/index.html follows the redirect to the report', async ({ page }) => {
  await openEditor(page);
  // The door's preview first, as on the hub: it is what left a redirected
  // response in the cache under this very URL.
  await page.evaluate(() => fetch('report/index.html').then(r => r.text()));
  const res = await page.goto(`${origin}/primer/report/index.html`);
  expect(res.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/primer/report/');
  await expect(page.locator('#build')).toHaveText('build 1');
});

test('the cache an older worker kept is dropped when this one takes over', async ({ page }) => {
  // A browser that ran the v8 worker holds its cache, pre-ship copies and
  // all. Seeded from the report page, before any worker exists here.
  await page.goto(`${origin}/primer/report/`);
  await page.evaluate(async () => {
    const old = await caches.open('primer-shell-v8');
    await old.put('/primer/report/index.html', new Response('a pre-ship copy'));
  });
  await openEditor(page);
  const names = await page.evaluate(() => caches.keys());
  expect(names).not.toContain('primer-shell-v8');
  expect(names.filter(n => n.startsWith('primer-shell-'))).toHaveLength(1);
});
