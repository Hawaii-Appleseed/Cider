// A page's backdrop is not an overlap (2026-11-10, Devin's call).
//
// The report template's cover is a full-page photo with the title, logo and
// date set on it. The Check counted each of those as an overlap, so every
// report made from the template opened with three or four "Overlapping"
// warnings nobody could fix — and a warning that is always there is one
// people learn to ignore, the real ones too. A picture or a shape that covers
// the page and stands behind what it overlaps is now the page's backdrop;
// everything else is judged as before.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-cover-backdrop';
const TEXT = `# Spec Cover
Date: November 2026

## Introduction

The opening paragraph.`;

const overlapsOn = (page, n) => page.evaluate(p => docsync.api.audit().issues
  .filter(i => i.kind === 'overlap' && String(i.page) === String(p))
  .map(i => [...i.ids].sort().join(' + ')), n);

test.describe('the cover photo is the page\'s backdrop', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('a report made from the template opens with no overlap on its cover, and real ones are still found',
    async ({ page, request }) => {
      const j = await (await request.post('/__scaffold', { data: {
        slug: SLUG, template: 'appleseed-report', scheme: 'slate', text: TEXT } })).json();
      expect(j.ok, j.error).toBe(true);
      await gotoEditor(page, `?project=${SLUG}`);
      await settled(page);

      // The photo, the title on it, and nothing reported.
      const cover = await page.evaluate(() => ({
        photo: layout.boxes.find(b => b.id === 'tpl-photo'),
        title: layout.boxes.find(b => b.id === 'tpl-title'),
      }));
      expect(cover.photo && cover.title).toBeTruthy();
      expect(await overlapsOn(page, 1)).toEqual([]);

      // Two words-boxes on top of each other are still an overlap.
      const add = await page.evaluate(t => docsync.api.addTextBox(
        { page: 1, x: t.x, y: t.y, w: 3, md: 'A note dropped on the title' }), cover.title);
      expect(add.ok, add.error).toBe(true);
      await settled(page);
      expect(await overlapsOn(page, 1)).toEqual([[add.id, 'text.tpl-title'].sort().join(' + ')]);
      await page.evaluate(() => docsync.api.undo());
      await settled(page);
      expect(await overlapsOn(page, 1)).toEqual([]);
    });

  test('a backdrop brought to the front, or a picture short of the page, is reported',
    async ({ page, request }) => {
      const j = await (await request.post('/__scaffold', { data: {
        slug: SLUG, template: 'appleseed-report', scheme: 'slate', text: TEXT } })).json();
      expect(j.ok, j.error).toBe(true);
      await gotoEditor(page, `?project=${SLUG}`);
      await settled(page);
      expect(await overlapsOn(page, 1)).toEqual([]);

      // In front of the title, the photo hides it: that IS an overlap.
      await page.evaluate(async () => {
        const d = $('out').contentDocument;
        await layerStep(d, 1, true, [d.querySelector('[data-el="text.tpl-photo"]')]);
      });
      await settled(page);
      const front = await overlapsOn(page, 1);
      expect(front).toContain(['text.tpl-photo', 'text.tpl-title'].sort().join(' + '));
      await page.evaluate(() => docsync.api.undo());
      await settled(page);
      expect(await overlapsOn(page, 1)).toEqual([]);

      // Shrunk to a third of the page, it is a picture placed under the title.
      const r = await page.evaluate(() => docsync.api.place('text.tpl-photo', { x: 0.5, y: 0.5, w: 4 }));
      expect(r.ok, r.error).toBe(true);
      await settled(page);
      expect(await overlapsOn(page, 1)).toContain(['text.tpl-photo', 'text.tpl-title'].sort().join(' + '));
    });
});
