#!/usr/bin/env node
// Run the whole editor suite on GitHub — twenty machines, a few minutes — for
// the working tree as it is, committed or not. The laptop runs nothing but
// the Python checks.
//
//   npm run test:ci                  # snapshot, push, run, report, clean up
//   npm run test:ci -- --no-wait     # print the run's URL and return
//   npm run test:ci -- --keep        # leave the ci/… branch after the run
//   npm run test:ci -- --skip-checks # don't run the Python checks here first
//   npm run test:ci -- --clean       # delete every leftover ci/… branch
//   npm run test:ci -- --report <id> # summarise an existing run of the workflow
//
// Locally the suite is ~20 minutes and saturates the machine (measured: 0%
// idle, load average 51, the tests getting ~4 of 10 cores beside everything
// else a person has open). Every test boots the editor, so the floor is CPU,
// and more workers or fewer sleeps do not move it. GitHub does: the repo is
// public, so minutes are free, and editor-tests.yml runs 20 shards.
//
// What it touches:
//   - Never HEAD, the index or a file. The snapshot is built in a throwaway
//     index: HEAD, every tracked file as it is on disk, whatever is staged,
//     and untracked files under the source directories (SOURCE). Any other
//     untracked file stays here and is listed: the branch is public.
//   - It pushes that commit to ci/<time>-<sha> on origin, dispatches
//     editor-tests.yml there, waits, prints each failing test with its error,
//     and deletes the branch. Ctrl-C cancels the run and deletes it too.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = 'editor-tests.yml';
// Untracked files here are code on its way in; anywhere else they might be
// anything, and the branch is public.
const SOURCE = ['docsync', 'tests', 'tools', 'report2027', 'collab', 'projects', '.github'];
const BIG = 2 << 20;     // an untracked file over 2MB is data, not a source file

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const git = (...a) => run('git', a);
const gh = (...a) => run('gh', a);
const say = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clock = s => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

const REPO = (() => {
  const url = git('remote', 'get-url', 'origin').trim();
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub remote: ${url}`);
  return m[1];
})();

// --report <run id>: summarise a run that already happened (a push to main's,
// or one started with --no-wait), without snapshotting or pushing anything.
const reportOnly = argv.includes('--report') ? argv[argv.indexOf('--report') + 1] : null;

if (flag('--clean')) {
  const heads = git('ls-remote', '--heads', 'origin', 'ci/*').split('\n').filter(Boolean)
    .map(l => l.split('\t')[1].replace('refs/heads/', ''));
  if (!heads.length) say('No ci/… branches on origin.');
  for (const b of heads) {
    // Another session's run may still be reading its branch: leave that one.
    const runs = JSON.parse(gh('run', 'list', '--branch', b, '-R', REPO, '--json', 'status', '-L', '5'));
    if (runs.some(r => r.status !== 'completed')) { say(`kept ${b} (its run is still going)`); continue; }
    git('push', '-q', 'origin', '--delete', b);
    say(`deleted ${b}`);
  }
  process.exit(0);
}

// --- 1. the Python checks, here: seconds, and a broken engine stops before a push
if (!flag('--skip-checks') && !reportOnly) {
  for (const args of [['docsync/test_docsync.py'], ['report2027/tools/test_render.py'],
                      ['-m', 'docsync.check'], ['-m', 'docsync.chart_parity']]) {
    const r = spawnSync('python3', args, { cwd: ROOT, encoding: 'utf8' });
    const name = ['python3', ...args].join(' ');
    const tail = (r.stdout + r.stderr).trim().split('\n');
    // chart_parity is a report, not a gate (its docstring): a chart that moved
    // may be the fix. Say what it found and carry on.
    if (args.includes('docsync.chart_parity')) {
      const found = tail.filter(l => /renders compared/.test(l)).pop() || '';
      say(`${r.status ? '~' : '✓'} ${name}: ${found}`);
      continue;
    }
    if (r.status !== 0) {
      say(`✘ ${name}\n${tail.slice(-25).join('\n')}`);
      say('\nNothing was pushed. Fix that first, or pass --skip-checks.');
      process.exit(1);
    }
    say(`✓ ${name}`);
  }
}

let branch = null, runId = null, finished = false;
const cleanup = () => {
  if (!branch || flag('--keep') || flag('--no-wait')) return;
  try { run('git', ['push', '-q', 'origin', '--delete', branch], { stdio: 'pipe' }); say(`Deleted ${branch}`); }
  catch (e) { say(`Could not delete ${branch}: npm run test:ci -- --clean`); }
};

/** --- 2. HEAD plus the working tree as a commit, built in a throwaway index. */
function snapshot() {
  const head = git('rev-parse', 'HEAD').trim();
  const idx = path.join(os.tmpdir(), `ci-test-index-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  const gitIdx = (...a) => run('git', a, { env });
  try {
    gitIdx('read-tree', 'HEAD');
    gitIdx('add', '-u');
    // Staged in the real index but not in HEAD: someone meant to commit these.
    const staged = git('diff', '--cached', '--name-only', '--diff-filter=A', '-z').split('\0').filter(Boolean);
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    const take = [], skip = [];
    for (const f of untracked) {
      const inSource = SOURCE.some(d => f === d || f.startsWith(d + '/'));
      const size = fs.statSync(path.join(ROOT, f), { throwIfNoEntry: false })?.size ?? 0;
      (inSource && size <= BIG ? take : skip).push(f);
    }
    const add = [...new Set([...staged, ...take])].filter(f => fs.existsSync(path.join(ROOT, f)));
    for (let i = 0; i < add.length; i += 200) gitIdx('add', '--', ...add.slice(i, i + 200));
    const tree = gitIdx('write-tree').trim();
    const changed = git('diff-tree', '-r', '--name-status', head, tree).trim().split('\n').filter(Boolean);
    const onBranch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const commit = run('git', ['commit-tree', tree, '-p', head, '-m',
      `test:ci — ${onBranch} at ${head.slice(0, 7)}, plus ${changed.length} changed file(s) in the working tree`]).trim();
    // docs/ untracked is the stager's copies, not anybody's work: not worth listing.
    return { head, commit, changed, left: skip.filter(f => !f.startsWith('docs/')) };
  } finally {
    fs.rmSync(idx, { force: true });
  }
}

/** --- 3. push the snapshot to a ci/… branch and start the workflow there. */
async function dispatch(snap) {
  const unpushed = Number(spawnSync('git', ['rev-list', '--count', `origin/main..${snap.head}`],
                                    { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || 0);
  say(`\nSnapshot ${snap.commit.slice(0, 7)}: HEAD ${snap.head.slice(0, 7)}` +
      (unpushed ? ` (${unpushed} commit(s) not on origin/main)` : '') +
      `, plus ${snap.changed.length} working-tree change(s)`);
  for (const c of snap.changed.slice(0, 12)) say(`  ${c.replace('\t', ' ')}`);
  if (snap.changed.length > 12) say(`  … and ${snap.changed.length - 12} more`);
  if (snap.left.length) {
    say(`Not included — untracked outside ${SOURCE.join(', ')}, or over 2MB:`);
    for (const f of snap.left.slice(0, 8)) say(`  ${f}`);
    if (snap.left.length > 8) say(`  … and ${snap.left.length - 8} more`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  branch = `ci/${stamp}-${snap.commit.slice(0, 7)}`;
  // stdio piped: GitHub answers a new branch with a "create a pull request" note.
  run('git', ['push', '-q', 'origin', `${snap.commit}:refs/heads/${branch}`], { stdio: 'pipe' });
  say(`\nPushed ${branch}`);

  // A branch pushed a moment ago can be unknown to the dispatch API for a beat.
  let out = '';
  for (let i = 0; ; i++) {
    try { out = gh('workflow', 'run', WORKFLOW, '--ref', branch, '-R', REPO); break; }
    catch (e) { if (i >= 4) { cleanup(); throw e; } await sleep(3000); }
  }
  let id = (/actions\/runs\/(\d+)/.exec(out) || [])[1] || null;
  for (let i = 0; !id && i < 30; i++) {
    await sleep(2000);
    const j = JSON.parse(gh('run', 'list', '--workflow', WORKFLOW, '--branch', branch, '-R', REPO,
                            '--json', 'databaseId', '-L', '1'));
    if (j.length) id = String(j[0].databaseId);
  }
  if (!id) {
    say('The run did not appear. Look at the Actions tab; the branch is left for it.');
    process.exit(1);
  }
  return id;
}

/** --- 4. wait for the run, saying what changed. */
async function wait(id) {
  const t0 = Date.now();
  let last = '', view;
  for (;;) {
    view = JSON.parse(gh('run', 'view', id, '-R', REPO, '--json', 'status,conclusion,jobs'));
    const jobs = view.jobs || [];
    const n = (...st) => jobs.filter(j => st.includes(j.status)).length;
    const failed = jobs.filter(j => j.conclusion === 'failure').length;
    const line = `${n('completed')}/${jobs.length || 20} shards done, ${n('in_progress')} running, ` +
                 `${n('queued', 'waiting', 'pending')} waiting for a machine` + (failed ? `, ${failed} failed` : '');
    if (line !== last) { say(`  ${clock((Date.now() - t0) / 1000).padStart(6)}  ${line}`); last = line; }
    if (view.status === 'completed') return { view, took: (Date.now() - t0) / 1000 };
    await sleep(10_000);
  }
}

/** --- 5. what happened, read from the shards' own logs. */
function summarise(id, view, took) {
  const logs = spawnSync('gh', ['run', 'view', id, '-R', REPO, '--log'],
                         { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 29 }).stdout || '';
  const byJob = new Map();
  for (const raw of logs.split('\n')) {
    const tab = raw.indexOf('\t');
    if (tab < 0) continue;
    const job = raw.slice(0, tab);
    const text = raw.slice(raw.indexOf('\t', tab + 1) + 1).replace(/^\S+Z /, '');
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push(text);
  }
  // Playwright's list reporter ends each shard with "  N failed" and the
  // failing titles under it, then flaky, did not run, passed. The log API
  // hands each shard's lines over twice, so a shard's first block is the one.
  const tally = { passed: 0, failed: 0, flaky: 0, 'did not run': 0, skipped: 0 };
  const failures = [], flaky = [];
  for (const lines of byJob.values()) {
    const seen = new Set();
    let bucket = null;
    for (const l of lines) {
      const count = /^\s{2}(\d+) (passed|failed|flaky|did not run|skipped)\b/.exec(l);
      if (count) {
        bucket = seen.has(count[2]) ? null : count[2];
        if (bucket) { seen.add(bucket); tally[bucket] += Number(count[1]); }
        continue;
      }
      const t = /^\s{4}\[chromium\] › (.+?)\s*$/.exec(l);
      if (t && bucket === 'failed') failures.push({ title: t[1], error: errorFor(lines, t[1]) });
      else if (t && bucket === 'flaky') flaky.push(t[1]);
      else if (!/^\s*$/.test(l)) bucket = null;
    }
  }

  say('');
  if (view.conclusion === 'success') {
    say(`✓ The whole suite passed on GitHub: ${tally.passed} passed` +
        (tally.flaky ? `, ${tally.flaky} flaky` : '') + ` — ${clock(took)}`);
  } else {
    say(`✘ ${view.conclusion}: ${tally.failed} failed, ${tally.flaky} flaky, ${tally.passed} passed` +
        (tally['did not run'] ? `, ${tally['did not run']} did not run` : '') + ` — ${clock(took)}`);
    for (const f of failures) say(`  ✘ ${f.title}${f.error ? `\n      ${f.error}` : ''}`);
    if (!failures.length) {
      // A shard that died before its tests ran: say which step.
      for (const j of (view.jobs || []).filter(j => j.conclusion === 'failure')) {
        const step = (j.steps || []).find(s => s.conclusion === 'failure');
        say(`  ✘ ${j.name}: ${step ? step.name : 'failed'}`);
      }
    }
  }
  for (const f of flaky) say(`  ~ flaky: ${f}`);
  say(`https://github.com/${REPO}/actions/runs/${id}`);
}

/** The first error line under a failing test's numbered report. */
function errorFor(lines, title) {
  const at = lines.findIndex(l => /^\s+\d+\) \[chromium\] › /.test(l) && l.includes(title.slice(0, 60)));
  if (at < 0) return '';
  for (let i = at + 1; i < Math.min(lines.length, at + 40); i++) {
    const l = lines[i].trim();
    if (/^(Error|TimeoutError|Test timeout|"beforeAll" hook|"beforeEach" hook|expect\()/.test(l)) return l.slice(0, 200);
  }
  return '';
}

if (reportOnly) {
  const view = JSON.parse(gh('run', 'view', reportOnly, '-R', REPO, '--json', 'status,conclusion,jobs,createdAt,updatedAt'));
  summarise(reportOnly, view, (Date.parse(view.updatedAt) - Date.parse(view.createdAt)) / 1000);
  process.exit(view.conclusion === 'success' ? 0 : 1);
}

process.on('SIGINT', () => {
  if (!finished && runId) {
    try { gh('run', 'cancel', String(runId), '-R', REPO); say(`\nCancelled run ${runId}`); } catch (e) {}
  }
  cleanup();
  process.exit(130);
});

runId = await dispatch(snapshot());
say(`Run https://github.com/${REPO}/actions/runs/${runId}`);
if (flag('--no-wait')) {
  say('The branch stays until the run is done: npm run test:ci -- --clean');
  process.exit(0);
}
const { view, took } = await wait(runId);
finished = true;
summarise(runId, view, took);
cleanup();
process.exit(view.conclusion === 'success' ? 0 : 1);
