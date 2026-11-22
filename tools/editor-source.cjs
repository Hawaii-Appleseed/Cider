// The editor, put together, for the Node tools: docsync/editor/edit.html with
// its parts (docsync/editor/parts/*) inlined where `//@include parts/x.js` or
// `/*@include parts/x.css*/` lines stand. The same rule as
// docsync/editor_source.py, which is what stage and the hub serve; keep the two
// equal (docsync/test_docsync.py runs both and compares the bytes).
//
// Every tool that reads "edit.html" as text (the ratchets, the typecheck, the
// test picker, the spec fixture's list of top-level lets) reads assembled(),
// so it sees exactly what a browser runs. Lines in the assembled text are
// mapped back to the file a person edits with where(line).
//
// CommonJS so the Playwright fixtures can require() it; the .mjs tools import it.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDITOR_DIR = path.join(ROOT, 'docsync', 'editor');
const EDITOR = path.join(EDITOR_DIR, 'edit.html');
const INCLUDE = /^[ \t]*(?:\/\/|\/\*)@include ([\w./-]+)(?:\*\/)?[ \t]*(?:\r?\n|$(?![\s\S]))/gm;

/** [{file, text}] in order: pieces of edit.html (file 'edit.html') and each
 *  part where it is included. `read(name)` returns a part's text or null. */
function segments(text, read) {
  const out = [];
  const seen = new Set();
  let at = 0;
  for (const m of text.matchAll(INCLUDE)) {
    const name = m[1];
    if (!name.startsWith('parts/') || name.includes('..')) throw new Error(`edit.html: an include must name a file under parts/: ${name}`);
    if (seen.has(name)) throw new Error(`edit.html: ${name} is included twice`);
    seen.add(name);
    const body = read(name);
    if (body == null) throw new Error(`edit.html includes ${name}, which does not exist`);
    if (new RegExp(INCLUDE.source, 'm').test(body)) throw new Error(`${name}: a part may not include another`);
    if (body && !body.endsWith('\n')) throw new Error(`${name}: a part must end with a newline`);
    out.push({ file: 'edit.html', text: text.slice(at, m.index) });
    out.push({ file: name, text: body });
    at = m.index + m[0].length;
  }
  out.push({ file: 'edit.html', text: text.slice(at) });
  return out.filter(s => s.text || s.file !== 'edit.html');
}

const readDir = dir => name => {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

/** The assembled text plus a line map. `where(n)` turns line n of the
 *  assembled text into {file, line} — file relative to the repo root. */
function build(text, read, base = 'docsync/editor') {
  const segs = segments(text, read);
  const rows = [];                  // {from, count, file, first}
  let line = 1;
  const own = { 'edit.html': 1 };   // where the next edit.html piece starts in edit.html
  for (const s of segs) {
    const n = s.text.split('\n').length - 1;   // whole lines (a piece ends with \n, but the last)
    const first = s.file === 'edit.html' ? own['edit.html'] : 1;
    rows.push({ from: line, count: n + (s.text.endsWith('\n') ? 0 : 1), file: `${base}/${s.file}`, first });
    if (s.file === 'edit.html') own['edit.html'] += n;
    else own['edit.html'] += 1;                // the include line itself
    line += n;
  }
  const where = n => {
    for (const r of rows) if (n >= r.from && n < r.from + Math.max(r.count, 1)) return { file: r.file, line: r.first + (n - r.from) };
    const r = rows[rows.length - 1];
    return { file: r.file, line: r.first + (n - r.from) };
  };
  return { text: segs.map(s => s.text).join(''), segments: segs, where };
}

/** The editor a browser gets, from the files on disk (or `file`, another
 *  edit.html with its own parts/ beside it). */
function assembled(file = EDITOR) {
  return build(fs.readFileSync(file, 'utf8'), readDir(path.dirname(file)));
}

/** The same at a git revision: edit.html and its parts as committed there. */
function assembledAt(rev, { cwd = ROOT, file = 'docsync/editor/edit.html' } = {}) {
  const { execFileSync } = require('child_process');
  const show = p => {
    try { return execFileSync('git', ['show', `${rev}:${p}`], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { return null; }
  };
  const text = show(file);
  if (text == null) return null;
  const dir = path.posix.dirname(file);
  return build(text, name => show(`${dir}/${name}`));
}

/** Is this repo path one of the editor's source files (edit.html or a part)? */
const isEditorSource = f => f === 'docsync/editor/edit.html' || /^docsync\/editor\/parts\/[^/]+$/.test(f);

/** "docsync/editor/parts/pdf.js:12" for line n of the assembled text. */
function loc(map, n) {
  const w = map.where(n);
  return `${w.file}:${w.line}`;
}

module.exports = { ROOT, EDITOR, segments, build, assembled, assembledAt, isEditorSource, loc };
