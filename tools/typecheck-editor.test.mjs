// node --test tools/typecheck-editor.test.mjs
// The check's own logic: taking the script out of the page, line numbers that
// are the page's, which errors count, and the bar that only goes down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractScript, diagnose, checked, knownNoise, compare, baselineOf, countByCode, CODES } from './typecheck-editor.mjs';

// A page shaped like edit.html: a <script src> first, markup, then the one
// big script, which itself writes a closing tag inside a string.
const page = body => [
  '<!doctype html>',                                            // 1
  '<script src="https://example.org/lib.js"></script>',         // 2
  '<style>p { color: red }</style>',                            // 3
  '<script>',                                                   // 4
  ...body,                                                      // 5…
  '</script>',
  '<p>after</p>',
].join('\n');

const lineOf = (html, needle) => html.split('\n').findIndex(l => l.includes(needle)) + 1;

test('the script comes out with the page\'s own line and column numbers', () => {
  const html = page(['const a = 1;', '  const marker = 2;']);
  const s = extractScript(html);
  assert.equal(s.line, 4);
  const lines = s.code.split('\n');
  assert.equal(lines[lineOf(html, 'marker') - 1], '  const marker = 2;');
  assert.equal(lines[0].trim(), '', 'markup above the script is blanked, not kept');
  assert.equal(lines[1].length, html.split('\n')[1].length, 'and blanked to the same width');
  assert.ok(!s.code.includes('after'));
});

test('a closing tag inside a string does not end the script, and the longest script wins', () => {
  const html = '<script>var small = 1;</script>\n' + page([
    'const tail = `<div>${1}<\\/script>`;',
    'const stillInside = 3;',
  ]);
  const s = extractScript(html);
  assert.ok(s.code.includes('stillInside'));
  assert.ok(!s.code.includes('small'));
});

test('a page with no inline script is refused', () => {
  assert.throws(() => extractScript('<p>nothing</p>'), /no inline <script>/);
});

test('real bugs are reported at their line in the page', () => {
  const html = page([
    'function area(w, h) { return w * h; }',
    'function known() { return 1; }',
    'const one = area(2, 3);',
    'const typo = knwon();',                      // a name that does not exist
    'const few = area(2);',                       // too few: allowed, every parameter of plain JavaScript is optional
    'const many = known(1, 2);',                  // too many
    'const five = 5; const bad = five();',              // not a function
    'function known() { return 2; }',             // declared again
    'const fine = loadPyodide().then(() => docsync.api.audit());',   // declared in the .d.ts
  ]);
  const errs = checked(diagnose(extractScript(html).code));
  const at = needle => errs.filter(e => e.line === lineOf(html, needle)).map(e => String(e.code));
  assert.deepEqual(at('knwon'), ['2552']);
  assert.deepEqual(at('area(2);'), []);
  assert.deepEqual(at('known(1, 2)'), ['2554']);
  assert.deepEqual(at('five()'), ['2349']);
  assert.deepEqual(at('return 2'), ['dup-function']);
  assert.deepEqual(at('area(2, 3)'), []);
  assert.deepEqual(at('loadPyodide'), []);
  assert.equal(errs.length, 4);
  for (const e of errs) assert.ok(String(e.code) in CODES);
});

test('the DOM noise is not reported, and the two known false shapes are let through', () => {
  const html = page([
    'const el = document.getElementById("x");',
    'el.value = "typed";',                                         // TS2339: not a kind that is checked
    'el.onclick = () => {};',
    'el.onclick();',                                               // a handler run by hand
    '[["Rotate", () => 1], ["Flip", () => 2]].forEach(([label, fn]) => { fn(); });',   // rows of label + function
  ]);
  const all = diagnose(extractScript(html).code);
  assert.ok(all.some(e => e.code === 2339), 'TypeScript does complain about .value');
  assert.equal(all.filter(knownNoise).length, 2);
  assert.deepEqual(checked(all), []);
});

test('the bar: equal passes, more fails and names the new error, fewer is noticed', () => {
  const e = (code, line, text) => ({ code, line, col: 1, text, message: 'm' });
  const old = [e(2304, 10, 'foo()'), e(2304, 20, 'bar()'), e(2554, 30, 'baz(1)')];
  const base = baselineOf(old);
  assert.deepEqual(base.counts, { 2304: 2, 2554: 1 });
  assert.deepEqual(countByCode(old), { 2304: 2, 2554: 1 });

  // The same errors on other lines (code above them moved): still at the bar.
  const moved = old.map(x => ({ ...x, line: x.line + 100 }));
  assert.deepEqual(compare(moved, base), { risen: [], fallen: [] });

  // One more of a kind: that kind has risen, and only the new one is shown.
  const more = compare([...moved, e(2304, 500, 'newTypo()')], base);
  assert.equal(more.risen.length, 1);
  assert.deepEqual([more.risen[0].code, more.risen[0].now, more.risen[0].allowed], ['2304', 3, 2]);
  assert.deepEqual(more.risen[0].errors.map(x => x.line), [500]);

  // A second error on a line that reads like a known one: one of the pair is shown.
  const twin = compare([...old, e(2554, 31, 'baz(1)')], base);
  assert.deepEqual(twin.risen[0].errors.map(x => x.line), [31]);
  // A baseline with counts and no list of known lines: every error of the kind is shown.
  const bare = compare([...old, e(2554, 31, 'baz(1)')], { counts: base.counts });
  assert.deepEqual(bare.risen[0].errors.map(x => x.line), [30, 31]);

  // A kind the baseline has never seen.
  const fresh = compare([...old, e(2349, 7, 'x()')], base);
  assert.deepEqual(fresh.risen.map(r => [r.code, r.allowed]), [['2349', 0]]);

  // One fixed and another added elsewhere of the SAME kind is level; of a different kind is a rise.
  assert.deepEqual(compare([old[0], e(2304, 9, 'other()'), old[2]], base).risen, []);
  const swap = compare([old[0], old[2], e(2349, 9, 'x()')], base);
  assert.deepEqual(swap.risen.map(r => r.code), ['2349']);
  assert.deepEqual(swap.fallen, [{ code: '2304', now: 1, allowed: 2 }]);
});
