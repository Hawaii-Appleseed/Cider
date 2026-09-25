// The export to git (src/export.js), against a stub bucket and a fake GitHub
// that speaks just enough of the Git Data API to be committed to. What is
// pinned: one export is one commit on hub/<project>, parented on the tip;
// the branch is made from the deploy branch the first time; an unchanged
// store writes nothing; assets ride along as blobs at the assets path; a
// document with no recorded paths is refused rather than guessed at; and the
// sweep survives one room failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportRoom, exportAll, listRooms, safeRepoPath, exportBranch } from './src/export.js';

const ROOM = 'Hawaii-Appleseed~Cider~retitc';
const NWO = 'Hawaii-Appleseed/Cider';

function bucket(seed = {}) {
  const store = new Map();
  const enc = new TextEncoder();
  for (const [k, v] of Object.entries(seed)) store.set(k, typeof v === 'string' ? enc.encode(v) : v);
  return {
    store,
    get: async k => (store.has(k) ? {
      text: async () => new TextDecoder().decode(store.get(k)),
      json: async () => JSON.parse(new TextDecoder().decode(store.get(k))),
      arrayBuffer: async () => store.get(k).buffer.slice(store.get(k).byteOffset, store.get(k).byteOffset + store.get(k).byteLength),
    } : null),
    put: async (k, v) => { store.set(k, typeof v === 'string' ? enc.encode(v) : new Uint8Array(v)); },
    list: async ({ prefix, delimiter }) => {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      if (!delimiter) return { objects: keys.map(key => ({ key })), truncated: false };
      const heads = new Set(keys.map(k => prefix + k.slice(prefix.length).split(delimiter)[0] + delimiter));
      return { objects: [], delimitedPrefixes: [...heads], truncated: false };
    },
  };
}

/** GitHub's Git Data API, in memory: refs, commits, trees, blobs. */
function fakeGitHub({ branches = { main: 'c0' } } = {}) {
  const refs = { ...branches };
  const commits = { c0: { tree: 't0', parents: [] } };
  const trees = { t0: { entries: [] } };
  const blobs = {};
  let n = 0;
  const id = p => `${p}${++n}`;
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const m = init.method || 'GET';
    calls.push(`${m} ${u.pathname}`);
    const body = init.body ? JSON.parse(init.body) : null;
    const path = u.pathname.replace(`/repos/${NWO}/`, '');
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (!init.headers.authorization) return json({ message: 'no token' }, 401);
    let x;
    if ((x = path.match(/^git\/ref\/heads\/(.+)$/)) && m === 'GET') {
      const b = decodeURIComponent(x[1]);
      return refs[b] ? json({ ref: `refs/heads/${b}`, object: { sha: refs[b] } }) : json({ message: 'Not Found' }, 404);
    }
    if (path === 'git/refs' && m === 'POST') {
      const b = body.ref.replace('refs/heads/', '');
      refs[b] = body.sha;
      return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    if ((x = path.match(/^git\/refs\/heads\/(.+)$/)) && m === 'PATCH') {
      const b = decodeURIComponent(x[1]);
      if (!commits[body.sha] || commits[body.sha].parents[0] !== refs[b]) return json({ message: 'not a fast forward' }, 422);
      refs[b] = body.sha;
      return json({ object: { sha: body.sha } });
    }
    if ((x = path.match(/^git\/commits\/(.+)$/)) && m === 'GET') {
      const c = commits[x[1]];
      return c ? json({ sha: x[1], tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })) }) : json({}, 404);
    }
    if (path === 'git/blobs' && m === 'POST') { const sha = id('b'); blobs[sha] = body; return json({ sha }, 201); }
    if (path === 'git/trees' && m === 'POST') {
      const base = trees[body.base_tree]?.entries || [];
      const entries = [...base.filter(e => !body.tree.some(t => t.path === e.path)), ...body.tree];
      const fingerprint = JSON.stringify(entries.map(e => [e.path, e.content ?? blobs[e.sha]?.content]).sort());
      const existing = Object.entries(trees).find(([, t]) => t.fingerprint === fingerprint);
      if (existing) return json({ sha: existing[0] }, 201);
      const sha = id('t'); trees[sha] = { entries, fingerprint };
      return json({ sha }, 201);
    }
    if (path === 'git/commits' && m === 'POST') {
      const sha = id('c'); commits[sha] = { tree: body.tree, parents: body.parents, message: body.message };
      return json({ sha }, 201);
    }
    return json({ message: `unhandled ${m} ${path}` }, 500);
  };
  return { fetch, refs, commits, trees, blobs, calls,
           fileAt: (sha, p) => { const e = trees[commits[sha].tree].entries.find(e => e.path === p); return e ? (e.content ?? blobs[e.sha]) : undefined; } };
}

const META = { version: '20260905T100000000Z-ab12', updated_by: 'ada@hiappleseed.org', updated_at: '2026-09-05T10:00:00.000Z',
               paths: { content: 'projects/retitc/content.md', layout: 'projects/retitc/layout.json', assets: 'projects/retitc/assets', branch: 'main' } };
const seed = (meta = META) => ({
  [`docs/${ROOM}/meta.json`]: JSON.stringify(meta),
  [`docs/${ROOM}/content.md`]: '[[title]]\nRETITC\n',
  [`docs/${ROOM}/layout.json`]: '{"positions":{}}',
  [`docs/${ROOM}/assets/chart.png`]: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
});

test('paths are checked, not trusted', () => {
  assert.equal(safeRepoPath('projects/x/content.md'), 'projects/x/content.md');
  assert.equal(safeRepoPath('/etc/passwd'), 'etc/passwd');
  assert.equal(safeRepoPath('../x'), null);
  assert.equal(safeRepoPath('a/../b'), null);
  assert.equal(safeRepoPath(''), null);
  assert.equal(exportBranch('retitc'), 'hub/retitc');
});

test('the first export makes the branch from main and commits the document and its assets', async () => {
  const b = bucket(seed());
  const gh = fakeGitHub();
  const r = await exportRoom({ bucket: b, room: ROOM, token: 't', api: 'https://gh.test', fetch: gh.fetch });
  assert.equal(r.status, 'exported');
  assert.equal(r.branch, 'hub/retitc');
  assert.equal(gh.refs['hub/retitc'], r.sha);
  assert.equal(gh.commits[r.sha].parents[0], 'c0', 'parented on the branch tip (which was main)');
  assert.equal(gh.fileAt(r.sha, 'projects/retitc/content.md'), '[[title]]\nRETITC\n');
  assert.equal(gh.fileAt(r.sha, 'projects/retitc/layout.json'), '{"positions":{}}');
  const blob = gh.fileAt(r.sha, 'projects/retitc/assets/chart.png');
  assert.equal(blob.encoding, 'base64');
  assert.equal(Buffer.from(blob.content, 'base64').toString('hex'), '89504e47010203');
  assert.match(gh.commits[r.sha].message, /retitc: hub version 20260905T100000000Z-ab12/);
  assert.match(gh.commits[r.sha].message, /ada@hiappleseed.org/);
  assert.equal(r.url, `https://github.com/${NWO}/commit/${r.sha}`);
  const state = JSON.parse(new TextDecoder().decode(b.store.get(`docs/${ROOM}/export.json`)));
  assert.equal(state.version, META.version);
  assert.equal(state.sha, r.sha);
});

test('an unchanged store writes nothing; a new version is one more commit on the same branch', async () => {
  const b = bucket(seed());
  const gh = fakeGitHub();
  const first = await exportRoom({ bucket: b, room: ROOM, token: 't', api: 'https://gh.test', fetch: gh.fetch });
  const before = gh.calls.length;
  const again = await exportRoom({ bucket: b, room: ROOM, token: 't', api: 'https://gh.test', fetch: gh.fetch });
  assert.equal(again.status, 'unchanged');
  assert.equal(again.sha, first.sha);
  assert.equal(gh.calls.length, before, 'GitHub was not asked anything');

  await b.put(`docs/${ROOM}/content.md`, '[[title]]\nRETITC, revised\n');
  await b.put(`docs/${ROOM}/meta.json`, JSON.stringify({ ...META, version: '20260905T110000000Z-cd34' }));
  const second = await exportRoom({ bucket: b, room: ROOM, token: 't', api: 'https://gh.test', fetch: gh.fetch });
  assert.equal(second.status, 'exported');
  assert.equal(gh.commits[second.sha].parents[0], first.sha, 'the log is the sequence of versions');
  assert.equal(gh.fileAt(second.sha, 'projects/retitc/content.md'), '[[title]]\nRETITC, revised\n');
  assert.equal(gh.fileAt(second.sha, 'projects/retitc/assets/chart.png').encoding, 'base64', 'assets ride every export');
  assert.equal(gh.refs['hub/retitc'], second.sha);
  assert.equal(gh.refs.main, 'c0', 'main is never touched');
});

test('a document with no recorded paths is refused, not guessed at', async () => {
  const b = bucket(seed({ version: META.version }));
  const gh = fakeGitHub();
  const r = await exportRoom({ bucket: b, room: ROOM, token: 't', api: 'https://gh.test', fetch: gh.fetch });
  assert.equal(r.status, 'unexportable');
  assert.equal(gh.calls.length, 0);
});

test('an empty store, no token, and a bad room are each named', async () => {
  const gh = fakeGitHub();
  assert.equal((await exportRoom({ bucket: bucket(), room: ROOM, token: 't', fetch: gh.fetch })).status, 'nothing');
  await assert.rejects(exportRoom({ bucket: bucket(seed()), room: ROOM, token: '', fetch: gh.fetch }), /GITHUB_EXPORT_TOKEN/);
  await assert.rejects(exportRoom({ bucket: bucket(seed()), room: 'nonsense', token: 't', fetch: gh.fetch }), /not a room/);
});

test('the nightly sweep visits every room and survives one failing', async () => {
  const OTHER = 'Hawaii-Appleseed~Cider~rxkids';
  const b = bucket({ ...seed(),
    [`docs/${OTHER}/meta.json`]: JSON.stringify({ ...META, paths: { ...META.paths, content: 'projects/rxkids/content.md', branch: 'nope' } }),
    [`docs/${OTHER}/content.md`]: 'x',
    'docs/not~a-room/meta.json': '{}' });
  assert.deepEqual(await listRooms(b), [ROOM, OTHER]);
  const gh = fakeGitHub();
  const out = await exportAll({ bucket: b, token: 't', api: 'https://gh.test', fetch: gh.fetch });
  assert.equal(out.length, 2);
  assert.equal(out[0].status, 'exported');
  assert.equal(out[1].status, 'failed', 'a branch that does not exist fails that room only');
  assert.match(out[1].error, /neither hub\/rxkids nor nope/);
});
