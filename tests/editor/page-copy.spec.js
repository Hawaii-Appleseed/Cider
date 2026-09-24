// A designed page's content is the renderer's, so Duplicate page used to hand
// back a blank sheet with the movable layer copied and a status line saying
// the designed content stayed put. Now it snapshots the page (docsync/
// pagecopy.py): every heading, card and label on the copy is a slot or an
// element under copy.<bid>., editable, movable and hideable like the
// original's, and redrawn from content.md on every render. The second half
// here is the other "AI-generated element" nobody could edit on the page: a
// label drawn inside a chart's SVG. slot_attr on an SVG <text> now edits in
// a field floated over the glyphs (editSvgSlot), and a label the renderer
// only DEFAULTS (C.text_or) opens on the words the page shows.
//
// rxkids-fiscal: two designed pages declared to the strip, every chart label
// an svg_text slot, page 2's how-it-works chart the one with plain words.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const PROJECT = '?project=rxkids-fiscal';

test.describe('duplicating a designed page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, PROJECT);
    await page.waitForTimeout(800);
  });

  test('the copy carries the page\'s content as its own editable slots and elements',
    async ({ page }) => {
      const r = await page.evaluate(() => docsync.api.duplicatePage(1));
      expect(r.ok).toBe(true);
      expect(r.copied).toBe(true);
      const bid = r.page;
      await page.waitForTimeout(1200);

      const inv = await page.evaluate(() => docsync.api.inventory());
      expect(inv.pageOrder.map(String)).toEqual(['1', bid, '2']);
      const copy = inv.pages.find(p => p.id === bid);
      // Page 1 has 27 elements and 51 slots (23 prose + 28 chart labels);
      // "more than twenty" is the claim, not the exact tally, so a new stat
      // card on the report does not fail this.
      expect(copy.elements.length).toBeGreaterThan(20);
      expect(copy.slots.length).toBeGreaterThan(40);
      expect(copy.slots.find(s => s.key === `copy.${bid}.stat.a.n`).text).toBe('13,228');
      // Kinds see through the prefix: a prose block is prose in the copy too.
      expect(copy.elements.find(e => e.id === `copy.${bid}.para.hero.standfirst`).kind).toBe('prose');
      // A chart's labels came along as slots inside the copied graphic.
      expect(copy.slots.some(s => s.key === `copy.${bid}.chart.how.s1.label`
        || s.key === `copy.${bid}.chart.timeline.legend.fed`)).toBe(true);

      // Every slot was written into content.md under the copy's key, so the
      // copy renders from the document — not from a frozen string.
      const keys = await page.evaluate(b => source.split('[[copy.' + b + '.').length - 1, bid);
      expect(keys).toBe(copy.slots.length);
      // And the layout holds the snapshot on the blank page's entry.
      const stored = await page.evaluate(b => {
        const e = layout.pages.blanks.find(x => x.id === b);
        return { of: e.copy.of, hasHtml: e.copy.html.length > 5000,
                 noLayer: !/shape-layer|ds-textbox|ds-spacer|<style|<script/.test(e.copy.html),
                 noOverrides: !/data-placed|data-anc-host|data-reserve/.test(e.copy.html) };
      }, bid);
      expect(stored).toEqual({ of: 1, hasHtml: true, noLayer: true, noOverrides: true });

      // Editing the copy edits the copy — the original's words do not move.
      await page.evaluate(b => docsync.api.setSlot(`copy.${b}.stat.a.n`, '99,999'), bid);
      await page.waitForTimeout(900);
      const words = await page.evaluate(b => {
        const d = document.getElementById('out').contentDocument;
        return { orig: d.querySelector('[data-slot="stat.a.n"]').textContent,
                 copy: d.querySelector(`[data-slot="copy.${b}.stat.a.n"]`).textContent };
      }, bid);
      expect(words).toEqual({ orig: '13,228', copy: '99,999' });

      // Moving a copied element places it by its own id, and holds its
      // vacated slot — the same rule every designed element has.
      const pl = await page.evaluate(b => docsync.api.place(`copy.${b}.stat.a`, { x: 1, y: 6 }), bid);
      expect(pl.ok).toBe(true);
      expect(pl.box.x).toBeCloseTo(1, 1);
      expect(pl.box.y).toBeCloseTo(6, 1);
      await page.waitForTimeout(600);
      // Where it DRAWS, in page inches — not its style's left/top: the stat
      // sits in its strip, a frame (L.frame), so the coordinates it stores
      // are the strip's, and the strip carries it if the strip moves.
      const placed = await page.evaluate(b => {
        const d = document.getElementById('out').contentDocument;
        const el = d.querySelector(`[data-el="copy.${b}.stat.a"]`);
        const at = _pilotMeasure(`copy.${b}.stat.a`);
        return { abs: /position:absolute/.test(el.getAttribute('style')),
                 at: [+at.x.toFixed(1), +at.y.toFixed(1)],
                 strut: !!d.querySelector(`.ds-spacer[data-spacer-for="copy.${b}.stat.a"]`) };
      }, bid);
      expect(placed).toEqual({ abs: true, at: [1, 6], strut: true });

      // The published build renders the copy too — with the edit, without
      // a single editing hook.
      const pub = await page.evaluate(b => renderClean().then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const pg = doc.querySelector(`section.page[data-page="${b}"]`);
        return { pages: doc.querySelectorAll('section.page').length,
                 hooks: pg.querySelectorAll('[data-el],[data-slot],[data-fill]').length,
                 edited: /99,999/.test(pg.innerHTML),
                 viewBox: (pg.innerHTML.match(/viewBox=/g) || []).length };
      }), bid);
      expect(pub.pages).toBe(3);
      expect(pub.hooks).toBe(0);
      expect(pub.edited).toBe(true);
      expect(pub.viewBox).toBeGreaterThan(0);

      // Three edits, three undos, and the document is what it was.
      for (let i = 0; i < 3; i++) { await page.evaluate(() => docsync.api.undo()); await page.waitForTimeout(700); }
      const back = await page.evaluate(() => ({
        pages: layout.pages || null, copies: (source.match(/\[\[copy\./g) || []).length,
        sheets: document.getElementById('out').contentDocument.querySelectorAll('section.page').length }));
      expect(back).toEqual({ pages: null, copies: 0, sheets: 2 });
    });

  test('the strip\'s Duplicate page button does the same, and a copy of a copy renames its keys',
    async ({ page }) => {
      await page.evaluate(() => setSelPage(document.getElementById('out').contentDocument, 2));
      await page.waitForTimeout(400);
      await expect(page.locator('#ar-pagedup')).toBeVisible();
      await page.click('#ar-pagedup');
      await page.waitForTimeout(2500);
      const first = await page.evaluate(() => ({ order: pageOrder().map(String), sel: selPage,
        stat: document.getElementById('stat').textContent }));
      expect(first.order).toEqual(['1', '2', 'p1']);
      expect(first.sel).toBe('p1');
      expect(first.stat).toContain('everything on it is a copy you can edit');
      // Now duplicate the copy: its copy.p1. keys become copy.p2. ones, and
      // the words travel.
      const r = await page.evaluate(() => docsync.api.duplicatePage('p1'));
      expect(r.copied).toBe(true);
      expect(r.page).toBe('p2');
      await page.waitForTimeout(1200);
      const got = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        return { order: pageOrder().map(String),
                 h1: d.querySelector('[data-slot="copy.p2.p2.hero.h1"]')?.textContent || null,
                 leaked: /copy\.p1\./.test(layout.pages.blanks.find(b => b.id === 'p2').copy.html) };
      });
      expect(got.order).toEqual(['1', '2', 'p1', 'p2']);
      expect(got.h1).toBe('Rx Keiki: how it works');
      expect(got.leaked).toBe(false);
    });
});

test.describe('editing a label drawn inside a chart', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, PROJECT);
    await page.waitForTimeout(800);
  });

  /** The label's centre in main-frame coordinates, scrolled into view. */
  async function labelPoint(page, key) {
    const loc = page.frameLocator('#out').locator(`svg text[data-slot="${key}"]`);
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  test('double-click floats a field over the glyphs; Enter writes the slot',
    async ({ page }) => {
      const pt = await labelPoint(page, 'chart.how.s1.label');
      await page.mouse.dblclick(pt.x, pt.y);
      await page.waitForTimeout(500);
      const inp = page.frameLocator('#out').locator('.ds-svg-edit');
      await expect(inp).toBeVisible();
      await expect(inp).toHaveValue('Sign up');
      // The field wears the label's alignment and sits on it, not in a corner.
      const where = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const i = d.querySelector('.ds-svg-edit'), t = d.querySelector('svg text[data-slot="chart.how.s1.label"]');
        const a = i.getBoundingClientRect(), b = t.getBoundingClientRect();
        return { align: i.style.textAlign, dx: Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)),
                 dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) };
      });
      expect(where.align).toBe('center');
      expect(where.dx).toBeLessThan(4);
      expect(where.dy).toBeLessThan(6);
      await page.keyboard.press('Meta+a');
      await page.keyboard.type('Enroll');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
      const after = await page.evaluate(() => ({
        editing, slot: docsync.api.getSlot('chart.how.s1.label').md,
        drawn: document.getElementById('out').contentDocument
          .querySelector('svg text[data-slot="chart.how.s1.label"]').textContent,
        field: !!document.getElementById('out').contentDocument.querySelector('.ds-svg-edit') }));
      expect(after).toEqual({ editing: false, slot: 'Enroll', drawn: 'Enroll', field: false });
      // ⌘Z is one step back.
      await page.evaluate(() => docsync.api.undo());
      await page.waitForTimeout(900);
      expect(await page.evaluate(() => docsync.api.getSlot('chart.how.s1.label').md)).toBe('Sign up');
    });

  test('Escape cancels, and a label the document only DEFAULTS opens on the words the page shows',
    async ({ page }) => {
      // Take the slot out of the document: the renderer's default now draws
      // it (C.text_or), and the editor has no block to read.
      await page.evaluate(async () => {
        source = source.replace(slotRe('chart.how.s2.desc'), '');
        await render();
      });
      await page.waitForTimeout(1000);
      const gone = await page.evaluate(() => ({
        has: slotRe('chart.how.s2.desc').test(source),
        drawn: document.getElementById('out').contentDocument
          .querySelector('svg text[data-slot="chart.how.s2.desc"]').textContent }));
      expect(gone).toEqual({ has: false, drawn: 'prenatal payment' });

      const pt = await labelPoint(page, 'chart.how.s2.desc');
      await page.mouse.dblclick(pt.x, pt.y);
      await page.waitForTimeout(500);
      const inp = page.frameLocator('#out').locator('.ds-svg-edit');
      await expect(inp).toHaveValue('prenatal payment');      // seeded from the page, not empty
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => ({ editing, has: slotRe('chart.how.s2.desc').test(source) })))
        .toEqual({ editing: false, has: false });              // cancelled: nothing written

      // Commit once, and the first edit CREATES the block.
      const pt2 = await labelPoint(page, 'chart.how.s2.desc');
      await page.mouse.dblclick(pt2.x, pt2.y);
      await page.waitForTimeout(500);
      await page.keyboard.press('Meta+a');
      await page.keyboard.type('first payment');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
      expect(await page.evaluate(() => docsync.api.getSlot('chart.how.s2.desc').md)).toBe('first payment');
    });
});
