#!/usr/bin/env node
// Refresh tests/editor/sweep-weights.json from a real CI run's sweep jobs.
//
//   node tools/sweep-weights.mjs              the latest successful run that swept every report
//   node tools/sweep-weights.mjs <run id>     a particular one
//
// Needs `gh`, signed in. The `changes` job in editor-tests.yml packs the
// per-field sweep (every-field-opens.spec.js) into six jobs by these weights:
// minutes of test time per report, both passes, every part added up, less the
// editor boot each part pays (BOOT below, which the packer adds back per
// part). A report missing here gets the packer's default and is a guess —
// the weights dated 2026-10-22 had five reports on that default, and the
// slowest sweep job ran two minutes past the fastest. Run this after adding
// reports, or when a run's sweep jobs finish far apart.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/editor/sweep-weights.json');
const BOOT = 0.5;   // minutes; keep in step with the packer in editor-tests.yml
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });

const repo = JSON.parse(gh('repo', 'view', '--json', 'nameWithOwner')).nameWithOwner;
const sweepJobs = run => JSON.parse(gh('api', `repos/${repo}/actions/runs/${run}/jobs`, '--paginate',
  '--jq', '[.jobs[] | {id, name, conclusion}]')).filter(j => /^sweep \(/.test(j.name));

let run = process.argv[2];
if (!run) {
  const runs = JSON.parse(gh('run', 'list', '--workflow', 'editor-tests.yml', '--status', 'success',
    '--limit', '30', '--json', 'databaseId'));
  // every report swept = six jobs (the nightly run, a manual one, an engine merge)
  run = runs.map(r => String(r.databaseId)).find(r => sweepJobs(r).length >= 6);
  if (!run) { console.error('no recent successful run swept every report'); process.exit(1); }
}
const jobs = sweepJobs(run);
if (!jobs.length) { console.error(`run ${run} has no sweep jobs`); process.exit(1); }

// "› rxkids: every field opens …(part 2/3) (1.7m)", with or without the
// report's describe block in front; a retry is the same work again, so not counted.
const line = /[✓✘]\s+\d+ \[chromium\] › tests\/editor\/every-field-opens\.spec\.js:\d+:\d+ › (?:.*? › )?([\w.-]+): .*\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
const mins = { ms: 1 / 60000, s: 1 / 60, m: 1 };
const took = {}, parts = {};
for (const j of jobs) {
  for (const item of j.name.replace(/^sweep \(|\)$/g, '').split(',')) {
    const [id, p] = item.trim().split(':');
    parts[id] = p ? Number(p.split('/')[1]) : 1;
  }
  for (const l of gh('run', 'view', '--job', String(j.id), '--log').split('\n')) {
    if (/retry #/.test(l)) continue;
    const m = line.exec(l);
    if (m) took[m[1]] = (took[m[1]] || 0) + Number(m[2]) * mins[m[3]];
  }
}
let old = {};
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
const next = { ...old };
for (const [id, t] of Object.entries(took)) next[id] = Math.max(0.2, Math.round((t - BOOT * (parts[id] || 1)) * 10) / 10);
const sorted = Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]));
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 1) + '\n');
console.log(`run ${run}: ${Object.keys(took).length} reports timed from ${jobs.length} sweep jobs`);
for (const [id, w] of Object.entries(sorted)) console.log(`  ${id.padEnd(24)} ${String(w).padStart(5)}${old[id] !== undefined && old[id] !== w ? `  (was ${old[id]})` : ''}`);
