/**
 * One Durable Object per project document.
 *
 * y-partyserver's YServer supplies the Yjs sync protocol, awareness fan-out
 * and the in-memory document; this subclass adds the three things specific to
 * a primer project: durable storage, a seed handshake, and the commit SHA the
 * live document was built from.
 *
 * --- Why the server does not fetch from GitHub --------------------------
 *
 * The Phase 1 scope had the Durable Object bootstrap an empty room by reading
 * content.md and layout.json from the draft branch. It doesn't, and shouldn't:
 *
 *   - It would need a GitHub credential of its own. Every design that gives a
 *     shared server a token that can read (and eventually write) the repo is
 *     strictly worse than one where the credential never leaves the browser
 *     that owns it.
 *   - It would only work for a public repo, or force a service token for a
 *     private one — and Cider's consumers include private repos.
 *   - It is redundant. The first client to open the editor has already
 *     fetched both files in order to render the page.
 *
 * So the FIRST client to arrive seeds the room from what it already holds.
 * Exactly one connection is granted the seed (the grant is a synchronous
 * check-and-set below, and a Durable Object is single-threaded, so there is no
 * race); everyone else waits for normal Yjs sync. The room records that it has
 * been seeded in storage, so a later reconnection to an empty-but-seeded room
 * does not re-seed it.
 */
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import { readSnapshot, writeSnapshot, snapshotMeta } from './persist.js';
import { filesFromY, writeFiles } from '../ydoc.mjs';

/** The origin of a write the hub makes to a sleeping room (below). Not
 *  ORIGIN.LOCAL, so no client's UndoManager ever treats it as an undo step. */
const ORIGIN_STORE = 'collab:store';

const KEY_SEEDED = 'seeded';

export class PrimerRoom extends YServer {
  /**
   * How often the document is persisted. y-partyserver debounces onSave()
   * around edits and always calls it when the room empties, so these control
   * how much work is at risk if the isolate dies mid-session, not whether a
   * clean departure is saved.
   */
  static callbackOptions = {
    debounceWait: 3000,
    debounceMaxWait: 15000,
    timeout: 10000,
  };

  /**
   * Hibernation is deliberately OFF, and the CLIENT is what holds the cost
   * down instead.
   *
   * A hibernating Durable Object drops its isolate between messages, and a Yjs
   * room has to hold the whole document in memory to apply an update — so
   * every message would pay a full reload. That much still stands.
   *
   * What did not: this said the cost of staying awake was "bounded and small",
   * and asked for a measurement. The measurement was arithmetic. A room bills
   * wall-clock at 128 MB while a websocket is open, which is 0.125 GB-s per
   * second per ROOM — so one tab left open overnight is ~10,800 GB-s, most of
   * the free plan's 13,000 GB-s/day, spent on nobody typing.
   *
   * So the tab lets go instead: CollabSession drops its socket after ten
   * minutes with no input (client/session.mjs, "sleeping an idle tab") and
   * reconnects on the next keystroke, which costs a resync Yjs was already
   * doing for every network blip. Hibernation would now save little on top of
   * that — revisit it only against a dashboard figure you cannot explain.
   */
  static options = { hibernate: false };

  /** Pilot ops in flight: id -> resolve(result). See onRequest's /pilot. */
  #pilots = new Map();

  /**
   * The room's plain-HTTP side, reached only through a Worker that holds the
   * namespace binding (the hub's Pages Functions do; a browser cannot):
   *
   *   GET  …/status   what status() says — is it seeded, who is here
   *   POST …/pilot    {ops, by?, what?, timeout?} — hand pilot ops to ONE
   *                   editor in the room to apply, and wait for its answer
   *   POST …/ask      {what:'inventory', timeout?} — ask ONE editor about the
   *                   page it has rendered: where each slot sits, what is cut
   *   GET  …/files    the document AS FILES: {content, layout, baseSha, …} —
   *                   what the room holds, which is the truth whenever it is
   *                   seeded (the store only ever holds what a room saved)
   *   POST …/files    {content?, layout?, baseSha?, expect?} — write a room
   *                   that NOBODY is in, so a Save made straight to the store
   *                   (the hub's connector, a restore) reaches the copy the
   *                   next person will be handed. Refused while anyone is
   *                   connected (`occupied` — use /pilot, an editor is there
   *                   to apply it) and when `expect.content` is not what the
   *                   room holds (`moved` — the caller read a stale copy)
   *
   * /pilot is how a person's own Claude, talking to the hub's MCP connector,
   * edits a document that someone has open: the ops are relayed to the first
   * editor that may write, which applies them through docsync.api.batch() —
   * one undo step, the same validation as typing — and answers with a
   * `pilot-result`. Nothing is written to the Yjs document from here; the
   * editor that applied the batch syncs it to everyone the ordinary way.
   *
   * Two refusals, told apart because the caller should do different things:
   * `reason:'empty'` — nobody is here, so write the store instead; and
   * `reason:'no-pilot'` — someone IS here but no connection said it can take
   * pilot ops (an editor from before this existed, or a socket whose page is
   * gone). Both fall back to the store, but only the second is worth telling
   * a person about: their colleague should reload.
   */
  async onRequest(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/status')) {
      return Response.json(await this.status());
    }
    if (request.method === 'POST' && url.pathname.endsWith('/pilot')) {
      let body;
      try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'a JSON body is required' }, { status: 400 }); }
      const ops = Array.isArray(body?.ops) ? body.ops : [];
      if (!ops.length) return Response.json({ ok: false, error: 'ops is required' }, { status: 400 });
      const all = [...this.getConnections()];
      // Only an editor that SAID it can take pilot ops. A read-only one may
      // not write; one that never said so is either a client from before the
      // room learned this or a socket whose page is gone, and handing either
      // the ops buys nothing but the caller's timeout. No such editor is
      // reported distinctly from an empty room, because the answer differs:
      // there is a person here, and they need to reload.
      const editors = [...this.getConnections()].filter(c => !this.isReadOnly(c) && c.state?.pilot === true);
      if (!editors.length) {
        return Response.json({ ok: false, reason: all.length ? 'no-pilot' : 'empty', connections: all.length });
      }
      const id = crypto.randomUUID();
      const answer = new Promise(res => this.#pilots.set(id, res));
      const wait = Math.min(Math.max(+body.timeout || 20000, 1000), 60000);
      this.#send(editors[0], { t: 'pilot', id, ops, by: body.by ?? null, what: body.what ?? '' });
      const r = await Promise.race([
        answer,
        new Promise(res => setTimeout(() => res({ ok: false, reason: 'timeout', error: 'the editor did not answer in time' }), wait)),
      ]);
      this.#pilots.delete(id);
      return Response.json({ ...r, via: editors[0].state?.login ?? null, connections: all.length });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/ask')) {
      // A question, not a change. The editor is the only thing in the system
      // that has the page laid out in inches — where a slot sits, what is
      // falling off the bottom — so the hub asks it rather than guessing.
      // Answered by any editor here, read-only included: it renders the same
      // page. Same waiting map as /pilot; the answer is a pilot-result.
      let body;
      try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'a JSON body is required' }, { status: 400 }); }
      const what = typeof body?.what === 'string' ? body.what : '';
      if (what !== 'inventory') return Response.json({ ok: false, error: `nothing here answers '${what}'` }, { status: 400 });
      const all = [...this.getConnections()];
      const who = all.filter(c => c.state?.pilot === true);
      if (!who.length) return Response.json({ ok: false, reason: all.length ? 'no-pilot' : 'empty', connections: all.length });
      const id = crypto.randomUUID();
      const answer = new Promise(res => this.#pilots.set(id, res));
      const wait = Math.min(Math.max(+body.timeout || 10000, 1000), 30000);
      this.#send(who[0], { t: 'ask', id, what });
      const r = await Promise.race([
        answer,
        new Promise(res => setTimeout(() => res({ ok: false, reason: 'timeout', error: 'the editor did not answer in time' }), wait)),
      ]);
      this.#pilots.delete(id);
      return Response.json({ ...r, via: who[0].state?.login ?? null, connections: all.length });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/files')) {
      return Response.json({ ok: true, ...this.#files() });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/files')) {
      // A write to a room nobody is in. Why this exists: the room's snapshot
      // outlives every session, and the first client into a seeded room
      // ADOPTS what the room holds — so a version saved straight to the
      // store while the room slept was never seen by anyone, and the next
      // person's Save (409, then "save over it") destroyed it. The store is
      // written first by the caller; this brings the room up to it, with
      // the version as baseSha so that person's next Save carries the right
      // base. Check-and-set on the content the caller read, and no await
      // between the checks and the write: a Durable Object runs one task at
      // a time, so nobody can connect in between.
      let body;
      try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'a JSON body is required' }, { status: 400 }); }
      const all = [...this.getConnections()];
      if (all.length) return Response.json({ ok: false, reason: 'occupied', connections: all.length });
      const cur = this.#files();
      if (!cur.blocks) {
        // Nothing here to bring up to date: whoever seeds next seeds from
        // the store, which the caller has already written.
        return Response.json({ ok: true, applied: false, reason: 'unseeded', ...cur });
      }
      const expect = body?.expect && typeof body.expect === 'object' ? body.expect : null;
      if (expect && typeof expect.content === 'string' && expect.content !== cur.content) {
        return Response.json({ ok: false, reason: 'moved', ...cur });
      }
      const content = typeof body?.content === 'string' ? body.content : cur.content;
      const layout = typeof body?.layout === 'string' ? body.layout : cur.layout;
      const baseSha = typeof body?.baseSha === 'string' && body.baseSha ? body.baseSha : null;
      try {
        this.document.transact(() => {
          writeFiles(this.document, { content, layout });
          if (baseSha) this.document.getMap('meta').set('baseSha', baseSha);
        }, ORIGIN_STORE);
      } catch (e) {
        return Response.json({ ok: false, error: 'the files could not be written: ' + String((e && e.message) || e) }, { status: 400 });
      }
      // Persist now rather than trusting the debounce: the whole point is
      // that the next person, whenever they come, is handed this.
      await this.onSave();
      return Response.json({ ok: true, applied: true, ...this.#files() });
    }
    return new Response('not found', { status: 404 });
  }

  /** The document as the two files, plus what a caller deciding whether to
   *  trust them needs: whether the room was ever seeded, how many blocks it
   *  holds (0 = nothing here, the store is the truth), who is in it. */
  #files() {
    const blocks = this.document.getArray('blocks').length;
    const base = { seeded: this.#seeded, blocks, connections: [...this.getConnections()].length,
                   baseSha: this.document.getMap('meta').get('baseSha') ?? null };
    if (!blocks) return { ...base, content: null, layout: null };
    const f = filesFromY(this.document);
    return { ...base, content: f.content, layout: f.layoutText };
  }

  /** Set synchronously the moment a seed is granted, so two connections
   *  arriving in the same tick cannot both be told to seed. */
  #seedGranted = false;
  #seedKnown = false;
  #seeded = false;

  async onLoad() {
    const snap = await readSnapshot(this.ctx.storage);
    if (snap && snap.bytes.length) {
      Y.applyUpdate(this.document, snap.bytes, 'storage');
    }
    this.#seeded = (await this.ctx.storage.get(KEY_SEEDED)) === true;
    this.#seedKnown = true;
  }

  async onSave() {
    const bytes = Y.encodeStateAsUpdate(this.document);
    await writeSnapshot(this.ctx.storage, bytes, {
      baseSha: this.document.getMap('meta').get('baseSha') ?? null,
      slots: this.document.getArray('blocks').length,
    });
  }

  /**
   * A connection that authenticated read-only sees the document and everyone's
   * cursors but cannot change it. The ticket carries the verdict; onConnect
   * copies it onto the connection so this stays a synchronous read.
   */
  isReadOnly(connection) {
    return connection.state?.ro === true;
  }

  onConnect(connection, ctx) {
    const url = new URL(ctx.request.url);
    connection.setState({
      login: ctx.request.headers.get('x-collab-login') || null,
      ro: ctx.request.headers.get('x-collab-ro') === '1',
      room: url.pathname.split('/').pop(),
    });
    // YServer's own onConnect opens the sync and — the part that is easy to
    // lose — sends the newcomer everyone's current awareness state. Without
    // it a second editor sees an empty room until someone moves, because the
    // client only ever learns presence from updates, never from a query.
    super.onConnect(connection, ctx);
  }

  onCustomMessage(connection, message) {
    let msg;
    try { msg = JSON.parse(message); } catch { return; }

    switch (msg?.t) {
      case 'hello':
        // Whether this client can apply pilot ops, from its own mouth. Kept on
        // the connection so /pilot is a synchronous choice.
        connection.setState({ ...connection.state, pilot: msg.pilot === true });
        this.#send(connection, {
          t: 'hello',
          seeded: this.#seeded,
          baseSha: this.document.getMap('meta').get('baseSha') ?? null,
          you: { login: connection.state?.login ?? null, ro: this.isReadOnly(connection) },
          here: [...this.getConnections()].map(c => c.state?.login ?? null),
        });
        return;

      case 'seed-claim': {
        // Check-and-set with no await in between: a Durable Object runs one
        // task at a time, so this is atomic without a lock.
        const granted = !this.#seeded && !this.#seedGranted && !this.isReadOnly(connection);
        if (granted) this.#seedGranted = true;
        this.#send(connection, { t: 'seed-claim-result', granted, seeded: this.#seeded });
        return;
      }

      case 'seeded': {
        if (!this.#seedGranted || this.#seeded) return;
        this.#seeded = true;
        // Not awaited: the flag is already true in memory, and a failed write
        // only costs a redundant re-seed offer after an eviction.
        this.ctx.storage.put(KEY_SEEDED, true).catch(() => {});
        this.broadcastCustomMessage(JSON.stringify({
          t: 'seeded',
          by: connection.state?.login ?? null,
          baseSha: this.document.getMap('meta').get('baseSha') ?? null,
        }));
        return;
      }

      case 'pilot-result': {
        // The editor's answer to an onRequest /pilot; nobody waiting means
        // the caller's timeout already spoke, and the answer is dropped.
        const res = this.#pilots.get(msg.id);
        if (res) res({ ok: msg.ok === true, error: msg.error ?? null, results: msg.results ?? null });
        return;
      }

      default:
        return;
    }
  }

  #send(connection, obj) {
    this.sendCustomMessage(connection, JSON.stringify(obj));
  }

  /**
   * A plain HTTP view of the room, for operators and tests: is it seeded, how
   * many people are in it, how big is the document. Never returns content.
   */
  async status() {
    return {
      name: this.name ?? null,
      seeded: this.#seedKnown ? this.#seeded : (await this.ctx.storage.get(KEY_SEEDED)) === true,
      connections: [...this.getConnections()].length,
      // WHO is here, not just how many: the hub's list page draws a face per
      // person on a document's tile, and a count cannot say whose. Logins,
      // deduped (one person with two tabs is one person on the list), and
      // whatever the door set on the connection - never anything a client
      // said about itself.
      here: [...new Set([...this.getConnections()].map(c => c.state?.login).filter(Boolean))],
      blocks: this.document.getArray('blocks').length,
      baseSha: this.document.getMap('meta').get('baseSha') ?? null,
      snapshot: await snapshotMeta(this.ctx.storage),
    };
  }
}
