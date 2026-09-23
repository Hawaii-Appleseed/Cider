// The impact map: which spec runs which function, written by a full run with
// DS_IMPACT=map (`npm run test:full`) and read by tools/affected.mjs.
//
//   .impact/map.json       spec -> the functions its tests called
//   .impact/base/<path>    each mapped file exactly as it was during that run
//
// Line numbers in the map are the base copy's. The picker diffs the base copy
// against the working tree to carry a change back into those coordinates, so
// the map keeps working as the code moves on and only needs rebuilding when
// the selections it gives get broad. Machine-local and gitignored: it is a
// cache of one run on one checkout, not a source.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { IMPACT_DIR } = require('./impact');

const ROOT = path.resolve(__dirname, '../../..');
const DIR = path.join(ROOT, '.impact');
const PENDING = path.join(DIR, 'pending');

function mappable() {
  const out = execFileSync('git', ['ls-files', '*.py', 'docsync/editor/*'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(f => f && (f.endsWith('.py') || f.endsWith('.js') || f.endsWith('.html')));
}

/** Before the run: copy every file a record could point into. */
function snapshot() {
  fs.rmSync(PENDING, { recursive: true, force: true });
  for (const f of mappable()) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(PENDING, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  fs.writeFileSync(path.join(PENDING, '.head'),
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim());
}

/** After the run: fold the per-test records into one map, per spec. */
function merge() {
  if (!fs.existsSync(PENDING)) return;
  const recs = fs.existsSync(IMPACT_DIR) ? fs.readdirSync(IMPACT_DIR).filter(f => f.endsWith('.json')) : [];
  if (!recs.length) { console.log('impact: no records — the map was not rewritten'); return; }

  const map = { version: 1, built: new Date().toISOString(),
                head: fs.readFileSync(path.join(PENDING, '.head'), 'utf8'),
                tests: {}, js: {}, py: {} };
  const fileOf = (kind, f) => map[kind][f] || (map[kind][f] = { fns: [], idx: new Map(), hit: {} });
  const add = (entry, key, spec, hit) => {
    if (!entry.idx.has(key)) { entry.idx.set(key, entry.fns.length); entry.fns.push(key); }
    if (hit) (entry.hit[spec] || (entry.hit[spec] = new Set())).add(entry.idx.get(key));
  };

  for (const name of recs) {
    const r = JSON.parse(fs.readFileSync(path.join(IMPACT_DIR, name), 'utf8'));
    map.tests[r.spec] = (map.tests[r.spec] || 0) + 1;
    for (const [f, { all, hit }] of Object.entries(r.js)) {
      const e = fileOf('js', f);
      const h = new Set(hit);
      for (const k of all) add(e, k, r.spec, h.has(k));
    }
    for (const row of r.py) {
      const [f, line, fn] = row.split('\t');
      if (!fs.existsSync(path.join(PENDING, f))) continue;   // not a file of this repo
      add(fileOf('py', f), `${line}\t${fn}`, r.spec, true);
    }
  }

  // Coordinates are only good if nobody edited a mapped file mid-run.
  const moved = [];
  for (const kind of ['js', 'py']) {
    for (const [f, e] of Object.entries(map[kind])) {
      const now = path.join(ROOT, f);
      if (!fs.existsSync(now) || !fs.readFileSync(now).equals(fs.readFileSync(path.join(PENDING, f)))) moved.push(f);
      delete e.idx;
      for (const s of Object.keys(e.hit)) e.hit[s] = [...e.hit[s]];
    }
  }

  fs.rmSync(path.join(DIR, 'base'), { recursive: true, force: true });
  fs.renameSync(PENDING, path.join(DIR, 'base'));
  fs.writeFileSync(path.join(DIR, 'map.json'), JSON.stringify(map));
  const specs = Object.keys(map.tests).length;
  console.log(`impact: map written for ${specs} specs (.impact/map.json)`);
  if (moved.length) console.log(`impact: edited during the run, so their lines are the run's start: ${moved.join(', ')}`);
}

module.exports = { snapshot, merge, DIR };
