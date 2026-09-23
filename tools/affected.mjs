#!/usr/bin/env node
// Run the tests a change needs, not the whole suite.
//
//   npm run test:affected                 # uncommitted changes (vs HEAD)
//   npm run test:affected -- --since origin/main
//   npm run test:affected -- --list       # say what would run, run nothing
//   npm run test:affected -- --list --why # …with every spec's reason, even when that is all of them
//   npm run test:affected -- -- --headed  # anything after a second -- goes to playwright
//
// The full editor suite is ~780 tests and ~20 minutes, and most changes touch
// one feature. This picks specs by what they RUN, not by what they are named:
// `npm run test:full` records, per spec, every edit.html function its tests
// called (V8 coverage) and every engine function the renderer called inside
// Pyodide (sys.monitoring) — see tests/editor/fixtures/impact.js. A change is
// carried back into that run's line numbers through a diff of the snapshot it
// kept, then:
//
//   code inside a function    -> the specs that called that function
//   a function no spec calls  -> none (said so, so a gap in coverage shows)
//   a top-level declaration   -> the specs calling functions that read it
//   other top-level code      -> everything (it runs at every boot)
//   editor CSS / markup       -> specs naming the selector, or running code that does
//   serve.py                  -> specs that use the route the change sits under
//   a spec                    -> itself; a fixture or the config -> everything
//
// Specs whose code is not in the browser declare what they depend on in a
// comment: `// affected-by: docsync/layout.py projects/*/render_report.py`.
// boot-errors.spec.js runs whenever anything that boots the editor changed,
// and the cheap Python checks run for any engine or report change. CI still
// runs everything on every push; this is the loop between pushes.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = 'tests/editor';
const MAP_DIR = path.join(ROOT, '.impact');
const SMOKE = `${SPEC_DIR}/boot-errors.spec.js`;
// Above this share of the suite, list-passing buys nothing: run it all.
const ALL_AT = 0.7;
// A CSS selector named by more specs than this says nothing about which.
const COMMON_TOKEN = 0.6;

// --- arguments --------------------------------------------------------------
const argv = process.argv.slice(2);
const dd = argv.indexOf('--');
const own = dd < 0 ? argv : argv.slice(0, dd);
const passThrough = dd < 0 ? [] : argv.slice(dd + 1);
const opt = (name, dflt) => { const i = own.indexOf(name); return i < 0 ? dflt : own[i + 1]; };
const SINCE = opt('--since', 'HEAD');
const LIST = own.includes('--list');

// --- git ---------------------------------------------------------------------
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

function changedFiles() {
  const files = new Set();
  for (const row of git('diff', '--name-status', '-M', SINCE).split('\n')) {
    if (!row) continue;
    const parts = row.split('\t');
    for (const p of parts.slice(1)) files.add(p);
  }
  // Untracked files under docs/ are the stager's copies, not anybody's edit.
  for (const f of git('ls-files', '--others', '--exclude-standard').split('\n')) if (f && !f.startsWith('docs/')) files.add(f);
  return [...files].sort();
}

function parseHunks(diff) {
  const hunks = [];
  let h = null;
  for (const line of diff.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      h = { a: +m[1], b: m[2] === undefined ? 1 : +m[2], c: +m[3], d: m[4] === undefined ? 1 : +m[4], minus: [], plus: [] };
      hunks.push(h);
    } else if (h && line.startsWith('-') && !line.startsWith('---')) h.minus.push(line.slice(1));
    else if (h && line.startsWith('+') && !line.startsWith('+++')) h.plus.push(line.slice(1));
  }
  return hunks;
}

const exists = f => fs.existsSync(path.join(ROOT, f));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** This change, as hunks from SINCE to the working tree (a new file: all of it). */
function myHunks(f) {
  const tracked = spawnSync('git', ['cat-file', '-e', `${SINCE}:${f}`], { cwd: ROOT }).status === 0;
  if (!tracked) {
    const lines = exists(f) ? read(f).split('\n') : [];
    return [{ a: 0, b: 0, c: 1, d: lines.length, minus: [], plus: lines }];
  }
  return parseHunks(git('diff', '-U0', SINCE, '--', f));
}

/** Hunks from the map's snapshot of `f` to the working tree. */
function driftHunks(f) {
  const r = spawnSync('git', ['diff', '--no-index', '-U0', path.join(MAP_DIR, 'base', f), path.join(ROOT, f)],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return parseHunks(r.stdout || '');
}

// A position in a file is a span [lo, hi] of lines; a gap between lines k and
// k+1 (where lines were only added or only removed) is [k+.5, k+.5].
const span = (start, count) => count > 0 ? [start, start + count - 1] : [start + 0.5, start + 0.5];

/** Carry this change's hunks into the snapshot's coordinates. Returns spans in
 *  the snapshot, each with the hunk that produced it. */
function inBase(f, mine) {
  const drift = driftHunks(f);
  const toBase = (x) => {            // a working-tree position outside every drift hunk
    let off = 0;
    for (const h of drift) {
      if (span(h.c, h.d)[1] < x) off += h.d - h.b; else break;
    }
    return x - off;
  };
  const out = [];
  for (const m of mine) {
    const [lo, hi] = span(m.c, m.d);
    const hit = drift.filter(h => { const [l2, h2] = span(h.c, h.d); return l2 <= hi + 0.5 && lo <= h2 + 0.5; });
    for (const h of hit) out.push({ s: span(h.a, h.b), hunk: m });
    if (!hit.length) out.push({ s: [toBase(lo), toBase(hi)], hunk: m });
  }
  return out;
}

/** Working-tree spans of this change (for files the map does not hold). */
const inTree = (mine) => mine.map(m => ({ s: span(m.c, m.d), hunk: m }));

// --- models: where the functions are ---------------------------------------
// Both languages reduce to the same shape: fns [{s, e, name, parent}] in file
// lines, top-level statements [{s, e, kind, names}], and which lines hold code.
const MODELS = new Map();

function scriptRegions(text, file) {
  if (!file.endsWith('.html')) return [{ start: 0, line: 1, code: text }];
  const out = [];
  const re = /<script>/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('</script>', start);
    if (end < 0) break;
    out.push({ start, line: text.slice(0, start).split('\n').length, code: text.slice(start, end) });
    re.lastIndex = end;
  }
  return out;
}

function jsModel(text, file) {
  const nLines = text.split('\n').length;
  const code = new Uint8Array(nLines + 2);
  const script = new Uint8Array(nLines + 2);
  const fns = [], top = [];
  for (const r of scriptRegions(text, file)) {
    const off = r.line - 1;
    let ast;
    const onToken = t => { for (let l = t.loc.start.line; l <= t.loc.end.line; l++) code[l + off] = 1; };
    try {
      ast = acorn.parse(r.code, { ecmaVersion: 'latest', sourceType: file.endsWith('.mjs') ? 'module' : 'script',
        locations: true, onToken, allowHashBang: true, allowReturnOutsideFunction: true });
    } catch (e) {
      try { ast = acorn.parse(r.code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onToken }); }
      catch (e2) { throw new Error(`${file}: cannot parse the script at line ${r.line}: ${e2.message}`); }
    }
    const endLine = r.line + r.code.split('\n').length - 1;
    for (let l = r.line; l <= endLine; l++) script[l] = 1;
    const walk = (node, parentFn, nameHint) => {
      if (!node || typeof node.type !== 'string') return;
      let here = parentFn;
      if (/Function/.test(node.type)) {
        const f = { s: node.loc.start.line + off, e: node.loc.end.line + off,
                    name: (node.id && node.id.name) || nameHint || 'anonymous', parent: parentFn };
        fns.push(f);
        here = f;
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'loc') continue;
        const hint = node.type === 'VariableDeclarator' ? node.id && node.id.name
          : (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') ? node.key && (node.key.name || node.key.value)
          : node.type === 'AssignmentExpression' ? node.left && (node.left.name || (node.left.property && node.left.property.name))
          : undefined;
        if (Array.isArray(v)) v.forEach(c => walk(c, here, hint));
        else if (v && typeof v.type === 'string') walk(v, here, hint);
      }
    };
    for (const st of ast.body) {
      const names = [];
      let kind = 'other';
      if (st.type === 'VariableDeclaration') {
        kind = 'decl';
        for (const d of st.declarations) if (d.id.type === 'Identifier') names.push(d.id.name);
      } else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) {
        kind = 'decl'; names.push(st.id.name);
      }
      top.push({ s: st.loc.start.line + off, e: st.loc.end.line + off, kind, names });
      walk(st, null);
    }
  }
  return { lang: 'js', fns, top, code, script, lines: text.split('\n') };
}

const PY_MODEL = String.raw`
import ast, json, sys
req = json.load(open(sys.argv[1]))
out = {}
def start(n):
    return min([n.lineno] + [d.lineno for d in getattr(n, "decorator_list", [])])
for f, text in req["files"].items():
    try:
        tree = ast.parse(text)
    except SyntaxError as e:
        out[f] = {"error": str(e)}
        continue
    fns, docs, parent = [], [], {}
    def visit(n, owner):
        here = owner
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            here = len(fns)
            fns.append({"s": start(n), "e": n.end_lineno, "name": n.name, "parent": owner})
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = n.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant) and isinstance(b[0].value.value, str):
                docs.append([b[0].lineno, b[0].end_lineno])
        for c in ast.iter_child_nodes(n):
            visit(c, here)
    visit(tree, None)
    # Code is every line but blanks, comments and docstrings.
    doc = set()
    for lo, hi in docs:
        doc.update(range(lo, hi + 1))
    code = [i + 1 for i, t in enumerate(text.split("\n"))
            if t.strip() and not t.strip().startswith("#") and i + 1 not in doc]
    top = []
    for n in tree.body:
        kind, names = "other", []
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            kind, names = "decl", [n.name]
        elif isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            kind = "decl"
            for t in (n.targets if isinstance(n, ast.Assign) else [n.target]):
                names += [x.id for x in ast.walk(t) if isinstance(x, ast.Name)]
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            kind = "import"
        elif isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
            kind = "doc"
        top.append({"s": start(n), "e": n.end_lineno, "kind": kind, "names": names})
    out[f] = {"fns": fns, "top": top, "code": code}
snips = []
for s in req.get("snippets", []):
    try:
        t = ast.parse(s)
        snips.append(all(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign)) or
                         (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)) for n in t.body))
    except SyntaxError:
        snips.append(None)
out["__snippets__"] = snips
print(json.dumps(out))
`;

// Through a file, not stdin: spawnSync's `input` wedged (Python blocked in
// read() forever) on a few large payloads.
function pyRun(files, snippets = []) {
  const tmp = path.join(os.tmpdir(), `affected-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ files, snippets }));
  try {
    const r = spawnSync('python3', ['-c', PY_MODEL, tmp], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.status !== 0) throw new Error(`python model failed: ${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function pyModel(text, file) {
  const o = pyRun({ [file]: text })[file];
  if (o.error) throw new Error(`${file}: ${o.error}`);
  const lines = text.split('\n');
  const code = new Uint8Array(lines.length + 2);
  for (const l of o.code) code[l] = 1;
  const fns = o.fns.map(f => ({ ...f }));
  for (const f of fns) f.parent = f.parent === null ? null : fns[f.parent];
  const script = new Uint8Array(lines.length + 2).fill(1);
  return { lang: 'py', fns, top: o.top, code, script, lines };
}

function model(file, text, key) {
  if (!MODELS.has(key)) MODELS.set(key, file.endsWith('.py') ? pyModel(text, file) : jsModel(text, file));
  return MODELS.get(key);
}

/** The functions a span is in. Lines strictly inside a function are its; a
 *  header or closing line is the function's AND its parent's, since both can
 *  share it. Nothing: the span is top-level code. */
function whereIs(md, [lo, hi]) {
  let inner = null;
  for (const f of md.fns) {
    if (f.s < lo && hi < f.e && (!inner || f.s > inner.s || (f.s === inner.s && f.e < inner.e))) inner = f;
  }
  const out = inner ? [inner] : [];
  if (lo === hi && Number.isInteger(lo)) {
    for (const f of md.fns) {
      if ((f.s === lo || f.e === lo) && f.parent === inner) out.push(f);
    }
  }
  return out;
}

const topAt = (md, [lo, hi]) => md.top.filter(t => t.s <= Math.ceil(hi) && Math.floor(lo) <= t.e);

const isCodeText = (lines, lang) => lines.some(l => {
  const t = l.trim();
  if (!t) return false;
  return lang === 'py' ? !t.startsWith('#') : !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
});

// --- the map ------------------------------------------------------------------
let MAP = null;
if (fs.existsSync(path.join(MAP_DIR, 'map.json'))) MAP = JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'map.json'), 'utf8'));

/** Reverse index for one mapped file: fn key -> Set(spec). */
const REV = new Map();
function specsByFn(kind, f) {
  const id = `${kind}:${f}`;
  if (!REV.has(id)) {
    const e = MAP[kind][f];
    const rev = e.fns.map(() => new Set());
    for (const [spec, idx] of Object.entries(e.hit)) for (const i of idx) rev[i].add(spec);
    REV.set(id, { keys: e.fns, rev });
  }
  return REV.get(id);
}

/** The map's record for a function found by the parser, or null when no spec
 *  ever compiled (JS) or entered (Python) it. V8 and acorn can disagree by a
 *  line about where a function starts, never about where it ends. */
function recordOf(kind, f, fn) {
  const r = specsByFn(kind, f);
  if (!r.byEnd) {
    r.byEnd = new Map();
    r.keys.forEach((k, i) => {
      const [s, e] = kind === 'js' ? k.split('-').map(Number) : [Number(k.split('\t')[0]), null];
      const at = kind === 'js' ? e : s;
      if (!r.byEnd.has(at)) r.byEnd.set(at, []);
      r.byEnd.get(at).push({ s, i });
    });
  }
  if (kind === 'py') { const c = r.byEnd.get(fn.s); return c ? r.rev[c[0].i] : null; }
  const c = (r.byEnd.get(fn.e) || []).find(x => Math.abs(x.s - fn.s) <= 1);
  return c ? r.rev[c.i] : null;
}

/** A name as a whole word. A route is whole only up to its own end, so
 *  /__pilot does not match /__pilot/claim. */
function wordRe(words) {
  const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = words.map(w => /^\/?__/.test(w) ? `${esc(w)}(?![\\w$/-])` : `${esc(w)}(?![\\w$-])`);
  return new RegExp(`(?<![\\w$-])(?:${alt.join('|')})`);
}

/** Specs that call a function whose own body (not a nested function's) names
 *  `word`, in any mapped file of that language. */
function specsReading(words, lang, only = null) {
  const out = new Map();                      // spec -> fn name
  const re = wordRe(words);
  for (const kind of lang === 'py' ? ['py', 'js'] : ['js']) {
    for (const f of Object.keys(MAP[kind])) {
      if (only && !only.includes(f)) continue;
      const md = model(f, fs.readFileSync(path.join(MAP_DIR, 'base', f), 'utf8'), `base:${f}`);
      for (const fn of md.fns) {
        const own = ownText(md, fn);
        if (!re.test(own)) continue;
        const specs = recordOf(kind, f, fn);
        if (specs) for (const s of specs) if (!out.has(s)) out.set(s, `${fn.name}()`);
      }
    }
  }
  return out;
}
/** A function's own code: not its nested functions', and not its comments —
 *  a route or a name mentioned in prose is not a use of it. */
function ownText(md, fn) {
  if (!md.own) md.own = new Map();
  if (md.own.has(fn)) return md.own.get(fn);
  const kids = md.fns.filter(k => k.parent === fn);
  const tail = md.lang === 'py' ? /\s+#\s.*$/ : /\s+\/\/\s.*$/;
  const lines = [];
  for (let l = fn.s; l <= fn.e; l++) {
    if (!md.code[l] || kids.some(k => k.s < l && l < k.e)) continue;
    lines.push(md.lines[l - 1].replace(tail, ''));
  }
  const text = lines.join('\n');
  md.own.set(fn, text);
  return text;
}

// --- specs ------------------------------------------------------------------------
const SPECS = fs.readdirSync(path.join(ROOT, SPEC_DIR)).filter(f => f.endsWith('.spec.js')).map(f => `${SPEC_DIR}/${f}`).sort();
const SPEC_TEXT = Object.fromEntries(SPECS.map(s => [s, read(s)]));
const globRe = g => new RegExp('^' + g.split('**').map(p => p.split('*').map(q => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');
const DECLARED = Object.fromEntries(SPECS.map(s => {
  const globs = [];
  for (const m of SPEC_TEXT[s].matchAll(/^\/\/ affected-by:(.*)$/gm)) globs.push(...m[1].trim().split(/\s+/));
  return [s, globs.map(globRe)];
}));
const specsNaming = (token) => {
  const re = wordRe([token]);
  return SPECS.filter(s => re.test(SPEC_TEXT[s]));
};
/** Specs naming a function — unless the name is a word nearly every spec
 *  uses anyway (`render`, `main`), which says nothing about which. */
const specsNamingFn = (name) => {
  // `render`, `main`, `check`: English, not an identifier anyone greps for.
  if (!/[_A-Z0-9]/.test(name.replace(/^_+/, '')) && name.length < 10) return [];
  const hits = specsNaming(name);
  return hits.length > SPECS.length * COMMON_TOKEN ? [] : hits;
};

// --- selection ----------------------------------------------------------------------
const picked = new Map();        // spec -> [reason]
const notes = [];                 // things worth saying that select nothing
let all = null;                   // a reason to run everything
const py = new Set();             // python checks to run
const pick = (spec, why) => {
  if (!picked.has(spec)) picked.set(spec, new Set());
  picked.get(spec).add(why);
};
const reasons = (spec) => {
  const r = [...picked.get(spec)];
  return r.slice(0, 3).join('; ') + (r.length > 3 ? `; +${r.length - 3} more` : '');
};
const everything = (why) => { if (!all) all = why; };
const loc = (f, s) => `${path.basename(f)}:${Math.floor(s[0])}`;

function mappedKind(f) {
  if (!MAP) return null;
  if (MAP.js[f]) return 'js';
  if (MAP.py[f]) return 'py';
  return null;
}

/** A change to a file whose functions the map knows. */
function coverageRule(f, kind) {
  const base = fs.readFileSync(path.join(MAP_DIR, 'base', f), 'utf8');
  const md = model(f, base, `base:${f}`);
  const mine = myHunks(f);
  let now = null, was = null;
  try { now = model(f, read(f), `tree:${f}`); } catch (e) { /* mid-edit syntax: count it all as code */ }
  try { was = model(f, git('show', `${SINCE}:${f}`), `since:${f}`); } catch (e) { /* new file, or unparsable */ }
  // Words only: a comment, a docstring, a blank line — on both sides.
  const prose = (m, from, to) => {
    for (let l = Math.ceil(from); l <= Math.floor(to); l++) if (!m || !m.script[l] || m.code[l]) return false;
    return true;
  };
  for (const { s, hunk } of inBase(f, mine)) {
    const [lo, hi] = s;
    if (prose(md, lo, hi) && prose(now, hunk.c, hunk.c + hunk.d - 1) && prose(was, hunk.a, hunk.a + hunk.b - 1)) continue;
    if (md.lang === 'js' && !md.script[Math.round(lo)]) { markupRule(f, md, s, hunk); continue; }

    const fns = whereIs(md, s);
    if (fns.length) {
      for (const fn of fns) {
        const specs = recordOf(kind, f, fn);
        if (!specs || !specs.size) {
          // Engine code the editor never ran may still run in the server.
          if (md.lang === 'py' && serverReach(f, fn.name, loc(f, s))) continue;
          notes.push(`${loc(f, s)} ${fn.name}() — no spec runs it`);
          continue;
        }
        for (const spec of specs) pick(spec, `${loc(f, s)} ${fn.name}()`);
      }
      continue;
    }
    topLevel(f, md, s, hunk);
  }
}

function topLevel(f, md, s, hunk) {
  const tops = topAt(md, s);
  const gap = !Number.isInteger(s[0]);
  if (gap || !tops.length) {
    // A declaration taken away: whatever read that name now reads another
    // one (a duplicate's twin) or nothing.
    const gone = declaredNames(hunk.minus, md.lang);
    if (gone.length) {
      const readers = specsReading(gone, md.lang, md.lang === 'py' ? [f] : null);
      for (const [spec, fn] of readers) pick(spec, `${loc(f, s)} removed ${gone[0]}, read by ${fn}`);
      if (!readers.size) notes.push(`${loc(f, s)} removed ${gone.join(', ')} — no spec runs code that reads it`);
    }
    // Only added lines, between statements: new declarations run nothing on
    // their own; what calls them is changed too, and selects through that.
    if (onlyDeclarations(hunk.plus, md.lang) && (gone.length || !isCodeText(hunk.minus, md.lang))) {
      if (isCodeText(hunk.plus, md.lang)) notes.push(`${loc(f, s)} new top-level declaration(s) — tested through their callers`);
      return;
    }
    everything(`${loc(f, s)} top-level code runs at every boot`);
    return;
  }
  for (const t of tops) {
    if (t.kind === 'doc') continue;
    if (t.kind === 'decl' && t.names.length) {
      // A Python module's own lowercase names are its business; an UPPER_CASE
      // constant is the engine's API (edit.html reads FONTS through runPython).
      // What it computes feeds this file; an engine module's UPPER_CASE
      // constant is also the engine's API (edit.html reads FONTS through
      // runPython), so that name alone is looked for everywhere.
      const readers = specsReading(derived(md, t.names, t.e), md.lang, [f]);
      const api = md.lang === 'js' ? t.names
        : f.startsWith('docsync/') ? t.names.filter(x => /^[A-Z][A-Z0-9_]+$/.test(x)) : [];
      if (api.length) for (const [sp, fn] of specsReading(api, md.lang)) if (!readers.has(sp)) readers.set(sp, fn);
      if (readers.size) { for (const [spec, fn] of readers) pick(spec, `${loc(f, s)} ${t.names[0]}, read by ${fn}`); continue; }
    }
    if (md.lang === 'py') {
      // Module-level code runs when the module is imported: every spec that did.
      const { keys, rev } = specsByFn('py', f);
      const i = keys.findIndex(k => k.endsWith('\t<module>'));
      if (i >= 0) { for (const spec of rev[i]) pick(spec, `${loc(f, s)} module level`); continue; }
    }
    everything(`${loc(f, s)} top-level ${t.names[0] || 'code'} runs at every boot`);
  }
}

/** The names, plus every top-level value computed from them (a floor in
 *  points, and the pixel and inch floors derived from it), to a fixpoint. */
function derived(md, names, after) {
  const out = new Set(names);
  for (let grew = true, n = 0; grew && n < 10; n++) {
    grew = false;
    const re = new RegExp(`(?<![\\w$])(?:${[...out].join('|')})(?![\\w$])`);
    for (const t of md.top) {
      if (t.kind !== 'decl' || t.s <= after || t.names.every(x => out.has(x))) continue;
      if (re.test(md.lines.slice(t.s - 1, t.e).join('\n'))) { t.names.forEach(x => out.add(x)); grew = true; }
    }
  }
  return [...out];
}

/** Names declared at the top level of these lines (column 0). */
function declaredNames(lines, lang) {
  const re = lang === 'py' ? /^(?:async\s+)?(?:def|class)\s+(\w+)|^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/
    : /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/;
  return [...new Set(lines.map(l => re.exec(l)).filter(Boolean).map(m => m[1] || m[2]))];
}

function onlyDeclarations(lines, lang) {
  if (!isCodeText(lines, lang)) return true;
  const text = lines.join('\n');
  if (lang === 'py') return pyRun({}, [text]).__snippets__[0] === true;
  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
    return ast.body.every(n => /Declaration$/.test(n.type));
  } catch (e) { return false; }
}

/** edit.html outside its script: the editor's own stylesheet and markup. A
 *  selector or id is looked for in the specs and in the code the specs run. */
function markupRule(f, md, s, hunk) {
  const lo = Math.max(1, Math.floor(s[0]));
  const tokens = new Set();
  const take = (text) => {
    for (const m of text.matchAll(/(?:^|[\s,>+~(])[.#]([A-Za-z_][\w-]*)/g)) tokens.add(m[1]);
    for (const m of text.matchAll(/\b(?:id|class)="([^"]+)"/g)) for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
    for (const m of text.matchAll(/(--[\w-]+)/g)) tokens.add(m[1]);
  };
  hunk.minus.concat(hunk.plus).forEach(take);
  // A declaration line names no selector: the rule it sits in does.
  if (!tokens.size) {
    for (let l = lo; l >= 1 && l > lo - 200; l--) {
      const t = md.lines[l - 1];
      if (/[{]/.test(t) && !/^\s*@/.test(t)) { take(' ' + t.slice(0, t.indexOf('{'))); break; }
      if (/\b(?:id|class)="/.test(t)) { take(t); break; }
    }
  }
  const common = [];
  let any = false;
  for (const tok of tokens) {
    const hit = new Map(specsNaming(tok).map(sp => [sp, 'names it']));
    for (const [sp, fn] of specsReading([tok], 'js')) if (!hit.has(sp)) hit.set(sp, `via ${fn}`);
    if (!hit.size) continue;
    if (hit.size > SPECS.length * COMMON_TOKEN) { common.push(tok); continue; }
    any = true;
    for (const [sp, how] of hit) pick(sp, `${loc(f, s)} ${tok} (${how})`);
  }
  if (!any) {
    if (common.length) everything(`${loc(f, s)} styles ${common.join(', ')}, which nearly every spec touches`);
    else notes.push(`${loc(f, s)} editor markup/CSS no spec names`);
  }
}

// --- serve.py: the routes code sits under ----------------------------------------
const SERVER = 'report2027/tools/serve.py';
const server = () => model(SERVER, read(SERVER), `tree:${SERVER}`);
const routesOn = (line) => [...line.matchAll(/["'](\/__[\w/.-]*)["']/g)].map(m => m[1]);
const dispatcher = fn => /^do_/.test(fn.name) || fn.e - fn.s > 300;

/** The routes whose handling runs line `l` of serve.py's function `fn`: in a
 *  do_GET/do_POST, the `if path == …` above it; elsewhere, the routes the
 *  function names and those of whatever calls it, two calls up. */
function routesOf(fn, l, depth = 0) {
  const md = server();
  if (dispatcher(fn)) {
    for (let k = l; k >= fn.s; k--) {
      const t = md.lines[k - 1];
      if (/\bpath\s*(==|\.startswith\(|in\s)/.test(t) && routesOn(t).length) return routesOn(t);
    }
    return [];
  }
  const r = [];
  for (let k = fn.s; k <= fn.e; k++) r.push(...routesOn(md.lines[k - 1]));
  if (depth < 2) r.push(...routesCalling(fn.name, fn, depth + 1));
  return r;
}

/** Routes of the serve.py code that calls `name(`. */
function routesCalling(name, self = null, depth = 1) {
  const md = server();
  const call = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\(`);
  const r = [];
  md.lines.forEach((t, i) => {
    const at = i + 1;
    if ((self && at >= self.s && at <= self.e) || !call.test(t) || /^\s*def\s/.test(t)) return;
    const [caller] = whereIs(md, [at, at]);
    if (caller) r.push(...routesOf(caller, at, depth));
  });
  return r;
}

/** Pick the specs that use any of these routes; true if there were any. */
function pickRoutes(routes, label) {
  let any = false;
  for (const r of new Set(routes)) {
    const sel = new Map(specsNaming(r.slice(1)).map(sp => [sp, 'names it']));
    if (MAP) for (const [sp, jf] of specsReading([r], 'js')) if (!sel.has(sp)) sel.set(sp, `via ${jf}`);
    for (const [sp, how] of sel) { any = true; pick(sp, `${label} ${r} (${how})`); }
  }
  return any;
}

/** An engine function reached through the server rather than the browser. */
function serverReach(f, name, label) {
  const mod = path.basename(f, '.py');
  let any = wordRe([mod]).test(read(SERVER)) && pickRoutes(routesCalling(name), `${label} ${name}() via`);
  for (const sp of specsNamingFn(name)) { any = true; pick(sp, `${label} ${name} (named)`); }
  return any;
}

function serverRule(f) {
  const md = server();
  for (const { s, hunk } of inTree(myHunks(f))) {
    if (!isCodeText(hunk.plus.concat(hunk.minus), 'py')) continue;
    const at = Math.max(1, Math.round(s[0]));
    const [fn] = whereIs(md, [at, at]).concat(whereIs(md, [s[0], s[1]]));
    const routes = [...hunk.plus, ...hunk.minus].flatMap(routesOn);
    if (fn) routes.push(...routesOf(fn, at));
    let any = pickRoutes(routes, loc(f, s));
    if (fn) for (const sp of specsNamingFn(fn.name)) { any = true; pick(sp, `${loc(f, s)} ${fn.name}`); }
    pick(SMOKE, `${loc(f, s)} server still starts`);
    if (!any) notes.push(`${loc(f, s)} ${fn ? fn.name + '()' : 'top level'} — no spec reaches it by route or name`);
  }
}

/** A Python file the browser does not run: by module name and changed defs. */
function namedRule(f) {
  const stem = path.basename(f, '.py');
  const mod = !f.endsWith('.py') ? path.basename(f)
    : stem === '__init__' ? path.basename(path.dirname(f)) : stem;
  const hits = specsNamingFn(mod);
  for (const sp of hits) pick(sp, `${path.basename(f)} (named)`);
  if (f.endsWith('.py') && exists(f)) {
    let md;
    try { md = model(f, read(f), `tree:${f}`); } catch (e) { md = null; }
    if (md) {
      for (const { s } of inTree(myHunks(f))) {
        for (const fn of whereIs(md, s)) serverReach(f, fn.name, loc(f, s));
      }
    }
  }
  if (!hits.length) notes.push(`${f} — no spec names it${f.endsWith('.py') ? '; the Python checks cover it' : ''}`);
}

const QUIET = [/\.md$/, /^LICENSE$/, /^\.claude\//, /^\.github\//, /^docs\/(?!primer\/)/, /\.gitignore$/, /^tools\/affected\.mjs$/,
  // Built output: the test server re-renders it at startup, so it changes
  // whenever its renderer does — and that change is what selects.
  /^report2027\/web\/index\.html$/, /^\.impact\//, /(^|\/)node_modules$/];
const EVERYTHING = [/^tests\/editor\/fixtures\//, /^playwright\.config\.js$/, /^package(-lock)?\.json$/, /^report2027\/(content\.md|layout\.json|web\/)/];

const changed = changedFiles();
for (const f of changed) {
  const declaredBy = SPECS.filter(s => DECLARED[s].some(re => re.test(f)));
  declaredBy.forEach(s => pick(s, `${f} (declared)`));

  if (f.startsWith(`${SPEC_DIR}/`) && f.endsWith('.spec.js')) { if (exists(f)) pick(f, 'changed'); continue; }
  // The Python checks themselves: they run below, and no spec runs them.
  if (/(^|\/)test_[\w]+\.py$|^docsync\/(check|chart_parity)\.py$/.test(f)) { py.add('engine'); continue; }
  if (EVERYTHING.some(re => re.test(f))) { everything(`${f} is shared by every spec`); continue; }
  if (QUIET.some(re => re.test(f))) continue;

  if (/^(docsync|report2027|projects)\/.*\.py$/.test(f) || f === 'docsync.yml' || /^projects\//.test(f) || /^docsync\/templates\//.test(f)) {
    py.add('engine');
  }
  if (f.startsWith('collab/')) {
    py.add('collab');
    for (const sp of SPECS.filter(s => path.basename(s).startsWith('collab'))) pick(sp, f);
    continue;
  }
  if (f === 'docsync/editor/edit.html') { py.add('render'); pick(SMOKE, 'edit.html boots'); }
  if (!exists(f)) { notes.push(`${f} deleted — its callers' changes select their specs`); continue; }

  const kind = mappedKind(f);
  if (kind) {
    if (kind === 'py') pick(SMOKE, `${path.basename(f)} is engine code the editor boots`);
    coverageRule(f, kind);
  } else if (f === 'docsync/editor/edit.html') {
    everything(MAP ? `${f} is not in the impact map` : 'no impact map yet — `npm run test:full` builds one');
  } else if (f === 'report2027/tools/serve.py') {
    serverRule(f);
  } else if (/^projects\/([^/]+)\//.test(f)) {
    const id = f.split('/')[1];
    for (const sp of specsNaming(id)) pick(sp, `${id} (named)`);
    if (f.endsWith('.py')) namedRule(f);
  } else if (f === 'docsync.yml') {
    for (const sp of specsNaming('docsync.yml')) pick(sp, 'docsync.yml (named)');
  } else if (f.endsWith('.py')) {
    if (!MAP && /^docsync\//.test(f)) everything('no impact map yet — `npm run test:full` builds one');
    else namedRule(f);
  } else {
    namedRule(f);
  }
}

// --- report ------------------------------------------------------------------------
const rel = s => path.relative(SPEC_DIR, s);
let run = [...picked.keys()].filter(s => SPECS.includes(s)).sort();
if (!all && run.length >= SPECS.length * ALL_AT) all = `${run.length} of ${SPECS.length} specs are affected`;

console.log(`Changes since ${SINCE}: ${changed.length ? changed.join(', ') : 'none'}`);
if (MAP) {
  const behind = spawnSync('git', ['rev-list', '--count', `${MAP.head}..HEAD`], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  console.log(`Impact map: ${MAP.built.slice(0, 10)}, ${behind || '?'} commit(s) behind HEAD`);
}
if (run.length && (!all || own.includes('--why'))) {
  console.log(`\n${run.length} of ${SPECS.length} specs:`);
  const w = Math.max(...run.map(s => rel(s).length));
  for (const s of run) console.log(`  ${rel(s).padEnd(w)}  ${reasons(s)}`);
}
if (all) console.log(`\nRunning the whole suite: ${all}.${own.includes('--why') ? '' : ' (--why lists each spec\'s reason)'}`);
else if (!run.length) console.log('\nNo spec is affected.');
if (notes.length) { console.log('\nNotes:'); for (const n of [...new Set(notes)]) console.log(`  ${n}`); }

const checks = [];
if (py.has('engine')) {
  checks.push(['python3', ['docsync/test_docsync.py']], ['python3', ['-m', 'docsync.check']], ['python3', ['-m', 'docsync.chart_parity']]);
}
if (py.has('engine') || py.has('render')) checks.push(['python3', ['report2027/tools/test_render.py']]);
if (py.has('collab')) checks.push(['npm', ['run', '--silent', 'test:collab']]);
if (checks.length) console.log(`\nChecks: ${checks.map(([c, a]) => [c, ...a].join(' ')).join(' · ')}`);

if (LIST) process.exit(0);

let failed = 0;
for (const [cmd, args] of checks) {
  console.log(`\n$ ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (all || run.length) {
  const args = ['playwright', 'test', ...(all ? [] : run.map(rel)), ...passThrough];
  console.log(`\n$ npx ${args.join(' ')}`);
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
