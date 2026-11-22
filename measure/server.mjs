#!/usr/bin/env node
// The headless editor: lays out a report nobody has open, for the staff hub.
//
// The page is laid out — measured, clamped, drawn — only by the editor, a
// browser program (Pyodide renders the report). So the hub's connector could
// change a page, or say what is on it, only while somebody had the report open
// in a tab: arrange_report, check_report and read_report's page map all
// refused with "nobody has this report open". This is the editor with nobody
// at it. The hub POSTs a job here; this opens the hub's OWN deployed editor in
// headless Chromium on that report, runs the job with the functions an open
// tab runs for the same request — hubPilot() for ops, the docsync.api reads
// for questions — and answers with what that editor measured on the page it
// rendered, plus the files it ended with. The hub saves those as the person.
// Nothing here estimates anything: it is the same editor, the same verbs, the
// same layout checks (layout.new, fit), on the same files.
//
// --- where the files come from: the door --------------------------------------
//
// The hub sits behind Cloudflare Access, and this machine has no key to it and
// needs none. Each job carries a DOOR: a token the hub signed for one person,
// one report, three minutes. Every request the headless editor makes to the
// hub's origin is answered from GET <origin>/api/mcp?door=<token>&path=<path>,
// which hands out only what one editor needs to open that one report, as that
// person, read only (functions/api/mcp.js doorGet in the hub). A job whose
// door the hub does not honour fails on its first file. So a stranger who
// reaches this server can make it do nothing but ask the hub and be refused,
// and this machine holds no secret. Writes never leave the page: every
// non-GET request (autosave, comments) is answered 403 here, and the room's
// websocket is closed, so the editor works alone, as a tab whose relay is
// down does. The hub writes the result itself, with its own checks.
//
// --- running it -----------------------------------------------------------------
//
//   node measure/server.mjs                 port 8797 (MEASURE_PORT)
//   MEASURE_ORIGINS=https://a,https://b     hubs it will open (default: the
//                                           production hub; *.staff-updates-
//                                           internal.pages.dev previews too)
//
// On Devin's Mac mini it runs from ~/repos/Cider under a LaunchAgent and is
// reached through a Tailscale Funnel; see measure/README.md.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MEASURE_PORT || 8797);
const HOST = process.env.MEASURE_HOST || '127.0.0.1';
const CACHE = process.env.MEASURE_CACHE || path.join(os.homedir(), 'Library', 'Caches', 'cider-measure');
const PROD = 'https://staff-updates-internal.pages.dev';
const ORIGINS = (process.env.MEASURE_ORIGINS || PROD).split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
/** A preview or staging deployment of the hub serves its own editor, and
 *  the door it mints opens only that deployment: allowed like production. */
const PREVIEW = /^https:\/\/[a-z0-9-]+\.staff-updates-internal\.pages\.dev$/;
/** From cold: Pyodide boot, the report's render, the job, a second render. */
const JOB_MS = Number(process.env.MEASURE_JOB_MS || 80_000);
/** One editor at a time — each is a whole Pyodide — and one more waiting. */
const MAX_WAITING = 1;
/** The questions an editor answers (collab/src/room.js ASKS, edit.html onAsk). */
export const ASKS = ['inventory', 'preflight', 'audit', 'hyperlinks', 'colours', 'fontsInUse', 'links', 'styles', 'notes', 'overrides', 'stories'];
const ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const ROOM_RE = /^[A-Za-z0-9._-]+~[A-Za-z0-9._-]+~[A-Za-z0-9._-]+$/;

const log = (...a) => console.log(new Date().toISOString(), ...a);

/** Which origin a job may name: one of ORIGINS, or a hub preview. */
export function originAllowed(o, allowed = ORIGINS) {
  if (typeof o !== 'string') return false;
  const clean = o.replace(/\/+$/, '');
  return allowed.includes(clean) || PREVIEW.test(clean);
}

/** A job, checked; or {error}. */
export function readJob(j, allowed = ORIGINS) {
  if (!j || typeof j !== 'object' || j.v !== 1) return { error: 'a job is {v: 1, origin, door, project, room, mode, …}' };
  if (!originAllowed(j.origin, allowed)) return { error: `not a hub this editor opens: ${j.origin}` };
  if (typeof j.door !== 'string' || j.door.length < 20 || j.door.length > 4000) return { error: 'a door is required' };
  if (!ID_RE.test(j.project || '')) return { error: 'project must be a report id' };
  if (!ROOM_RE.test(j.room || '')) return { error: 'room must be owner~repo~project' };
  if (j.mode === 'pilot') {
    if (!Array.isArray(j.ops) || !j.ops.length || j.ops.length > 40) return { error: 'ops: 1 to 40 of them' };
  } else if (j.mode === 'ask') {
    if (!Array.isArray(j.asks) || !j.asks.length || j.asks.some(a => !ASKS.includes(a))) return { error: `asks: some of ${ASKS.join(', ')}` };
  } else return { error: "mode is 'pilot' or 'ask'" };
  const f = j.files;
  if (f != null && (typeof f !== 'object' || typeof f.content !== 'string' || (f.layout != null && typeof f.layout !== 'string'))) {
    return { error: 'files are {content, layout} or null' };
  }
  return { job: { ...j, origin: j.origin.replace(/\/+$/, '') } };
}

// --- files ----------------------------------------------------------------------

/** Under /primer/, the files that are the same for everyone at one deploy:
 *  the editor and the vendored engines. Kept on disk by the deploy's commit,
 *  so a second job opens without fetching the editor again. Not the
 *  registry, a hub-made report's engine (rewritten per document) or any
 *  image (an upload can replace one under the same name). */
export function cacheable(p) {
  return p.startsWith('/primer/') && p !== '/primer/projects.json' && !p.startsWith('/primer/_hub/')
    && !/\/assets\//.test(p) && !p.endsWith('/');
}
const cdn = /^https:\/\/cdn\.jsdelivr\.net\//;
const keyFile = (...parts) => path.join(CACHE, ...parts.slice(0, -1),
  crypto.createHash('sha1').update(parts[parts.length - 1]).digest('hex'));
function readCached(file) {
  try { return { body: fs.readFileSync(file), meta: JSON.parse(fs.readFileSync(file + '.json', 'utf8')) }; } catch { return null; }
}
function writeCached(file, body, meta) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.part`;
    fs.writeFileSync(tmp, body);
    fs.writeFileSync(file + '.json', JSON.stringify(meta));
    fs.renameSync(tmp, file);
  } catch (e) { log('cache write failed', e.message); }
}
/** Only the last few deploys' files are worth keeping. */
function pruneCache(keep = 3) {
  try {
    const dir = path.join(CACHE, 'hub');
    const all = fs.readdirSync(dir).map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { n } of all.slice(keep)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  } catch { /* nothing cached yet */ }
}

/** One file from the hub, through the job's door. */
async function throughDoor(job, p) {
  const u = `${job.origin}/api/mcp?door=${encodeURIComponent(job.door)}&path=${encodeURIComponent(p)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  const body = Buffer.from(await r.arrayBuffer());
  return { status: r.status, body, type: r.headers.get('content-type') || 'application/octet-stream', commit: r.headers.get('x-hub-commit') || null };
}

// --- one job --------------------------------------------------------------------

let browser = null;
async function theBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

/** The job, run in a fresh context (nothing a previous report left in
 *  storage can reach this one). Resolves to the answer the hub reads. */
export async function runJob(job) {
  const t0 = Date.now();
  // The door first, and the deploy it opens: a door the hub does not honour
  // ends the job here, before a browser is started.
  const probe = await throughDoor(job, '/primer/projects.json');
  if (probe.status !== 200) {
    let why = '';
    try { why = JSON.parse(probe.body.toString()).error || ''; } catch { /* not JSON */ }
    return { ok: false, door: probe.status, error: `the hub refused the door (${probe.status}${why ? ': ' + why : ''})` };
  }
  // Files are kept by the deploy's commit, so only a real one: a local
  // `wrangler pages dev` says 0000000 for every build, which would serve one
  // run's editor to the next.
  const commit = /^[0-9a-f]{7,40}$/.test(probe.commit || '') && !/^0+$/.test(probe.commit) ? probe.commit : null;
  const b = await theBrowser();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', deviceScaleFactor: 1 });
  const errors = [];
  try {
    // The editor's autosave would only be refused here (below), but a
    // refused save is a red bar and a retry loop: off from the start.
    await ctx.addInitScript(() => { try { localStorage.setItem('primer-autosave', 'off'); } catch (e) { /* private mode */ } });
    // The room is the hub's websocket; this editor works alone.
    await ctx.routeWebSocket(/\/api\/collab\//, ws => ws.close({ code: 1000, reason: 'the headless editor works alone' }));
    const docs = `/api/docs/${job.room}`;
    await ctx.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      try {
        if (cdn.test(req.url())) return await fromCdn(route, req.url());
        if (url.origin !== job.origin) return await route.continue();
        if (req.method() !== 'GET' && req.method() !== 'HEAD') {
          return await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'the headless editor writes nothing; the hub saves its result' }) });
        }
        const p = url.pathname;
        // What the sleeping room holds, when the hub sent it: the copy the
        // first person in would be handed (the store's can be behind it).
        if (job.files && (p === docs + '/content' || p === docs + '/layout')) {
          const text = p.endsWith('/content') ? job.files.content : job.files.layout;
          if (text == null) return await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' });
          return await route.fulfill({ status: 200, contentType: p.endsWith('/content') ? 'text/markdown; charset=utf-8' : 'application/json', body: text });
        }
        const file = commit && cacheable(p) ? keyFile('hub', commit, p) : null;
        const hit = file && readCached(file);
        if (hit) return await route.fulfill({ status: 200, contentType: hit.meta.type, body: hit.body });
        const r = await throughDoor(job, p + url.search);
        if (file && r.status === 200 && r.commit === commit) writeCached(file, r.body, { type: r.type });
        return await route.fulfill({ status: r.status, contentType: r.type, body: r.body });
      } catch (e) {
        errors.push(`${url.pathname}: ${e.message}`);
        try { await route.abort(); } catch { /* the page is gone */ }
      }
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('page: ' + e.message));
    await page.goto(`${job.origin}/primer/edit.html?project=${encodeURIComponent(job.project)}`, { timeout: JOB_MS });
    await page.waitForSelector('#out[data-ds-live]', { state: 'attached', timeout: JOB_MS });
    await page.frameLocator('#out').locator('.page').first().waitFor({ state: 'visible', timeout: JOB_MS });
    await settle(page);
    const role = await page.evaluate('typeof hubRole === "undefined" ? null : hubRole');
    const out = job.mode === 'pilot'
      ? await page.evaluate(pilot, { ops: job.ops, by: job.by || null, what: job.what || '' })
      : await page.evaluate(ask, job.asks);
    log(`${job.mode} ${job.project} for ${job.by || '?'}: ${out.ok ? 'ok' : 'refused: ' + out.error} in ${Date.now() - t0} ms (deploy ${commit ? commit.slice(0, 7) : 'unknown'}, role ${role})`);
    return { ...out, by: 'headless editor', deploy: commit, ms: Date.now() - t0, ...(errors.length ? { warnings: errors.slice(0, 5) } : {}) };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** The editor's own "nothing is rendering": window.__dsSettled, asked a few
 *  times so a render that starts as the last one ends is waited for too —
 *  and the fonts, which move every measurement when they land late. */
async function settle(page) {
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction(() => !window.__dsSettled || window.__dsSettled(), null, { timeout: JOB_MS, polling: 50 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const d = document.getElementById('out') && document.getElementById('out').contentDocument;
      if (d && d.fonts) await d.fonts.ready;
    });
    await page.waitForTimeout(60);
    if (await page.evaluate(() => !window.__dsSettled || window.__dsSettled())) return;
  }
}

/* The two job bodies run IN the page (page.evaluate serialises them): they
 * may use only the editor's globals. */

/** Ops, applied as the room's /pilot has an open tab apply them: hubPilot(),
 *  one undo step, the layout checks before and after. With the files on
 *  either side, as the editor serialises them for a Save. */
async function pilot({ ops, by, what }) {
  /* global hubPilot, fitReport, source, layout */
  const files = () => ({ content: source, layout: JSON.stringify(layout, null, 2) + '\n' });
  const before = files();
  const fitBefore = fitReport();
  const r = await hubPilot({ ops, by, what });
  return { ...r, ok: !!(r && r.ok), fitBefore, before, after: files() };
}

/** Questions, answered as edit.html's onAsk answers the room's /ask. */
async function ask(asks) {
  /* global docsync, fitReport, PAGE_W_IN, PAGE_H_IN, isPageless */
  const answers = {};
  for (const what of asks) {
    try {
      if (what === 'inventory') {
        const inv = docsync.api.inventory();
        answers[what] = { ok: true,
          inventory: { project: inv.project, pageOrder: inv.pageOrder, styles: inv.styles,
                       pages: inv.pages.map(p => ({ id: p.id, index: p.index, slots: p.slots, elements: p.elements })) },
          page: { w: PAGE_W_IN, h: PAGE_H_IN, pageless: isPageless() }, fit: fitReport() };
      } else {
        const r = await docsync.api[what]();
        answers[what] = { ok: !(r && r.ok === false), error: (r && r.error) || null, answer: r };
      }
    } catch (e) { answers[what] = { ok: false, error: String((e && e.message) || e) }; }
  }
  return { ok: true, answers, fit: fitReport() };
}

/** Pyodide and the editor's ES modules, from disk after the first fetch. */
async function fromCdn(route, url) {
  const file = keyFile('cdn', url);
  let hit = readCached(file);
  if (!hit) {
    try {
      const r = await fetch(url);
      if (!r.ok) return route.continue();
      const body = Buffer.from(await r.arrayBuffer());
      writeCached(file, body, { type: r.headers.get('content-type') || 'application/octet-stream' });
      hit = { body, meta: { type: r.headers.get('content-type') } };
    } catch { return route.continue(); }
  }
  return route.fulfill({ status: 200, contentType: hit.meta.type || 'application/octet-stream', body: hit.body,
                         headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } });
}

// --- the server -------------------------------------------------------------------

let running = 0, waiting = 0, last = null;
const queue = [];
async function inTurn(fn) {
  if (running) {
    if (waiting >= MAX_WAITING) return { busy: true };
    waiting++;
    await new Promise(res => queue.push(res));
    waiting--;
  }
  running++;
  try { return { value: await fn() }; }
  finally { running--; const next = queue.shift(); if (next) next(); }
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export function createServer({ allowed = ORIGINS } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // Behind the Funnel it is mounted at /cider-measure; that prefix may or
    // may not reach here, so both shapes are the same request.
    url.pathname = url.pathname.replace(/^\/cider-measure(?=\/|$)/, '') || '/';
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, busy: running > 0, last });
    }
    if (req.method !== 'POST' || url.pathname !== '/measure') return send(res, 404, { error: 'POST /measure, GET /health' });
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 4_000_000) return send(res, 413, { error: 'too big' }); }
    let j;
    try { j = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON, please' }); }
    const { job, error } = readJob(j, allowed);
    if (error) return send(res, 400, { error });
    const t = await inTurn(() => Promise.race([
      runJob(job),
      new Promise(r => setTimeout(() => r({ ok: false, error: `the headless editor took longer than ${JOB_MS / 1000} seconds` }), JOB_MS)),
    ]).catch(e => ({ ok: false, error: 'the headless editor failed: ' + String((e && e.message) || e).split('\n')[0] })));
    if (t.busy) return send(res, 503, { busy: true, error: 'it is laying out another report' });
    last = { at: new Date().toISOString(), mode: job.mode, project: job.project, ok: !!t.value.ok };
    return send(res, 200, t.value);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  pruneCache();
  const server = createServer();
  server.listen(PORT, HOST, () => log(`headless editor on http://${HOST}:${PORT} for ${ORIGINS.join(', ')} (+ hub previews); cache ${CACHE}`));
  // Warm: the first job should not also pay for starting Chromium.
  theBrowser().catch(e => log('chromium did not start:', e.message));
  const stop = async () => { try { if (browser) await browser.close(); } finally { process.exit(0); } };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
