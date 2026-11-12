#!/usr/bin/env node
// Refresh tests/editor/shard-weights.json from real CI runs' own logs.
//
//   node tools/shard-weights.mjs              the latest four runs of all ten shards
//   node tools/shard-weights.mjs <run id> …   particular ones
//
// Needs `gh`, signed in. Reads each test shard's log, adds up every test's
// reported time per spec file, and takes each file's MEDIAN over the runs:
// one run is too noisy to plan by — the same spec took 98 s in one run and
// 144 s in the next (2026-11-12), and weights from that one run left the
// shards 371–621 s apart. A file that did not run keeps its old number.
// Nightly and manual runs are left out: they record the impact map, which
// costs half again the time. tools/ci-shard.mjs only needs these to be roughly
// right; run this when the balance looks off in a run's shard times, or after
// a change that makes many specs faster or slower.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/editor/shard-weights.json');
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });

const repo = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner')).nameWithOwner;
const shardJobs = run => JSON.parse(gh('api', `repos/${repo}/actions/runs/${run}/jobs`, '--paginate',
  '--jq', '[.jobs[] | {id, name, conclusion}]')).filter(j => /^test \(\d+\/10\)$/.test(j.name));
let runs = process.argv.slice(2);
if (!runs.length) {
  const list = JSON.parse(gh('run', 'list', '--workflow', 'editor-tests.yml', '--status', 'success',
    '--limit', '40', '--json', 'databaseId,event'));
  for (const r of list) {
    if (r.event === 'schedule' || r.event === 'workflow_dispatch') continue;   // impact recording
    const jobs = shardJobs(r.databaseId);
    if (jobs.length === 10 && jobs.every(j => j.conclusion === 'success')) runs.push(String(r.databaseId));
    if (runs.length === 4) break;
  }
  if (!runs.length) { console.error('no recent successful run of all ten shards'); process.exit(1); }
}

const line = /[✓✘]\s+\d+ \[chromium\] › tests\/editor\/([\w.-]+\.spec\.js):\d+:\d+ › .*?\((\d+(?:\.\d+)?)(ms|s|m)\)/;
const secs = { ms: 0.001, s: 1, m: 60 };
const times = {};                       // file -> [seconds in each run]
for (const run of runs) {
  const jobs = shardJobs(run);
  if (!jobs.length) { console.error(`run ${run} has no test shards`); process.exit(1); }
  const seen = {};
  for (const j of jobs) {
    for (const l of gh('run', 'view', '--job', String(j.id), '--log').split('\n')) {
      if (/retry #/.test(l)) continue;
      const m = line.exec(l);
      if (m) seen[m[1]] = (seen[m[1]] || 0) + Number(m[2]) * secs[m[3]];
    }
  }
  for (const [f, t] of Object.entries(seen)) (times[f] ||= []).push(t);
}
const median = a => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const seen = Object.fromEntries(Object.entries(times).map(([f, a]) => [f, median(a)]));
let old = {};
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
const onDisk = new Set(fs.readdirSync(path.join(ROOT, 'tests/editor')).filter(f => f.endsWith('.spec.js')));
const next = {};
for (const f of [...onDisk].sort()) next[f] = f in seen ? Math.max(1, Math.round(seen[f])) : old[f] ?? undefined;
for (const f of Object.keys(next)) if (next[f] === undefined) delete next[f];
fs.writeFileSync(OUT, JSON.stringify(next, null, 1) + '\n');
console.log(`runs ${runs.join(', ')}: ${Object.keys(seen).length} files timed, ${Object.keys(next).length} weights written`);
