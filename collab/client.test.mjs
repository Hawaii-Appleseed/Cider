/**
 * Phase 2 gate: the editor-side mirror.
 *
 *   npm test            (in collab/)   — unit + end-to-end
 *   COLLAB_E2E=0 npm test              — unit only, no wrangler
 *
 * Unit: the plain⇄Y bridge round-trips every project in this repo byte for
 * byte, local writes are minimal diffs (a slot edit keeps its Y.Text; a
 * layout move touches one key), and undo is scoped to local edits.
 *
 * End to end: two CollabSessions against a real `wrangler dev`, exercising
 * the seed handshake, convergence through the mirror API the editor actually
 * calls (flush / onFiles), the busy hold, reconnection, presence, and (Phase
 * 4) the beforeRemote / onBaseSha hooks and cursors as relative positions.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Y from 'yjs';
import {
  CollabSession, ORIGIN, writeFiles, filesFromY, docFromY, applyText,
  syncMap, syncArray, syncBlocks, deepEqual, toY, colorFor,
} from './client/session.mjs';
import { parseContent, serializeContent } from './serialize.mjs';
import { mintTicket, formatRoom } from './src/auth.js';
import { startDev } from './devserver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEV_SECRET = 'dev-only-insecure-secret';
const PORT = Number(process.env.COLLAB_TEST_PORT || 8789);
const HOST = `127.0.0.1:${PORT}`;
const E2E = process.env.COLLAB_E2E !== '0';

/* ---------------------------------------------------------------- fixtures */

function projects() {
  const out = [];
  const dirs = [join(ROOT, 'report2027'), ...readdirSync(join(ROOT, 'projects'))
    .map(d => join(ROOT, 'projects', d))];
  for (const d of dirs) {
    const c = join(d, 'content.md'), l = join(d, 'layout.json');
    if (existsSync(c)) {
      out.push({ id: d.split('/').pop(), content: readFileSync(c, 'utf8'),
                 layout: existsSync(l) ? readFileSync(l, 'utf8') : '{}' });
    }
  }
  return out;
}

const seeded = (files) => {
  const d = new Y.Doc();
  d.transact(() => writeFiles(d, files), ORIGIN.SEED);
  return d;
};

/* -------------------------------------------------------------------- unit */

describe('plain <-> Y bridge', () => {
  const all = projects();
  test('finds the projects', () => assert.ok(all.length >= 5, `${all.length} projects`));

  for (const p of all) {
    test(`${p.id}: content is byte-identical and layout deep-equal after a round trip`, () => {
      const d = seeded(p);
      const f = filesFromY(d);
      assert.equal(f.content, p.content);
      const want = JSON.parse(p.layout || '{}');
      want.positions = want.positions || {}; want.shapes = want.shapes || []; want.sections = want.sections || {};
      assert.ok(deepEqual(f.layout, want), 'layout deep-equal (after the editor\'s own normalisation)');
    });
  }

  test('writing the same files again changes nothing', () => {
    const p = all[0];
    const d = seeded(p);
    let changed = true;
    d.transact(() => { changed = writeFiles(d, p); }, ORIGIN.LOCAL);
    assert.equal(changed, false);
  });

  test('a slot edit keeps its Y.Text and every other block untouched', () => {
    const p = all.find(x => x.id === 'report2027') || all[0];
    const d = seeded(p);
    const blocks = d.getArray('blocks');
    const before = blocks.toArray();
    const key = before.find(m => m.get('kind') === 'slot' && String(m.get('text')).length > 20).get('key');
    const ytext = before.find(m => m.get('key') === key).get('text');

    const doc = parseContent(p.content);
    const b = doc.blocks.find(x => x.key === key);
    b.text = b.text.slice(0, 10) + 'INSERTED ' + b.text.slice(10);
    const content = serializeContent(doc);

    let changed;
    d.transact(() => { changed = writeFiles(d, { content, layout: p.layout }); }, ORIGIN.LOCAL);
    assert.equal(changed, true);
    const after = blocks.toArray();
    assert.equal(after.length, before.length);
    after.forEach((m, i) => assert.equal(m, before[i], `block ${i} is the same Y.Map`));
    assert.equal(after.find(m => m.get('key') === key).get('text'), ytext, 'same Y.Text instance');
    assert.equal(filesFromY(d).content, content);
  });

  test('applyText is a single delete+insert around the change and never splits a surrogate pair', () => {
    const d = new Y.Doc();
    const t = d.getText('t');
    t.insert(0, 'Hawaiʻi 🌺 budget');
    let events = [];
    t.observe(e => events.push(e.delta));
    d.transact(() => applyText(t, 'Hawaiʻi 🌴 budget!'));
    assert.equal(t.toString(), 'Hawaiʻi 🌴 budget!');
    assert.equal(events.length, 1);
    // Two ops at most: the delete and the insert.
    const ops = events[0].filter(o => o.insert !== undefined || o.delete !== undefined);
    assert.ok(ops.length <= 2, JSON.stringify(events[0]));
    assert.equal(applyText(t, t.toString()), false);
  });

  test('a layout move sets one key; adding a shape splices one entry', () => {
    const d = new Y.Doc();
    const layout = { positions: { 'cover.logo': { x: 1, y: 2 }, 'fig.3': { x: 4, y: 5 } },
                     shapes: [{ id: 's1', x: 0 }, { id: 's2', x: 1 }], sections: {} };
    d.transact(() => syncMap(d.getMap('layout'), layout));
    const lm = d.getMap('layout');
    const logo = lm.get('positions').get('cover.logo');
    const shapes = lm.get('shapes');
    const s1 = shapes.get(0);

    const moved = structuredClone(layout);
    moved.positions['cover.logo'].x = 3.25;
    d.transact(() => syncMap(lm, moved));
    assert.equal(lm.get('positions').get('cover.logo'), logo, 'same nested Y.Map');
    assert.equal(logo.get('x'), 3.25);

    const added = structuredClone(moved);
    added.shapes.splice(1, 0, { id: 'new', x: 9 });
    d.transact(() => syncMap(lm, added));
    assert.equal(shapes.length, 3);
    assert.equal(shapes.get(0), s1, 'untouched entries keep their Y.Map');
    assert.equal(shapes.get(1).get('id'), 'new');
    assert.ok(deepEqual(lm.toJSON(), added));

    const removed = structuredClone(added);
    removed.shapes.pop();
    d.transact(() => syncMap(lm, removed));
    assert.ok(deepEqual(lm.toJSON(), removed));
  });

  test('syncArray on equal lengths recurses; on scalars replaces', () => {
    const d = new Y.Doc();
    const a = d.getArray('a');
    d.transact(() => syncArray(a, [1, 2, 3]));
    d.transact(() => syncArray(a, [1, 9, 3]));
    assert.deepEqual(a.toJSON(), [1, 9, 3]);
    d.transact(() => syncArray(a, [[1], { k: 1 }]));
    d.transact(() => syncArray(a, [[1, 2], { k: 2 }]));
    assert.deepEqual(a.toJSON(), [[1, 2], { k: 2 }]);
  });

  test('syncBlocks replaces only moved/added/removed blocks', () => {
    const d = new Y.Doc();
    const blocks = d.getArray('blocks');
    const mk = (key, text = key) => ({ kind: 'slot', key, pad: '', lead: '', text, gap: '\n\n' });
    d.transact(() => syncBlocks(blocks, [mk('a'), mk('b'), mk('c'), mk('d')]));
    const [ya, yb, yc, yd] = blocks.toArray();
    // move d before b, drop c, add e at the end
    d.transact(() => syncBlocks(blocks, [mk('a'), mk('d'), mk('b'), mk('e')]));
    assert.deepEqual(blocks.toArray().map(m => m.get('key')), ['a', 'd', 'b', 'e']);
    const now = blocks.toArray();
    assert.equal(now[0], ya);
    assert.equal(now[2], yb, 'b kept its identity');
    assert.notEqual(now[1], yd, 'the moved block is a fresh map');
    assert.ok(!now.includes(yc));
  });

  test('notes and the preamble survive local writes', () => {
    const content = '<!-- head -->\n\n[[a]]\nA text\n\n<!-- trailing -->\n\n[[b]]\nB\n';
    const d = seeded({ content, layout: '{}' });
    assert.equal(filesFromY(d).content, content);
    const edited = content.replace('A text', 'A longer text');
    d.transact(() => writeFiles(d, { content: edited, layout: '{}' }), ORIGIN.LOCAL);
    assert.equal(filesFromY(d).content, edited);
    assert.equal(docFromY(d).blocks.filter(b => b.kind === 'note').length, 1);
  });

  test('toY turns nested JSON into nested Y types', () => {
    const y = toY({ a: [1, { b: 2 }], c: 'x' });
    assert.ok(y instanceof Y.Map);
    const d = new Y.Doc(); d.getMap('m').set('v', y);
    assert.deepEqual(d.getMap('m').get('v').toJSON(), { a: [1, { b: 2 }], c: 'x' });
  });
});

describe('two front doors, one room', () => {
  const p = projects()[0];
  const room = formatRoom('Hawaii-Appleseed', 'Cider', 'doors');

  test('the relay is reached through its own party routing, with a ticket', () => {
    const s = new CollabSession({
      host: HOST, room, files: p, connect: false, ticket: async () => 'unused',
    });
    assert.equal(s.provider.url, `ws://${HOST}/parties/primer-room/${room}`);
    s.close();
  });

  test('a path front door is addressed exactly as given, and mints nothing', () => {
    // The hub authenticates the request itself (Cloudflare Access), so there
    // is no ticket function at all — a session that demanded one would fail
    // to connect there rather than fail loudly here.
    const s = new CollabSession({
      host: HOST, room, files: p, connect: false, path: `/api/collab/${room}`,
    });
    assert.equal(s.provider.url, `ws://${HOST}/api/collab/${room}`);
    s.close();
  });

  test('the path must name the room — y-partyserver does not append it', () => {
    // Pinned because the failure is silent and total: a prefix that stops at
    // /api/collab puts every document in the same room.
    const s = new CollabSession({ host: HOST, room, files: p, connect: false, path: '/api/collab' });
    assert.ok(!s.provider.url.endsWith(room),
              'a prefix is used verbatim; this is why collabPath() appends the room');
    s.close();
  });
});

describe('an offline session (no provider connection)', () => {
  const p = projects()[0];
  const make = () => new CollabSession({
    host: HOST, room: formatRoom('Hawaii-Appleseed', 'Cider', 'offline'),
    ticket: async () => 'unused', files: p, connect: false,
  });

  test('flush is a no-op before the room is ready', () => {
    const s = make();
    assert.equal(s.flush(p), false);
    assert.equal(s.shadow.getArray('blocks').length, 0);
    s.close();
  });

  test('undo is scoped to local marks; remote edits are never undone', () => {
    const s = make();
    // Stand in for the handshake: seed and declare ready.
    s.shadow.transact(() => writeFiles(s.shadow, p), ORIGIN.SEED);
    s.state = { ...s.state, phase: 'ready' };
    assert.equal(s.canUndo(), false);

    const doc = parseContent(p.content);
    const slot = doc.blocks.find(b => b.kind === 'slot' && b.text);
    const orig = slot.text;

    s.mark();
    slot.text = orig + ' one';
    assert.equal(s.flush({ content: serializeContent(doc), layout: p.layout }), true);
    // Same step: no mark between.
    slot.text = orig + ' one two';
    s.flush({ content: serializeContent(doc), layout: p.layout });
    s.mark();
    slot.text = orig + ' one two three';
    s.flush({ content: serializeContent(doc), layout: p.layout });
    assert.equal(s.undoManager.undoStack.length, 2, 'two marks -> two undo steps');

    // A "remote" edit lands in a different slot.
    const other = s.shadow.getArray('blocks').toArray()
      .find(m => m.get('kind') === 'slot' && m.get('key') !== slot.key);
    s.shadow.transact(() => other.get('text').insert(0, 'REMOTE '), ORIGIN.REMOTE);

    let f = s.undo();
    assert.ok(f.content.includes(orig + ' one two\n') || f.content.includes(orig + ' one two'), 'first undo drops " three"');
    f = s.undo();
    assert.ok(!f.content.includes(orig + ' one'), 'second undo drops the whole first step');
    assert.ok(String(other.get('text')).startsWith('REMOTE '), 'the remote edit survives both undos');
    assert.equal(s.canUndo(), false);
    f = s.redo();
    assert.ok(f.content.includes(orig + ' one two'));
    s.close();
  });

  test('a flush that changes nothing creates no undo step', () => {
    const s = make();
    s.shadow.transact(() => writeFiles(s.shadow, p), ORIGIN.SEED);
    s.state = { ...s.state, phase: 'ready' };
    s.mark();
    assert.equal(s.flush(p), false);
    assert.equal(s.canUndo(), false);
    s.close();
  });

  test('a cursor names a character, not an offset: it holds through edits around it and dies with its slot', () => {
    const s = make();
    s.shadow.transact(() => writeFiles(s.shadow, p), ORIGIN.SEED);
    s.state = { ...s.state, phase: 'ready' };
    const doc = parseContent(p.content);
    const slot = doc.blocks.find(b => b.kind === 'slot' && b.text.length > 20);
    const c = s.cursorAt(slot.key, 5);
    assert.equal(c.slot, slot.key);
    assert.ok(c.rel && typeof c.rel === 'object', 'a relative position as plain JSON');
    assert.deepEqual(s.resolveCursor(c), { slot: slot.key, index: 5 });
    const t = s.slotText(slot.key);
    // A collaborator's insert BEFORE it moves it along; one after it does not.
    s.shadow.transact(() => t.insert(0, 'AAA '), ORIGIN.REMOTE);
    assert.equal(s.resolveCursor(c).index, 9);
    s.shadow.transact(() => t.insert(t.length, ' tail'), ORIGIN.REMOTE);
    assert.equal(s.resolveCursor(c).index, 9);
    // The character it names is deleted: it lands where that was.
    s.shadow.transact(() => t.delete(4, 6), ORIGIN.REMOTE);
    assert.equal(s.resolveCursor(c).index, 4);
    // Past the end clamps to the end; an unknown slot is nothing.
    assert.equal(s.resolveCursor(s.cursorAt(slot.key, 10_000)).index, t.length);
    assert.equal(s.cursorAt('no.such.slot', 0), null);
    assert.equal(s.resolveCursor(null), null);
    // The slot is moved (syncBlocks re-creates a moved block, and so its
    // Y.Text): a position into the old one points at nothing.
    const moved = doc.blocks.filter(b => b !== slot);
    if (doc.blocks[0] === slot) moved.push(slot); else moved.unshift(slot);
    s.shadow.transact(() => writeFiles(s.shadow,
      { content: serializeContent({ preamble: doc.preamble, blocks: moved }), layout: p.layout }), ORIGIN.LOCAL);
    assert.equal(s.resolveCursor(c), null);
    s.close();
  });
});

/* --------------------------------------------------------------------- e2e */

let dev = null;

describe('two editors on one room', { skip: E2E ? false : 'COLLAB_E2E=0' }, () => {
  before(async () => { dev = await startDev({ port: PORT }); });
  after(async () => { if (dev) await dev.stop(); });

  const p = projects().find(x => x.id === 'report2027') || projects()[0];
  let seq = 0;
  const uniqueRoom = tag => formatRoom('Hawaii-Appleseed', 'Cider', `c-${tag}-${Date.now()}-${seq++}`);
  const ticketFor = (room, login) => async () =>
    mintTicket(DEV_SECRET, { room, login, ro: false, exp: Math.floor(Date.now() / 1000) + 120 });

  function open(room, login, files, extra = {}) {
    const got = [];
    const s = new CollabSession({
      host: HOST, room, login, files, ticket: ticketFor(room, login), debug: true,
      onFiles: (f, why) => got.push({ f, why }), ...extra,
    });
    s.got = got;
    return s;
  }

  test('the first editor seeds, the second adopts, and both hold the same bytes', async () => {
    const room = uniqueRoom('seed');
    const a = open(room, 'ada', p);
    await a.ready;
    assert.equal(a.state.phase, 'ready');
    assert.equal(a.state.seededBy, 'ada');
    assert.equal(a.got[0].why, 'adopt');
    assert.equal(a.got[0].f.content, p.content);

    const b = open(room, 'grace', { content: '[[x]]\nnot what the room holds\n', layout: '{}' });
    await b.ready;
    assert.equal(b.got[0].why, 'adopt');
    assert.equal(b.got[0].f.content, p.content, 'the room wins over the late arriver\'s files');
    assert.equal(b.baseSha(), null);
    await waitFor(() => a.state.peers === 2 && b.state.peers === 2, 5000, 'presence never showed two');
    assert.deepEqual(a.state.here, ['grace']);
    a.close(); b.close();
  });

  test('edits flow through flush/onFiles and converge, including the same slot', async () => {
    const room = uniqueRoom('converge');
    const a = open(room, 'ada', p);
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;

    const docA = parseContent(p.content), docB = parseContent(p.content);
    const key = docA.blocks.find(x => x.kind === 'slot' && x.text.length > 20).key;
    const slotA = docA.blocks.find(x => x.key === key), slotB = docB.blocks.find(x => x.key === key);

    slotA.text = 'A: ' + slotA.text;
    slotB.text = slotB.text + ' (B)';
    a.mark(); a.flush({ content: serializeContent(docA), layout: p.layout });
    b.mark(); b.flush({ content: serializeContent(docB), layout: p.layout });

    await waitFor(() => {
      const fa = a.files().content, fb = b.files().content;
      return fa === fb && fa.includes('A: ') && fa.includes(' (B)');
    }, 10_000, 'the two sessions never converged on the shared slot');

    const lastA = a.got[a.got.length - 1], lastB = b.got[b.got.length - 1];
    assert.equal(lastA.why, 'remote'); assert.equal(lastB.why, 'remote');
    assert.equal(lastA.f.content, lastB.f.content);
    // Merged text: both edits, in one slot, nobody's lost.
    const merged = parseContent(lastA.f.content).blocks.find(x => x.key === key).text;
    assert.ok(merged.startsWith('A: ') && merged.endsWith(' (B)'), merged);

    // Layout: two different elements at once.
    const la = JSON.parse(p.layout), lb = JSON.parse(p.layout);
    la.positions = la.positions || {}; lb.positions = lb.positions || {};
    la.positions['cover.logo'] = { x: 1.5, y: 2 };
    lb.positions['fig.3'] = { x: 4, y: 4 };
    a.flush({ content: lastA.f.content, layout: la });
    b.flush({ content: lastB.f.content, layout: lb });
    await waitFor(() => {
      const l = a.files().layout, m = b.files().layout;
      return deepEqual(l, m) && l.positions['cover.logo']?.x === 1.5 && l.positions['fig.3']?.x === 4;
    }, 10_000, 'layout moves never converged');
    a.close(); b.close();
  });

  test('a remote change back to exactly what this editor last received still reaches it', async () => {
    // B was last handed the document at adopt. B then edits (a flush moves
    // the shadow; nothing is handed back for one's own edit). A brings the
    // document back to exactly that adopted state — what a restore does, and
    // what an undo of B's edit from A's side would do. B must be told, or it
    // keeps words the document no longer holds.
    const room = uniqueRoom('back-to-last');
    const a = open(room, 'ada', p);
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;
    const adopted = b.got.length;
    const docB = parseContent(p.content);
    const slot = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    slot.text = 'B typed. ' + slot.text;
    b.mark(); b.flush({ content: serializeContent(docB), layout: p.layout });
    await waitFor(() => a.files().content.includes('B typed.'), 10_000, "B's edit never reached A");
    assert.equal(b.got.length, adopted, "nothing is handed back for one's own edit");

    // A puts the original files back: byte-for-byte what B was given at adopt.
    a.mark(); a.flush({ content: p.content, layout: p.layout });
    await waitFor(() => b.got.length > adopted, 10_000, 'B was never told the document went back');
    const last = b.got[b.got.length - 1];
    assert.equal(last.why, 'remote');
    assert.equal(last.f.content, p.content);
    assert.ok(!b.files().content.includes('B typed.'), 'the shadow agrees');
    a.close(); b.close();
  });

  test('a remote edit is held while the editor is busy and lands when it is not', async () => {
    const room = uniqueRoom('busy');
    let busy = false;
    const a = open(room, 'ada', p, { busy: () => busy });
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;

    busy = true;
    const docB = parseContent(p.content);
    const slot = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    slot.text = 'B typed. ' + slot.text;
    b.flush({ content: serializeContent(docB), layout: p.layout });
    await sleep(1500);
    assert.ok(!a.files().content.includes('B typed.'), 'held while busy');
    assert.ok(a.net.getArray('blocks').length > 0, 'but the net doc has it');
    assert.equal(a.got.length, 1, 'no onFiles while busy');

    // Meanwhile A commits an edit to a DIFFERENT slot from its (older) view.
    const docA = parseContent(p.content);
    const other = docA.blocks.find(x => x.kind === 'slot' && x.key !== slot.key && x.text.length > 5);
    other.text = other.text + ' [A]';
    a.mark(); a.flush({ content: serializeContent(docA), layout: p.layout });

    busy = false;
    await waitFor(() => a.files().content.includes('B typed.') && b.files().content.includes(' [A]'),
      10_000, 'the held update never landed / A\'s edit never reached B');
    assert.equal(a.files().content, b.files().content);
    a.close(); b.close();
  });

  test('a session that reconnects does not re-seed and picks up what it missed', async () => {
    const room = uniqueRoom('reconnect');
    const a = open(room, 'ada', p);
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;

    // A dropped connection, as the provider sees one: its socket's close
    // event. (Not provider.disconnect(): under Miniflare the server never
    // completes the close handshake, so the socket sits in CLOSING forever and
    // the provider — correctly — treats it as still connected.) The provider's
    // own reconnect logic takes it from here, fresh ticket included.
    const dropped = a.provider.ws;
    dropped.dispatchEvent(new Event('close'));
    dropped.close();   // a CLOSING socket delivers no more messages
    await waitFor(() => a.state.status === 'offline', 5000, 'never went offline');
    const docB = parseContent(p.content);
    const slot = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    slot.text = slot.text + ' while A was away';
    b.flush({ content: serializeContent(docB), layout: p.layout });
    // (No "A must not see it yet" here: the provider's first reconnect fires
    // after 100ms, so by now A is usually back — which is the point.)

    await waitFor(() => a.state.status === 'live' && a.files().content.includes('while A was away'),
      15_000, 'A never caught up after reconnecting');
    assert.equal(a.shadow.getArray('blocks').length, b.shadow.getArray('blocks').length, 'no duplicate blocks');
    assert.equal(a.files().content, b.files().content);
    a.close(); b.close();
  });

  // An open socket bills the room's Durable Object for wall-clock time whether
  // anyone is typing or not, so a session that nobody is using lets go of it
  // (client/session.mjs, "sleeping an idle tab"). The deadlines are in
  // milliseconds here; they are ten and two minutes in a browser.
  test('an unused session lets go of the socket, and stops hearing the room', async () => {
    const room = uniqueRoom('sleep');
    const a = open(room, 'ada', p, { idleMs: 600, hiddenMs: 0 });
    await a.ready;
    const b = open(room, 'grace', p, { idleMs: 0, hiddenMs: 0 });
    await b.ready;
    await waitFor(() => a.state.peers === 2, 5000, 'presence never showed two');

    await waitFor(() => a.asleep, 5000, 'the idle session never let go of the socket');
    // Not `offline`: nothing failed, and the editor draws a band over the page
    // for offline that would be a lie here.
    assert.equal(a.state.status, 'asleep');
    assert.equal(b.asleep, false, 'idleMs: 0 never sleeps');

    const docB = parseContent(p.content);
    const slot = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    slot.text = slot.text + ' while A was asleep';
    b.flush({ content: serializeContent(docB), layout: p.layout });
    await sleep(500);
    assert.ok(!a.files().content.includes('while A was asleep'), 'a sleeping session is not listening');
    a.close(); b.close();
  });

  // The waking half, with the deadline out of the way: a test short enough to
  // watch a session fall asleep is far too short for it to stay awake once it
  // has, so this one puts it to sleep by hand and exercises the way back.
  test('a woken session merges what it did while asleep with what it missed', async () => {
    const room = uniqueRoom('wake');
    const a = open(room, 'ada', p, { idleMs: 0, hiddenMs: 0 });
    await a.ready;
    const b = open(room, 'grace', p, { idleMs: 0, hiddenMs: 0 });
    await b.ready;
    await waitFor(() => a.state.peers === 2, 5000, 'presence never showed two');

    assert.equal(a.sleep(), true);
    assert.equal(a.state.status, 'asleep');

    const docB = parseContent(p.content);
    const key = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20).key;
    const slotB = docB.blocks.find(x => x.key === key);
    slotB.text = slotB.text + ' (B while A was asleep)';
    b.flush({ content: serializeContent(docB), layout: p.layout });
    await sleep(400);
    assert.ok(!a.files().content.includes('(B while A'), 'a sleeping session is not listening');

    // Typing is what wakes it: the editor calls flush() as it always does, and
    // the edit made while the socket was gone is merged on the way back in.
    const docA = parseContent(a.files().content);
    const slotA = docA.blocks.find(x => x.key === key);
    slotA.text = 'A while asleep: ' + slotA.text;
    a.mark(); a.flush({ content: serializeContent(docA), layout: p.layout });
    assert.equal(a.asleep, false, 'a local edit wakes the session at once');

    await waitFor(() => {
      const fa = a.files().content;
      return a.state.status === 'live' && fa === b.files().content
        && fa.includes('(B while A was asleep)') && fa.includes('A while asleep: ');
    }, 15_000, 'the woken session never converged with what it missed');
    assert.equal(a.shadow.getArray('blocks').length, b.shadow.getArray('blocks').length, 'no duplicate blocks');
    // Both edits, one slot, nobody's lost — the same merge a dropped
    // connection already gets, reached on purpose.
    const merged = parseContent(a.files().content).blocks.find(x => x.key === key).text;
    assert.ok(merged.startsWith('A while asleep: ') && merged.endsWith('(B while A was asleep)'), merged);
    a.close(); b.close();
  });

  test('a collaborator typing keeps an otherwise idle session awake', async () => {
    const room = uniqueRoom('watch');
    // A is only READING — no local edits at all, and a deadline it would trip
    // several times over during this test.
    const a = open(room, 'ada', p, { idleMs: 500, hiddenMs: 0 });
    await a.ready;
    const b = open(room, 'grace', p, { idleMs: 0, hiddenMs: 0 });
    await b.ready;

    // Duration is billed per ROOM, not per connection: B holds it awake
    // regardless, so A leaving would save nothing and cost A the edits.
    const docB = parseContent(p.content);
    const slot = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    for (let i = 0; i < 6; i++) {
      slot.text = slot.text + ` ${i}`;
      b.flush({ content: serializeContent(docB), layout: p.layout });
      await sleep(200);
      assert.equal(a.asleep, false, `A slept while B was typing (round ${i})`);
    }
    await waitFor(() => a.files().content.includes(' 5'), 10_000, 'A never saw B\'s last edit');
    a.close(); b.close();
  });

  test('presence: selection, page, typing spot and colour reach the other side, and leave with it', async () => {
    const room = uniqueRoom('presence');
    const seenA = [], seenB = [];
    const a = open(room, 'ada', p, { onPeers: ps => seenA.push(ps) });
    await a.ready;
    const b = open(room, 'grace', p, { onPeers: ps => seenB.push(ps) });
    await b.ready;
    await waitFor(() => a.peers.length === 1 && b.peers.length === 1, 5000, 'never saw each other');
    assert.equal(a.peers[0].login, 'grace');
    assert.equal(b.peers[0].login, 'ada');
    assert.equal(b.peers[0].color, colorFor('ada'), 'colour hashes off the login');
    assert.equal(a.color, colorFor('ada'));
    assert.equal(colorFor('ada'), colorFor('ada'), 'stable across calls (and so across days)');
    assert.match(colorFor('grace'), /^#[0-9A-F]{6}$/);
    // Two logins CAN share a colour (eight colours, many people); stability
    // beats uniqueness here, and the name tag disambiguates.
    assert.deepEqual(b.peers[0].sel, []);

    assert.equal(a.setPresence({ sel: ['cover.logo', 'fig.3'], slot: 'page1.intro', drag: true }), true);
    assert.equal(a.setPresence({ sel: ['cover.logo', 'fig.3'], slot: 'page1.intro', drag: true }), false, 'unchanged: not resent');
    await waitFor(() => b.peers[0]?.slot === 'page1.intro', 5000, 'presence never propagated');
    assert.deepEqual(b.peers[0].sel, ['cover.logo', 'fig.3']);
    assert.equal(b.peers[0].drag, true);
    assert.equal(b.peers[0].page, null);

    // An automated editor at work through A is presence too, so B can say "via ada".
    a.setPresence({ sel: [], agent: { by: 'Claude', what: 'setSlot page1.intro', target: 'page1.intro' } });
    await waitFor(() => b.peers[0]?.agent?.by === 'Claude', 5000, 'the agent never showed');
    assert.equal(b.peers[0].agent.target, 'page1.intro');
    a.setPresence({ sel: [] });
    await waitFor(() => !b.peers[0]?.agent, 5000, 'the agent never cleared');

    // A polled presence function is picked up without anyone calling setPresence.
    const c = open(room, 'linus', p, { presence: () => ({ page: 'p3' }) });
    await c.ready;
    await waitFor(() => b.peers.some(x => x.login === 'linus' && x.page === 'p3'), 5000, 'polled presence never arrived');

    a.close();
    await waitFor(() => !b.peers.some(x => x.login === 'ada'), 5000, 'ada never left');
    assert.ok(seenB.length >= 3, 'onPeers fired for arrival, change and departure');
    b.close(); c.close();
  });

  test('beforeRemote runs just before a collaborator\'s update lands; a collaborator\'s Save is announced, our own is not', async () => {
    const room = uniqueRoom('hooks');
    const order = [], shas = [];
    let a;
    const has = () => a.files().content.includes('B typed.') ? 'has' : 'not';
    a = open(room, 'ada', p, {
      beforeRemote: () => order.push('before:' + has()),
      onFiles: (f, why) => order.push(why + ':' + (f.content.includes('B typed.') ? 'has' : 'not')),
      onBaseSha: sha => shas.push(sha),
    });
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;
    const docB = parseContent(p.content);
    const slot = docB.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    slot.text = 'B typed. ' + slot.text;
    b.flush({ content: serializeContent(docB), layout: p.layout });
    await waitFor(() => order.includes('remote:has'), 10_000, 'B\'s edit never reached A');
    const i = order.indexOf('remote:has');
    assert.equal(order[i - 1], 'before:not', 'beforeRemote ran right before, with the old text still in place: ' + order.join(' '));

    a.setBaseSha('a'.repeat(40));
    await sleep(500);
    assert.deepEqual(shas, [], 'our own Save is not announced back to us');
    b.setBaseSha('b'.repeat(40));
    await waitFor(() => shas.length > 0, 5000, 'onBaseSha never fired for the collaborator\'s Save');
    assert.deepEqual(shas, ['b'.repeat(40)]);
    assert.equal(a.baseSha(), 'b'.repeat(40));
    a.close(); b.close();
  });

  test('a cursor published by A resolves in B against B\'s own copy, and moves with B\'s edits', async () => {
    const room = uniqueRoom('cursor');
    const a = open(room, 'ada', p);
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;
    await waitFor(() => a.peers.length === 1 && b.peers.length === 1, 5000, 'never saw each other');
    const doc = parseContent(p.content);
    const slot = doc.blocks.find(x => x.kind === 'slot' && x.text.length > 20);
    a.setPresence({ slot: slot.key, cursor: a.cursorAt(slot.key, 7) });
    await waitFor(() => b.peers[0]?.cursor, 5000, 'the cursor never arrived');
    assert.deepEqual(b.resolveCursor(b.peers[0].cursor), { slot: slot.key, index: 7 });
    // B inserts before it: on B's screen A's caret is further along now, and
    // A's own copy agrees once B's edit arrives.
    const docB = parseContent(p.content);
    docB.blocks.find(x => x.key === slot.key).text = 'BB ' + slot.text;
    b.flush({ content: serializeContent(docB), layout: p.layout });
    assert.equal(b.resolveCursor(b.peers[0].cursor).index, 10);
    await waitFor(() => a.files().content.includes('BB '), 5000, 'B\'s edit never reached A');
    assert.equal(a.resolveCursor(a.provider.awareness.getLocalState().cursor).index, 10);
    a.close(); b.close();
  });

  test('baseSha rides in meta and is not an undo step', async () => {
    const room = uniqueRoom('sha');
    const a = open(room, 'ada', p, { baseSha: 'a'.repeat(40) });
    await a.ready;
    const b = open(room, 'grace', p);
    await b.ready;
    assert.equal(b.baseSha(), 'a'.repeat(40));
    b.setBaseSha('b'.repeat(40));
    assert.equal(b.canUndo(), false);
    await waitFor(() => a.baseSha() === 'b'.repeat(40), 5000, 'baseSha never propagated');
    a.close(); b.close();
  });
});

/* ------------------------------------------------------------------ helpers */

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(pred, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(50);
  }
  throw new Error(what);
}
