// The CI shard planner (tools/ci-shard.mjs): every spec file runs on exactly one
// shard, the shards come out even, and a file with no recorded weight is not a
// problem. Run with `npm run test:shards`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, check, shardsFor } from './ci-shard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(ROOT, 'tests/editor')).filter(f => f.endsWith('.spec.js')).sort().map(f => `tests/editor/${f}`);
const weights = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/editor/shard-weights.json'), 'utf8'));

test('every spec file runs on exactly one of the ten shards', () => {
  const bins = plan(files, weights, 10);
  check(files, bins);                                  // throws if not
  assert.equal(bins.reduce((n, b) => n + b.files.length, 0), files.length);
});

test('the shards are within 5% of even, with the real weights', () => {
  const loads = plan(files, weights, 10).map(b => b.load);
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  assert.ok(Math.max(...loads) / mean < 1.05, `slowest is ${(Math.max(...loads) / mean).toFixed(3)}x the mean`);
});

test('a spec file with no recorded weight still runs, once', () => {
  const more = [...files, 'tests/editor/zz-brand-new.spec.js'];
  const bins = plan(more, weights, 10);
  check(more, bins);
  assert.ok(bins.some(b => b.files.includes('tests/editor/zz-brand-new.spec.js')));
});

test('the same inputs give the same plan on every machine', () => {
  assert.deepEqual(plan(files, weights, 10), plan([...files].reverse(), weights, 10));
});

test('a file name that another one contains is refused, because Playwright takes filters as regexes', () => {
  const bins = plan(['tests/editor/a.spec.js', 'tests/editor/xa.spec.js'], {}, 2);
  // "tests/editor/a.spec.js" does not match inside "tests/editor/xa.spec.js"; the directory anchors it.
  check(['tests/editor/a.spec.js', 'tests/editor/xa.spec.js'], bins);
  assert.throws(() => check(['a.spec.js', 'xa.spec.js'], plan(['a.spec.js', 'xa.spec.js'], {}, 2)), /also matches/);
});

test('a shard past the end of the list, or the planner with one shard, is still a partition', () => {
  check(files, plan(files, weights, 1));
  check(files, plan(files, weights, 40));
});

// The pull-request gate: a picked subset (tools/affected.mjs --ci) on fewer machines.
test('a picked subset gets as many shards as its weight is worth, and no more than it has files', () => {
  assert.equal(shardsFor(files, files, weights), 10);
  assert.equal(shardsFor(files.slice(0, 1), files, weights), 1);
  const heavy = [...files].sort((a, b) => (weights[path.basename(b)] ?? 0) - (weights[path.basename(a)] ?? 0)).slice(0, 3);
  const n = shardsFor(heavy, files, weights);
  assert.ok(n >= 1 && n <= 3, `three files on ${n} shards`);
  const half = files.filter((_, i) => i % 2 === 0);
  const h = shardsFor(half, files, weights);
  assert.ok(h >= 4 && h <= 6, `half the suite on ${h} shards`);
  // No shard of the subset is much heavier than a shard of the whole suite.
  const whole = Math.max(...plan(files, weights, 10).map(b => b.load));
  assert.ok(Math.max(...plan(half, weights, h).map(b => b.load)) < whole * 1.25);
});

test('a subset is a partition too', () => {
  const some = files.filter((_, i) => i % 7 === 0);
  const n = shardsFor(some, files, weights);
  check(some, plan(some, weights, n));
});
