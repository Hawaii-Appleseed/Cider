// The published report at phone width. layout.py places elements by INCH
// against a sheet; a narrow screen keeps the inches and shrinks the sheet, so
// without layout.py's mobile_css() the placed things sit off the right-hand
// edge and on top of the flowing text — and `.page` is overflow:hidden, so a
// reader can neither scroll to what ran off nor see what it covered.
//
// This drives the PUBLISHED page (serve.py's /primer/), not the editor: no
// Pyodide, no boot, just the HTML a reader gets. Engine-side faces — the
// data-placed stamp, the shape layer that must never carry it, the reset
// riding out with the first layer() — are pinned in docsync/test_docsync.py.
// This is the end-to-end half: whatever those emit, does the real report
// actually lay out on a phone.
const { test, expect } = require('@playwright/test');

const PHONE = { width: 375, height: 812 };

/** Things a reader must be able to SEE whose box extends past the viewport.
 *
 *  Two exemptions, both of them design rather than damage. Decoration is
 *  allowed off the edge — a cover's ribbons are sized to bleed past the sheet
 *  and be trimmed by `.page`'s overflow, which is the whole point of them — so
 *  only elements carrying text or artwork count. And descendants of a scroller
 *  are exempt: a wide table is SUPPOSED to have content wider than its box,
 *  that being the fix rather than the bug, and its rows legitimately measure
 *  past the edge while the table itself does not.
 *
 *  That second exemption asks the COMPUTED overflow, not `[style*="overflow"]`.
 *  Matching an inline-style substring only ever recognised a scroller whose
 *  rule the engine had written onto the element itself, so blocks.py's
 *  chart_scroll() — which scrolls a chart from a stylesheet rule instead —
 *  read as a chart running off the page. The scroll container is the thing
 *  that matters here, not which file said so. */
const overflowing = (page) => page.evaluate(() => {
  const scrolled = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      if (p.classList.contains('page')) break;   // the sheet is not a scroller
    }
    return !!el.closest('table');
  };
  const readable = (el) => el.textContent.trim()
    || ['IMG', 'TABLE', 'SVG'].includes(el.tagName.toUpperCase());
  const bad = [...document.querySelectorAll('.page *')].filter((el) => {
    if (scrolled(el) || !readable(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > innerWidth + 2 || r.left < -2);
  });
  // Only the outermost offender of each nest: a wrapper that runs off the
  // edge drags every child with it, and listing all of them buries the cause.
  const set = new Set(bad);
  return bad.filter((el) => !set.has(el.parentElement)).map((el) => {
    const r = el.getBoundingClientRect();
    const cls = String(el.className.baseVal ?? el.className).slice(0, 40);
    return `${el.tagName}.${cls} right=${Math.round(r.right)} (viewport ${innerWidth})`;
  });
});

/** Pairs of text-bearing leaves that share more than a few px in both axes.
 *
 *  Two exclusions, both of them real: a closed <details> still has laid-out
 *  content stacked under its summary, and an SVG's <text> legitimately sits
 *  on top of the shapes it labels. Neither is a collision a reader sees. */
const overlaps = (page) => page.evaluate(() => {
  const out = [];
  const eligible = (el) => {
    const d = el.closest('details');
    if (d && !d.open) return false;
    if (el.closest('svg')) return false;
    if (el.querySelector('p,h1,h2,h3,h4,li,td,th,svg')) return false;
    if (!el.textContent.trim()) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  document.querySelectorAll('.page').forEach((pg, pi) => {
    const leaves = [...pg.querySelectorAll('p,h1,h2,h3,h4,li,td,th,span,div')]
      .filter(eligible);
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i]; const b = leaves[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 6 && oy > 6) {
          out.push(`page ${pi}: "${a.textContent.trim().slice(0, 30)}"`
            + ` over "${b.textContent.trim().slice(0, 30)}"`);
        }
      }
    }
  });
  return out;
});

test.describe('the published report on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/primer/');
    await page.locator('.page').first().waitFor();
  });

  test('nothing runs off the right-hand edge', async ({ page }) => {
    expect(await overflowing(page)).toEqual([]);
  });

  test('no text lands on top of other text', async ({ page }) => {
    expect(await overlaps(page)).toEqual([]);
  });

  test('placed elements are released into the flow, not merely hidden',
    async ({ page }) => {
      // The reset must work by un-pinning. Hiding the overflow instead would
      // satisfy both checks above while silently dropping content from the
      // phone edition, so assert the mechanism, not just the symptom.
      const placed = await page.evaluate(() => {
        const els = [...document.querySelectorAll('.page [data-placed]')];
        return {
          count: els.length,
          pinned: els.filter((e) => getComputedStyle(e).position !== 'static').length,
          hidden: els.filter((e) => getComputedStyle(e).display === 'none').length,
        };
      });
      expect(placed.count).toBeGreaterThan(0);
      expect(placed.pinned).toBe(0);
      expect(placed.hidden).toBe(0);
    });

  test('a table too wide to reflow scrolls instead of being clipped',
    async ({ page }) => {
      const tables = await page.evaluate(() => [...document.querySelectorAll('.page table')]
        .map((t) => ({ over: t.scrollWidth > t.clientWidth,
          scrollable: getComputedStyle(t).overflowX === 'auto' })));
      // Only meaningful if this report still HAS an over-wide table; if one
      // day none do, the guarantee is vacuous rather than broken.
      for (const t of tables.filter((x) => x.over)) expect(t.scrollable).toBe(true);
    });

  test('the desktop sheet is untouched', async ({ page }) => {
    // The reset is scoped to a screen too narrow for the sheet. Above that it
    // must not fire at all — a page that reflowed on a laptop would be a
    // regression dressed as a fix.
    await page.setViewportSize({ width: 1280, height: 900 });
    const pinned = await page.evaluate(() =>
      [...document.querySelectorAll('.page [data-placed]')]
        .filter((e) => getComputedStyle(e).position === 'absolute').length);
    expect(pinned).toBeGreaterThan(0);
  });
});

// A figure placed by INCH, on a report whose page really does narrow. The
// primer's own graphics are small, so the case needs a report that sets one
// at column width — the staff toolkit's are 7.26in. Its CSS used to carry the
// release by hand; docsync.blocks emits it now, so every report that places a
// figure by inch gets it rather than only the one that noticed.
test.describe('a graphic at phone width', () => {
  test('narrows to the page instead of being clipped by it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(
      'file://' + require('path').resolve(__dirname, '../../projects/staff-toolkit/index.html'));
    await page.locator('.page').first().waitFor();
    await page.waitForTimeout(400);

    const seen = await page.evaluate(() => {
      const pg = document.querySelector('.page').getBoundingClientRect();
      return [...document.querySelectorAll('.ds-graphic')].map(g => {
        const r = g.getBoundingClientRect();
        return { over: Math.round(r.right - pg.right), w: Math.round(r.width) };
      });
    });
    expect(seen.length).toBeGreaterThan(0);
    // Not one of them past the right-hand edge: .page is overflow:hidden, so
    // a figure wider than it is simply cut off, with nothing to scroll to it.
    expect(seen.filter(s => s.over > 1)).toEqual([]);
    expect(seen.every(s => s.w > 0)).toBe(true);
  });
});
