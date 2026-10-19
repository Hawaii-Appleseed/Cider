// A patched edit leaves a page that has scripts drawn as it was, in every
// bound report whose page carries a script.
//
// The editor's incremental render (patchPages) puts a re-rendered page in
// place of the old one WITHOUT running the scripts in it: a parsed node's
// <script> never executes, and a script that ran at load still holds the
// nodes it found then. So whatever a report's own script does to its page at
// load — an inline height, a class, a CSS variable, a scroll listener's
// state — is gone after an edit, while a full swap (the first render, or a
// render that changes nothing) runs it again. On our-mission that grew a
// carousel 0.98in and put the wrong icons over its numbered badges after ANY
// edit (our-mission-carousel.spec.js has the detail), and snapped the site
// nav out of its scrolled look. A page with no script cannot do this, so
// only reports with one are opened, and every page of each is probed:
//
//   scroll the page past its top (so a scroll listener has something to
//   say), let observers and timers land, freeze animations, and record every
//   element's box, opacity, visibility, display and colours; then patch that
//   page with an edit that reflows nothing — its background nudged by one
//   unit — and record it again, at the same scroll. Every element must be
//   where it was and as it was, and no picture a script drew (an element
//   with nothing inside it) may vanish. A wrapper a script put around words
//   may: the words are still drawn, by the elements this compares.
//
// Fix a failure in the project, not here: make the state plain CSS (FIVE_CSS
// in our-mission's renderer), or, for an effect that only means something
// while the page's script is live, hold it still under DOCSYNC_EDIT (its
// EDIT_CSS). A report is found by the scripts in its BUILT page; one whose
// script exists only in the editor's build would be missed.
// affected-by: projects/** docsync.yml docsync/layout.py docsync/blocks.py
const fs = require('fs');
const path = require('path');
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const REPO = path.resolve(__dirname, '../..');

/** Bound reports whose built page runs a script: JSON data blocks and import
 *  maps run nothing, so they do not count. */
const discover = () => {
  const yml = fs.readFileSync(path.join(REPO, 'docsync.yml'), 'utf8');
  const ids = [...yml.matchAll(/^ {2}- id: (\S+)$/gm)];
  return ids.map((m, i) => {
    const block = yml.slice(m.index, i + 1 < ids.length ? ids[i + 1].index : undefined);
    const out = block.match(/^ {6}out: (\S+)$/m);
    const file = out && path.join(REPO, out[1]);
    if (!file || !fs.existsSync(file)) return null;
    const html = fs.readFileSync(file, 'utf8');
    const body = html.slice(html.search(/<body[\s>]/i));
    const runs = [...body.matchAll(/<script\b([^>]*)>/gi)]
      .filter(s => !/type=["']?(application\/(ld\+)?json|importmap)/i.test(s[1]));
    return runs.length ? { id: m[1] } : null;
  }).filter(Boolean);
};
const REPORTS = discover();

test('the reports with page scripts were found', () => {
  const ids = REPORTS.map(r => r.id);
  for (const id of ['our-mission', 'rxkids']) expect(ids, ids.join(', ')).toContain(id);
});

/** Page `idx` as drawn: per element, an alignment key, its box in document
 *  pixels, and what decides whether and how it shows. */
const record = (page, idx) => page.evaluate((i) => {
  const d = document.getElementById('out').contentDocument;
  const w = d.defaultView;
  // A looping animation is caught mid-swing at a different point each time.
  d.getAnimations().forEach(a => {
    const t = a.effect && a.effect.getComputedTiming();
    if (t && t.iterations === Infinity) { a.pause(); a.currentTime = 0; }
    else { try { a.finish(); } catch (e) { /* never started */ } }
  });
  const sec = d.querySelectorAll('section.page')[i];
  // The editor's own marks painted into a page (the thumbnail strips them too).
  const chrome = typeof THUMB_STRIP === 'string' ? THUMB_STRIP : '.ds-cut';
  const els = [sec, ...sec.querySelectorAll('*')]
    .filter(e => !e.closest('script, style') && !e.closest(chrome));
  return {
    scrollY: w.scrollY,
    els: els.map(e => {
      const cs = w.getComputedStyle(e), r = e.getBoundingClientRect();
      const hook = e.getAttribute('data-slot') || e.getAttribute('data-el') || e.id || '';
      return {
        key: e.tagName.toLowerCase() + (hook ? '#' + hook : ''),
        name: e.tagName.toLowerCase() + (hook ? `[${hook}]` : '')
          + [...e.classList].slice(0, 3).map(c => '.' + c).join(''),
        leaf: !e.firstElementChild,
        box: cs.display === 'none' ? '' : [r.left + w.scrollX, r.top + w.scrollY, r.width, r.height]
          .map(v => Math.round(v * 2) / 2).join(' '),
        look: [cs.display, cs.visibility, cs.opacity, cs.color,
               e === sec ? '' : cs.backgroundColor].join(' | '),
        shows: cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0
          && r.width > 0 && r.height > 0,
      };
    }),
  };
}, idx);

/** Pair two element lists by their keys in order (longest common
 *  subsequence), leaving what only one side has unpaired. */
function align(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i].key === b[j].key ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [], onlyA = [], onlyB = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) pairs.push([a[i++], b[j++]]);
    else if (L[i + 1][j] >= L[i][j + 1]) onlyA.push(a[i++]);
    else onlyB.push(b[j++]);
  }
  return { pairs, onlyA: onlyA.concat(a.slice(i)), onlyB: onlyB.concat(b.slice(j)) };
}

for (const rep of REPORTS) {
  test(`${rep.id}: a patched edit leaves every page as it was drawn`, async ({ page }) => {
    test.setTimeout(240_000);
    await gotoEditor(page, rep.id === 'budget-primer' ? '' : `?project=${rep.id}`);
    const pages = await page.evaluate(() =>
      document.getElementById('out').contentDocument.querySelectorAll('section.page').length);
    const problems = [];
    for (let i = 0; i < pages; i++) {
      const pid = await page.evaluate((idx) => {
        const d = document.getElementById('out').contentDocument;
        const sec = d.querySelectorAll('section.page')[idx];
        d.__probeDoc = d.__probeDoc || Math.random().toString(36).slice(2);
        sec.__probe = true;
        d.defaultView.scrollTo(0, sec.getBoundingClientRect().top + d.defaultView.scrollY + 600);
        const m = sec.querySelector('[data-ds-mount]');
        return sec.dataset.page || (m && m.dataset.dsMount) || String(idx + 1);
      }, i);
      await page.waitForTimeout(700);              // observers, timers, rAF
      const before = await record(page, i);
      const how = await page.evaluate(async ([idx, p]) => {
        const doc = () => document.getElementById('out').contentDocument;
        const was = doc().__probeDoc;
        // One unit off the page's own colour: a patch that reflows nothing,
        // and too small a change to flip which ink the page sets.
        const bg = getComputedStyle(doc().querySelectorAll('section.page')[idx]).backgroundColor;
        const [r, g, b] = (bg.match(/\d+/g) || [255, 255, 255]).map(Number);
        const hex = '#' + [r, g, b > 0 ? b - 1 : 1].map(v => v.toString(16).padStart(2, '0')).join('');
        const res = await docsync.api.recolor('page.' + p, hex);
        const sec = doc().querySelectorAll('section.page')[idx];
        if (res && res.ok === false) return 'refused: ' + res.error;
        if (doc().__probeDoc !== was) return 'the document reloaded';
        if (sec.__probe) return 'the page was not replaced';
        return 'patched';
      }, [i, pid]);
      expect(how, `page ${i + 1}: the probe must patch the page in place`).toBe('patched');
      // A patch is not meant to scroll; put the window back so a slip there
      // does not read as every fixed element moving.
      await page.evaluate((y) => document.getElementById('out').contentDocument.defaultView.scrollTo(0, y),
        before.scrollY);
      await page.waitForTimeout(400);
      const after = await record(page, i);

      const { pairs, onlyA, onlyB } = align(before.els, after.els);
      for (const [x, y] of pairs) {
        if (x.box !== y.box) problems.push(`page ${i + 1} ${x.name}: box [${x.box}] -> [${y.box}]`);
        if (x.look !== y.look) problems.push(`page ${i + 1} ${x.name}: ${x.look} -> ${y.look}`);
      }
      onlyA.filter(e => e.leaf && e.shows)
        .forEach(e => problems.push(`page ${i + 1} ${e.name}: drawn before the edit, gone after`));
      onlyB.filter(e => e.leaf && e.shows)
        .forEach(e => problems.push(`page ${i + 1} ${e.name}: not there before the edit, drawn after`));
    }
    expect(problems).toEqual([]);
  });
}
