// The endnotes section, three ways it used to trap a report (FINDINGS R5,
// the Wealth Tax run of 2026-11-09):
//   (c) its box's words are only its heading, and a heading set beside it as
//       a box of its own (the way every section page sets one) left it with
//       none: setBoxText refused '' and the engine refused the draft;
//   (d) the box's paragraph spacing landed on every note — a 0.77in space
//       meant for under the heading made the list twenty inches tall;
//   (e) one box could not continue onto a second page: sixteen long notes
//       only just fitted, and a longer list had nowhere to go.
// affected-by: docsync/layout.py docsync/compose.py docsync/templates/__init__.py
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-endnotes-flow';

// One source line as long as the Wealth Tax notes run: a title, an author and
// a publisher in full, and an address that breaks anywhere.
const note = (id, i) => `[^${id}]: A long source title, number ${i}, with its authors, `
  + `its date and its publisher written out in full as reports cite them — `
  + `https://example.org/a/long/path/to/the/document/number/${i}/report-in-full.pdf`;
const text = (n) => `# Spec Endnotes
Date: November 2026

## Introduction

The opening paragraph.${Array.from({ length: n }, (_, i) => `[^n${i}]`).join('')}

## What follows

A second section, so there is a body to cite from.

${Array.from({ length: n }, (_, i) => note('n' + i, i)).join('\n')}`;

const scaffold = async (request, n) => {
  const j = await (await request.post('/__scaffold', { data: {
    slug: SLUG, template: 'appleseed-report', scheme: 'slate', text: text(n) } })).json();
  expect(j.ok, j.error).toBe(true);
};
// The section's box and every frame its list runs into, as drawn.
const notesDrawn = page => page.evaluate(() => {
  const d = $('out').contentDocument;
  const en = layout.boxes.find(b => b.act === 'endnotes');
  const frames = threadChain(en).map(b => b.id);
  const lists = [...d.querySelectorAll('ol.ds-endnotes')].filter(o => o.closest('section.page'));
  return {
    id: en.id, frames,
    pages: frames.map(id => layout.boxes.find(b => b.id === id).page),
    lists: lists.map(o => ({ start: +(o.getAttribute('start') || 1), n: o.children.length,
                             sec: !!o.closest('.ds-endnotes-sec') })),
    items: [...d.querySelectorAll('ol.ds-endnotes > li')].filter(li => li.closest('section.page'))
      .map(li => li.dataset.el),
    cut: (lastFit || []).filter(c => frames.includes((c.who || '').replace(/^text\./, ''))),
    rendererOwn: rendererHasEndnotes(),
  };
});

test.describe('the endnotes section', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('(e) a list longer than its page is laid out across pages from the start',
    async ({ page, request }) => {
      await scaffold(request, 60);
      await gotoEditor(page, `?project=${SLUG}`);
      await settled(page);
      const r = await notesDrawn(page);
      expect(r.frames.length).toBeGreaterThan(1);
      expect(new Set(r.pages).size).toBe(r.frames.length);      // a frame per page
      // Every note once, in order, and the numbering carried across.
      expect(r.items.length).toBe(60);
      expect(new Set(r.items).size).toBe(60);
      expect(r.lists[0].start).toBe(1);
      expect(r.lists[1].start).toBe(r.lists[0].n + 1);
      expect(r.lists.every(l => l.sec)).toBe(true);
      // As many pages as the list needs, and no more: a frame the estimate
      // added that no note reaches is a blank page in the report.
      expect(r.lists.length).toBe(r.frames.length);
      expect(r.lists.every(l => l.n > 0)).toBe(true);
      expect(r.cut).toEqual([]);                                 // nothing past a foot
      expect(r.rendererOwn).toBe(false);                         // still the editor's section
    });

  test('(e) the editor runs a list that has outgrown its page onto a new one',
    async ({ page, request }) => {
      await scaffold(request, 3);
      await gotoEditor(page, `?project=${SLUG}`);
      await settled(page);
      expect((await notesDrawn(page)).frames.length).toBe(1);

      // Sixty more sources, cited: now the list runs off the bottom.
      await page.evaluate(async () => {
        const ids = Array.from({ length: 60 }, (_, i) => 'x' + i);
        const lines = ids.map((id, i) => `[${id}]: Another long source, number ${i}, with its `
          + `authors, date and publisher in full — https://example.org/more/long/path/${i}/document.pdf`);
        await docsync.api.setSlot('sources', docsync.api.getSlot('sources').md + '\n' + lines.join('\n'));
        const b = layout.boxes.find(x => /\[\^n0\]/.test(x.md || ''));
        await docsync.api.setBoxText('text.' + b.id, b.md + ids.map(id => `[^${id}]`).join(''));
      });
      await settled(page);
      let r = await notesDrawn(page);
      expect(r.cut.length).toBeGreaterThan(0);
      const audit = await page.evaluate(() => docsync.api.audit());
      expect(audit.issues.some(i => i.kind === 'print-overflow' && /continueEndnotes\(\)/.test(i.note)))
        .toBe(true);

      const before = await page.evaluate(() => ({ boxes: layout.boxes.length, order: pageOrder().length }));
      const c = await page.evaluate(() => docsync.api.continueEndnotes());
      expect(c.ok, c.error).toBe(true);
      await settled(page);
      r = await notesDrawn(page);
      expect(r.frames.length).toBe(2);
      expect(r.cut).toEqual([]);
      expect(r.items.length).toBe(63);
      expect(new Set(r.items).size).toBe(63);
      expect(r.lists[1].start).toBe(r.lists[0].n + 1);
      expect(r.rendererOwn).toBe(false);
      // The new page follows the one the notes started on, and is numbered
      // like it: its footer came along.
      const pg = await page.evaluate(p => ({
        order: pageOrder().map(String),
        folio: layout.boxes.some(b => String(b.page) === String(p) && /\{page\}/.test(b.md || '')),
      }), r.pages[1]);
      expect(pg.order.indexOf(String(r.pages[1]))).toBe(pg.order.indexOf(String(r.pages[0])) + 1);
      expect(pg.folio).toBe(true);

      // One undo takes the whole step back.
      await page.evaluate(() => docsync.api.undo());
      await settled(page);
      expect(await page.evaluate(() => ({ boxes: layout.boxes.length, order: pageOrder().length })))
        .toEqual(before);
    });

  test('(c) the section can have no heading of its own, and keeps its list',
    async ({ page, request }) => {
      await scaffold(request, 3);
      await gotoEditor(page, `?project=${SLUG}`);
      await settled(page);
      const id = (await notesDrawn(page)).id;
      const r = await page.evaluate(i => docsync.api.setBoxText('text.' + i, ''), id);
      expect(r.ok, r.error).toBe(true);
      await settled(page);
      const box = page.frameLocator('#out').locator(`[data-el="text.${id}"]`);
      await expect(box.locator('ol.ds-endnotes > li')).toHaveCount(3);
      await expect(box.locator('h1, h2, h3')).toHaveCount(0);
      // And it takes a heading back.
      const back = await page.evaluate(i => docsync.api.setBoxText('text.' + i, '## Notes'), id);
      expect(back.ok, back.error).toBe(true);
      await settled(page);
      await expect(box.locator('h2')).toHaveText('Notes');
    });

  test('(d) space after the section\'s box goes under its heading, not under every note',
    async ({ page, request }) => {
      await scaffold(request, 12);
      await gotoEditor(page, `?project=${SLUG}`);
      await settled(page);
      const id = (await notesDrawn(page)).id;
      const tall = () => page.evaluate(i => {
        const el = $('out').contentDocument.querySelector(`[data-el="text.${i}"]`);
        const li = el.querySelector('ol.ds-endnotes > li');
        const h = el.querySelector('h2');
        const cs = x => getComputedStyle(x);
        return { box: el.offsetHeight,
                 li: parseFloat(cs(li).marginBottom), liFont: parseFloat(cs(li).fontSize),
                 head: parseFloat(cs(h).marginBottom) };
      }, id);
      const was = await tall();
      const r = await page.evaluate(i => docsync.api.setStyle('text.' + i, { spaceAfter: 0.77 }), id);
      expect(r.ok, r.error).toBe(true);
      await settled(page);
      const now = await tall();
      expect(now.head).toBeCloseTo(0.77 * 96, 0);                // under the heading
      expect(now.li).toBeCloseTo(0.6 * now.liFont, 1);           // each note as it was
      expect(now.box - was.box).toBeLessThan(0.77 * 96 + 2);     // the box grew by that space, once
    });
});
