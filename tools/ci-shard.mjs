#!/usr/bin/env node
// Which spec files shard K of N runs, balanced by how long they take.
//
//   node tools/ci-shard.mjs 3 10           the files shard 3 of 10 runs, one per line
//   node tools/ci-shard.mjs --report 10    every shard's predicted load, and how even it is
//
// Playwright's own --shard cuts the alphabetical test list into equal-COUNT
// chunks. Tests are not equal: charts.spec.js alone is 37 tests of ~11 s, all
// adjacent, so a few shards got the heavy files and the rest finished in half
// the time (2026-10-30: 209 s to 541 s across twelve shards, the slowest one
// setting the wall clock). Here each spec FILE is a unit, assigned largest-first
// to the least-loaded shard (longest processing time first). A file is never
// split, which keeps its beforeAll hooks and serial groups on one machine, as
// they are today.
//
// Weights are seconds of test time per file, in tests/editor/shard-weights.json,
// refreshed by `node tools/shard-weights.mjs`. They only need to be roughly
// right, and a file with no entry gets the median, so a stale file is a worse
// balance and never a wrong run. Every shard computes the same plan from the
// same inputs, and this checks as it goes that the shards together run every
// file exactly once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = 'tests/editor';
// Shard 1 also runs the Chrome export check before its tests (~15 s of wall
// clock, two workers' worth of test time).
const PRELOAD = { 1: 30 };

export function plan(files, weights, n) {
  const known = Object.values(weights).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 30;
  const w = f => weights[path.basename(f)] ?? median;
  const bins = Array.from({ length: n }, (_, i) => ({ shard: i + 1, load: PRELOAD[i + 1] || 0, files: [] }));
  for (const f of [...files].sort((a, b) => w(b) - w(a) || a.localeCompare(b))) {
    const bin = bins.reduce((m, b) => (b.load < m.load ? b : m));
    bin.files.push(f); bin.load += w(f);
  }
  for (const b of bins) b.files.sort();
  return bins;
}

export function check(files, bins) {
  const seen = new Map();
  for (const b of bins) for (const f of b.files) seen.set(f, (seen.get(f) || 0) + 1);
  const bad = files.filter(f => seen.get(f) !== 1);
  if (bad.length) throw new Error(`not run exactly once: ${bad.join(', ')}`);
  // Playwright takes file arguments as unanchored regular expressions.
  for (const a of files) for (const b of files)
    if (a !== b && new RegExp(a).test(b)) throw new Error(`"${a}" also matches "${b}" as a Playwright filter`);
}

function main(argv) {
  const report = argv[0] === '--report';
  const [k, n] = report ? [0, Number(argv[1])] : [Number(argv[0]), Number(argv[1])];
  if (!Number.isInteger(n) || n < 1 || (!report && (!Number.isInteger(k) || k < 1 || k > n)))
    { console.error('usage: ci-shard.mjs K N | --report N'); process.exit(64); }
  const files = fs.readdirSync(path.join(ROOT, SPEC_DIR)).filter(f => f.endsWith('.spec.js')).sort().map(f => `${SPEC_DIR}/${f}`);
  let weights = {};
  try { weights = JSON.parse(fs.readFileSync(path.join(ROOT, SPEC_DIR, 'shard-weights.json'), 'utf8')); }
  catch (e) { console.error('no shard-weights.json: balancing by file count'); }
  const bins = plan(files, weights, n);
  try { check(files, bins); } catch (e) { console.error('ci-shard: ' + e.message); process.exit(2); }
  if (report) {
    const loads = bins.map(b => b.load), max = Math.max(...loads), mean = loads.reduce((a, b) => a + b, 0) / n;
    for (const b of bins) console.log(`shard ${String(b.shard).padStart(2)}  ${String(b.files.length).padStart(3)} files  ${String(Math.round(b.load)).padStart(5)} s of tests`);
    console.log(`slowest ${Math.round(max)} s, mean ${Math.round(mean)} s, slowest is ${((max / mean - 1) * 100).toFixed(1)}% over the mean`);
    return;
  }
  console.log(bins[k - 1].files.join('\n'));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
