/**
 * Export a document from the hub's store (R2) to git — step 05.
 *
 * What the store gives up by leaving git is real: no log, no blame, no diff
 * you can read on github.com, no clone as an off-Cloudflare backup. This puts
 * the credential on a SCHEDULE instead of the hot path: a Publish from the
 * hub, or the nightly cron, writes one commit of the current state to a
 * branch of the project's repository. The editor never holds a GitHub token;
 * the Worker holds one, scoped to the repositories it serves, and the only
 * thing it can be made to do is commit what the store already holds.
 *
 *   docs/<room>/{content.md, layout.json, meta.json, assets/…}   in
 *   <repo> @ hub/<project>: <paths.content>, <paths.layout>, <paths.assets>/…   out
 *
 * The branch is `hub/<project>`, never the deploy branch: a pipeline report
 * builds from main and a build must run on a machine; an editor-native one
 * is published by a person merging what this wrote. One export = one commit,
 * parented on the branch's tip, so the log reads as the sequence of
 * versions. `docs/<room>/export.json` remembers the last version exported,
 * so a nightly sweep over an unchanged store writes nothing.
 *
 * Which repo paths the files belong at comes from the document itself: the
 * editor records its manifest's content/layout/assets paths and deploy
 * branch in meta on every Save (`paths`), because only the editor knows
 * them and the store must be exportable with nothing else present.
 *
 * Pure with respect to its inputs: `bucket` is an R2 binding (or a stub),
 * `fetch` is whatever performs HTTP, `api` is GitHub's base. The Worker's
 * fetch() and scheduled() handlers wire the real ones in.
 */
import { parseRoom } from './auth.js';

export const DEFAULT_API = 'https://api.github.com';
export const PREFIX = 'docs/';
export const exportBranch = project => `hub/${project}`;

const key = (room, file) => `${PREFIX}${room}/${file}`;

/** A repo path the editor may name: relative, no walking, no leading slash. */
export function safeRepoPath(p) {
  if (typeof p !== 'string') return null;
  const s = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s || s.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null;
  if (/[\\\0]/.test(s) || s.length > 300) return null;
  return s;
}
export function safeBranch(b) {
  if (typeof b !== 'string' || !b) return 'main';
  return /^[A-Za-z0-9._\/-]{1,120}$/.test(b) && !b.includes('..') ? b : 'main';
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function readJson(bucket, k) {
  const o = await bucket.get(k);
  if (!o) return null;
  try { return await o.json(); } catch { return null; }
}

/** GitHub, the Git Data API, with the failure named. */
function github({ token, api, fetch: f, nwo }) {
  return async (path, { method = 'GET', body } = {}) => {
    const r = await f(`${api}/repos/${nwo}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'primer-collab export',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`GitHub ${r.status} on ${method} ${path}: ${t.slice(0, 200)}`);
    }
    return r.status === 204 ? null : r.json();
  };
}

/**
 * Export one room. Returns one of:
 *   {status: 'nothing'}                       the store has no document
 *   {status: 'unexportable', reason}          it has one, but no paths recorded
 *   {status: 'unchanged', version, sha, …}    the branch already has this version
 *   {status: 'exported', version, sha, …}     one new commit
 */
export async function exportRoom({ bucket, room, token, api = DEFAULT_API, fetch: f = globalThis.fetch, now = () => new Date() }) {
  const parsed = parseRoom(room);
  if (!parsed) throw new Error(`not a room: ${room}`);
  if (!token) throw new Error('no GitHub token to export with (GITHUB_EXPORT_TOKEN)');

  const meta = await readJson(bucket, key(room, 'meta.json'));
  if (!meta || typeof meta.version !== 'string') return { status: 'nothing', room };

  const paths = meta.paths && typeof meta.paths === 'object' ? meta.paths : {};
  const contentPath = safeRepoPath(paths.content);
  const layoutPath = safeRepoPath(paths.layout);
  const assetsPath = safeRepoPath(paths.assets) || 'assets';
  if (!contentPath) {
    return { status: 'unexportable', room, version: meta.version,
             reason: 'no repository paths recorded for this document — Save it once from the editor' };
  }

  const state = await readJson(bucket, key(room, 'export.json'));
  const branch = exportBranch(parsed.project);
  if (state && state.version === meta.version && state.sha) {
    return { status: 'unchanged', room, version: meta.version, sha: state.sha, branch,
             repo: parsed.nwo, url: `https://github.com/${parsed.nwo}/commit/${state.sha}` };
  }

  const gh = github({ token, api, fetch: f, nwo: parsed.nwo });

  // The branch, created from the deploy branch the first time.
  let ref = await gh(`git/ref/heads/${encodeURIComponent(branch)}`);
  if (!ref) {
    const base = safeBranch(paths.branch);
    const baseRef = await gh(`git/ref/heads/${encodeURIComponent(base)}`);
    if (!baseRef) throw new Error(`neither ${branch} nor ${base} exists in ${parsed.nwo}`);
    ref = await gh('git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: baseRef.object.sha } });
  }
  const tip = ref.object.sha;
  const tipCommit = await gh(`git/commits/${tip}`);

  // The tree: the two files as text, every asset as a blob.
  const tree = [];
  const content = await bucket.get(key(room, 'content.md'));
  if (!content) return { status: 'nothing', room };
  tree.push({ path: contentPath, mode: '100644', type: 'blob', content: await content.text() });
  if (layoutPath) {
    const layout = await bucket.get(key(room, 'layout.json'));
    if (layout) tree.push({ path: layoutPath, mode: '100644', type: 'blob', content: await layout.text() });
  }
  let cursor;
  const assetPrefix = key(room, 'assets/');
  do {
    const page = await bucket.list({ prefix: assetPrefix, cursor });
    for (const obj of page.objects) {
      const name = obj.key.slice(assetPrefix.length);
      if (!name || name.includes('/')) continue;
      const o = await bucket.get(obj.key);
      if (!o) continue;
      const blob = await gh('git/blobs', { method: 'POST',
        body: { content: toBase64(await o.arrayBuffer()), encoding: 'base64' } });
      tree.push({ path: `${assetsPath}/${name}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const newTree = await gh('git/trees', { method: 'POST', body: { base_tree: tipCommit.tree.sha, tree } });
  if (newTree.sha === tipCommit.tree.sha) {
    // Bytes already on the branch (an export that lost the race to record
    // itself, or a hand commit): record it rather than write an empty commit.
    await bucket.put(key(room, 'export.json'), JSON.stringify({ version: meta.version, sha: tip, branch, at: now().toISOString() }),
                     { httpMetadata: { contentType: 'application/json' } });
    return { status: 'unchanged', room, version: meta.version, sha: tip, branch, repo: parsed.nwo,
             url: `https://github.com/${parsed.nwo}/commit/${tip}` };
  }
  const who = meta.updated_by ? ` by ${meta.updated_by}` : '';
  const when = meta.updated_at ? ` at ${meta.updated_at}` : '';
  const commit = await gh('git/commits', { method: 'POST', body: {
    message: `${parsed.project}: hub version ${meta.version}\n\nSaved on the staff hub${who}${when}. Exported by primer-collab.`,
    tree: newTree.sha, parents: [tip],
  } });
  await gh(`git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });

  const record = { version: meta.version, sha: commit.sha, branch, at: now().toISOString() };
  await bucket.put(key(room, 'export.json'), JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
  return { status: 'exported', room, ...record, repo: parsed.nwo, url: `https://github.com/${parsed.nwo}/commit/${commit.sha}` };
}

/** Every room the store holds. */
export async function listRooms(bucket) {
  const rooms = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: PREFIX, delimiter: '/', cursor });
    for (const p of page.delimitedPrefixes || []) {
      const name = p.slice(PREFIX.length).replace(/\/$/, '');
      if (parseRoom(name)) rooms.push(name);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return rooms;
}

/** The hub's shelf, in the same bucket: documents MADE on the hub, by id.
 *  Written by the hub's Pages Functions (assets/shelf.js in
 *  staff-updates-internal); this is the one place the Worker reads it. */
export const SHELF_KEY = 'hub/shelf.json';

/**
 * The project ids of documents made on the hub. The same fact the hub's
 * Publish (functions/api/docs, `shelf.docs[room.project]`) refuses on: a
 * hub-made document borrows a template's engine, so the `meta.paths` its
 * editor records point into the TEMPLATE's repository directory, not one of
 * its own. A missing shelf is empty, as the hub reads it. An unreadable one
 * is not: better no sweep tonight than one that commits hub-made documents
 * into a template's repository.
 */
export async function hubMadeProjects(bucket) {
  const o = await bucket.get(SHELF_KEY);
  if (!o) return new Set();
  const shelf = await o.json();   // throws on malformed JSON: fail closed
  const docs = shelf && typeof shelf === 'object' && shelf.docs && typeof shelf.docs === 'object' ? shelf.docs : {};
  return new Set(Object.keys(docs).filter(id => docs[id] && typeof docs[id] === 'object'));
}

/**
 * The nightly sweep: every room, one at a time, nothing fatal.
 *
 * `allowed` is allowedRepos(env), lowercase owner/repo; empty means no
 * restriction, as at /auth and /export. Rooms outside it are skipped: R2 also
 * holds the `~primer-editor~` backup rooms from the key migration, and the
 * sweep must not commit a stale backup over the live copy. Hub-made documents
 * are skipped too (see hubMadeProjects). Skips are reported, not silent.
 */
export async function exportAll(opts) {
  const { allowed = [], ...rest } = opts;
  let hubMade;
  try { hubMade = await hubMadeProjects(opts.bucket); }
  catch (e) { return [{ status: 'failed', room: null, error: `shelf unreadable, sweep skipped: ${String(e.message || e)}` }]; }
  const out = [];
  for (const room of await listRooms(opts.bucket)) {
    const parsed = parseRoom(room);
    if (allowed.length && !allowed.includes(parsed.nwo.toLowerCase())) {
      out.push({ status: 'skipped', room, reason: `repository ${parsed.nwo} is not served here` });
      continue;
    }
    if (hubMade.has(parsed.project)) {
      out.push({ status: 'skipped', room, reason: 'made on the hub: it has no directory in the repository to export into' });
      continue;
    }
    try { out.push(await exportRoom({ ...rest, room })); }
    catch (e) { out.push({ status: 'failed', room, error: String(e.message || e) }); }
  }
  return out;
}
