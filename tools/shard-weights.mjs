#!/usr/bin/env node
// Refresh tests/editor/shard-weights.json from a real CI run's own logs.
//
//   node tools/shard-weights.mjs              the latest successful full run
//   node tools/shard-weights.mjs <run id>     a particular one
//
// Needs `gh`, signed in. Reads each test shard's log, adds up every test's
// reported time per spec file, and merges the result over the old weights
// (a file that did not run keeps its old number). tools/ci-shard.mjs only needs
// these to be roughly right; run this when the balance looks off in a run's
// shard times, or a few times a year.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/editor/shard-weights.json');
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });

let run = process.argv[2];
if (!run) {
  // A push to main runs shard 1 only; the nightly and pull-request runs run them all.
  const runs = JSON.parse(gh('run', 'list', '--workflow', 'editor-tests.yml', '--status', 'success',
    '--limit', '30', '--json', 'databaseId,event'));
  const full = runs.find(r => r.event !== 'push');
  if (!full) { console.error('no successful full run found'); process.exit(1); }
  run = String(full.databaseId);
}
const repo = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner')).nameWithOwner;
const jobs = JSON.parse(gh('api', `repos/${repo}/actions/runs/${run}/jobs`, '--paginate', '--jq', '[.jobs[] | {id, name}]'));
const shards = jobs.filter(j => /^test \(\d+\/\d+\)$/.test(j.name));
if (!shards.length) { console.error(`run ${run} has no test shards`); process.exit(1); }

const line = /[✓✘]\s+\d+ \[chromium\] › tests\/editor\/([\w.-]+\.spec\.js):\d+:\d+ › .*?\((\d+(?:\.\d+)?)(ms|s|m)\)/;
const secs = { ms: 0.001, s: 1, m: 60 };
const seen = {};
for (const j of shards) {
  for (const l of gh('run', 'view', '--job', String(j.id), '--log').split('\n')) {
    const m = line.exec(l);
    if (m) seen[m[1]] = (seen[m[1]] || 0) + Number(m[2]) * secs[m[3]];
  }
}
let old = {};
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
const onDisk = new Set(fs.readdirSync(path.join(ROOT, 'tests/editor')).filter(f => f.endsWith('.spec.js')));
const next = {};
for (const f of [...onDisk].sort()) next[f] = f in seen ? Math.max(1, Math.round(seen[f])) : old[f] ?? undefined;
for (const f of Object.keys(next)) if (next[f] === undefined) delete next[f];
fs.writeFileSync(OUT, JSON.stringify(next, null, 1) + '\n');
console.log(`run ${run}: ${Object.keys(seen).length} files timed from ${shards.length} shards, ${Object.keys(next).length} weights written`);
