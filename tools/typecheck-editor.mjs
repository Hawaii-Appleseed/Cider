#!/usr/bin/env node
// A static check for the editor's script. docsync/editor/edit.html holds about
// 33,000 lines of plain JavaScript in one <script>, and until this nothing read
// it before a browser did: a mistyped name or a call with the wrong number of
// arguments was found only when a Playwright spec happened to run that line.
//
// This takes the script out of edit.html (in memory; line numbers stay
// edit.html's), runs TypeScript over it as JavaScript (checkJs, loose settings,
// DOM types: tools/typecheck-editor.tsconfig.json, with the few outside names
// declared in tools/typecheck-editor.d.ts) and keeps only the kinds of error
// that find real bugs cheaply (CODES below). TypeScript says a great deal more
// about this file, nearly all of it about DOM types; tools/TYPECHECK-FINDINGS.md
// says what and why it is left out.
//
// The errors already there are recorded in tools/typecheck-editor.json. The
// check fails only when a kind has MORE errors than the baseline allows, and
// prints the new ones with their edit.html lines. When a count comes down,
// --write lowers the bar.
//
//   node tools/typecheck-editor.mjs                 check          (npm run typecheck)
//   node tools/typecheck-editor.mjs --write         record today's (lower) counts
//   node tools/typecheck-editor.mjs --write --allow-raise   after a TypeScript upgrade moved a count
//   node tools/typecheck-editor.mjs --all           print every error of the kinds checked
//   node tools/typecheck-editor.mjs --every         print every error TypeScript has, any kind
//   node tools/typecheck-editor.mjs --file <path>   check another copy of edit.html
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'docsync/editor/edit.html');
const BASE = join(root, 'tools/typecheck-editor.json');
const CONFIG = join(root, 'tools/typecheck-editor.tsconfig.json');
const AMBIENT = join(root, 'tools/typecheck-editor.d.ts');

/** The kinds of error that are checked, and what each means here. Everything
 *  else TypeScript reports is left out (see TYPECHECK-FINDINGS.md). */
export const CODES = {
  // a name that does not exist
  2304: 'a name that is not defined anywhere',
  2552: 'a name that is not defined (TypeScript suggests a near one)',
  2662: 'a bare name that is only a static member',
  2663: 'a bare name that is only an instance member',
  // a call with the wrong arguments
  // (too MANY, in practice: TypeScript treats every parameter of a plain
  // JavaScript function as optional, so a call with too few is not an error)
  2554: 'a call with the wrong number of arguments',
  2555: 'a call with too few arguments',
  2556: 'a spread argument where the function takes a fixed list',
  2575: 'a call whose argument count fits no overload',
  // a call of something that is not a function
  2348: 'a call of a class without new',
  2349: 'a call of something that is not a function',
  2351: 'new on something that cannot be constructed',
  // declared twice
  2300: 'a name declared twice',
  2393: 'a function implemented twice',
  2451: 'a let or const declared twice',
  1117: 'an object literal with the same key twice',
  'dup-function': 'two top-level functions with one name (the later one silently wins)',
  // used before it exists, written when it cannot be
  2448: 'a let or const used before its declaration',
  2449: 'a class used before its declaration',
  2450: 'an enum used before its declaration',
  2588: 'an assignment to a const',
  // code that cannot run, tests that cannot vary
  7027: 'code that can never run',
  2367: 'a comparison between values that can never be equal',
  2839: 'a comparison of two fresh objects, which is always false',
  2845: 'a comparison with NaN, which is always false',
  2872: 'a test that is always true',
  2873: 'a test that is always false',
  2695: 'a comma expression whose left side does nothing',
};

/** The editor's script, out of edit.html: the longest inline <script>, padded
 *  so every character keeps the line and column it has in the HTML. A closing
 *  tag written inside a string as <\/script> does not end it. */
export function extractScript(html) {
  let best = null;
  const re = /<script>/g;
  let m;
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length;
    const end = html.indexOf('</script>', start);
    if (end < 0) break;
    if (!best || end - start > best.end - best.start) best = { start, end };
    re.lastIndex = end;
  }
  if (!best) throw new Error('no inline <script> found');
  const before = html.slice(0, best.start);
  return {
    line: before.split('\n').length,                       // the line the script starts on
    lines: html.slice(best.start, best.end).split('\n').length,
    code: before.replace(/[^\n]/g, ' ') + html.slice(best.start, best.end),
  };
}

function options() {
  const read = ts.readConfigFile(CONFIG, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const got = ts.convertCompilerOptionsFromJson(read.config.compilerOptions, dirname(CONFIG));
  if (got.errors.length) throw new Error(got.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
  return got.options;
}

/** Two top-level `function name()` declarations with one name. A classic
 *  script takes the later one without a word, and TypeScript lets JavaScript
 *  do it; in a file of 1,100 functions it is a way to lose one. */
function duplicateFunctions(sf) {
  const seen = new Map(), out = [];
  for (const st of sf.statements) {
    if (!ts.isFunctionDeclaration(st) || !st.name) continue;
    const name = st.name.text;
    if (seen.has(name)) {
      out.push({ start: st.name.getStart(sf),
        message: `Function '${name}' is declared again; the one at line ${seen.get(name)} is replaced by it.` });
    } else seen.set(name, sf.getLineAndCharacterOfPosition(st.name.getStart(sf)).line + 1);
  }
  return out;
}

/** Every error TypeScript (and the duplicate-function pass) has for this
 *  script: [{ code, line, col, message, text }], in file order. `line` is the
 *  line in edit.html; `text` is that line of source, trimmed. */
export function diagnose(code, { ambient = [AMBIENT] } = {}) {
  const file = join(root, 'docsync/editor/edit.html.js');   // never written: served from memory
  const opts = options();
  const host = ts.createCompilerHost(opts);
  const getSourceFile = host.getSourceFile.bind(host), fileExists = host.fileExists.bind(host), readFile = host.readFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === file ? ts.createSourceFile(f, code, lang, true, ts.ScriptKind.JS) : getSourceFile(f, lang, ...rest);
  host.fileExists = f => f === file || fileExists(f);
  host.readFile = f => (f === file ? code : readFile(f));
  const program = ts.createProgram([file, ...ambient], opts, host);
  const sf = program.getSourceFile(file);
  const src = code.split('\n');
  const at = start => {
    const p = sf.getLineAndCharacterOfPosition(start);
    return { line: p.line + 1, col: p.character + 1, text: (src[p.line] || '').trim() };
  };
  const out = [];
  for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
    if (d.file !== sf) continue;
    out.push({ code: d.code, ...at(d.start), span: code.slice(d.start, d.start + d.length),
      message: ts.flattenDiagnosticMessageText(d.messageText, ' ') });
  }
  for (const d of duplicateFunctions(sf)) out.push({ code: 'dup-function', ...at(d.start), message: d.message });
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

/** Two shapes TypeScript gets wrong in this file every time, so they are not
 *  errors here (TYPECHECK-FINDINGS.md has the examples):
 *  - a list of [label, function] rows read back with destructuring. With no
 *    types written, a row is an array of "string or function", so calling the
 *    function is "not callable: not ALL constituents are". Something with no
 *    callable part at all is still reported.
 *  - a DOM handler run by hand, `$('text').onclick()`. The DOM's type wants
 *    the event; the editor's handlers that are run this way take none. */
export function knownNoise(e) {
  if (e.code === 2349) return /Not all constituents of type/.test(e.message);
  if (e.code === 2554) return /^on[a-z]+$/.test(e.span || '') && /but got 0\b/.test(e.message);
  return false;
}

/** The errors of the kinds this check keeps. */
export function checked(errors) { return errors.filter(e => String(e.code) in CODES && !knownNoise(e)); }

/** { code: how many }, for the kinds that have any. */
export function countByCode(errors) {
  const n = {};
  for (const e of errors) n[e.code] = (n[e.code] || 0) + 1;
  return n;
}

/** What identifies an error when the lines above it move: its kind and the
 *  source line it is on. */
export const fingerprint = e => `${e.code} ${e.text}`;

/** Today's errors against the baseline { counts, known }.
 *  risen: [{ code, now, allowed, errors }] for each kind with more than it is
 *  allowed, `errors` being the ones the baseline does not know (all of that
 *  kind when it cannot tell). fallen: [{ code, now, allowed }]. */
export function compare(errors, baseline) {
  const now = countByCode(errors), allowed = baseline.counts || {};
  const risen = [], fallen = [];
  for (const code of new Set([...Object.keys(now), ...Object.keys(allowed)])) {
    const n = now[code] || 0, a = allowed[code] || 0;
    if (n < a) fallen.push({ code, now: n, allowed: a });
    if (n <= a) continue;
    const left = new Map();                                 // fingerprint -> how many the baseline has
    for (const k of baseline.known || []) left.set(k, (left.get(k) || 0) + 1);
    const mine = errors.filter(e => String(e.code) === code);
    const fresh = mine.filter(e => {
      const k = fingerprint(e), c = left.get(k) || 0;
      if (c) { left.set(k, c - 1); return false; }
      return true;
    });
    risen.push({ code, now: n, allowed: a, errors: fresh.length ? fresh : mine });
  }
  return { risen, fallen };
}

/** The baseline file's contents for these errors. */
export function baselineOf(errors) {
  const counts = countByCode(errors);
  return {
    counts: Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]])),
    known: errors.map(fingerprint),
  };
}

const show = (e, rel) => `  ${rel}:${e.line}:${e.col}  ${typeof e.code === 'number' ? 'TS' + e.code : e.code}  ${e.message}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf('--file');
  const src = fi >= 0 ? resolve(argv[fi + 1]) : SRC;
  const rel = fi >= 0 ? argv[fi + 1] : 'docsync/editor/edit.html';
  const t0 = Date.now();
  const all = diagnose(extractScript(readFileSync(src, 'utf8')).code);
  const errors = checked(all);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const baseline = JSON.parse(readFileSync(BASE, 'utf8'));
  const { risen, fallen } = compare(errors, baseline);
  const total = errors.length, bar = Object.values(baseline.counts).reduce((a, b) => a + b, 0);

  if (argv.includes('--every') || argv.includes('--all')) {
    const list = argv.includes('--every') ? all : errors;
    for (const e of list) console.log(show(e, rel));
    console.log(`typecheck: ${list.length} errors`
      + (argv.includes('--every') ? ` of every kind (${total} of the kinds checked)` : ' of the kinds checked') + `, ${secs}s.`);
  } else if (argv.includes('--write')) {
    if (risen.length && !argv.includes('--allow-raise')) {
      for (const r of risen) console.error(`typecheck: TS${r.code} has ${r.now} errors, more than the ${r.allowed} allowed.`);
      console.error('--write only lowers the bar. Fix the new errors; --allow-raise is for a TypeScript upgrade that moved a count.');
      process.exit(1);
    }
    writeFileSync(BASE, JSON.stringify(baselineOf(errors), null, 2) + '\n');
    console.log(`typecheck: bar set to ${total} (was ${bar}).`);
  } else if (risen.length) {
    console.error(`typecheck: new errors in ${rel} (${secs}s).`);
    for (const r of risen) {
      console.error(`\n${typeof r.errors[0].code === 'number' ? 'TS' + r.code : r.code}: ${CODES[r.code]}. ${r.now} now, ${r.allowed} allowed:`);
      for (const e of r.errors) console.error(show(e, rel));
    }
    console.error('\nFix them. Each is a line a browser would only trip over when it ran.');
    console.error('A name that really comes from outside the script is declared in tools/typecheck-editor.d.ts.');
    process.exit(1);
  } else {
    console.log(`typecheck: ${total} errors of the kinds checked (bar ${bar}), ${secs}s`
      + (fallen.length ? '; run with --write to lower the bar.' : '.'));
  }
}
