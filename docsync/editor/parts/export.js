// --- HTML export ---------------------------------------------------------
// What you see in the editor IS the renderer's HTML — the iframe holds the
// real thing, not a preview of it. So an export that matches the editor is
// not a conversion: it is the same render, minus the editing scaffolding
// (DOCSYNC_EDIT stamps data-slot/data-el hooks that must not ship) and with
// everything it referenced pulled inline so the file stands alone.
async function renderClean() {
  py.globals.set('SRC', source);
  py.globals.set('LAYOUT', JSON.stringify(layout, null, 2));
  py.globals.set('CONTENT', M.content);
  py.globals.set('LAYOUT_PATH', M.layout || '');
  py.globals.set('RENDER', M.render);
  py.globals.set('OUT', M.out);
  // Its own PURGE, rather than inheriting whatever renderOnce last set: a
  // publish render that reached Python before any editing render would have
  // read an unset global and died with NameError.
  py.globals.set('PURGE', engineDirty);
  return py.runPythonAsync(`
import sys, os, io, runpy, contextlib
os.environ.pop('DOCSYNC_EDIT', None)        # the published bytes, not the editable ones
open('/repo/' + CONTENT, 'w').write(SRC)
if LAYOUT_PATH: open('/repo/' + LAYOUT_PATH, 'w').write(LAYOUT)
if PURGE:
    for m in [m for m in sys.modules if m.startswith('docsync')]: del sys.modules[m]
with contextlib.redirect_stdout(io.StringIO()):
    runpy.run_path('/repo/' + RENDER, run_name='__main__')
try:                                         # draw the pages layout.pages adds that the renderer did not
    from docsync.layout import finish_output
    finish_output('/repo/' + OUT)
except ImportError:                          # an older staged engine: nothing to draw them with
    pass
open('/repo/' + OUT).read()
`);
}

const asDataUrl = async url => {
  // It gives up: one picture that never answers held the whole export, with
  // the status line saying "making the PDF" for as long as the browser waited.
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(url);
  const blob = await r.blob();
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
};

/** Pull every external reference into the document itself: stylesheets as
 *  <style>, images as data: URIs. A file that reaches for assets/ is only
 *  identical while it sits next to them — and a Squarespace block never
 *  does. Session uploads already live in memory as data URLs. */
async function inlineEverything(doc, opts = {}) {
  // What the caller may want to tell the user: opts.fonts / opts.scripts turn
  // the two network-or-folder inlinings on (a Squarespace block keeps its font
  // links and takes no script, so they are off by default).
  const res = { fonts: [], fontsLinked: [], scriptsInlined: 0, scriptsLeft: [] };
  if (opts.fonts) await inlineWebFonts(doc, res);
  if (opts.scripts) await inlineScripts(doc, res);
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"]')]) {
    const href = link.getAttribute('href') || '';
    // A web font's stylesheet stays a link — it is fetched from the web
    // wherever the file is opened. Joined onto the project's folder it 404'd,
    // and a 404 does not throw: the error page replaced the link, as CSS.
    if (/^(https?:)?\/\//i.test(href)) continue;
    try {
      const r = await fetch(withBase(href));
      if (!r.ok) continue;
      const css = await r.text();
      const st = doc.createElement('style');
      st.textContent = css;
      link.replaceWith(st);
    } catch (e) { /* leave the <link>: a broken style beats a broken export */ }
  }
  // Every picture is asked for at once, and a file used twice is fetched once.
  // One after another, a report of forty pictures waited forty round trips.
  const jobs = [];
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!/^(data:|https?:)/i.test(src)) jobs.push({ el: img, attr: 'src', src });
  }
  for (const img of doc.querySelectorAll('image[href]')) {          // a picture in a shape (58)
    const src = img.getAttribute('href') || '';
    if (!/^(data:|https?:|#)/i.test(src)) jobs.push({ el: img, attr: 'href', src });
  }
  const got = new Map();
  await Promise.all([...new Set(jobs.map(j => j.src))].map(async src => {
    try { got.set(src, localImages.get(src) || await asDataUrl(withBase(src))); }
    catch (e) { /* keep the relative path rather than lose the image tag */ }
  }));
  for (const j of jobs) if (got.has(j.src)) j.el.setAttribute(j.attr, got.get(j.src));
  return res;
}

/** Google Fonts links -> @font-face rules with the woff2 files inline as data:
 *  URIs, so the exported file sets itself in its fonts with no network (the
 *  families are SIL OFL, which allows redistributing them). Only the latin and
 *  latin-ext subsets are kept: the other subsets (cyrillic, greek, vietnamese…)
 *  are most of the bytes and no Hawaiian-policy report uses them; the ʻokina
 *  is in latin. A stylesheet whose CSS or any file will not fetch is left as
 *  its <link> — the web copy beats a half-embedded one — and listed in
 *  res.fontsLinked so the package can say so. res.fonts collects every face's
 *  bytes for the package's fonts/ folder. */
// A fetch that gives up: fonts.googleapis.com on a blocked or blackholed
// network never answers, and the package export waited on it as long as the
// browser would (minutes), with the status line saying only "preparing".
// A stylesheet or face that has not arrived by then stays a <link>, and the
// README says so, exactly as for a refusal.
let FONT_FETCH_MS = 10000;
const fetchWithin = (url, ms = FONT_FETCH_MS) => fetch(url, { signal: AbortSignal.timeout(ms) });
// A font file never changes at its address, so it is fetched once a session:
// the second Download in a sitting asks the network for no font at all. A
// fetch that failed is forgotten, so the next export tries again.
const fontFetched = new Map();
function fetchedOnce(key, get) {
  let p = fontFetched.get(key);
  if (!p) {
    p = get();
    fontFetched.set(key, p);
    p.catch(() => fontFetched.delete(key));
  }
  return p;
}
async function inlineWebFonts(doc, res) {
  // The stylesheets together, and each one's faces together: a report with
  // two families in six weights is some thirty files, which came one by one.
  const links = [...doc.querySelectorAll('link[rel~="stylesheet"]')].filter(link =>
    /^(https?:)?\/\/fonts\.googleapis\.com\//i.test(link.getAttribute('href') || ''));
  const done = await Promise.all(links.map(async link => {
    const href = link.getAttribute('href') || '';
    try {
      const cssUrl = href.startsWith('//') ? 'https:' + href : href;
      const css = await fetchedOnce('css ' + cssUrl, async () => {
        const r = await fetchWithin(cssUrl);
        if (!r.ok) throw new Error('css ' + r.status);
        return r.text();
      });
      const specs = [];
      for (const m of css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g)) {
        if (m[1] && !/^latin(-ext)?$/.test(m[1])) continue;
        const body = m[2];
        const get = k => ((new RegExp(k + '\\s*:\\s*([^;]+)', 'i')).exec(body) || [])[1];
        const url = /url\((['"]?)(https?:[^'")]+)\1\)/.exec(body);
        if (!url) continue;
        specs.push({ family: (get('font-family') || 'font').replace(/['"]/g, '').trim(),
                     weight: (get('font-weight') || '400').trim(),
                     style: (get('font-style') || 'normal').trim(),
                     subset: m[1] || '', url: url[2], rule: m[0].replace(/^\/\*[^*]*\*\/\s*/, '') });
      }
      if (!specs.length) throw new Error('no faces');
      const faces = await Promise.all(specs.map(async f => {
        const got = await fetchedOnce('face ' + f.url, async () => {
          const fr = await fetchWithin(f.url);
          if (!fr.ok) throw new Error('font ' + fr.status);
          const bytes = new Uint8Array(await fr.arrayBuffer());
          const uri = await new Promise(ok => {
            const rd = new FileReader();
            rd.onload = () => ok(rd.result);
            rd.readAsDataURL(new Blob([bytes], { type: 'font/woff2' }));
          });
          return { bytes, uri };
        });
        return { ...f, bytes: got.bytes, uri: got.uri };
      }));
      return { link, faces, inline: faces.map(f => f.rule.replace(f.url, f.uri) + '\n').join('') };
    } catch (e) { return { link, href }; }          // keep the <link>
  }));
  for (const d of done) {                           // in the document's order, as before
    if (!d.faces) { res.fontsLinked.push(d.href); continue; }
    const st = doc.createElement('style');
    st.setAttribute('data-ds-fonts', '');
    st.textContent = d.inline;
    d.link.replaceWith(st);
    res.fonts.push(...d.faces.map(({ uri, ...f }) => f));
  }
}

/** A relative <script src> (the primer's primer.js) -> an inline script, so
 *  the file does not need the folder it was exported from. */
async function inlineScripts(doc, res) {
  for (const sc of [...doc.querySelectorAll('script[src]')]) {
    const src = sc.getAttribute('src') || '';
    if (/^(data:|https?:|\/\/)/i.test(src)) { res.scriptsLeft.push(src); continue; }
    try {
      const r = await fetch(withBase(src));
      if (!r.ok) throw new Error(r.status);
      const code = await r.text();
      sc.removeAttribute('src');
      sc.textContent = code.replace(/<\/script/gi, '<\\/script');
      res.scriptsInlined++;
    } catch (e) { res.scriptsLeft.push(src); }      // keep the reference
  }
}

/** Resolve a single @media feature against the design viewport.
 *  true / false / null, where null means "this editor cannot decide" and the
 *  caller must leave the query standing. */
function mediaFeature(feat, viewPx) {
  const s = feat.replace(/^\(|\)$/g, '').trim();
  const len = t => {
    const m = /^([+-]?[\d.]+)(px|em|rem|in|cm|mm|pt|pc|q)?$/i.exec(t.trim());
    if (!m) return null;
    const k = { px: 1, em: 16, rem: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4,
                pt: 96 / 72, pc: 16, q: 96 / 101.6 }[(m[2] || 'px').toLowerCase()];
    return k ? parseFloat(m[1]) * k : null;
  };
  const cmp = (l, op, r) => op === '<' ? l < r : op === '<=' ? l <= r
                          : op === '>' ? l > r : op === '>=' ? l >= r
                          : Math.abs(l - r) < 0.5;
  let m;
  if ((m = /^(min|max)-(?:device-)?width\s*:\s*(.+)$/i.exec(s))) {
    const v = len(m[2]);
    return v === null ? null : (m[1].toLowerCase() === 'min' ? viewPx >= v : viewPx <= v);
  }
  // Range syntax: (width >= 900px) and (500px <= width <= 900px).
  if ((m = /^(?:device-)?width\s*(<=|>=|<|>|=)\s*(.+)$/i.exec(s))) {
    const v = len(m[2]);
    return v === null ? null : cmp(viewPx, m[1], v);
  }
  if ((m = /^(.+?)\s*(<=|<)\s*(?:device-)?width\s*(<=|<)\s*(.+)$/i.exec(s))) {
    const a = len(m[1]), b = len(m[4]);
    return (a === null || b === null) ? null : (cmp(a, m[2], viewPx) && cmp(viewPx, m[3], b));
  }
  if ((m = /^(?:device-)?width\s*:\s*(.+)$/i.exec(s))) {
    const v = len(m[1]);
    return v === null ? null : cmp(viewPx, '=', v);
  }
  // The block is a STILL of what the editor showed: no motion (a scroll-
  // reveal that waits for an observer the pasted block will never run left
  // thirteen sections of a page at opacity 0), and the editor's own light
  // scheme (a dark-mode host flipped a block's words light on its white
  // sheet). Decided here like a width.
  if ((m = /^prefers-reduced-motion(?:\s*:\s*(.+))?$/i.exec(s))) return !m[1] || m[1].trim() === 'reduce';
  if ((m = /^prefers-color-scheme\s*:\s*(.+)$/i.exec(s))) return m[1].trim() === 'light';
  return null;                                   // orientation, hover, height…
}

/** Resolve a whole @media prelude (a comma-separated OR list) at the design
 *  viewport: true = always on here, false = never on here, null = undecidable. */
function mediaVerdict(prelude, viewPx, medium = 'screen') {
  let anyTrue = false, allDecided = true;
  for (const q0 of prelude.split(',')) {
    const q = q0.trim().toLowerCase();
    if (!q) continue;
    if (/^not\s/.test(q)) { allDecided = false; continue; }   // inverted: leave it alone
    const type = (q.match(/^(?:only\s+)?(all|screen|print|speech|tty|tv|projection)\b/) || [])[1] || 'all';
    if (type !== 'all' && type !== medium) continue;          // the other medium/speech: never on here
    let ok = true;
    for (const f of q.match(/\([^)]*\)/g) || []) {
      const r = mediaFeature(f, viewPx);
      if (r === null) { allDecided = false; ok = false; break; }
      if (!r) { ok = false; break; }
    }
    if (ok) anyTrue = true;
  }
  return anyTrue ? true : (allDecided ? false : null);
}

/** Resolve @media at EXPORT time, at the width the report is composed against.
 *
 *  A media query in a pasted block is evaluated against the HOST page's
 *  viewport — but the block is a fixed-width design scaled into a column, and
 *  the two have nothing to do with each other. The Budget Primer's stylesheet
 *  says `@media (min-width:1120px){.page{zoom:1.25}}`: pasted into a desktop
 *  Squarespace page that fired, blew the page up to 1.25× inside a wrapper
 *  sized for 1×, and `overflow:hidden` clipped the right-hand inch. Its
 *  `@media (max-width:850px)` twin is the same trap in reverse — a phone would
 *  reflow the block into a layout the editor never showed.
 *
 *  So width queries are decided HERE, once, and the winning rules are inlined:
 *  the block carries exactly one layout, the one the editor showed, and no
 *  host viewport can switch it. `@media print` goes with them — a fragment in
 *  someone else's page is not a printed sheet, and its 8.5×11in overrides
 *  would fight the scale wrapper. Anything undecidable (orientation,
 *  prefers-*) is left standing rather than guessed at. */
function flattenMedia(css, viewPx, medium = 'screen') {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) { out.push(css.slice(i)); break; }
    const head = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (/^@media/i.test(head)) {
      const v = mediaVerdict(head.replace(/^@media/i, ''), viewPx, medium);
      if (v === true) out.push(flattenMedia(body, viewPx, medium));    // always on: inline
      else if (v === null) out.push(`${head}{${flattenMedia(body, viewPx, medium)}}`);
      // v === false: drop it entirely
    } else if (/^@(supports|layer|container)/i.test(head)) {
      out.push(`${head}{${flattenMedia(body, viewPx, medium)}}`);
    } else {
      out.push(`${head}{${body}}`);
    }
    i = j;
  }
  return out.join('');
}

/** vw is the same leak as a media query: a length that silently re-measures
 *  itself against whatever page the block was pasted into. Freeze it at the
 *  design viewport. (vh is left alone — a scaled block has no design viewport
 *  HEIGHT to freeze it against, and vh is vanishingly rare in a paged report.)
 *  The lookbehind keeps the substitution out of base64 data: URIs, where a
 *  run like "…A12vw+" would otherwise match. */
function freezeViewportUnits(css, viewPx) {
  return css.replace(/(?<![\w.#+/-])([\d.]+)vw\b/gi,
    (m, n) => +(parseFloat(n) * viewPx / 100).toFixed(2) + 'px');
}

/** Prefix every selector so pasted CSS cannot reach the host page — and,
 *  just as important, so the host's CSS cannot reach in. Squarespace styles
 *  h1/p/a globally; without scoping, a pasted block inherits them and stops
 *  looking like what the editor showed. @media/@supports recurse; @font-face
 *  and @keyframes are left alone (they name things, they do not select).
 *
 *  `bodySel` is where document-level rules (:root/html/body) land. In a block
 *  that is NOT the outer wrapper: the wrapper is as wide as the host's column,
 *  while the document those rules were written for is the fixed-width design
 *  box inside it. Sending `body{…}` to the wrapper made every body-level width,
 *  padding and centring rule measure against the wrong element. */
function scopeCss(css, sel, bodySel) {
  // Comments first, or they are read as part of the next selector: a
  // Google-Fonts sheet puts /* latin */ before every @font-face, and each one
  // came out as "#wrap /* latin */ @font-face{…}" — invalid, and it took the
  // font with it.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) { out.push(css.slice(i)); break; }
    const head = css.slice(i, open).trim();
    // Find this rule's matching close brace, counting nesting.
    let depth = 1, j = open + 1;
    while (j < css.length && depth) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (/^@(media|supports|layer|container)/i.test(head)) {
      out.push(`${head}{${scopeCss(body, sel, bodySel)}}`);
    } else if (head.startsWith('@')) {
      out.push(`${head}{${body}}`);                       // font-face, keyframes
    } else {
      const heads = head.split(',').map(h => {
        h = h.trim();
        if (!h) return h;
        // :root/html/body are the document itself — inside a block, that is
        // the element standing in for the document.
        if (/^(:root|html|body)$/i.test(h)) return bodySel || sel;
        return `${sel} ${h}`;
      }).filter(Boolean).join(',');
      out.push(`${heads}{${body}}`);
    }
    i = j;
  }
  return out.join('');
}

/** How wide the design ACTUALLY is, measured rather than assumed.
 *
 *  The old export took the page width straight out of the manifest — 8.5in →
 *  816px — and scaled to that. That number is a lie in three separate ways:
 *  the report may have been resized since it was built (layout.page), its CSS
 *  may zoom or otherwise scale the sheet, and a full-bleed element may sit
 *  wider than the sheet. Every one of those makes the wrapper narrower than
 *  its contents, and the wrapper's overflow:hidden then eats the right edge.
 *
 *  So: render the very bytes being exported into an offscreen iframe at the
 *  width the report is composed against, and read the width off the result.
 *  Whatever the CSS does, the number comes out the other side. */
async function measureDesignWidth(bodyHtml, css, viewPx) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;left:-99999px;top:0;border:0;visibility:hidden;'
                  + 'height:2000px;width:' + viewPx + 'px';
  document.body.appendChild(f);
  try {
    await new Promise(res => {
      f.addEventListener('load', res, { once: true });
      f.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">`
               // Hide the measuring frame's own scrollbar: it narrows the
               // layout viewport, and a stretch-to-fit wrapper then measures
               // 15px shy of full width — just enough to be mistaken for
               // content and set the design width 15px too wide.
               + `<style>html,body{margin:0}html{scrollbar-width:none}`
               + `::-webkit-scrollbar{width:0;height:0}</style>`
               + `<style>${css}</style></head>`
               + `<body>${bodyHtml}</body></html>`;
    });
    const d = f.contentDocument;
    try { await d.fonts.ready; } catch (e) { /* older engine: measure anyway */ }
    // The SHEET is the design. `<section class="page">` is the editor's one
    // hard structural requirement (docsync/scaffold.py), so every document it
    // can export has one — and its rendered width is the answer whatever the
    // CSS did to get there: a resize the manifest doesn't know about, a zoom,
    // a bleed page wider than its siblings. Everything OUTSIDE the sheet (the
    // toolbar, the download bar) is chrome that stretches to whatever width it
    // is handed, so it adapts to the block instead of defining it.
    let w = 0;
    for (const el of d.querySelectorAll('.page')) {
      w = Math.max(w, el.getBoundingClientRect().width);
    }
    // No sheet at all — an adopted web page rather than a paged report. Then
    // the design really is as wide as the viewport it was composed at.
    if (w < 1) w = d.documentElement.clientWidth || viewPx;
    return Math.ceil(w);
  } finally {
    f.remove();
  }
}

async function exportHtml(forSquarespace) {
  const label = forSquarespace ? 'Squarespace block' : 'HTML';
  tell(`building ${label}…`);
  try {
    const raw = await renderClean();
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    await inlineEverything(doc, { scripts: !forSquarespace });

    let out, name;
    if (!forSquarespace) {
      out = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      name = (M.id || 'report') + '.html';
    } else {
      // A Squarespace code block is a FRAGMENT living inside someone else's
      // page, so: no <html>/<head>/<body>, styles scoped to a wrapper, and —
      // the part that actually preserves the design — the wrapper is scaled
      // rather than reflowed. This document is absolutely positioned at a
      // fixed page width; letting it reflow would not be "the same page,
      // responsive", it would be a different page. Scaling keeps every
      // relationship exact and simply fits it to the column.
      const uid = 'dsx-' + Math.random().toString(36).slice(2, 8);
      // The design viewport: the width the report is composed against, which
      // is what every media query and vw length in its CSS was written for.
      const view = VIEW_W;
      let css = [...doc.querySelectorAll('style')].map(n => n.textContent).join('\n');
      css = freezeViewportUnits(flattenMedia(css, view), view);
      // The report's web fonts come along as links: a font stylesheet only
      // defines families (@font-face), so it cannot restyle the host page,
      // and without it the block set itself in whatever the host loads.
      const fonts = [...doc.querySelectorAll('link[rel~="stylesheet"]')].map(l => l.getAttribute('href') || '')
        .filter(h => /^https:\/\/fonts\.(googleapis|bunny)\.(com|net)\//i.test(h));
      doc.querySelectorAll('style, script, link').forEach(n => n.remove());
      // Inline styles carry the same vw leak as the stylesheet does.
      doc.querySelectorAll('[style]').forEach(el => {
        const s = el.getAttribute('style') || '';
        if (/vw\b/i.test(s)) el.setAttribute('style', freezeViewportUnits(s, view));
      });
      const body = doc.body.innerHTML;
      const design = (await measureDesignWidth(body, css, view))
                     || Math.round(PAGE_W_IN * DPI);      // fallback: the sheet itself
      out = `<!-- Exported from the draft editor. Paste into a Squarespace
     Code Block. Styles are scoped to #${uid}, so nothing here can affect the
     rest of the page and the page's own CSS cannot reach in. The block is
     SCALED to its column, not reflowed: it is a fixed ${design}px-wide design
     (measured at export, not assumed), so scaling is what keeps it identical.
     Its media queries and vw lengths were resolved at export too — a pasted
     block must not re-answer them against the host page's viewport. -->
<div id="${uid}" class="dsx-wrap">
${fonts.map(h => `<link rel="stylesheet" href="${h.replace(/"/g, '&quot;')}">`).join('\n')}
<style>
#${uid}.dsx-wrap { all:initial; display:block; width:100%; overflow:hidden; }
#${uid} .dsx-scale { transform-origin:top left; width:${design}px; display:flow-root; }
#${uid} * { box-sizing:border-box; }
${scopeCss(css, '#' + uid, '#' + uid + ' .dsx-scale')}
</style>
<div class="dsx-scale">
${body}
</div>
<script>
(function(){
  var w = document.getElementById('${uid}');
  var inner = w.querySelector('.dsx-scale');
  var DESIGN = ${design};        // measured at export from the real render
  var lastW = -1;
  function fit(force){
    var avail = w.clientWidth;
    // No width yet — the block is in a tab, an accordion or a container the
    // host has not laid out. Measuring that as zero and REMEMBERING it left
    // the whole report at scale(0): invisible, with nothing scheduled to try
    // again. Never latch it; wait for a signal that means something.
    if (avail <= 0) { lastW = -1; return; }
    if (!force && avail === lastW) return;
    lastW = avail;
    var s = Math.min(1, avail / DESIGN);
    inner.style.width = DESIGN + 'px';
    inner.style.transform = s === 1 ? 'none' : 'scale(' + s + ')';
    // Centre it. transform-origin is the top left, so a scaled box keeps the
    // UNSCALED box's left edge — in a column wider than the design that left
    // the block hard against the left margin, reading as skewed rather than
    // placed. Below the design width the scale already fills the column and
    // this is a no-op.
    inner.style.marginLeft = Math.max(0, (avail - DESIGN * s) / 2) + 'px';
    // The wrapper must take the SCALED height or the block leaves a gap
    // below it the size of the shrink.
    w.style.height = Math.ceil(inner.scrollHeight * s) + 'px';
  }
  fit(true);
  addEventListener('resize', function(){ fit(true); });
  if (window.ResizeObserver) new ResizeObserver(function(){ fit(); }).observe(w);
  // Height is only final once the things that occupy it have arrived. A fit()
  // run before the webfonts swap or the images decode measures a document
  // that is not the one the reader ends up with — and the wrapper keeps that
  // stale height, clipping the last page or leaving a gap under it.
  addEventListener('load', function(){ fit(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ fit(true); });
  Array.prototype.forEach.call(w.querySelectorAll('img'), function(im){
    if (!im.complete) im.addEventListener('load', function(){ fit(true); }, { once: true });
  });
  // A floor under all of it. ResizeObserver is driven by the frame loop, so a
  // host that renders the block in a background tab never delivers one — and
  // then the only fit that ever ran was the one at parse time.
  setTimeout(function(){ fit(true); }, 0);
  setTimeout(function(){ fit(true); }, 400);
})();
<\/script>
</div>
`;
      name = (M.id || 'report') + '-squarespace.html';
    }

    const blob = new Blob([out], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    tell(`downloaded ${name}`);
  } catch (e) {
    tell(`${label} export failed: ` + (e.message || e));
  } finally {
    await render();          // put the editable scaffolding back
  }
}

// A "source" download: the two authored files (content.md + layout.json) plus
// any images uploaded this session, zipped in the browser via fflate — an ~8kB
// ESM module loaded from the same CDN as Pyodide, so no build step and no new
// server dependency. This is the half of Export that STANDALONE.md left out:
// the raw material of the report, for anyone who wants the files without a git
// checkout. It only reads state the editor already holds, so it needs neither
// the local server nor a token, and works identically in local and hosted mode.
const baseName = p => p.split('/').pop();
async function downloadSource() {
  $('downloadpop').hidden = true;
  tell('zipping the source…');
  try {
    const { zipSync, strToU8 } =
      await import('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js');
    const files = {};
    files[baseName(M.content)] = strToU8(source);
    if (M.layout) files[baseName(M.layout)] = strToU8(JSON.stringify(layout, null, 2) + '\n');
    // Images uploaded this session live in localImages as data URLs; decode
    // each back to bytes and keep its assets/… path inside the zip.
    for (const [path, dataUrl] of localImages) {
      const b64 = String(dataUrl).split(',')[1] || '';
      files[path] = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }
    const blob = new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (M.id || 'report') + '-source.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    tell(`downloaded ${a.download}`);
  } catch (e) {
    tell('source download failed: ' + e.message);
  }
}

// ---------------------------------------------- more ways out (71)
// JPEG as well as PNG, just the selection, and a package: everything the
// local server's Chrome renders, re-encoded or cropped here (a canvas), so
// the server keeps its two formats and a page's pixels are made once.
const fflateLib = () => import('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js');
/** The server's answer to an export, or the reason there is none. Only a
 *  JSON body used to count as a failure: a crash page (500, HTML), a 404
 *  from some other server on the port, an empty 200 — each was saved as
 *  "Report.pdf" and announced as downloaded, and the person found out when
 *  the file would not open. A file is a file only when the status is good
 *  and the body is the kind asked for. */
async function exportAnswer(r, kinds) {
  const type = (r.headers.get('Content-Type') || '').toLowerCase();
  if (type.includes('application/json')) {
    let j = {}; try { j = await r.json(); } catch (e) {}
    throw new Error(j.error || `the server refused the export (HTTP ${r.status})`);
  }
  const text = async () => { try { return (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); } catch (e) { return ''; } };
  if (!r.ok) throw new Error(`the live server hit an error (HTTP ${r.status}) — nothing was downloaded. ${await text()}`.trim());
  if (!kinds.some(k => type.includes(k))) {
    throw new Error(`the server answered with ${type || 'no content type'} instead of a file — nothing was downloaded. `
      + `Is the live server still the editor's? ${await text()}`.trim());
  }
  const blob = await r.blob();
  if (!blob.size) throw new Error('the server answered with an empty file — nothing was downloaded');
  return blob;
}
async function exportBlob(body) {
  const r = await fetch('/__export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: M.id, content: source, layout: JSON.stringify(layout, null, 2) + '\n', ...body }) });
  return exportAnswer(r, body.fmt === 'pdf' ? ['application/pdf'] : ['application/zip', 'image/png', 'application/octet-stream']);
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  tell(`downloaded ${name}`);
}
/** A raster, re-encoded (JPEG on white — it has no transparency) and,
 *  given `crop` in pixels, cut to that box. */
async function reencode(blob, type, crop) {
  const bmp = await createImageBitmap(blob);
  const c = crop || { x: 0, y: 0, w: bmp.width, h: bmp.height };
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(c.w)); cv.height = Math.max(1, Math.round(c.h));
  const g = cv.getContext('2d');
  if (type === 'jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); }
  g.drawImage(bmp, Math.round(c.x), Math.round(c.y), cv.width, cv.height, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, type === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92));
}
async function exportPagesJpeg() {
  $('downloadpop').hidden = true;
  tell('rendering the pages as JPEG… (a full report takes a moment)');
  try {
    const { unzipSync, zipSync } = await fflateLib();
    const zip = unzipSync(new Uint8Array(await (await exportBlob({ fmt: 'png' })).arrayBuffer()));
    const out = {};
    for (const [n, bytes] of Object.entries(zip)) {
      const jpg = await reencode(new Blob([bytes], { type: 'image/png' }), 'jpeg');
      out[n.replace(/\.png$/i, '.jpg')] = new Uint8Array(await jpg.arrayBuffer());
    }
    saveBlob(new Blob([zipSync(out, { level: 0 })], { type: 'application/zip' }), `${exportBasename()}-pages-jpg.zip`);
  } catch (e) { tell('export failed: ' + e.message); }
}
/** The selection's box on its page, in inches, and that page's place. */
function selectionBox() {
  const d = $('out').contentDocument;
  const els = selEls(d);
  if (!els.length) return null;
  const pg = els[0].closest('section.page');
  const n = [...d.querySelectorAll('section.page')].indexOf(pg) + 1;
  const bs = els.filter(el => el.closest('section.page') === pg)
    .map(el => (el.dataset.shape ? shapeBox(el, pg) : inchBox(el, pg)));
  const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
  return { page: n, x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y };
}
async function exportSelection(type) {
  $('downloadpop').hidden = true;
  const box = selectionBox();
  if (!box) { tell('select what to export first'); return; }
  tell('rendering the selection…');
  try {
    const scale = 3, px = 96 * scale, pad = 0.04;          // a hair round it, so a stroke is not cut
    const png = await exportBlob({ fmt: 'png', page: box.page, scale });
    const out = await reencode(png, type, { x: (box.x - pad) * px, y: (box.y - pad) * px,
                                            w: (box.w + 2 * pad) * px, h: (box.h + 2 * pad) * px });
    saveBlob(out, `${exportBasename()}-selection.${type === 'jpeg' ? 'jpg' : 'png'}`);
  } catch (e) { tell('export failed: ' + e.message); }
}
/** Every @font-face the HTML loads: [{family, weight, style, url}]. */
function fontFaces(css) {
  const out = [];
  for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = m[1];
    const get = k => ((new RegExp(k + '\\s*:\\s*([^;]+)', 'i')).exec(body) || [])[1];
    const url = /url\((['"]?)(https?:[^'")]+)\1\)/.exec(body);
    if (!url) continue;
    out.push({ family: (get('font-family') || 'font').replace(/['"]/g, '').trim(), weight: (get('font-weight') || '400').trim(),
               style: (get('font-style') || 'normal').trim(), url: url[2], rule: m[0] });
  }
  return out;
}
/** A package: the PDF, every page as PNG, the self-contained HTML, and the
 *  fonts it loads with a stylesheet pointing at them — the folder a printer
 *  or a designer asks for. */
async function exportPackage() {
  $('downloadpop').hidden = true;
  tell('packaging: the PDF, the pages, the HTML and the fonts…');
  try {
    const { unzipSync, zipSync, strToU8 } = await fflateLib();
    const slug = exportBasename();
    const files = {};
    files[`${slug}.pdf`] = new Uint8Array(await (await exportBlob({ fmt: 'pdf' })).arrayBuffer());
    Object.entries(unzipSync(new Uint8Array(await (await exportBlob({ fmt: 'png' })).arrayBuffer())))
      .forEach(([n, b]) => { files[`pages/${n}`] = b; });
    const doc = new DOMParser().parseFromString(await renderClean(), 'text/html');
    const inl = await inlineEverything(doc, { fonts: true, scripts: true });
    files[`${slug}.html`] = strToU8('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
    // Faces whose bytes inlineWebFonts already holds, plus any @font-face still
    // pointing at a URL (fetched here, as before).
    const css = [...doc.querySelectorAll('style')].map(n => n.textContent).join('\n');
    const faces = [...inl.fonts, ...fontFaces(css)];
    let fontCss = '', got = 0;
    const names = new Set();
    for (const [i, f] of faces.entries()) {
      const ext = (/\.(woff2?|ttf|otf)(\?|$)/i.exec(f.url) || [, 'woff2'])[1].toLowerCase();
      let n = `${f.family.replace(/[^A-Za-z0-9]+/g, '-')}-${f.weight.replace(/\s+/g, '_')}${f.style === 'italic' ? '-italic' : ''}${f.subset ? '-' + f.subset : ''}`;
      if (names.has(n)) n += `-${i}`;
      names.add(n);
      try {
        const bytes = f.bytes || new Uint8Array(await (await fetch(f.url)).arrayBuffer());
        if (!bytes.length) continue;
        files[`fonts/${n}.${ext}`] = bytes;
        fontCss += f.rule.replace(f.url, `${n}.${ext}`) + '\n';
        got++;
      } catch (e) { /* a font that will not download is named in the README */ }
    }
    if (fontCss) files['fonts/fonts.css'] = strToU8(fontCss);
    const fams = [...new Set(faces.map(f => f.family))];
    const fontNote = inl.fontsLinked.length
      ? `Fonts NOT embedded: ${inl.fontsLinked.length} Google Fonts stylesheet${inl.fontsLinked.length === 1 ? '' : 's'} could not be fetched, so the HTML still links ${inl.fontsLinked.length === 1 ? 'it' : 'them'} (it needs a connection to show those fonts).`
      : (inl.fonts.length ? 'Fonts: embedded in the HTML as woff2 (latin and latin-ext subsets), and in fonts/.' : '');
    const scriptNote = inl.scriptsLeft.length
      ? `Scripts still loaded from elsewhere: ${inl.scriptsLeft.join(', ')}.`
      : (inl.scriptsInlined ? `${inl.scriptsInlined} script${inl.scriptsInlined === 1 ? '' : 's'} inlined into the HTML.` : '');
    files['README.txt'] = strToU8([
      `${slug} — package from the draft editor, ${new Date().toISOString().slice(0, 10)}`, '',
      `${slug}.pdf          the report as printed`,
      'pages/               every page as PNG',
      `${slug}.html         the report as one self-contained web page`,
      'fonts/               the font files the report loads, and fonts.css pointing at them',
      '', 'Fonts: ' + (fams.join(', ') || 'none beyond the system\'s'),
      `${got} of ${faces.length} font file${faces.length === 1 ? '' : 's'} included.`,
      ...(fontNote ? [fontNote] : []), ...(scriptNote ? [scriptNote] : []),
      'The Google Fonts used here are under the SIL Open Font License; check any other font\'s licence before passing it on.',
    ].join('\n') + '\n');
    saveBlob(new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }), `${slug}-package.zip`);
    // Said in the status line too, not only the README: a fallback is a decision
    // the person should see without opening the zip.
    tell($('stat').textContent + ` — ${got} font file${got === 1 ? '' : 's'} embedded`
      + (inl.fontsLinked.length ? `; fonts LINKED, not embedded (could not fetch ${inl.fontsLinked.length})` : '')
      + (inl.scriptsLeft.length ? '; a script is still external' : ''));
  } catch (e) { tell('package failed: ' + e.message); }
}

/** What an exported file should be CALLED.
 *
 *  The report as a person knows it — "Budget-Primer-FY2026-27.pdf" — not its
 *  slug. A PDF lands in a Downloads folder among a hundred others, where the
 *  id it happens to have inside this tool means nothing. It regressed to the
 *  id when multi-project support landed and the id became conveniently to
 *  hand; the test for it has been red ever since, saying so.
 *
 *  Falls back to the id when the registry has no display name, which is every
 *  project that was never given one. */
function exportBasename() {
  // M.id, not activeProjectId(): a per-project editor opened at its own URL
  // (/tax-testimony/edit.html) has no ?project= param, and activeProjectId's
  // fallback picks the base-less registry entry — the primer — so every other
  // report's export was downloading as Budget-Primer-FY2026-27.pdf. The
  // manifest that is actually loaded is the truth about what is being exported.
  const entry = REGISTRY && (REGISTRY[M && M.id] || REGISTRY[activeProjectId()]);
  const name = (entry && entry.name) || M.id || 'report';
  return String(name).trim().replace(/[\u02bb\u2018\u2019']/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
         || M.id || 'report';
}

