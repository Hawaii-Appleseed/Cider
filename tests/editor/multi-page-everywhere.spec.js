// Multi-page reports work for EVERY template, not just demo-report (2026-11-12).
//
// A pilot's addShape / addTextBox / addChart / addTable on a page added by
// addPage or duplicatePage was refused ("page pN does not draw placed objects
// (its renderer builds that sheet by hand)") for any report whose renderer
// writes its own sheets and never reads layout.pages. PR #135/#136 fixed that
// inside projects/demo-report alone. The engine now finishes every render
// (docsync.layout.finish_html / finish_output): any sheet layout.pages names
// that the renderer did not draw is appended, drawn by L.sheet(), and the
// once-per-document head (page size, print colour) is emitted even when no
// sheet called layer(). These specs run the same scenario against templates
// of every shape: hand-built sheets (retitc, uhero-trc-summary, dotax-itep,
// tax-testimony), L.sheet scaffolds (top-three-fact-sheet, my-report), a
// designed-plus-blank mix (staff-toolkit, our-mission) and demo-report.
const { sharedTest: test, expect, gotoEditor, clickTool } = require('./fixtures/editor-test');

const api = (page, fn, arg) => page.evaluate(fn, arg);

// One of each shape of renderer. A new template that writes its own sheets
// belongs on this list.
const TEMPLATES = [
  'demo-report',          // designed page 1 + hand-built endnotes sheet
  'top-three-fact-sheet', // scaffold: L.sheet() for every page
  'retitc',               // hand-built <section class="page"> x4, no page_order
  'uhero-trc-summary',    // hand-built, cover + body pages, no page_order
  'dotax-itep',           // hand-built, no page_order
  'tax-testimony',        // hand-built with generated pages
  'our-mission',          // L.sheet(pid, BODY) with one designed page
];

for (const project of TEMPLATES) {
  test.describe(`added pages on ${project}`, () => {
    test(`a page added with addPage takes a fill, shape, text, chart and table`, async ({ page }) => {
      await gotoEditor(page, `?project=${project}`);
      const frame = page.frameLocator('#out');
      const a = await api(page, () => docsync.api.addPage());
      expect(a.ok, a.error).not.toBe(false);
      const b = await api(page, () => docsync.api.addPage());
      const pids = [a.id, b.id];
      // A duplicate of an added page is one too.
      const d = await api(page, P => docsync.api.duplicatePage(P), a.id);
      expect(d.page, JSON.stringify(d)).toBeTruthy();
      pids.push(d.page);
      for (const [i, P] of pids.entries()) {
        const fill = await api(page, ([P, c]) => docsync.api.recolor('page.' + P, c), [P, i % 2 ? '#1E6194' : '#354F52']);
        expect(fill.ok, `${P} fill: ${fill.error}`).not.toBe(false);
        const s = await api(page, P => docsync.api.addShape({ page: P, kind: 'rect', x: 0.5, y: 0.5, w: 2, h: 1, fill: '#FDCF21' }), P);
        expect(s.ok, `${P} shape: ${s.error}`).not.toBe(false);
        const t = await api(page, P => docsync.api.addTextBox({ page: P, x: 0.5, y: 2, w: 4, md: 'Slide text' }), P);
        expect(t.ok, `${P} text: ${t.error}`).not.toBe(false);
        const c = await api(page, P => docsync.api.addChart({ page: P, x: 0.5, y: 3, w: 4, h: 2.5,
          chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] } }), P);
        expect(c.ok, `${P} chart: ${c.error}`).toBe(true);
        const tb = await api(page, P => docsync.api.addTable({ page: P, x: 4.8, y: 3, w: 3, rows: [['h1', 'h2'], ['1', '2']] }), P);
        expect(tb.ok, `${P} table: ${tb.error}`).not.toBe(false);
      }
      await api(page, () => render());
      for (const P of pids) {
        const sec = frame.locator(`section.page[data-page="${P}"]`);
        await expect(sec, `${P} drawn`).toHaveCount(1);
        await expect(sec.locator('g[data-shape]')).not.toHaveCount(0);
        await expect(sec.locator('.ds-textbox')).toHaveCount(1);
        await expect(sec.locator('table')).toHaveCount(1);
        // The page's own fill reached the sheet (recolor 'page.<id>').
        const bg = await sec.evaluate(e => getComputedStyle(e).backgroundColor);
        expect(bg, `${P} fill`).not.toBe('rgb(255, 255, 255)');
      }
    });

    // The report's page size reaches the sheets the engine drew for it: the
    // once-per-document head (layout.page) rides out with the first layer()
    // call, and a renderer that draws every sheet by hand never made one.
    test('setPageSize applies to the pages that were added', async ({ page }) => {
      await gotoEditor(page, `?project=${project}`);
      const frame = page.frameLocator('#out');
      const a = await api(page, () => docsync.api.addPage());
      const b = await api(page, () => docsync.api.addPage());
      const s = await api(page, () => docsync.api.setPageSize('slide43'));
      expect(s.ok, s.error).not.toBe(false);
      for (const P of [a.id, b.id]) {
        const box = await frame.locator(`section.page[data-page="${P}"]`).evaluate(e => {
          const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)];
        });
        expect(box, `${P} size`).toEqual([960, 720]);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// The two clean starting points the hub's new_report offers: nothing designed,
// nothing to delete, nothing that raises an error before a word is typed.
// size is the sheet in CSS px at 96 px to the inch; fs is the size a NEW text box
// starts at (the base's own body size), so a slide or a social post does not open
// on 15px type.
const BASES = [
  { id: 'blank-document', size: [816, 1056], fs: 15 },      // US Letter, 8.5 x 11 in
  { id: 'slides', size: [960, 720], fs: 15 },               // 4:3, 10 x 7.5 in
  { id: 'slides-widescreen', size: [1280, 720], fs: 32 },   // 16:9, 13.333 x 7.5 in
  { id: 'social-square', size: [1080, 1080], fs: 32 },      // 1080 x 1080
  { id: 'social-portrait', size: [1080, 1350], fs: 32 },    // 4:5, 1080 x 1350
  { id: 'social-story', size: [1080, 1920], fs: 32 },       // 9:16, 1080 x 1920
  { id: 'link-card', size: [1200, 630], fs: 32 },           // link preview, 1200 x 630
  { id: 'letter-landscape', size: [1056, 816], fs: 16 },    // 11 x 8.5 in
  { id: 'poster-tabloid', size: [1056, 1632], fs: 28 },     // 11 x 17 in
];

for (const { id, size, fs } of BASES) {
  test.describe(`clean base: ${id}`, () => {
    test('opens as one empty sheet with no placeholder, no endnotes page and no Preflight issue', async ({ page }) => {
      await gotoEditor(page, `?project=${id}`);
      const frame = page.frameLocator('#out');
      await expect(frame.locator('section.page')).toHaveCount(1);
      const box = await frame.locator('section.page').evaluate(e => {
        const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)];
      });
      expect(box).toEqual(size);
      // Nothing is drawn on it but the sheet itself.
      await expect(frame.locator('section.page [data-el], section.page [data-slot], section.page .ds-textbox, .endnotes')).toHaveCount(0);
      // No placeholder source (it would be an uncited-source ERROR that blocks Publish).
      const src = await api(page, () => source);
      expect(src).not.toMatch(/placeholder|example\.com/i);
      const pf = await api(page, () => docsync.api.preflight());
      expect(pf.issues, JSON.stringify(pf.issues)).toEqual([]);
      expect(pf.errors).toBe(0);
    });

    test('a page added with addPage takes objects at once, and the empty report still has no errors', async ({ page }) => {
      await gotoEditor(page, `?project=${id}`);
      const frame = page.frameLocator('#out');
      const a = await api(page, () => docsync.api.addPage());
      expect(a.ok, a.error).not.toBe(false);
      const P = a.id;
      // Laid out inside the SMALLEST canvas here (the 6.56in-high link card) so
      // one set of numbers fits every size.
      const s = await api(page, P => docsync.api.addShape({ page: P, kind: 'rect', x: 0.5, y: 0.5, w: 1.5, h: 0.8, fill: '#FDCF21' }), P);
      expect(s.ok, s.error).not.toBe(false);
      const t = await api(page, P => docsync.api.addTextBox({ page: P, x: 0.5, y: 1.5, w: 4, md: 'Hello' }), P);
      expect(t.ok, t.error).not.toBe(false);
      const c = await api(page, P => docsync.api.addChart({ page: P, x: 0.5, y: 2.4, w: 4, h: 2.2,
        chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] } }), P);
      expect(c.ok, c.error).toBe(true);
      const tb = await api(page, P => docsync.api.addTable({ page: P, x: 5, y: 0.5, w: 3, rows: [['h1', 'h2'], ['1', '2']] }), P);
      expect(tb.ok, tb.error).not.toBe(false);
      await expect(frame.locator('section.page')).toHaveCount(2);
      const sec = frame.locator(`section.page[data-page="${P}"]`);
      await expect(sec.locator('g[data-shape]')).not.toHaveCount(0);
      await expect(sec.locator('.ds-textbox')).toHaveCount(1);
      await expect(sec.locator('table')).toHaveCount(1);
      // A new text box starts at the base's own body size (15px on a letter page,
      // 32px on a 1080px social canvas), not on one size for every canvas.
      const started = await sec.locator('.ds-textbox').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
      expect(started, 'a new text box starts at the base size').toBe(fs);
      const pf = await api(page, () => docsync.api.preflight());
      expect(pf.errors, JSON.stringify(pf.issues)).toBe(0);
    });

    // removePage on the born page hides it (the report keeps the sheets the
    // person added). What is left must still print and still present.
    test('after the first page is removed the report still presents and still makes a PDF', async ({ page }) => {
      test.setTimeout(120000);
      await gotoEditor(page, `?project=${id}`);
      const frame = page.frameLocator('#out');
      const a = await api(page, () => docsync.api.addPage());
      const b = await api(page, () => docsync.api.addPage());
      await api(page, P => docsync.api.addTextBox({ page: P, x: 0.5, y: 0.5, w: 4, md: 'Second' }), a.id);
      const r = await api(page, () => docsync.api.removePage(1));
      expect(r.ok, r.error).not.toBe(false);
      await expect(frame.locator('section.page')).toHaveCount(2);
      await expect(frame.locator('section.page[data-page="1"]')).toHaveCount(0);
      const pf = await api(page, () => docsync.api.preflight());
      expect(pf.errors, JSON.stringify(pf.issues)).toBe(0);
      // Present: it opens on the first sheet that is left, and counts them.
      await clickTool(page, 'present');
      await expect(page.locator('#present-n')).toHaveText('1 / 2');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#present-n')).toHaveText('2 / 2');
      await page.keyboard.press('Escape');
      await expect(page.locator('body')).not.toHaveClass(/ds-present/);
      // PDF, made in the page (what the hub does): one page per sheet, at the sheet's size.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        api(page, () => exportPdfInBrowser(null, '')),
      ]);
      const txt = require('fs').readFileSync(await download.path()).toString('latin1');
      const boxes = [...txt.matchAll(/\/Type \/Page \/Parent[^\n]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [+m[1], +m[2]]);
      expect(boxes.length).toBe(2);
      for (const b of boxes) {          // 13.333in is 959.98pt, not 960: close, not equal
        expect(b[0]).toBeCloseTo(size[0] * 0.75, 0);
        expect(b[1]).toBeCloseTo(size[1] * 0.75, 0);
      }
    });
  });
}
