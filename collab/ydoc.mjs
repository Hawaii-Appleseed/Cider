/**
 * The plain <-> Yjs bridge: how {content, layout} live inside a Y document,
 * and how a document is written from and read back to those two files.
 *
 * Shared by the browser client (client/session.mjs, which mirrors the editor
 * onto a Y.Doc) and the room (src/room.js, which holds the same Y.Doc in a
 * Durable Object). It used to live in session.mjs alone, and the room could
 * not read its own document as files — so a Save made to the hub's store
 * while the room slept was invisible to the room, and the next person in
 * was handed the older copy. The room reads and writes files through this
 * now, with exactly the client's diffing, so the two cannot disagree about
 * what a block is.
 *
 * Imports Yjs and the Phase 0 serializer only: nothing here knows about a
 * websocket, a provider, or an editor.
 */
import * as Y from 'yjs';
import {
  parseContent, serializeContent, serializeLayout, assertWellFormed,
} from './serialize.mjs';

/* ------------------------------------------------------------ plain <-> Y */

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!(k in b) || !deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** A JSON value as the Y type that lets two people change different parts
 *  of it at once: objects become Y.Map, arrays Y.Array, scalars stay. */
export function toY(v) {
  if (Array.isArray(v)) { const a = new Y.Array(); a.push(v.map(toY)); return a; }
  if (isObj(v)) { const m = new Y.Map(); for (const k of Object.keys(v)) m.set(k, toY(v[k])); return m; }
  return v;
}

function blockToY(b) {
  const m = new Y.Map();
  m.set('kind', b.kind);
  if (b.kind === 'note') { m.set('raw', b.raw); return m; }
  m.set('key', b.key);
  m.set('pad', b.pad ?? '');
  m.set('lead', b.lead ?? '');
  m.set('text', new Y.Text(b.text ?? ''));
  m.set('gap', b.gap ?? '');
  return m;
}

function blockFromY(m) {
  if (m.get('kind') === 'note') return { kind: 'note', raw: m.get('raw') ?? '' };
  return {
    kind: 'slot', key: m.get('key'), pad: m.get('pad') ?? '', lead: m.get('lead') ?? '',
    text: String(m.get('text') ?? ''), gap: m.get('gap') ?? '',
  };
}

/** The Y document as Phase 0's plain shape. */
export function docFromY(ydoc) {
  return {
    preamble: ydoc.getMap('meta').get('preamble') ?? '',
    blocks: ydoc.getArray('blocks').toArray().map(blockFromY),
    layout: ydoc.getMap('layout').toJSON(),
  };
}

/** {content, layout} — the two file bodies — from a Y document. */
export function filesFromY(ydoc) {
  const d = docFromY(ydoc);
  return { content: serializeContent(d), layout: d.layout, layoutText: serializeLayout(d.layout) };
}

/* ----------------------------------------------------------- text diffs */

const isHigh = c => c >= 0xD800 && c <= 0xDBFF;
const isLow = c => c >= 0xDC00 && c <= 0xDFFF;

/**
 * Turn `prev` into `next` on a Y.Text as ONE delete + ONE insert around the
 * changed span — a common prefix and suffix are left untouched, which is what
 * lets a collaborator's concurrent insert elsewhere in the same paragraph
 * survive. Never splits a surrogate pair.
 */
export function applyText(ytext, next) {
  const prev = ytext.toString();
  if (prev === next) return false;
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++;
  if (p > 0 && isHigh(prev.charCodeAt(p - 1))) p--;
  let s = 0;
  while (s < max - p && prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  if (s > 0 && isLow(prev.charCodeAt(prev.length - s))) s--;
  const del = prev.length - p - s;
  const ins = next.slice(p, next.length - s);
  if (del) ytext.delete(p, del);
  if (ins) ytext.insert(p, ins);
  return true;
}

/* --------------------------------------------------------- layout diffs */

/** Make `ymap` equal the plain object `obj`, touching only what differs. */
export function syncMap(ymap, obj) {
  let changed = false;
  for (const k of [...ymap.keys()]) {
    if (!(k in obj)) { ymap.delete(k); changed = true; }
  }
  for (const k of Object.keys(obj)) {
    const nv = obj[k];
    const ov = ymap.get(k);
    if (ov instanceof Y.Map && isObj(nv)) { if (syncMap(ov, nv)) changed = true; }
    else if (ov instanceof Y.Array && Array.isArray(nv)) { if (syncArray(ov, nv)) changed = true; }
    else if (!(ov instanceof Y.AbstractType) && !isObj(nv) && !Array.isArray(nv) && ov === nv) { /* same */ }
    else { ymap.set(k, toY(nv)); changed = true; }
  }
  return changed;
}

/**
 * Make `yarr` equal the plain array `arr`.
 *
 * Same length: element by element, recursing into maps — so two people moving
 * two different shapes (one array, two entries) both land. Different length:
 * the equal prefix and suffix are kept and only the middle is spliced, which
 * is exactly one shape added or removed anywhere in the list.
 */
export function syncArray(yarr, arr) {
  const old = yarr.toJSON();
  if (old.length === arr.length) {
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
      const ov = yarr.get(i), nv = arr[i];
      if (ov instanceof Y.Map && isObj(nv)) { if (syncMap(ov, nv)) changed = true; }
      else if (ov instanceof Y.Array && Array.isArray(nv)) { if (syncArray(ov, nv)) changed = true; }
      else if (!deepEqual(old[i], nv)) { yarr.delete(i, 1); yarr.insert(i, [toY(nv)]); changed = true; }
    }
    return changed;
  }
  let p = 0;
  while (p < old.length && p < arr.length && deepEqual(old[p], arr[p])) p++;
  let s = 0;
  while (s < old.length - p && s < arr.length - p
         && deepEqual(old[old.length - 1 - s], arr[arr.length - 1 - s])) s++;
  yarr.delete(p, old.length - p - s);
  yarr.insert(p, arr.slice(p, arr.length - s).map(toY));
  return true;
}

/* ---------------------------------------------------------- block diffs */

const blockId = b => b.kind === 'note' ? `note:${b.raw}` : `slot:${b.key}`;

/** Indices forming a longest increasing subsequence of `xs` (−1 = absent). */
function lis(xs) {
  const tails = [], tailIdx = [], prev = new Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x < 0) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x; tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const out = [];
  for (let i = tailIdx.length ? tailIdx[tailIdx.length - 1] : -1; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/**
 * Make the Y block list equal `blocks` (Phase 0's plain list).
 *
 * A slot that exists on both sides keeps its Y.Map — and so its Y.Text, and
 * so any collaborator's concurrent typing in it. Only blocks that were added,
 * removed or MOVED are replaced: the longest run of blocks already in the
 * right order stays put, everything else is deleted and re-inserted fresh.
 * That makes the common case (typing) a text diff, and the rare case (a
 * section moved, added or renamed) touch only the blocks involved.
 */
export function syncBlocks(yblocks, blocks) {
  const old = yblocks.toArray().map(blockFromY);
  const oldIdx = new Map();
  old.forEach((b, i) => {
    const id = blockId(b);
    if (!oldIdx.has(id)) oldIdx.set(id, []);
    oldIdx.get(id).push(i);
  });
  const newToOld = blocks.map(b => {
    const q = oldIdx.get(blockId(b));
    return q && q.length ? q.shift() : -1;
  });
  const kept = new Set(lis(newToOld).map(ni => newToOld[ni]));
  let changed = false;
  for (let i = old.length - 1; i >= 0; i--) {
    if (!kept.has(i)) { yblocks.delete(i, 1); changed = true; }
  }
  let j = 0;
  blocks.forEach((b, ni) => {
    const oi = newToOld[ni];
    if (oi !== -1 && kept.has(oi)) {
      const m = yblocks.get(j++);
      if (b.kind === 'slot') {
        for (const f of ['pad', 'lead', 'gap']) {
          if ((m.get(f) ?? '') !== (b[f] ?? '')) { m.set(f, b[f] ?? ''); changed = true; }
        }
        let t = m.get('text');
        if (!(t instanceof Y.Text)) { t = new Y.Text(''); m.set('text', t); changed = true; }
        if (applyText(t, b.text ?? '')) changed = true;
      }
    } else {
      yblocks.insert(j++, [blockToY(b)]);
      changed = true;
    }
  });
  return changed;
}

/* ------------------------------------------------------------ the mirror */

/** Accept either the layout object or its JSON text. */
function layoutObject(layout) {
  if (typeof layout === 'string') return JSON.parse(layout || '{}');
  // JSON round-trip: drops `undefined` values and functions the editor may
  // leave on its in-memory object, and is exactly what the file would hold.
  return JSON.parse(JSON.stringify(layout ?? {}));
}

/** The editor fills these in on load; keeping them in the document means a
 *  freshly adopted layout never differs from what the editor then holds —
 *  which would otherwise be a spurious LOCAL transaction (an undo step that
 *  undoes nothing) on the very next render. */
function normalizeLayout(l) {
  l.positions = l.positions || {};
  l.shapes = l.shapes || [];
  l.sections = l.sections || {};
  return l;
}

/**
 * Write {content, layout} into a Y document, touching only what differs.
 * Runs inside the caller's transaction. Returns whether anything changed.
 */
export function writeFiles(ydoc, files) {
  const { preamble, blocks } = parseContent(files.content);
  const layout = normalizeLayout(layoutObject(files.layout));
  let changed = false;
  const meta = ydoc.getMap('meta');
  if ((meta.get('preamble') ?? '') !== preamble) { meta.set('preamble', preamble); changed = true; }
  if (syncBlocks(ydoc.getArray('blocks'), blocks)) changed = true;
  if (syncMap(ydoc.getMap('layout'), layout)) changed = true;
  return changed;
}

/** Would the document survive a round trip? Throws if not. */
export function checkY(ydoc) {
  return assertWellFormed(docFromY(ydoc));
}

/* ------------------------------------------------------- a restore as a diff */

/** One level of the 3-way rule: a key the restored copy leaves as it was in
 *  the base keeps whatever the room holds now (including "gone"); a key it
 *  changed takes the restored value; a key only the room has (added since the
 *  base) stays. */
function mergeKeys(base, restored, current) {
  const out = {};
  for (const k of Object.keys(restored)) {
    if (k in base && deepEqual(restored[k], base[k])) { if (k in current) out[k] = current[k]; }
    else out[k] = restored[k];
  }
  for (const k of Object.keys(current)) if (!(k in restored) && !(k in base)) out[k] = current[k];
  return out;
}

/**
 * A restore as a per-slot diff. `base` is the version the restore goes on top
 * of (what everyone's "saved" is), `restored` the version being brought back,
 * `current` what the editor shows now (base plus whatever people have typed
 * and not saved). Every slot the restored copy does NOT change relative to
 * the base keeps its current words; every slot it changes takes the restored
 * words: the restore wins where the two meet. Layout the same way, key by
 * key and one level into positions / sections / and the like. Slots only the
 * room added since the base are not carried (they have no place in the
 * restored order).
 *
 * @param {{content: string, layout: string|object}} base
 * @returns {{content: string, layout: object, kept: string[], taken: string[], dropped: string[]}}
 *   kept/taken: slot keys whose current words survived / were replaced;
 *   dropped: slots in `current` that neither `base` nor `restored` has (a
 *   colleague added them since the saved version), which the restore loses
 */
export function mergeRestore(base, restored, current) {
  const B = parseContent(base.content), R = parseContent(restored.content), C = parseContent(current.content);
  const slotOf = (doc, key) => doc.blocks.find(b => b.kind === 'slot' && b.key === key);
  const kept = [], taken = [];
  const blocks = R.blocks.map(b => {
    if (b.kind !== 'slot') return b;
    const was = slotOf(B, b.key), now = slotOf(C, b.key);
    if (was && now && was.text === b.text) {
      if (now.text !== b.text) kept.push(b.key);
      return { ...b, text: now.text };
    }
    if (was && now && now.text !== was.text && now.text !== b.text) taken.push(b.key);   // unsaved words, in a slot the restore changes
    return b;
  });
  const dropped = C.blocks.filter(b => b.kind === 'slot' && !slotOf(B, b.key) && !slotOf(R, b.key)).map(b => b.key);
  const lay = v => normalizeLayout(layoutObject(v));
  const lb = lay(base.layout), lr = lay(restored.layout), lc = lay(current.layout);
  const layout = {};
  for (const k of Object.keys(lr)) {
    if (k in lb && deepEqual(lr[k], lb[k])) { if (k in lc) layout[k] = lc[k]; }
    else if (isObj(lr[k]) && isObj(lb[k]) && isObj(lc[k])) layout[k] = mergeKeys(lb[k], lr[k], lc[k]);
    else layout[k] = lr[k];
  }
  for (const k of Object.keys(lc)) if (!(k in lr) && !(k in lb)) layout[k] = lc[k];
  return { content: serializeContent({ preamble: R.preamble, blocks }), layout, kept, taken, dropped };
}
