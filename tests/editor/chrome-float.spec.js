// The chrome that used to hold window height open floats over the canvas: the
// contextual card (#context, an overlay inside #work) and the page strip
// (#rail), in BOTH its states.
//
// The strip used to go back into the flex column when expanded, and this file
// pinned that. It was the right call while the only two options were an opaque
// 106px band or nothing: an opaque bar floating over the document would read
// as covering it. Translucency is the third option, and with it the band was
// the largest piece of standing chrome in the app — 12% of window height, the
// highest-contrast object on screen, holding room for something you look at
// between tasks rather than during one. So expanded now floats too, and what
// this file pins is the consequence: the canvas runs to the bottom of the
// window in both states, and applyZoom leaves room BELOW the iframe so the
// last page can still be scrolled clear of a strip that takes clicks. Local
// mode.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const geo = (page) => page.evaluate(() => {
  const r = id => {
    const b = document.getElementById(id).getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom };
  };
  const railCs = getComputedStyle(document.getElementById('rail'));
  return { bar: r('bar'), work: r('work'), rail: r('rail'), arrange: r('arrange'),
           ctx: r('context'), winH: window.innerHeight,
           railPos: railCs.position, railBg: railCs.backgroundColor,
           ctxEvents: getComputedStyle(document.getElementById('context')).pointerEvents };
});

const fold = async (page, want) => {
  const has = await page.locator('#rail').evaluate(el => el.classList.contains('folded'));
  if (has !== want) { await page.click('#rail-fold'); await page.waitForTimeout(450); }
};

test.describe('floating chrome', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  // One scrollbar, not two. The stage keeps a small vertical range of its own
  // (the clearance below the iframe that lets the last page rise above the
  // floating strip) — but the report iframe is the document's scroller, and a
  // bar for that 90-odd px stood full-height right beside the real one. The
  // range must survive; only the chrome goes.
  test('the canvas paints no scrollbar of its own beside the report’s',
    async ({ page }) => {
      const g = await page.evaluate(() => {
        const st = document.getElementById('stage');
        const d = document.getElementById('out').contentDocument;
        return { hidden: getComputedStyle(st).scrollbarWidth,
                 gutter: st.offsetWidth - st.clientWidth,
                 range: st.scrollHeight - st.clientHeight,
                 report: d.documentElement.scrollHeight - d.documentElement.clientHeight };
      });
      expect(g.hidden).toBe('none');    // no bar painted
      expect(g.gutter).toBe(0);         // and none reserved
      expect(g.range).toBeGreaterThan(0);    // the strip clearance is still there
      expect(g.report).toBeGreaterThan(100); // and the report still scrolls itself
    });

  test('the folded page strip floats: no ground, no clicks, canvas underneath',
    async ({ page }) => {
      await fold(page, true);
      const g = await geo(page);
      expect(g.railPos).toBe('absolute');
      // rgba(…, 0) — transparent, so the canvas shows through rather than a bar
      expect(g.railBg).toMatch(/, 0\)$|^transparent$/);
      // the document runs all the way to the bottom of the window
      expect(g.work.bottom).toBeCloseTo(g.winH, 0);
      // The control sits in the window's bottom-left CORNER. It only ever sat
      // inboard of that because the tool rail used to run the full height;
      // the rail stops after its last button now, so the corner is free.
      const foldX = await page.locator('#rail-fold').evaluate(el =>
        el.getBoundingClientRect().x);
      expect(foldX).toBeLessThan(30);
      // the chevron is still reachable through the pass-through strip
      await page.click('#rail-fold');
      await expect(page.locator('#rail')).not.toHaveClass(/folded/);
    });

  test('expanded, the strip floats too — translucent, over a full-height canvas',
    async ({ page }) => {
      await fold(page, false);
      const g = await geo(page);
      expect(g.railPos).toBe('absolute');
      // The canvas no longer stops above the strip: it runs under it.
      expect(g.work.bottom).toBeCloseTo(g.winH, 0);
      expect(g.rail.bottom).toBeCloseTo(g.winH, 0);
      // Translucent, not opaque — an alpha strictly between the two. A solid
      // fill here is the exact regression this test exists to catch, and so
      // is a fill so faint the chips lose their ground.
      const alpha = Number((g.railBg.match(/[\d.]+\)$/) || ['1)'])[0].slice(0, -1));
      expect(alpha).toBeGreaterThan(0.35);
      expect(alpha).toBeLessThan(1);
      // And the document can still be scrolled clear of it: applyZoom puts
      // the strip's own height below the iframe.
      const clear = await page.locator('#out').evaluate(el =>
        parseFloat(getComputedStyle(el).marginBottom) || 0);
      expect(clear).toBeGreaterThanOrEqual(g.rail.h - 1);
    });

  test('idle, the strip is dimmed; pointing at it brings it back', async ({ page }) => {
    await fold(page, false);
    const idle = await page.locator('#rail').evaluate(el =>
      parseFloat(getComputedStyle(el).opacity));
    expect(idle).toBeLessThan(0.8);
    await page.hover('#rail');
    await page.waitForTimeout(300);
    const live = await page.locator('#rail').evaluate(el =>
      parseFloat(getComputedStyle(el).opacity));
    expect(live).toBeCloseTo(1, 1);
  });

  test('the contextual card overlays the canvas, just under the top bar',
    async ({ page }) => {
      const g = await geo(page);
      // an overlay inside #work, not a band between #bar and #work
      expect(g.ctx.y).toBeGreaterThan(g.bar.bottom);
      expect(g.ctx.y).toBeLessThan(g.bar.bottom + 12);   // close, not welded
      expect(g.work.y).toBeCloseTo(g.bar.bottom, 0);     // #work starts at the bar
      // the overlay passes clicks through everywhere the card itself is not
      expect(g.ctxEvents).toBe('none');
    });

  // NB: this one passes against the pre-float code too — there was no card to
  // park under. What it discriminates is the float WITHOUT applyZoom's
  // scroll-padding on the iframe document: drop that and #arrange is what
  // answers the hit test here.
  test('scrolling an object into view does not park it under the card',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.click('#chart');
      await frame.locator('g[data-shape]').first().waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForTimeout(1200);
      const id = await page.evaluate(() => layout.shapes.find(s => s.kind === 'chart').id);
      await frame.locator(`g[data-shape="${id}"]`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const b = await frame.locator(`g[data-shape="${id}"]`).boundingBox();
      // Whatever answers a hit test at the top of the object must be the report,
      // not the editor's own toolbar — the exact failure charts.spec.js guards
      // against for the REPORT's sticky bar.
      const top = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.id || el.tagName : null;
      }, [b.x + b.width / 2, b.y + 6]);
      expect(top).toBe('out');
    });
});

// The two things present in BOTH fold states must not move when it toggles,
// and a render that happened while folded must not leave blank previews.
test.describe('page strip fold', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(1000);
  });

  const marks = (page) => page.evaluate(() => {
    const b = id => { const r = document.getElementById(id).getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) }; };
    return { head: b('rail-head'), fold: b('rail-fold') };
  });
  const thumbScale = (page) => page.evaluate(() => {
    const v = document.querySelector('.chip .chip-view');
    const w = v && v.shadowRoot && v.shadowRoot.firstElementChild;
    return w ? parseFloat((w.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]) : null;
  });

  test('the label and chevron stay on the same pixel through a fold',
    async ({ page }) => {
      await fold(page, false);
      const open = await marks(page);
      await fold(page, true);
      const closed = await marks(page);
      // They used to jump 67px across and ~40 down — the control running away
      // from the click that just hit it.
      expect(closed.head).toEqual(open.head);
      expect(closed.fold).toEqual(open.fold);
    });

  test('previews survive a render that happens while the strip is folded',
    async ({ page }) => {
      await fold(page, true);
      await page.evaluate(() => render());
      await settled(page);
      await fold(page, false);
      await page.waitForTimeout(600);
      // A folded strip hides #rail-list, so every preview host measures 0 wide.
      // Baking that in gave scale(0) — twelve blank chips on unfolding.
      const s = await thumbScale(page);
      expect(s).not.toBeNull();
      expect(s).toBeGreaterThan(0.01);
      await expect(page.locator('.chip-thumb.empty')).toHaveCount(0);
    });
});

// The arrange strip describes a SELECTION, so with nothing selected there is
// nothing for it to say and it stays away entirely. Insert Image moved to the
// left tool rail precisely so that hiding it costs nothing.
test.describe('selection-contextual arrange strip', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(700);
  });

  test('no selection, no card', async ({ page }) => {
    await expect(page.locator('#arrange')).toBeHidden();
    await expect(page.locator('#ar-pos')).toBeHidden();
    await page.evaluate(() => setSel($('out').contentDocument, ['cover.logo']));
    await page.waitForTimeout(400);
    await expect(page.locator('#arrange')).toBeVisible();
    await expect(page.locator('#ar-pos')).toBeVisible();
  });

  test('Insert Image lives in the left rail, reachable with nothing selected',
    async ({ page }) => {
      await expect(page.locator('#arrange')).toBeHidden();
      await expect(page.locator('#leftrail #ar-img')).toBeVisible();
      await expect(page.locator('#leftrail #ar-img')).toBeEnabled();
    });

  test('the tool rail ends after its last button, with nothing below it',
    async ({ page }) => {
      const g = await page.evaluate(() => {
        const rail = document.getElementById('leftrail');
        const r = rail.getBoundingClientRect();
        // :scope > — the rail also CONTAINS buttons that are not tools: the
        // Insert Image picker (#imgpop) is a child div holding an upload
        // button, and a bare `button:last-of-type` matched THAT first (it is
        // the last button of its own parent, and earlier in document order
        // than the last tool). Hidden, so its rect read all zeros and the
        // "nothing below the last tool" gap came back as the rail's own
        // bottom — 454px of imaginary emptiness under a rail that was fine.
        const last = rail.querySelector(':scope > button:last-of-type').getBoundingClientRect();
        const work = document.getElementById('work').getBoundingClientRect();
        const stage = document.getElementById('stage').getBoundingClientRect();
        return { railBottom: r.bottom, lastBottom: last.bottom, workBottom: work.bottom,
                 stageX: stage.x, workX: work.x,
                 after: getComputedStyle(rail, '::after').content };
      });
      // solid only as far as the tools go — not a full-height wall
      expect(g.railBottom).toBeLessThan(g.workBottom - 40);
      expect(g.railBottom - g.lastBottom).toBeLessThan(20);
      // the canvas runs underneath rather than starting where the rail ends
      expect(g.stageX).toBeCloseTo(g.workX, 0);
      // and nothing continues below the tools — no veil, no tint
      expect(g.after).toBe('none');
    });
});
