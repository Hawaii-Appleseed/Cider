// The reference typography, held in the RENDERED page: a report scaffolded
// from the template must paint its title and headers in the exact style
// digested from Hawaiʻi Appleseed's published 2025–26 reports
// (hiappleseed.org/research — "A Fairer Tax Code", "Keiki Ride Free",
// "Pedestrian Head Start"), and a pilot following the served style guide
// (/__templates .style) must achieve the SAME computed style, to the pixel.
//
// docsync/test_docsync.py holds the guide equal to the template as data;
// this spec holds the template equal to the reference as pixels — font,
// size, weight, case, colour, tracking, leading, all read from
// getComputedStyle of the editor's rendered iframe.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-refstyle';

// What the published covers and body pages set, translated to computed CSS.
// Barlow stands in for the print Glober (same DIN-grotesque genre — and the
// live primer's own display face), Source Sans 3 for Source Sans Pro (its
// current name) — the numbers are the reference's own.
const REF = {
  coverTitle: { family: 'Glober', size: 58, weight: '800',
                transform: 'uppercase', color: 'rgb(255, 255, 255)',
                leading: 1.08 },
  subtitle:   { family: 'Source Sans 3', size: 19,
                transform: 'uppercase', color: 'rgb(255, 255, 255)',
                spacing: '1.2px' },
  date:       { family: 'Source Sans 3', size: 14, weight: '700',
                color: 'rgb(253, 207, 33)', spacing: '1.5px' },
  heading:    { family: 'Glober', size: 44, weight: '800',
                transform: 'uppercase', color: 'rgb(35, 35, 34)',
                leading: 1.05 },
  subheading: { family: 'Glober', size: 22, weight: '700',
                color: 'rgb(30, 97, 148)' },       // the topic blue
  body:       { family: 'Source Sans 3', size: 15,
                color: 'rgb(31, 31, 31)' },
};

test.describe('reference typography', () => {
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('the template paints the published title/header styles, and the style guide reproduces them',
    async ({ page, request }) => {
    const j = await (await request.post('/__scaffold', { data: {
      name: 'Spec Reference Style', slug: SLUG, template: 'appleseed-report',
    } })).json();
    expect(j.ok, j.error).toBe(true);

    await gotoEditor(page, `?project=${SLUG}`);
    const frame = page.frameLocator('#out');
    await expect(frame.locator('[data-el="text.tpl-title"]'))
      .toBeVisible({ timeout: 30000 });

    const computed = id => page.evaluate(id => {
      const el = document.getElementById('out').contentDocument
        .querySelector(`[data-el="${id}"]`);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { family: s.fontFamily, size: parseFloat(s.fontSize),
               weight: s.fontWeight, transform: s.textTransform,
               color: s.color, spacing: s.letterSpacing,
               lineHeight: parseFloat(s.lineHeight) };
    }, id);
    const expectRef = (got, ref, what) => {
      expect(got, what).toBeTruthy();
      expect(got.family, `${what} font`).toContain(ref.family);
      expect(got.size, `${what} size`).toBeCloseTo(ref.size, 1);
      if (ref.weight) expect(got.weight, `${what} weight`).toBe(ref.weight);
      if (ref.transform) expect(got.transform, `${what} case`).toBe(ref.transform);
      expect(got.color, `${what} colour`).toBe(ref.color);
      if (ref.spacing) expect(got.spacing, `${what} tracking`).toBe(ref.spacing);
      if (ref.leading) expect(got.lineHeight / got.size, `${what} leading`)
        .toBeCloseTo(ref.leading, 2);
    };

    // --- the reference styles, as painted --------------------------------
    expectRef(await computed('text.tpl-title'), REF.coverTitle, 'cover title');
    expectRef(await computed('text.tpl-sub'), REF.subtitle, 'cover subtitle');
    expectRef(await computed('text.tpl-date'), REF.date, 'cover date');
    expectRef(await computed('text.tpl-h3'), REF.heading, 'exec-summary headline');
    expectRef(await computed('text.tpl-h4'), REF.heading, 'section headline');
    expectRef(await computed('text.tpl-sub4'), REF.subheading, 'subheading');
    expectRef(await computed('text.tpl-body4a'), REF.body, 'body text');

    // --- and the served guide achieves them ------------------------------
    // A pilot that knows nothing but /__templates lays a headline and a
    // cover title from the guide's dicts; both must compute IDENTICAL to
    // the template's own — same face, size, weight, case, colour, leading.
    const guide = await page.evaluate(async () =>
      (await (await fetch('/__templates')).json()).style);
    expect(guide.patterns.cover_title).toBeTruthy();
    const same = ['family', 'size', 'weight', 'transform', 'color', 'lineHeight'];
    for (const [pattern, twin, y] of [
      ['section_heading', 'text.tpl-h4', 8.6],
      ['cover_title', 'text.tpl-title', 9.4],
    ]) {
      const added = await page.evaluate(([g, y]) => docsync.api.addTextBox(
        { page: 4, x: 0.7, y, w: 7.1, md: 'Achieved from the guide',
          style: g.style }), [guide.patterns[pattern], y]);
      expect(added.ok, pattern).toBe(true);
      const a = await computed(added.id);
      const b = await computed(twin);
      for (const k of same) expect(a[k], `${pattern} ${k}`).toEqual(b[k]);
    }
  });
});
