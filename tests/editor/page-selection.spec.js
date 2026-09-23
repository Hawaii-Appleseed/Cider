// A page is a thing you can pick up: clicking its background selects it (ring
// round the sheet, its own toolbar with the colour and Duplicate), and
// right-clicking gives a MENU rather than dropping colour swatches straight in
// — the page used to be the only surface in the editor whose right-click was a
// picker. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** A point on a page where hitPlaced() finds nothing — the exact condition
 *  that routes a click to the page instead of to an object. */
async function bareSpot(page) {
  const pt = await page.evaluate(() => {
    const out = document.getElementById('out');
    const r = out.getBoundingClientRect();
    const d = out.contentDocument;
    const sc = r.width / out.offsetWidth;
    for (const pg of d.querySelectorAll('section.page')) {
      const pr = pg.getBoundingClientRect();
      if (pr.bottom < 0 || pr.top > d.defaultView.innerHeight) continue;
      for (let y = pr.bottom - 24; y > pr.top + 24; y -= 10) {
        for (let x = pr.right - 24; x > pr.left + 24; x -= 20) {
          if (y < 0 || y > d.defaultView.innerHeight) continue;
          if (hitPlaced(d, pg, { clientX: x, clientY: y })) continue;
          const el = d.elementFromPoint(x, y);
          if (!el || el.closest('a, button, input, .ds-menu')) continue;
          const top = { x: r.left + x * sc, y: r.top + y * sc };
          // ...and the click has to actually REACH the canvas. The page strip
          // floats over the bottom of it now, so a spot that is bare on the
          // page can still sit under a page chip — which is not a bare spot
          // for a person either, and a helper that returned one would be
          // reporting a UI regression as a page-selection bug.
          const over = document.elementFromPoint(top.x, top.y);
          if (over !== out) continue;
          return top;
        }
      }
    }
    return null;
  });
  if (!pt) throw new Error('no bare spot on any visible page');
  return pt;
}

test.describe('page selection', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(900);
  });

  test('clicking the background selects the page and shows its toolbar',
    async ({ page }) => {
      const pt = await bareSpot(page);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(500);
      const st = await page.evaluate(() => ({
        selPage,
        ring: !!document.getElementById('out').contentDocument.querySelector('.ds-pagesel'),
        arrange: !document.getElementById('arrange').hidden,
        label: document.getElementById('ar-pagelabel').textContent,
        fill: !document.getElementById('ar-fill').hidden,
        dup: !document.getElementById('ar-pagedup').hidden,
        posHidden: document.getElementById('ar-pos').hidden,
      }));
      expect(st.selPage).not.toBeNull();
      expect(st.ring).toBe(true);           // a quiet outline round the sheet
      expect(st.arrange).toBe(true);
      expect(st.label).toMatch(/^Page \d+$/);
      expect(st.fill).toBe(true);           // recolour, in hand
      expect(st.dup).toBe(true);
      // …and nothing that only makes sense for an object
      expect(st.posHidden).toBe(true);

      // Selecting an OBJECT takes the page selection away again — the two are
      // one state between them, not two that can both be on.
      await page.evaluate(() => setSel($('out').contentDocument, ['cover.logo']));
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => selPage)).toBeNull();
      await expect(page.locator('#ar-pagedup')).toBeHidden();
    });

  test('right-click gives the page menu, not a colour picker', async ({ page }) => {
    const pt = await bareSpot(page);
    await page.mouse.click(pt.x, pt.y, { button: 'right' });
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const m = d.querySelector('.ds-menu');
      return m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()) : null;
    });
    expect(rows).toEqual(expect.arrayContaining(
      ['Copy', 'Copy page style', 'Paste', 'Duplicate page']));
    // the colour is still reachable — behind a row, like every other submenu
    expect(rows.some(r => r.startsWith('Page colour'))).toBe(true);
  });
});

test.describe('duplicate page', () => {
  test('clones the movable layer onto a new page after this one',
    async ({ page }) => {
      await gotoEditor(page);
      await page.waitForTimeout(900);
      await page.evaluate(() => addBlankPage());
      await page.waitForTimeout(2000);
      const bid = await page.evaluate(() => pageBlanks()[pageBlanks().length - 1].id);
      await page.evaluate(pid => {
        pushHistory();
        layout.shapes.push({ id: freeTId(), page: pid, kind: 'rect',
                             x: 1, y: 1, w: 2, h: 1, fill: '#6B9E78', z: 2 });
        layout.fill = layout.fill || {};
        layout.fill['page.' + pid] = '#EAF3EC';
        markDirty();
      }, bid);
      await page.evaluate(() => render());
      await page.waitForTimeout(2500);

      const before = await page.evaluate(() => ({
        pages: pageOrder().length, shapes: layout.shapes.length }));
      const srcIdx = await page.evaluate(pid => pageOrder().indexOf(pid), bid);
      await page.evaluate(pid => duplicatePage(pid), bid);
      await page.waitForTimeout(3000);

      const after = await page.evaluate(() => {
        const order = pageOrder();
        return { pages: order.length, shapes: layout.shapes.length,
                 newPid: selPage, idx: order.indexOf(selPage),
                 onNew: layout.shapes.filter(s => String(s.page) === String(selPage)).length,
                 fill: (layout.fill || {})['page.' + selPage],
                 ids: layout.shapes.map(s => s.id) };
      });
      expect(after.pages).toBe(before.pages + 1);
      expect(after.idx).toBe(srcIdx + 1);        // right after the original
      expect(after.shapes).toBe(before.shapes + 1);
      expect(after.onNew).toBe(1);
      expect(after.fill).toBe('#EAF3EC');        // the sheet's colour comes too
      // Fresh ids: a copy that shared them would be two views of one object.
      expect(new Set(after.ids).size).toBe(after.ids.length);
      // and the copy is what is now selected
      expect(after.newPid).toBe(await page.evaluate(() => selPage));
    });
  test('the copy gets its own toggle, and no anchor to the old page\'s text',
    async ({ page }) => {
      await gotoEditor(page);
      await page.waitForTimeout(900);
      await page.evaluate(() => addBlankPage());
      await page.waitForTimeout(2000);
      const bid = await page.evaluate(() => pageBlanks()[pageBlanks().length - 1].id);
      await page.evaluate(pid => {
        pushHistory();
        boxes().push({ id: 'tgt1', page: pid, x: 1, y: 3, w: 3, md: 'Details' });
        boxes().push({ id: 'btn1', page: pid, x: 1, y: 1, w: 3, md: 'Show',
                       act: 'toggle', target: 'tgt1' });
        boxes().push({ id: 'anc1', page: pid, x: 5, y: 1, w: 2, md: 'Figure',
                       anchor: { to: 'cover.title', dy: 0.2 } });
        markDirty();
      }, bid);
      await page.evaluate(() => render());
      await page.waitForTimeout(2500);

      await page.evaluate(pid => duplicatePage(pid), bid);
      await page.waitForTimeout(3000);

      const copies = await page.evaluate(() =>
        boxes().filter(b => String(b.page) === String(selPage)));
      expect(copies).toHaveLength(3);
      const btn = copies.find(b => b.act === 'toggle');
      const tgt = copies.find(b => b.md === 'Details');
      // The button opens the content it was copied WITH, not the original's.
      expect(btn.target).toBe(tgt.id);
      expect(btn.target).not.toBe('tgt1');
      // And nothing on the copy claims to follow a paragraph on another page.
      expect(copies.find(b => b.md === 'Figure').anchor).toBeUndefined();
      // The original is untouched: still its own button, its own content.
      const src = await page.evaluate(pid =>
        boxes().filter(b => String(b.page) === String(pid)), bid);
      expect(src.find(b => b.act === 'toggle').target).toBe('tgt1');
      expect(src.find(b => b.md === 'Figure').anchor.to).toBe('cover.title');
    });
});
