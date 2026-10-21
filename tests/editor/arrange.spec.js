// Arranging: what Align, Distribute, nudges and the layer steps do to the page.
//
// Found by driving every arrange operation over the bound reports and checking
// four things after each: the operation did what it says, nothing it did not
// touch moved, the page as rendered matches the page as dragged, and undo puts
// everything back (2026-10-18). Each test below is one way that failed; each
// fails on the editor before the fix. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** Run `fn(d, h)` in the editor, where `h` holds the measuring helpers. */
const inEditor = (page, fn, arg) => page.evaluate(async ([src, arg]) => {
  const d = document.getElementById('out').contentDocument;
  const h = {
    el: id => document.getElementById('out').contentDocument
      .querySelector(`[data-el="${CSS.escape(id)}"], [data-shape="${CSS.escape(id)}"]`),
    box(id) {
      const el = h.el(id), pg = el.closest('section.page'), b = inchBox(el, pg);
      return { x: +b.x.toFixed(3), y: +b.y.toFixed(3), w: +b.w.toFixed(3), h: +b.h.toFixed(3) };
    },
    words(id) {                      // where the first line of its words is
      const el = h.el(id), t = el.querySelector('[data-slot]') || el;
      const b = inchBox(t, el.closest('section.page'));
      return { x: +b.x.toFixed(3), y: +b.y.toFixed(3) };
    },
    settle: () => new Promise(r => setTimeout(r, 150)),
  };
  // eslint-disable-next-line no-new-func
  return await (new Function('d', 'h', 'arg', `return (${src})(d, h, arg);`))(
    document.getElementById('out').contentDocument, h, arg);
}, [fn.toString(), arg]);

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

test.describe('arranging', () => {
  test('what is under a paragraph stays put while it is moved, and after', async ({ page }) => {
    // The intro's <p> margin collapsed through its block in the flow, and the
    // strut held the block without it: the diagram under it rose 0.125in the
    // moment the paragraph was picked up, then dropped back on the render,
    // once the strut was re-measured with the margin inside.
    await gotoEditor(page, '?project=demo-report');
    const r = await inEditor(page, async (d, h) => {
      const dia0 = h.box('page1.diagram');
      setSel(d, ['para.page1.intro']);
      nudgeSel(d, [0, 0.3]);
      const live = h.box('page1.diagram');
      await render(); await h.settle();
      return { dia0, live, dia1: h.box('page1.diagram') };
    });
    expect(near(r.live.y, r.dia0.y), `in hand: diagram ${r.dia0.y} -> ${r.live.y}`).toBe(true);
    expect(near(r.dia1.y, r.dia0.y), `rendered: diagram ${r.dia0.y} -> ${r.dia1.y}`).toBe(true);
  });

  test('a paragraph lifted out of the flow keeps its words where they were', async ({ page }) => {
    // Its <p>'s top margin collapsed through the block in the flow and sat
    // inside it once placed: the words dropped by that margin on pick-up.
    await gotoEditor(page, '?project=uhero-trc-summary');
    const r = await inEditor(page, async (d, h) => {
      const w0 = h.words('para.groc.pay.p');
      setSel(d, ['para.groc.pay.p']);
      nudgeSel(d, [0, 0.1]);
      const live = h.words('para.groc.pay.p');
      await render(); await h.settle();
      return { w0, live, w1: h.words('para.groc.pay.p') };
    });
    expect(near(r.live.y - r.w0.y, 0.1), `in hand: words moved ${r.live.y - r.w0.y}`).toBe(true);
    expect(near(r.w1.y - r.w0.y, 0.1), `rendered: words moved ${r.w1.y - r.w0.y}`).toBe(true);
  });

  test('nudge, undo, nudge again: every nudge can be undone', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const r = await inEditor(page, async (d, h) => {
      const y0 = h.box('page1.h1').y;
      setSel(d, ['page1.h1']);
      nudgeSel(d, [0, 0.2]);
      await undo(); await h.settle();
      setSel(document.getElementById('out').contentDocument, ['page1.h1']);
      nudgeSel(document.getElementById('out').contentDocument, [0, 0.2]);   // inside the 0.9s burst
      await undo(); await h.settle();
      return { y0, y1: h.box('page1.h1').y, placed: !!layout.positions['page1.h1'] };
    });
    expect(r.placed, 'the second nudge was undone too').toBe(false);
    expect(near(r.y1, r.y0)).toBe(true);
  });

  test('distribute keeps the selection to its own extent', async ({ page }) => {
    // Sorted by left edge the order is A, B, C, but the selection ends at B's
    // right edge, not C's: the span was taken from the first and last by
    // position, and the three were spread over less than they occupy.
    await gotoEditor(page, '?project=demo-report');
    const r = await inEditor(page, async (d, h) => {
      const pid = pageOrder()[0];
      const ids = [];
      for (const [x, w] of [[0.6, 1], [2, 4], [3, 1]])
        ids.push((await docsync.api.addTextBox({ page: pid, x, y: 8, w, md: 'box' })).id);
      const dd = document.getElementById('out').contentDocument;
      setSel(dd, ids);
      distributeSel(dd, 'h');
      await render(); await h.settle();
      const bs = ids.map(i => h.box(i));
      return { lo: Math.min(...bs.map(b => b.x)), hi: Math.max(...bs.map(b => b.x + b.w)) };
    });
    expect(near(r.lo, 0.6), `left edge ${r.lo}`).toBe(true);
    expect(near(r.hi, 6), `right edge ${r.hi}`).toBe(true);
  });

  test('Align moves a group as one thing — to the page, or to the rest of the selection',
    async ({ page }) => {
      // A group's members used to be aligned like any other pieces: centring
      // a selected group on the page lined its members up with each other
      // instead, and aligning it with another box pulled it apart.
      await gotoEditor(page, '?project=demo-report');
      const r = await inEditor(page, async (d, h) => {
        const pid = pageOrder()[0];
        const add = async (x, y) => (await docsync.api.addTextBox({ page: pid, x, y, w: 1, md: 'g' })).id;
        const a = await add(1, 8), b = await add(2.5, 8.4), c = await add(4.5, 9.2);
        await docsync.api.group([a, b]);
        const dd = () => document.getElementById('out').contentDocument;
        const off = () => { const A = h.box(a), B = h.box(b); return [+(B.x - A.x).toFixed(2), +(B.y - A.y).toFixed(2)]; };
        const before = off();
        setSel(dd(), [a, b]);
        alignSel(dd(), 'hcenter');                     // the group alone: to the page
        await render(); await h.settle();
        const A1 = h.box(a), B1 = h.box(b);
        const centre = (Math.min(A1.x, B1.x) + Math.max(A1.x + A1.w, B1.x + B1.w)) / 2;
        const afterCentre = off();
        setSel(dd(), [a, b, c]);
        alignSel(dd(), 'left');                        // the group and a box
        await render(); await h.settle();
        return { before, afterCentre, centre, page: PAGE_W_IN / 2, afterLeft: off(),
                 groupLeft: Math.min(h.box(a).x, h.box(b).x), boxLeft: h.box(c).x };
      });
      expect(r.afterCentre, 'centring kept the group together').toEqual(r.before);
      expect(Math.abs(r.centre - r.page)).toBeLessThan(0.03);
      expect(r.afterLeft, 'aligning with a box kept the group together').toEqual(r.before);
      expect(Math.abs(r.boxLeft - r.groupLeft)).toBeLessThan(0.03);
    });

  test('Forward passes the next object even when layer numbers have gaps', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const r = await inEditor(page, async (d, h) => {
      const pid = pageOrder()[0];
      const a = (await docsync.api.addTextBox({ page: pid, x: 1, y: 8, w: 2, md: 'A' })).id;
      const b = (await docsync.api.addTextBox({ page: pid, x: 1.5, y: 8.1, w: 2, md: 'B' })).id;
      const c = (await docsync.api.addTextBox({ page: pid, x: 4, y: 8.4, w: 2, md: 'C' })).id;
      // Gapped, as Send to back and new objects leave them: A 2, B 3, C 7.
      boxOf(a).z = 2; boxOf(b).z = 3; boxOf(c).z = 7;
      markDirty(); await render(); await h.settle();
      const dd = document.getElementById('out').contentDocument;
      setSel(dd, [a]);
      await layerStep(dd, 1, false);
      h.el(a).scrollIntoView({ block: 'center' });
      await h.settle();
      const top = (() => {                  // what paints on top where A and B overlap
        const fr = document.getElementById('out'), pg = h.el(a).closest('section.page');
        const pr = pg.getBoundingClientRect(), px = DPI * zoomOf(pg);
        const hit = fr.contentDocument.elementFromPoint(pr.left + 1.7 * px, pr.top + 8.15 * px);
        return hit && (hit.closest('[data-el]') || {}).dataset ? hit.closest('[data-el]').dataset.el : null;
      })();
      return { a: zOf(a), b: zOf(b), c: zOf(c), top, ids: [a, b, c] };
    });
    expect(r.a, 'A is now above B').toBeGreaterThan(r.b);
    expect(r.a, 'and still below C').toBeLessThan(r.c);
    expect(r.top).toBe(r.ids[0]);
  });

  test('a card its row stretched keeps its height when it is moved', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('cover.fig.b');
      setSel(d, ['cover.fig.b']);
      nudgeSel(d, [0.1, 0]);
      await render(); await h.settle();
      return { b0, b1: h.box('cover.fig.b') };
    });
    expect(near(r.b1.h, r.b0.h), `height ${r.b0.h} -> ${r.b1.h}`).toBe(true);
  });

  test('a piece anchored inside a bordered container lands where it is put', async ({ page }) => {
    // The cover's figure grid has a 2px top border; the page's anchor script
    // measured from outside it and `top` counts from inside, so a figure
    // nudged 0.1in down landed 0.121in down.
    await gotoEditor(page, '?project=uhero-trc-summary');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('cover.fig.b');
      setSel(d, ['cover.fig.b']);
      nudgeSel(d, [0, 0.1]);
      await render(); await h.settle();
      return { b0, b1: h.box('cover.fig.b') };
    });
    expect(near(r.b1.y, r.b0.y + 0.1, 0.005), `y ${r.b0.y} -> ${r.b1.y}`).toBe(true);
  });

  test('a grid cell moved stays where it was across, and its neighbours keep their columns',
    async ({ page }) => {
      // A grid whose css puts its cells in columns of their own. Out of the
      // flow, such a cell was placed against its column, not the grid, and
      // jumped sideways. (UHERO's swap-table header was the case; it is a real
      // table now, 28bcb70, so the cover's figure grid is given columns here —
      // b in the third, c in the second — on every render.)
      await gotoEditor(page, '?project=uhero-trc-summary');
      await page.evaluate(() => {
        const prep = prepPreviewHtml;
        prepPreviewHtml = html => prep(html).replace('</head>', '<style>'
          + '.figs>[data-el="cover.fig.b"]{grid-column:3}.figs>[data-el="cover.fig.c"]{grid-column:2}</style></head>');
        return render();
      });
      const r = await inEditor(page, async (d, h) => {
        const b0 = h.box('cover.fig.b'), c0 = h.box('cover.fig.c');
        setSel(d, ['cover.fig.b']);
        nudgeSel(d, [0, 0.1]);
        await render(); await h.settle();
        return { b0, b1: h.box('cover.fig.b'), c0, c1: h.box('cover.fig.c') };
      });
      expect(r.b0.x, 'b sits right of c, by its css column').toBeGreaterThan(r.c0.x);
      expect(near(r.b1.x, r.b0.x), `x ${r.b0.x} -> ${r.b1.x}`).toBe(true);
      expect(near(r.b1.y, r.b0.y + 0.1), `y ${r.b0.y} -> ${r.b1.y}`).toBe(true);
      expect(near(r.c1.x, r.c0.x)).toBe(true);
    });

  // The UHERO summary's chapter pages were the suite's only fixture with a
  // paragraph split across CSS columns (para.ch3.p). The three-page summary
  // replaced them with a table, so no report draws one now. Needs a fixture.
  test.fixme('a paragraph split across two columns moves as one block a column wide', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const r = await inEditor(page, async (d, h) => {
      const el = h.el('para.ch3.p');
      const first = el.getClientRects()[0], pg = el.closest('section.page');
      const pr = pg.getBoundingClientRect(), px = DPI * zoomOf(pg);
      const x0 = (first.left - pr.left) / px, w0 = first.width / px;
      const pieces = el.getClientRects().length;
      setSel(d, ['para.ch3.p']);
      nudgeSel(d, [0, 0.1]);
      await render(); await h.settle();
      return { x0, w0, b1: h.box('para.ch3.p'), pieces };
    });
    expect(r.pieces, 'the paragraph does start out split').toBeGreaterThan(1);
    expect(near(r.b1.x, r.x0), `x ${r.x0} -> ${r.b1.x}`).toBe(true);
    expect(r.b1.w, 'one column wide, not the two columns its pieces spanned').toBeLessThan(r.w0 + 0.05);
  });

  test('a label that fits its line exactly does not wrap once its width is pinned', async ({ page }) => {
    // Rounded to the nearest hundredth the stat lost a thousandth of an inch,
    // wrapped to two lines, and its strut grew the whole meta row with it.
    await gotoEditor(page, '?project=tfc-2027-priorities');
    const r = await inEditor(page, async (d, h) => {
      const s0 = h.box('stat.disagree'), m0 = h.box('frame.meta');
      setSel(d, ['stat.disagree']);
      nudgeSel(d, [0.1, 0]);
      await render(); await h.settle();
      return { s0, s1: h.box('stat.disagree'), m0, m1: h.box('frame.meta') };
    });
    expect(near(r.s1.h, r.s0.h), `stat ${r.s0.h} -> ${r.s1.h}`).toBe(true);
    expect(near(r.m1.h, r.m0.h), `row ${r.m0.h} -> ${r.m1.h}`).toBe(true);
  });

  test('a footer its css pins by `bottom` stays its own height when moved', async ({ page }) => {
    await gotoEditor(page, '?project=retitc');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('pfoot.4');
      setSel(d, ['pfoot.4']);
      alignSel(d, 'top');
      await render(); await h.settle();
      return { b0, b1: h.box('pfoot.4') };
    });
    expect(near(r.b1.h, r.b0.h, 0.05), `height ${r.b0.h} -> ${r.b1.h}`).toBe(true);
  });

  test('a row lined up by baseline does not grow when an item leaves it', async ({ page }) => {
    await gotoEditor(page, '?project=staff-toolkit');
    const r = await inEditor(page, async (d, h) => {
      const f0 = h.box('pfoot.9');
      setSel(d, ['foot.pnum.9']);
      nudgeSel(d, [0, -0.5]);
      await render(); await h.settle();
      return { f0, f1: h.box('pfoot.9') };
    });
    expect(near(r.f1.h, r.f0.h), `footer ${r.f0.h} -> ${r.f1.h}`).toBe(true);
  });

  test('a picture moved out of its line leaves the line as tall as it was', async ({ page }) => {
    // An <img> on the baseline has the descender gap under it; a strut hung
    // from the line's top lost the gap, and the page under the photo rose.
    await gotoEditor(page);
    const r = await inEditor(page, async (d, h) => {
      const c0 = h.box('onetime.h3');
      setSel(d, ['onetime.photo']);
      nudgeSel(d, [0, 0.3]);
      await render(); await h.settle();
      return { c0, c1: h.box('onetime.h3') };
    });
    expect(near(r.c1.y, r.c0.y), `heading under it ${r.c0.y} -> ${r.c1.y}`).toBe(true);
  });

  test('align bottom on a page with no fixed height stays on the page', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const r = await inEditor(page, async (d, h) => {
      layout.page = { w: PAGE_W_IN, h: null };
      syncPageSize();
      markDirty(); await render(); await h.settle();
      const dd = document.getElementById('out').contentDocument;
      setSel(dd, ['page1.h1']);
      alignSel(dd, 'bottom');
      await render(); await h.settle();
      const pg = h.el('page1.h1').closest('section.page');
      const b = h.box('page1.h1');
      return { bottom: b.y + b.h, pageH: pg.getBoundingClientRect().height / (DPI * zoomOf(pg)) };
    });
    expect(r.bottom, `bottom at ${r.bottom}in on a ${r.pageH}in page`).toBeLessThanOrEqual(r.pageH + 0.01);
  });
  test('a pinned width is the width it had, whatever its css max-width says', async ({ page }) => {
    // rxkids' subtitle box: max-width 620px for its CONTENT, 40px of padding
    // a side. Pinned as a border box, the max-width capped the whole box 80px
    // short and the words rewrapped a line taller.
    await gotoEditor(page, '?project=rxkids');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('what.body');
      setSel(d, ['what.body']);
      nudgeSel(d, [0, 0.1]);
      await render(); await h.settle();
      return { b0, b1: h.box('what.body') };
    });
    expect(near(r.b1.w, r.b0.w), `width ${r.b0.w} -> ${r.b1.w}`).toBe(true);
    expect(near(r.b1.h, r.b0.h), `height ${r.b0.h} -> ${r.b1.h}`).toBe(true);
  });

  test('a margin its css marks !important does not push a placed piece off its spot', async ({ page }) => {
    await gotoEditor(page, '?project=rxkids');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('panel.cta');
      setSel(d, ['panel.cta']);
      nudgeSel(d, [0, 0.1]);
      const live = h.box('panel.cta');
      await render(); await h.settle();
      return { b0, live, b1: h.box('panel.cta') };
    });
    expect(near(r.live.y, r.b0.y + 0.1), `in hand ${r.b0.y} -> ${r.live.y}`).toBe(true);
    expect(near(r.b1.y, r.b0.y + 0.1), `rendered ${r.b0.y} -> ${r.b1.y}`).toBe(true);
  });

  test('a piece that already overhangs the page is not dragged sideways by a move down', async ({ page }) => {
    // A bar in the carousel's second slide is laid out past the page's right
    // edge (and clipped); the keep-it-on-the-page clamp pulled it a slide's
    // width left on a nudge straight down.
    await gotoEditor(page, '?project=rxkids');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('carousel.childcare.bar.single');
      setSel(d, ['carousel.childcare.bar.single']);
      nudgeSel(d, [0, 0.1]);
      await render(); await h.settle();
      return { b0, b1: h.box('carousel.childcare.bar.single') };
    });
    expect(near(r.b1.x, r.b0.x), `x ${r.b0.x} -> ${r.b1.x}`).toBe(true);
  });

  test('a designed piece with a css margin of its own lands where it is put', async ({ page }) => {
    // Already absolute in its css, with an 11px margin: the margin was taken
    // for part of its ancestor's offset, and the placement (margin:0) drew
    // it that much higher than the drag had it.
    await gotoEditor(page, '?project=rxkids');
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('what.scene.right');
      setSel(d, ['what.scene.right']);
      nudgeSel(d, [0, 0.1]);
      await render(); await h.settle();
      return { b0, b1: h.box('what.scene.right') };
    });
    expect(near(r.b1.y, r.b0.y + 0.1), `y ${r.b0.y} -> ${r.b1.y}`).toBe(true);
  });

  test('a report\'s entrance animation does not play again on every render', async ({ page }) => {
    // rxkids' panels rise and fade in (rxkIn, .35s). A render replaces the
    // page's nodes, so it replayed after every edit: the page flickered at
    // each keystroke and a piece just moved was measured mid-rise.
    await gotoEditor(page, '?project=rxkids');
    const running = await page.evaluate(async () => {
      const d = $('out').contentDocument;
      setSel(d, ['what.scene.right']); nudgeSel(d, [0, 0.1]);
      await render();
      return $('out').contentDocument.getAnimations()
        .filter(a => a.animationName === 'rxkIn' && a.playState === 'running').length;
    });
    expect(running).toBe(0);
  });

  test('icons line up by the box they are drawn in, not the stroke inside it', async ({ page }) => {
    // An icon's painted glyph sits inside its declared square: aligned by its
    // right edge with the stroke's width, the box it is drawn in overshot.
    await gotoEditor(page, '?project=eviction-code-guide');
    const r = await inEditor(page, async (d, h) => {
      const ids = ['p9-f1-cv', 'text.kick-9'];
      setSel(d, ids);
      alignSel(d, 'right');
      await render(); await h.settle();
      const icon = shapeOf('p9-f1-cv'), k = h.box('text.kick-9');
      return { iconRight: icon.x + icon.w, kickRight: k.x + k.w };
    });
    expect(near(r.iconRight, r.kickRight), `icon box ends at ${r.iconRight}, text box at ${r.kickRight}`).toBe(true);
  });

  // A guard more than a regression test: pinned widths round UP (so words
  // never wrap), and a strut that rounded up with them took the difference
  // from its flexible neighbours.
  test('a strut in a flex row holds the width it stood in for, so its neighbours keep theirs',
    async ({ page }) => {
      await gotoEditor(page, '?project=dotax-itep');
      const r = await inEditor(page, async (d, h) => {
        const a0 = h.box('stat.a');
        setSel(d, ['stat.b', 'stat.c', 'stat.d']);
        alignSel(d, 'left');
        const live = h.box('stat.a');
        await render(); await h.settle();
        return { a0, live, a1: h.box('stat.a') };
      });
      expect(near(r.live.w, r.a0.w, 0.006), `in hand ${r.a0.w} -> ${r.live.w}`).toBe(true);
      expect(near(r.a1.w, r.a0.w, 0.006), `rendered ${r.a0.w} -> ${r.a1.w}`).toBe(true);
    });
  test('a Budget Primer branch card moved stays where it is dropped', async ({ page }) => {
    // The renderer marked the card with L.tag() and wrote its own style
    // (its background) without L.style(), so its placement never reached
    // the page: it dragged, then snapped back on the render. Its photo and
    // the cards around it stay where they were (its strut holds the slot).
    await gotoEditor(page);
    const r = await inEditor(page, async (d, h) => {
      const b0 = h.box('branch.executive'), p0 = h.box('branch.photo.executive');
      const n0 = h.box('branch.oha');
      setSel(d, ['branch.executive']);
      nudgeSel(d, [0.2, 0.3]);
      await render(); await h.settle();
      return { b0, b1: h.box('branch.executive'), p0, p1: h.box('branch.photo.executive'),
               n0, n1: h.box('branch.oha') };
    });
    expect(near(r.b1.x, r.b0.x + 0.2) && near(r.b1.y, r.b0.y + 0.3),
      `card ${r.b0.x},${r.b0.y} -> ${r.b1.x},${r.b1.y}`).toBe(true);
    expect(near(r.p1.y, r.p0.y) && near(r.p1.x, r.p0.x), 'its photo stayed').toBe(true);
    expect(near(r.n1.y, r.n0.y), 'the next card stayed').toBe(true);
  });
});
