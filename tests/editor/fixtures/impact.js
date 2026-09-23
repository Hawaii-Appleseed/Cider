// Which code each spec runs — recorded only when DS_IMPACT is set, and only
// on Chromium. tools/affected.py reads the result to answer "which specs does
// THIS change need?", so a one-function edit to edit.html runs the dozen specs
// that execute that function instead of all ~780 tests.
//
// Two halves, because the editor runs two languages:
//
//   JS   — page.coverage (V8 precise coverage). Every function V8 reports for
//          edit.html's inline scripts, with whether this test called it. The
//          offsets are turned into edit.html LINE ranges here, so the map is
//          in the file's own coordinates.
//   Py   — the report renderer and the docsync engine run inside Pyodide
//          (Python 3.12), where sys.monitoring's PY_START fires once per code
//          object and is then DISABLEd, so recording costs one call per
//          function for the whole test. Each first call is posted straight to
//          Node through an exposed binding, so a reload or a second boot inside
//          one test loses nothing.
//
// Nothing here changes what a test does. With DS_IMPACT unset every function
// below returns before touching the page.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'test-results', 'impact');
const ON = !!process.env.DS_IMPACT;

// loadPyodide is assigned by the CDN script; wrap it as it lands so the
// monitor is installed on the instance before boot() writes a single file or
// imports the engine. Any later boot in the same page goes through it too.
const INIT = `(() => {
  const SRC = ${JSON.stringify(`
import sys, js
_m = sys.monitoring
_T = 5
try:
    _m.use_tool_id(_T, "ds-impact")
except ValueError:
    pass
def _ds_start(code, offset):
    f = code.co_filename
    if f.startswith("/repo/"):
        js.__dsImpactPy(f[6:], code.co_firstlineno, code.co_name)
    return _m.DISABLE
_m.register_callback(_T, _m.events.PY_START, _ds_start)
_m.set_events(_T, _m.events.PY_START)
`)};
  let real;
  Object.defineProperty(window, 'loadPyodide', {
    configurable: true,
    get() { return real; },
    set(fn) {
      real = typeof fn !== 'function' ? fn : async function (...a) {
        const py = await fn.apply(this, a);
        try { py.runPython(SRC); } catch (e) { console.warn('ds-impact:', e); }
        return py;
      };
    },
  });
})();`;

class ImpactRecorder {
  constructor(testInfo) {
    this.info = testInfo;
    this.py = new Set();
    this.pages = new Map();     // page -> the promise that coverage has started
  }

  async attach(context) {
    await context.exposeBinding('__dsImpactPy', (_src, file, line, name) => {
      this.py.add(`${file}\t${line}\t${name}`);
    });
    await context.addInitScript(INIT);
    context.on('page', p => { this.watch(p); });
  }

  watch(page) {
    if (!page.coverage) return Promise.resolve();
    if (!this.pages.has(page)) {
      this.pages.set(page, page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {}));
    }
    return this.pages.get(page);
  }

  async finish(context) {
    const files = {};           // repo path -> { all: Set("s-e"), hit: Set("s-e") }
    for (const [page, started] of this.pages) {
      await started;
      if (page.isClosed()) continue;
      let entries;
      try { entries = await page.coverage.stopJSCoverage(); } catch (e) { continue; }
      for (const e of entries) addEntry(files, e);
    }
    const out = {
      spec: path.relative(ROOT, this.info.file),
      title: this.info.titlePath.slice(1).join(' › '),
      js: Object.fromEntries(Object.entries(files).map(([f, v]) => [f, { all: [...v.all], hit: [...v.hit] }])),
      py: [...this.py],
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const name = `${this.info.workerIndex}-${this.info.testId}-${this.info.retry}.json`;
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(out));
  }
}

// A served script -> the repo file it was copied from. edit.html is staged
// byte for byte into every docs/<id>/, and its inline scripts are found inside
// it by their text, so an offset becomes a line of docsync/editor/edit.html.
const SOURCES = {};
function repoSource(url) {
  let p;
  try { p = new URL(url).pathname; } catch (e) { return null; }
  const base = p.split('/').pop();
  const rel = base === 'edit.html' ? 'docsync/editor/edit.html'
    : fs.existsSync(path.join(ROOT, 'docsync/editor', base)) && base.endsWith('.js') ? `docsync/editor/${base}`
    : null;
  if (!rel) return null;
  if (!(rel in SOURCES)) SOURCES[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return { rel, text: SOURCES[rel] };
}

function lineStarts(text) {
  const s = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) s.push(i + 1);
  return s;
}
const LINES = new Map();
function lineOf(rel, text, offset) {
  if (!LINES.has(rel)) LINES.set(rel, lineStarts(text));
  const s = LINES.get(rel);
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

function addEntry(files, e) {
  const src = repoSource(e.url);
  if (!src || !e.source) return;
  const base = src.text.indexOf(e.source);
  if (base < 0) return;                     // served text differs from the repo's: not ours to map
  const f = files[src.rel] || (files[src.rel] = { all: new Set(), hit: new Set() });
  for (const fn of e.functions) {
    const r = fn.ranges[0];
    const key = `${lineOf(src.rel, src.text, base + r.startOffset)}-${lineOf(src.rel, src.text, base + r.endOffset)}`;
    f.all.add(key);
    if (r.count > 0) f.hit.add(key);
  }
}

// Fixtures to spread into a test.extend(). `page` is started here rather than
// from the context's 'page' event so coverage is on before the spec's first
// goto; pages a spec opens itself are caught by the event.
const impactFixtures = {
  _impact: [async ({ context }, use, testInfo) => {
    if (!ON || testInfo.project.name !== 'chromium') return use(null);
    const rec = new ImpactRecorder(testInfo);
    await rec.attach(context);
    await use(rec);
    await rec.finish(context);
  }, { auto: true }],
  page: async ({ page, _impact }, use) => {
    if (_impact) await _impact.watch(page);
    await use(page);
  },
};

module.exports = { impactFixtures, IMPACT_DIR: OUT_DIR };
