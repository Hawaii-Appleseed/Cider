// tools/hub-verbs.mjs: the check that the staff hub's connector agrees with this
// editor. It runs against a FAKE hub (a folder whose dev/test_mcp.mjs reads
// primer/edit.html and prints failures the way dev/testkit.mjs does), so no real
// hub is needed. The real one is exercised in CI (the `connector` job) and by
// hand: `node tools/hub-verbs.mjs ~/staff-updates-internal --ref origin/main`.
// Run with `npm run test:hub-verbs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFailures, newFailures } from './hub-verbs.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub-verbs.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-verbs-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The editor is a list of verbs, one per line: `verb` is a batch verb.
const editor = (...verbs) => `const PILOT_BATCH_VERBS = {\n${verbs.map(v => `  ${v}: { n: 1 },`).join('\n')}\n};\n`;

// A hub whose connector relays `relays`, holds `held` back, and (optionally)
// fails one check of its own whatever the editor says.
const STUB = (relays, held, red) => `
import fs from 'node:fs';
const ed = fs.readFileSync(new URL('../primer/edit.html', import.meta.url), 'utf8');
const verbs = [...ed.matchAll(/^  ([A-Za-z]+): \\{/gm)].map(m => m[1]);
const known = new Set(${JSON.stringify([...relays, ...held])});
const missing = verbs.filter(v => !known.has(v));
console.log('  ok   the stub started');
if (missing.length) console.log('  FAIL and every verb the editor takes is relayed, or held back on purpose\\n         ' + missing.join(','));
else console.log('  ok   and every verb the editor takes is relayed, or held back on purpose');
${red ? "console.log('  FAIL something else the hub gets wrong\\n         not the editor\\'s fault');" : ''}
process.exit(missing.length || ${red} ? 1 : 0);
`;

let n = 0;
function fakeHub({ own, relays, held = [], red = false }) {
  const dir = path.join(tmp, `hub${++n}`);
  fs.mkdirSync(path.join(dir, 'dev'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'primer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dev', 'test_mcp.mjs'), STUB(relays, held, red));
  fs.writeFileSync(path.join(dir, 'primer', 'edit.html'), editor(...own));
  return dir;
}
function mine(...verbs) {
  const f = path.join(tmp, `edit${++n}.html`);
  fs.writeFileSync(f, editor(...verbs));
  return f;
}
const run = (hub, file, extra = []) =>
  spawnSync(process.execPath, [TOOL, hub, '--editor', file, ...extra], { encoding: 'utf8' });

test('a new verb the hub neither relays nor holds back fails, naming it', () => {
  const hub = fakeHub({ own: ['place', 'recolor'], relays: ['place', 'recolor'] });
  const r = run(hub, mine('place', 'recolor', 'addGuide'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /every verb the editor takes is relayed/);
  assert.match(r.stderr, /addGuide/);
  assert.match(r.stderr, /same name as this Cider branch|SAME NAME/);
});

test('a new verb the hub relays, or holds back on purpose, passes', () => {
  const hub = fakeHub({ own: ['place'], relays: ['place', 'addGuide'], held: ['editSource'] });
  const r = run(hub, mine('place', 'addGuide', 'editSource'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agrees with this editor/);
});

test('the very editor the hub carries is nothing to compare', () => {
  const hub = fakeHub({ own: ['place'], relays: ['place'] });
  const r = run(hub, path.join(hub, 'primer', 'edit.html'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already carries this very editor/);
});

test('a check the hub already fails is not blamed on the change', () => {
  const hub = fakeHub({ own: ['place'], relays: ['place', 'recolor'], red: true });
  const r = run(hub, mine('place', 'recolor'));          // a different editor, every verb relayed
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already fails 1 check/);
  assert.match(r.stdout, /something else the hub gets wrong/);
});

test('but a new break on top of a hub that is already red still fails', () => {
  const hub = fakeHub({ own: ['place'], relays: ['place'], red: true });
  const r = run(hub, mine('place', 'addSpacer'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /addSpacer/);
  assert.doesNotMatch(r.stderr, /something else the hub gets wrong/);
});

test('the hub folder is only read: its editor is the one it had', () => {
  const hub = fakeHub({ own: ['place'], relays: ['place'] });
  const before = fs.readFileSync(path.join(hub, 'primer', 'edit.html'), 'utf8');
  run(hub, mine('place', 'addGuide'));
  assert.equal(fs.readFileSync(path.join(hub, 'primer', 'edit.html'), 'utf8'), before);
});

test('no hub, or a hub with no test, is exit 2, not a pass', () => {
  const none = spawnSync(process.execPath, [TOOL, path.join(tmp, 'nowhere'), '--editor', mine('place')],
    { encoding: 'utf8', env: { ...process.env, PRIMER_HUB_DIR: path.join(tmp, 'nor-here'), HOME: path.join(tmp, 'emptyhome') } });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no staff-updates-internal checkout/);
});

test('a hub test that dies before reporting is a failure of its own', () => {
  const out = 'Error: Cannot find module x\n    at Object.<anonymous> (dev/test_mcp.mjs:1:1)\n';
  const fails = parseFailures(out, 1, null);
  assert.equal(fails.length, 1);
  assert.match(fails[0].label, /exited 1 without reporting a failed check/);
  assert.deepEqual(parseFailures('  ok   fine\n', 0, null), []);
  assert.equal(parseFailures('', null, { code: 'ETIMEDOUT' })[0].label.includes('did not finish'), true);
});

test('failures are read the way dev/testkit.mjs prints them, with their detail', () => {
  const out = '  ok   a\n  FAIL the verbs\n         addGuide,removeGuide\n  ok   b\n  FAIL no detail\n';
  assert.deepEqual(parseFailures(out, 1, null), [
    { label: 'the verbs', detail: 'addGuide,removeGuide' },
    { label: 'no detail', detail: '' },
  ]);
  assert.deepEqual(newFailures([{ label: 'x' }], [{ label: 'x' }, { label: 'y' }]).map(f => f.label), ['y']);
});
