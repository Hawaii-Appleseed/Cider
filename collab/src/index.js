/**
 * primer-collab — the Worker in front of the rooms.
 *
 * Four routes and a schedule:
 *
 *   POST /auth                      exchange a GitHub token for a room ticket
 *   GET  /parties/primer-room/:room the collaborative websocket
 *   GET  /health                    liveness, no auth
 *   GET|POST /export/:room          the store -> git (src/export.js); keyed,
 *                                   for the hub's Publish. Nightly for every room.
 *
 * The Worker's job is to decide who may open a room; once a socket is
 * accepted, everything else happens in the Durable Object (src/room.js). The
 * export is the one other thing it does, because it is the one place a
 * GitHub credential may live: scoped to the repositories served, and able
 * only to commit what the store already holds.
 */
import { routePartykitRequest } from 'partyserver';
import {
  mintTicket, verifyTicket, parseRoom, checkRepoPermission,
  corsHeaders, allowedRepos, signingSecret, TICKET_TTL_SECONDS,
} from './auth.js';

import { exportRoom, exportAll } from './export.js';

export { PrimerRoom } from './room.js';

const json = (body, init = {}, extra = null) => new Response(
  JSON.stringify(body),
  { ...init, headers: { 'content-type': 'application/json', ...(extra || {}), ...(init.headers || {}) } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      // Only a browser we allow gets a usable preflight; anything else is told
      // nothing at all rather than being handed a hint about what exists.
      return cors ? new Response(null, { status: 204, headers: cors })
                  : new Response(null, { status: 403 });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'primer-collab' }, {}, cors);
    }

    if (url.pathname.startsWith('/export/')) {
      return handleExport(request, env, url);
    }

    if (url.pathname === '/auth') {
      if (request.method !== 'POST') return json({ error: 'POST required' }, { status: 405 }, cors);
      return handleAuth(request, env, cors);
    }

    // Everything else is a room. The gate runs here, in the Worker, before
    // any Durable Object is touched — an unauthenticated attempt costs no DO
    // time at all. BOTH hooks: partyserver runs onBeforeConnect for a
    // websocket upgrade and onBeforeRequest for plain HTTP, and with only
    // the first set the room's HTTP side (status, pilot, ask, files) was
    // open to anyone who could spell a room name.
    const routed = await routePartykitRequest(request, env, {
      onBeforeConnect: (req) => gateConnection(req, env),
      onBeforeRequest: (req) => gateConnection(req, env),
    });
    if (routed) return routed;

    return json({ error: 'not found' }, { status: 404 }, cors);
  },

  /** The nightly sweep (wrangler.jsonc triggers): every room whose version
   *  the branch does not have yet gets one commit. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (!env.PRIMER_DOCS || !env.GITHUB_EXPORT_TOKEN) {
        console.warn('export sweep skipped: PRIMER_DOCS or GITHUB_EXPORT_TOKEN not bound');
        return;
      }
      const out = await exportAll({ bucket: env.PRIMER_DOCS, token: env.GITHUB_EXPORT_TOKEN, api: env.GITHUB_API, allowed: allowedRepos(env) });
      console.log('export sweep', JSON.stringify(out.map(r => [r.room, r.status, r.sha || r.error || r.reason || ''])));
    })());
  },
};

/**
 * GET|POST /export/<room>: the hub's Publish. Server to server, keyed with
 * EXPORT_KEY (the hub holds the same string). The key lets a caller cause a
 * commit of what the store already holds and read the last one's sha —
 * nothing else — so it is a shared secret rather than a signed identity.
 * No CORS: a browser is never the caller.
 */
async function handleExport(request, env, url) {
  const room = decodeURIComponent(url.pathname.slice('/export/'.length));
  if (!parseRoom(room)) return json({ error: 'room must be "owner~repo~project"' }, { status: 400 });
  if (!env.EXPORT_KEY) return json({ error: 'export is not configured (EXPORT_KEY)' }, { status: 501 });
  const given = request.headers.get('x-export-key') || '';
  if (!timingSafeEqual(given, env.EXPORT_KEY)) return json({ error: 'export key required' }, { status: 401 });
  if (!env.PRIMER_DOCS) return json({ error: 'the document store is not bound (PRIMER_DOCS)' }, { status: 501 });
  if (!env.GITHUB_EXPORT_TOKEN) return json({ error: 'export is not configured (GITHUB_EXPORT_TOKEN)' }, { status: 501 });
  const allowed = allowedRepos(env);
  const nwo = parseRoom(room).nwo.toLowerCase();
  if (allowed.length && !allowed.includes(nwo)) return json({ error: `repository ${nwo} is not served here` }, { status: 403 });

  if (request.method === 'GET') {
    const o = await env.PRIMER_DOCS.get(`docs/${room}/export.json`);
    return json({ room, exported: o ? await o.json() : null });
  }
  if (request.method !== 'POST') return json({ error: 'GET or POST' }, { status: 405 });
  try {
    const r = await exportRoom({ bucket: env.PRIMER_DOCS, room, token: env.GITHUB_EXPORT_TOKEN, api: env.GITHUB_API });
    return json(r, { status: r.status === 'unexportable' ? 409 : 200 });
  } catch (e) {
    return json({ error: String(e.message || e) }, { status: 502 });
  }
}

function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/**
 * POST /auth  {room, token}  ->  {ticket, exp, login}
 *
 * The only place a GitHub token is ever seen, and it is never stored, logged
 * or forwarded to the Durable Object.
 */
async function handleAuth(request, env, cors) {
  if (!cors) {
    // No Origin, or one not on the list. A ticket handed to an unknown page is
    // exactly the thing the allowlist exists to prevent.
    return json({ error: 'origin not allowed' }, { status: 403 });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'expected a JSON body' }, { status: 400 }, cors); }

  const room = parseRoom(body?.room);
  if (!room) {
    return json({ error: 'room must be "owner~repo~project"' }, { status: 400 }, cors);
  }

  const allowed = allowedRepos(env);
  if (allowed.length && !allowed.includes(room.nwo.toLowerCase())) {
    // Without this, push access to any repository at all would mint a ticket
    // for a room named after someone else's.
    return json({ error: `repository ${room.nwo} is not served here` }, { status: 403 }, cors);
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return json({ error: 'a GitHub token is required' }, { status: 400 }, cors);

  // Development tokens: `dev:<login>` mints a ticket without asking GitHub —
  // what the editor's Playwright spec and a local `wrangler dev` session
  // use, since neither has a real token to offer. Accepted ONLY where the
  // development signing secret is in force: a deployed Worker always binds
  // COLLAB_SECRET, so there this branch cannot be reached at all. No
  // separate flag to leave switched on by mistake.
  const verdict = (!env.COLLAB_SECRET && token.startsWith('dev:'))
    ? { ok: true, login: token.slice(4).replace(/[^A-Za-z0-9-]/g, '').slice(0, 39) || 'dev' }
    : await checkRepoPermission(token, room.nwo);
  if (!verdict.ok) {
    return json({ error: verdict.reason, repo: room.nwo }, { status: 403 }, cors);
  }

  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
  const ticket = await mintTicket(signingSecret(env), {
    room: body.room,
    login: verdict.login,
    ro: false,
    exp,
  });

  return json({ ticket, exp, login: verdict.login, repo: room.nwo }, {}, cors);
}

/**
 * The websocket gate. Returns a Response to refuse, or a Request carrying the
 * verified identity to allow.
 *
 * The ticket is bound to its room, so a valid ticket for one project cannot
 * open another — see verifyTicket.
 */
async function gateConnection(req, env) {
  const url = new URL(req.url);
  // /parties/primer-room/<room>[/<route>]: the room is the third segment,
  // not the last — the room's plain-HTTP side (status, files, pilot, ask)
  // sits under it, and taking the last segment read "files" as a room name.
  const parts = url.pathname.split('/').filter(Boolean);
  const roomName = parts[2];

  if (!parseRoom(roomName)) {
    return new Response('bad room name', { status: 400 });
  }

  const ticket = url.searchParams.get('ticket');
  const payload = await verifyTicket(signingSecret(env), ticket, roomName);
  if (!payload) {
    return new Response('a valid ticket is required — POST /auth first', { status: 401 });
  }
  // The HTTP side reads the document as files and hands ops to an editor;
  // a read-only ticket gets the websocket (it sees the document there too)
  // and nothing else. The hub reaches these routes through its binding, as
  // the person Access verified, and never comes this way.
  const upgrade = (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
  if (!upgrade && payload.ro) {
    return new Response('a read-only ticket may open the document, not its routes', { status: 403 });
  }

  // Hand the verdict to the Durable Object as headers. A received Request has
  // immutable headers, so this has to be a new one.
  const headers = new Headers(req.headers);
  headers.set('x-collab-login', payload.login ?? '');
  headers.set('x-collab-ro', payload.ro ? '1' : '0');
  // Only a router sets this, and the router in front of this room is the line
  // above. Anything arriving under that name came from the browser, and
  // partyserver decodes it into `this.props` without asking who sent it.
  // Nothing reads props today; the point is that adding something that does
  // should not silently become an injection point. (The hub's front door
  // strips the same header, for the same reason.)
  headers.delete('x-partykit-props');
  return new Request(req, { headers });
}
