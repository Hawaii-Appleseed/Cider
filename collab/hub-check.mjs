#!/usr/bin/env node
/**
 * The staff hub's front door onto a room, end to end.
 *
 *     node hub-check.mjs [--hub ../../staff-updates-internal]
 *
 * Two processes, because that is the shape production has: the Durable Object
 * class can only live in a Worker (`You cannot create and deploy a Durable
 * Object within a Pages project`), and the Access session can only be read on
 * the hub's own origin. So the class stays in `primer-collab` and the hub
 * binds it. This script boots both — a `wrangler dev` holding the class, a
 * `wrangler pages dev` in front of it with the binding — and drives the result
 * with the real client.
 *
 * It is not part of `npm test`: it needs the hub repo checked out beside this
 * one, and it boots two wranglers. Run it when either side of the hop changes.
 *
 * What it proves, and why each one is here:
 *
 *   - the hop works at all. A websocket through a Pages Function into a
 *     Durable Object in another script is the load-bearing assumption of the
 *     whole design; everything else is arrangement.
 *   - the identity survives it. The room shows who is present from the header
 *     the Function set, so seeing an email in `here` means it travelled from
 *     Access through the Function into the DO.
 *   - two clients converge through it, which is the actual product.
 *   - a viewer is read-only IN THE ROOM. The Function decides the role, but
 *     nothing it does would stop a write — only `x-collab-ro`, honoured by
 *     y-partyserver, does. That is worth watching land rather than assuming.
 *   - the refusals refuse.
 *
 * LOCALLY THE ACCESS HEADER IS FORGEABLE, and this script forges it. In
 * production Cloudflare's edge strips `Cf-Access-Authenticated-User-Email`
 * from inbound requests and re-signs it, which is the only reason the Function
 * may trust it. Nothing here tests that; it tests what happens after.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import WS from 'ws';
import { CollabSession } from './client/session.mjs';
import { formatRoom } from './src/auth.js';
import { startDev } from './devserver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const argHub = process.argv.indexOf('--hub');
const HUB_DIR = resolve(HERE, argHub > 0 ? process.argv[argHub + 1] : '../../staff-updates-internal');
const RELAY_PORT = Number(process.env.HUB_CHECK_RELAY_PORT || 8797);
const HUB_PORT = Number(process.env.HUB_CHECK_PORT || 8796);
const HUB = `127.0.0.1:${HUB_PORT}`;
const ROOM = formatRoom('Hawaii-Appleseed', 'primer-editor', 'hub-check');
const ME = 'devin@hibudget.org';
const HER = 'abbey@hiappleseed.org';

const FAILURES = [];
let checks = 0;
function check(label, ok, detail) {
  checks++;
  if (ok) { console.log('  ok   ' + label); return; }
  FAILURES.push(label);
  console.log('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
}
const eq = (label, got, want) =>
  check(`${label}  (${JSON.stringify(got)})`, got === want, 'wanted ' + JSON.stringify(want));

/* ------------------------------------------------------------- the hub */

/** `wrangler pages dev` over the hub repo, with the relay's class bound. */
export async function startPages({ port, hubDir = HUB_DIR, timeoutMs = 120_000, relayName = 'primer-collab' }) {
  const persistDir = mkdtempSync(pathJoin(tmpdir(), 'hub-check-'));
  // Run from the hub's directory, with this repo's wrangler binary. From
  // here, `wrangler pages dev` would read collab/wrangler.jsonc and merge in
  // its LOCAL PrimerRoom binding — the Pages shim exports no such class, and
  // it fails to boot with a message about the entrypoint that has nothing to
  // do with the actual mistake.
  const proc = spawn(pathJoin(HERE, 'node_modules/.bin/wrangler'), [
    'pages', 'dev', hubDir,
    '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', String(port + 1000),
    '--compatibility-date', '2026-09-01',
    // The binding under test. `@primer-collab` is the other wrangler, found
    // through the local dev registry — the same shape as the dashboard
    // binding, which names a script and a class.
    '--do', `PRIMER_ROOM=PrimerRoom@${relayName}`,
    '--kv', 'COLLAB',
    // The document store (functions/api/docs/), local R2 emulation.
    '--r2', 'PRIMER_DOCS',
    '--persist-to', persistDir, '--log-level', 'warn',
    // Its own process group: wrangler spawns workerd, and killing only the
    // parent leaves workerd holding the port — which then looks like "address
    // already in use" on the next run rather than like a leak here.
  ], { cwd: hubDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

  const kill = (sig) => { try { process.kill(-proc.pid, sig); } catch { /* already gone */ } };

  const log = [];
  proc.stdout.on('data', d => log.push(String(d)));
  proc.stderr.on('data', d => log.push(String(d)));
  proc.on('exit', c => { if (c) log.push(`\n[wrangler pages exited ${c}]`); });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline || proc.exitCode !== null) {
      kill('SIGTERM'); await sleep(400); kill('SIGKILL');
      throw new Error(`wrangler pages dev did not come up:\n${log.join('')}`);
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/robots.txt`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return {
    log,
    async stop() {
      kill('SIGTERM'); await sleep(600); kill('SIGKILL');
      rmSync(persistDir, { recursive: true, force: true });
    },
  };
}

/** A WebSocket that carries an Access identity, since a Node client has no
 *  cookie jar and no Access session to be redirected into. */
const asPerson = (email) => class extends WS {
  constructor(url, protocols) {
    super(url, protocols, { headers: { 'Cf-Access-Authenticated-User-Email': email } });
  }
};

// Three slots, so the three writes below never touch the same text. Two
// concurrent edits to one paragraph are merged by Yjs — correctly — which
// would make "the viewer's write did not land" indistinguishable from "it
// landed and was merged away".
const FILES = {
  content: '[[intro]]\nThe first paragraph.\n\n[[second]]\nThe second.\n\n[[third]]\nThe third.\n',
  layout: '{}',
};
const withSlot = (key, text) =>
  FILES.content.replace(new RegExp(`(\\[\\[${key}\\]\\]\\n)[^\\n]*`), `$1${text}`);

/** A session through the hub's front door: no ticket, a path, an identity. */
function joinRoom(email, files = FILES) {
  return new CollabSession({
    host: HUB,
    room: ROOM,
    path: `/api/collab/${ROOM}`,
    login: email,
    files,
    WebSocketPolyfill: asPerson(email),
  });
}

async function main() {
  if (!existsSync(pathJoin(HUB_DIR, 'functions/api/collab'))) {
    console.error(`No hub front door at ${HUB_DIR}/functions/api/collab — pass --hub <path>.`);
    process.exit(2);
  }

  console.log(`\nbooting the relay on 127.0.0.1:${RELAY_PORT} and the hub on ${HUB}…`);
  const relay = await startDev({ port: RELAY_PORT });
  let pages;
  try {
    pages = await startPages({ port: HUB_PORT });
  } catch (e) { await relay.stop(); throw e; }

  try {
    console.log('\nthe refusals');
    const up = { Upgrade: 'websocket', Connection: 'Upgrade' };
    const me = { 'Cf-Access-Authenticated-User-Email': ME };
    eq('no Access identity is refused at the door',
       (await raw(`/api/collab/${ROOM}`, up)).status, 401);
    eq('a plain GET is not a room',
       (await raw(`/api/collab/${ROOM}`, me)).status, 426);
    eq('a malformed room name is refused',
       (await raw('/api/collab/nonsense', { ...up, ...me })).status, 400);
    eq('a repository this hub does not serve is refused',
       (await raw('/api/collab/someone~elses~project', { ...up, ...me })).status, 403);

    console.log('\nthe hop');
    const a = joinRoom(ME);
    await a.ready;
    check('a websocket reaches the Durable Object through the Pages Function', true);
    eq('the first client in seeds the room', a.state.seededBy, ME);

    console.log('\ntwo people, one document');
    const b = joinRoom(HER, { content: '[[intro]]\nSomething else entirely.\n', layout: '{}' });
    await b.ready;
    eq('the second adopts the room rather than its own copy',
       b.files().content.includes('The first paragraph.'), true);
    // `here` is the room's own view of its connections, built from the login
    // header this Function set — so an email in it is the identity having
    // travelled Access -> Function -> Durable Object -> back.
    eq('the room knows who is in it, by the identity Access gave',
       await eventually(() => (a.state.here || []).includes(HER)), true);

    a.mark();
    a.flush({ content: withSlot('intro', 'Edited by Devin.'), layout: {} });
    eq('an edit crosses to the other editor',
       await eventually(() => b.files().content.includes('Edited by Devin.')), true);
    b.close();

    console.log('\na viewer is read-only in the room, not just in the UI');
    const put = await fetch(`http://${HUB}/api/collab/share/${ROOM}`, {
      method: 'PUT',
      headers: { 'Cf-Access-Authenticated-User-Email': ME, 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'viewer', people: { [ME]: 'editor' } }),
    });
    eq('the share record is written', put.status, 200);

    const v = joinRoom(HER);
    await v.ready;
    eq('a viewer still gets the document', v.files().content.includes('Edited by Devin.'), true);
    v.mark();
    v.flush({ content: withSlot('second', 'A viewer wrote this.'), layout: {} });
    await sleep(1500);
    eq('but nothing they write reaches anyone else',
       a.files().content.includes('A viewer wrote this.'), false);

    a.mark();
    a.flush({ content: withSlot('third', 'Still writable.'), layout: {} });
    eq('while an editor can still write to them',
       await eventually(() => v.files().content.includes('Still writable.')), true);

    v.close();
    a.close();
    await sleep(500);

    console.log('\nthe room outlives its connections');
    const c = joinRoom(ME, { content: '[[intro]]\nA fresh copy that should be discarded.\n', layout: '{}' });
    await c.ready;
    eq('a later arrival adopts what the room kept',
       c.files().content.includes('Still writable.'), true);
    c.close();
  } finally {
    await pages.stop();
    await relay.stop();
  }

  console.log();
  if (FAILURES.length) {
    console.log(`${FAILURES.length} failure(s) of ${checks}`);
    process.exit(1);
  }
  console.log(`all ${checks} checks passed`);
}

/** A GET the way a browser opens a websocket. Not fetch(): undici refuses to
 *  send an `Upgrade` header at all, so every refusal below would look like a
 *  client-side TypeError rather than the status the Function returned. */
function raw(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HUB_PORT, path, method: 'GET', headers });
    req.on('response', r => { r.resume(); resolve({ status: r.statusCode }); });
    req.on('upgrade', r => { resolve({ status: r.statusCode }); req.destroy(); });
    req.on('error', reject);
    req.end();
  });
}

/** Poll a predicate for a couple of seconds — every claim here is about
 *  something arriving over a websocket, which is never synchronous. */
async function eventually(fn, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try { if (fn()) return true; } catch { /* not yet */ }
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
}

// Run as a script; imported (tests/editor/collab-hub.spec.js borrows
// startPages), it boots nothing.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
