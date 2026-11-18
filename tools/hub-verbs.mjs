#!/usr/bin/env node
/**
 * Does the staff hub's connector still agree with THIS editor?
 *
 * The hub relays the editor's pilot verbs to Claude (arrange_report) and its
 * own test, dev/test_mcp.mjs, pins that every verb the editor takes is either
 * relayed or held back on purpose. That test reads the editor the hub carries
 * (primer/edit.html), so a new verb added here was only caught THERE, after
 * the merge, once the editor was vendored in: the hub's tests went red, the
 * `promote` job skipped, and production stayed put (2026-11-17/18: addGuide,
 * removeGuide and addSpacer kept four editor ships off production for about
 * nine hours, until someone read the log).
 *
 * This runs the hub's own test_mcp.mjs twice on a throwaway copy of the hub:
 *   1. as it stands, with the editor the hub carries (the baseline), and
 *   2. with THIS editor (docsync/editor/edit.html) in its place.
 * Any check that fails the second time and not the first is this change's
 * doing, and fails here, on the pull request, naming the check and the verbs
 * it found. A check the hub already fails on its own is not blamed on a
 * change that did not cause it.
 *
 *     node tools/hub-verbs.mjs [<hub-dir>] [--ref <git-ref>] [--editor <edit.html>]
 *
 * <hub-dir> defaults to $PRIMER_HUB_DIR, then a `staff-updates-internal`
 * beside this clone, then ~/staff-updates-internal. It is only read: the test
 * runs in a copy. `--ref origin/main` takes the copy from that commit instead
 * of the working tree, which is what to use on a laptop, where the hub folder
 * is often on a stale branch (a stale hub lacks verbs main already relays and
 * would say so). CI checks the hub out itself and passes the folder.
 *
 * Exit 0: nothing new broke (or the hub already carries this very editor).
 * Exit 1: this editor breaks a check the hub's own editor passes.
 * Exit 2: could not run (no hub, or it has no dev/test_mcp.mjs).
 *
 * Tested by tools/hub-verbs.test.mjs (`npm run test:hub-verbs`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The failed checks in a hub test's output. dev/testkit.mjs prints a failure
 *  as `  FAIL <label>` with the detail (for the verb check, the verbs) on the
 *  next line, indented nine spaces. A run that died before reporting any check
 *  (a throw at import, a timeout) is one failure of its own, so a crash with
 *  the new editor is not mistaken for a pass. */
export function parseFailures(out, code, error) {
  const lines = String(out || '').split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {2}FAIL (.*)$/.exec(lines[i]);
    if (!m) continue;
    const d = /^ {9}(\S.*)$/.exec(lines[i + 1] || '');
    found.push({ label: m[1].trim(), detail: d ? d[1].trim() : '' });
  }
  if (found.length || (code === 0 && !error)) return found;
  const tail = lines.map(l => l.trim()).filter(Boolean).slice(-4).join(' | ');
  const why = error ? `did not finish (${error.code || error.message})` : `exited ${code} without reporting a failed check`;
  return [{ label: `dev/test_mcp.mjs ${why}`, detail: tail }];
}

/** What `mine` fails that `base` did not: those are this change's. */
export function newFailures(base, mine) {
  const had = new Set(base.map(f => f.label));
  return mine.filter(f => !had.has(f.label));
}

function runHubTest(dir) {
  const r = spawnSync(process.execPath, ['dev/test_mcp.mjs'], {
    cwd: dir, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 << 20,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  return { out, failures: parseFailures(out, r.status, r.error) };
}

/** The hub as a throwaway folder: from a git ref, or from the working tree
 *  without its .git and node_modules. The hub's own folder is never written. */
function copyHub(hub, ref, into) {
  if (ref) {
    const tar = path.join(into, '..', path.basename(into) + '.tar');
    const a = spawnSync('git', ['-C', hub, 'archive', '--format=tar', '-o', tar, ref], { encoding: 'utf8' });
    if (a.status !== 0) throw new Error(`git archive ${ref} failed in ${hub}: ${(a.stderr || '').trim()}`);
    const x = spawnSync('tar', ['-x', '-f', tar, '-C', into], { encoding: 'utf8' });
    fs.rmSync(tar, { force: true });
    if (x.status !== 0) throw new Error(`could not unpack ${ref}: ${(x.stderr || '').trim()}`);
    return;
  }
  fs.cpSync(hub, into, {
    recursive: true,
    filter: src => !['.git', 'node_modules'].includes(path.basename(src)),
  });
}

function findHub(arg) {
  // A folder named on the command line is the one meant: a typo there must not
  // quietly fall back to some other hub.
  const tries = arg ? [arg] : [process.env.PRIMER_HUB_DIR, path.join(ROOT, '..', 'staff-updates-internal'), path.join(os.homedir(), 'staff-updates-internal')];
  for (const t of tries) if (t && fs.existsSync(path.join(t, 'dev', 'test_mcp.mjs'))) return path.resolve(t);
  return null;
}

function explain(fails) {
  const rows = fails.map(f => `  FAIL ${f.label}${f.detail ? `\n       ${f.detail}` : ''}`).join('\n');
  return [
    'The staff hub\'s connector (dev/test_mcp.mjs) fails with this editor and passes with the one the hub carries:',
    '',
    rows,
    '',
    'Most often that is a new editor verb. The hub lists the verbs it relays to Claude in',
    'functions/api/mcp.js (PAGE_VERBS) and the ones it holds back on purpose in dev/test_mcp.mjs',
    '(HELD). Make that change in the hub on a branch with the SAME NAME as this Cider branch: CI',
    'checks out a hub branch of that name when there is one, and main otherwise. Then re-run this.',
    'Land the two together (hub branch first, or right after) so the hub\'s main is not left red.',
  ].join('\n');
}

function main(argv) {
  const args = { hub: null, ref: null, editor: path.join(ROOT, 'docsync', 'editor', 'edit.html') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--editor') args.editor = path.resolve(argv[++i]);
    else if (!argv[i].startsWith('--')) args.hub = argv[i];
  }
  const hub = findHub(args.hub);
  if (!hub) { console.error('hub-verbs: no staff-updates-internal checkout with dev/test_mcp.mjs (pass its folder, or set PRIMER_HUB_DIR).'); return 2; }
  if (!fs.existsSync(args.editor)) { console.error(`hub-verbs: no editor at ${args.editor}`); return 2; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-verbs-'));
  const copy = path.join(tmp, 'hub');
  try {
    fs.mkdirSync(copy);
    copyHub(hub, args.ref, copy);
    const carried = path.join(copy, 'primer', 'edit.html');
    if (!fs.existsSync(carried)) { console.error(`hub-verbs: ${hub} has no primer/edit.html (the editor it serves).`); return 2; }
    if (fs.readFileSync(carried).equals(fs.readFileSync(args.editor))) {
      console.log('hub-verbs: the hub already carries this very editor; nothing to compare.');
      return 0;
    }
    const rel = path.relative(ROOT, args.editor);
    console.log(`hub-verbs: the hub's test_mcp.mjs, first with its own editor${args.ref ? ` (${args.ref})` : ''}, then with ${rel.startsWith('..') ? args.editor : rel}`);
    const base = runHubTest(copy);
    fs.copyFileSync(args.editor, carried);
    const mine = runHubTest(copy);

    if (base.failures.length) {
      console.log(`hub-verbs: note: the hub already fails ${base.failures.length} check(s) with its own editor, not blamed on this change:`);
      for (const f of base.failures) console.log(`  FAIL ${f.label}`);
    }
    const broke = newFailures(base.failures, mine.failures);
    if (!broke.length) { console.log('hub-verbs: ok, the connector agrees with this editor.'); return 0; }
    const text = explain(broke);
    console.error('\n' + text);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### The hub\'s connector does not agree with this editor\n\n```\n' + text + '\n```\n'); } catch { /* the log has it */ }
    }
    return 1;
  } catch (err) {
    console.error(`hub-verbs: ${err.message}`);
    return 2;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
