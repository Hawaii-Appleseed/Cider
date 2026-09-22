// Text a reader can actually read, measured where the reader is.
//
// The recurring failure this pins: type that is fine on the screen it was
// designed on and unreadable everywhere else. One page has three sizes and
// only one of them gets looked at during design —
//
//   * desktop screen: primer.css puts `zoom: 1.25` on `.page` above 1120px,
//     so every review of a wide window sees 125% of what anyone else does;
//   * print / PDF: no zoom, 1in = 96px, so a 13.5px paragraph is 10.1pt;
//   * phone or Squarespace embed: `.page{max-width:100%}` shrinks an 8.5in
//     sheet to 375px — 0.42x. HTML text does NOT shrink with it (a px is a
//     px), but every SVG with a viewBox does, so chart labels alone collapse.
//     That asymmetry is why charts are the thing that keeps going wrong. The
//     phone case passes because blocks.py's chart_scroll() stops each chart
//     shrinking at the width where its smallest label reaches the floor and
//     scrolls the wrapper instead — NOT because SVG text is naturally safe
//     here. A chart added without that wrapper fails this test at 375px.
//
// docsync/check.py catches what can be read out of the markup: an inch-sized
// chart label, an inline font-size. It cannot resolve a CLASS to a size, and
// it cannot know the 0.42x. This spec measures what the browser computed, on
// real page content, at the widths people actually read at — which is the
// only place the scaled and the cascaded cases are visible at all.
//
// Floors live in docsync/layout.py (MIN_TEXT_PT and friends) so the renderer's
// clamps, docsync.check and this spec can never disagree about the line.
const { test, expect } = require('@playwright/test');

// The four contexts, in the unit the reader's eye is in. Screen widths are
// judged in CSS px; print is judged in points on paper.
const CONTEXTS = [
  { name: 'phone', width: 375, height: 812, print: false },
  { name: 'tablet', width: 768, height: 1024, print: false },
  { name: 'desktop', width: 1400, height: 1000, print: false },
  { name: 'print', width: 1400, height: 1000, print: true },
];

// MIN_TEXT_PX / MIN_TEXT_PT in docsync/layout.py. 10.5px is the smallest size
// the engine will render; 7.875pt is what that is on paper. The screen floor
// is stated in px and the print floor in points because those are the units
// each is actually read in — collapsing them into one number is how "0.07"
// came to look like a reasonable setting for five-point type.
const FLOOR = {
  screen: 10.5,    // CSS px — MIN_TEXT_PX exactly; nothing on any screen below
  print: 7.8,      // pt on paper — MIN_TEXT_PT, with a hair for float noise
};

// The floor protects READING, and an icon is not reading.
//
// screen was 10 until 2026-08-20, half a pixel under the engine's own
// MIN_TEXT_PX. That gap had already let one real defect through: chart labels
// rendering at 10.1px cleared 10 and only tripped the PRINT floor, so the same
// bug was caught on paper and missed on every screen. Tightening it to 10.5
// broke exactly one thing across all ten bound reports — a decorative ▼
// disclosure triangle on rxkids, sized `0.8em` in the verbatim-ingested
// Squarespace markup, which multiplies down to 10.0px.
//
// Failing a page over a chevron while a 9px brand LABEL sails past is
// backwards, so runs carrying no letter and no digit are exempt: a triangle, a
// chevron, a bullet, a multiplication sign. Prose always has a letter or a
// digit in it, so this cannot hide a sub-floor sentence — our-mission's 9px
// .px-brand-tag stays caught, its 9px .px-chevron no longer does.
const isIconGlyph = (text) => !/[\p{L}\p{N}]/u.test(text);


/** Every text run inside a sheet, with the size the browser actually computed.
 *
 *  SVG is measured through getScreenCTM() rather than by its font-size: a
 *  chart's font-size is in the page's INCH coordinates, so the attribute says
 *  0.13 and the reader sees whatever the current sheet scale makes of it.
 *  That product is the entire point of this file. */
const runs = (page) => page.evaluate(() => {
  const out = [];
  const label = (el) => {
    const cls = String(el.className?.baseVal ?? el.className ?? '').slice(0, 30);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls.split(/\s+/)[0] : ''}`;
  };
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };

  document.querySelectorAll('.page').forEach((pg) => {
    // HTML: only elements holding their OWN text, so a paragraph is measured
    // once rather than once per ancestor that contains it.
    pg.querySelectorAll('*').forEach((el) => {
      if (el.closest('svg') || el.closest('.noprint')) return;
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim())
        .join(' ').trim();
      if (!own || !shown(el)) return;
      out.push({
        kind: 'html',
        px: parseFloat(getComputedStyle(el).fontSize),
        what: label(el),
        text: own.slice(0, 34),
      });
    });

    // SVG: font-size is in user units; the CTM turns it into screen px.
    pg.querySelectorAll('svg text, svg tspan').forEach((t) => {
      const txt = t.textContent.trim();
      if (!txt || !t.getScreenCTM || !shown(t)) return;
      const m = t.getScreenCTM();
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) /
        (window.devicePixelRatio || 1);
      out.push({
        kind: 'svg',
        px: parseFloat(getComputedStyle(t).fontSize) * scale,
        what: label(t),
        text: txt.slice(0, 34),
      });
    });
  });
  return out;
});

/** One line per offender, smallest first, deduped by size and element.
 *
 *  A stylesheet rule that is too small is too small once, however many
 *  paragraphs it reaches — listing all 54 of them buries the one fix. */
const report = (bad, unit) => {
  const seen = new Map();
  for (const r of bad.sort((a, b) => a.size - b.size)) {
    const key = `${r.size.toFixed(1)}|${r.what}`;
    if (!seen.has(key)) seen.set(key, { ...r, n: 0 });
    seen.get(key).n += 1;
  }
  return [...seen.values()].map((r) =>
    `  ${r.size.toFixed(1)}${unit}  ${r.kind.padEnd(4)} ${r.what.padEnd(18)}`
    + ` ${JSON.stringify(r.text)}${r.n > 1 ? `  (x${r.n})` : ''}`).join('\n');
};

// EVERY bound report, not just the primer.
//
// This file measured `/primer/` alone until 2026-08-20, and two shipped pages
// were carrying the exact defect it exists to catch: rxkids-fiscal drew chart
// labels at 11.5 user units on an 820-unit viewBox rendered at 7.5in — 10.1px
// on screen, 7.6pt on paper — and its footnote markers inherited the UA
// sheet's `font-size: smaller` down to 10.3px. docsync.check passed both:
// it reads AUTHORED sizes out of the markup and cannot know either the
// viewBox conversion or the cascade. Only a computed measurement sees them,
// so the measurement has to cover every report, not one.
//
// Reports are discovered from docsync.yml, so a new one is covered the day it
// is bound rather than whenever someone remembers this file. docsync.yml is
// read with a small regex rather than a YAML parser: this repo has no yaml
// dependency, and adding one for two fields is not worth it.
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../..');

const discoverReports = () => {
  const yml = fs.readFileSync(path.join(REPO, 'docsync.yml'), 'utf8');
  const out = [];
  const ids = [...yml.matchAll(/^ {2}- id: (\S+)$/gm)];
  ids.forEach((m, i) => {
    const block = yml.slice(m.index, i + 1 < ids.length ? ids[i + 1].index : undefined);
    const built = block.match(/^ {6}out: (\S+)$/m);
    if (!built) return;
    const file = path.join(REPO, built[1]);
    // A bound report that has never been built is not a legibility failure —
    // it is nothing to measure. Skipped loudly via the count assertion below.
    if (fs.existsSync(file)) out.push({ id: m[1], file });
  });
  return out;
};

const REPORTS = discoverReports();

// The primer is reached over the dev server, the way a reader reaches it —
// docs/primer/index.html is what `make pub` publishes, and it is the one
// report serve.py hosts. Every other binding builds to projects/<id>/, which
// serve.py does not host at all, so those are opened as files. They are
// self-contained pages; nothing about a font SIZE depends on the origin.
const targetFor = (r) => (r.id === 'budget-primer' ? '/primer/' : `file://${r.file}`);

// Known sub-floor text: page:context -> the EXACT offenders ("9.0px
// div.px-brand-tag"), as report() prints them without their text.
//
// Each entry is a real defect a reader gets today, listed so the suite stays
// green for work nobody has scheduled. It used to be a test.fail() per page,
// and that let a worse defect through: a page expected to fail passes for
// failing for ANY reason, so tax-testimony's chart collapsing to 5px labels on
// a phone and tablet rode in under an entry that only named a 9.9px "Sources"
// label (found 2026-09-22). Now an entry excuses exactly what it names:
//
//   * anything NOT named fails the test, as on a page with no entry;
//   * a named offender that is gone fails too — the page was fixed, so delete
//     the name. The list only ever shrinks.
//
// NEVER add a name to silence a new failure — that is the defect this file
// exists to stop. Empty since 2026-09-22: every entry was fixed.
const KNOWN_SUB_FLOOR = new Map([
]);

test('every bound report was discovered and built', () => {
  // An empty or truncated list must never read as green: that would be this
  // spec silently measuring nothing, which is how the gap opened last time.
  expect(REPORTS.length, `reports discovered in docsync.yml: `
    + REPORTS.map((r) => r.id).join(', ')).toBeGreaterThan(5);
});

for (const ctx of CONTEXTS) {
  for (const rep of REPORTS) {
    test.describe(`${rep.id} at ${ctx.name}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: ctx.width, height: ctx.height });
        if (ctx.print) await page.emulateMedia({ media: 'print' });
        await page.goto(targetFor(rep));
        await page.locator('.page').first().waitFor();
        // Charts and any late layout settle before anything is measured — a
        // size read mid-render is a size nobody ever sees.
        await page.waitForTimeout(400);
      });

      test('no text falls below the legibility floor', async ({ page }) => {
        const known = KNOWN_SUB_FLOOR.get(`${rep.id}:${ctx.name}`) || [];

        const all = await runs(page);
        // A page with no measurable text means the harness broke, not that the
        // report passed — an empty result must never read as green. The bar is
        // low on purpose: it is set by the SMALLEST bound report (a freshly
        // scaffolded template renders about ten runs), not by the primer's
        // several hundred. Its job is to catch "measured nothing", and a
        // threshold tuned to the biggest report just fails the small ones.
        expect(all.length, 'text runs found on the page').toBeGreaterThan(5);

        // On paper a CSS px is 0.75pt: the sheet is drawn at 96px to the inch
        // and the zoom rule is out of play in print.
        const unit = ctx.print ? 'pt' : 'px';
        const floor = ctx.print ? FLOOR.print : FLOOR.screen;
        const bad = all
          .map((r) => ({ ...r, size: ctx.print ? r.px * 0.75 : r.px }))
          .filter((r) => r.size < floor - 0.05)
          .filter((r) => !isIconGlyph(r.text));

        const named = (r) => `${r.size.toFixed(1)}${unit} ${r.what}`;
        const fresh = bad.filter((r) => !known.includes(named(r)));
        const fixed = known.filter((k) => !bad.some((r) => named(r) === k));

        expect(fresh.length === 0 ||
          `text below the ${floor}${unit} floor in ${rep.id} at ${ctx.name} `
          + `(${ctx.width}px viewport):\n${report(fresh, unit)}`).toBe(true);
        expect(fixed.length === 0 ||
          `fixed, so delete from KNOWN_SUB_FLOOR['${rep.id}:${ctx.name}']: `
          + fixed.join('; ')).toBe(true);
      });
    });
  }
}
