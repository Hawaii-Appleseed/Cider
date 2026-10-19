// our-mission's "Five" carousel, across an edit anywhere on the page.
//
// The carousel is an imported web page's widget, and two things about it were
// set by that page's own script at load: the height of the slot its three
// phase bodies share (sizeBodies() measures the tallest body and writes it
// inline), and the resting --morph of the focus phase's icons (0 until that
// phase). A script runs once per document. The editor's incremental render
// (patchPages) puts a re-rendered page in place WITHOUT running it, so after
// any edit at all — one word in the footer — both fell back to the import's
// stylesheet: the slot went from 246px to 340px and everything under the
// carousel dropped 0.98in, and the five focus icons drew over the practices'
// numbered badges. Every arrange operation on the page looked broken because
// of it. A bare re-render never showed it: a render that changes nothing is a
// full swap, and a swap runs the script. render_report.py's FIVE_CSS now does
// both in CSS.
//
// So the edit has to be PATCHED for this to test anything, and the first
// assertion is that the document did not reload. If the editor ever stops
// patching this page, that assertion fails first and says so — this spec is
// then no longer exercising the bug, and wants a look rather than a pass.
// affected-by: projects/our-mission/**
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** The carousel as drawn: every element's box in page pixels and its opacity,
 *  plus the carousel's height in inches and where the section under it starts.
 *  The patch replaces every node, so elements are compared by position in the
 *  tree, which an edit outside the carousel does not change. */
const carousel = (page) => page.evaluate(() => {
  const d = document.getElementById('out').contentDocument;
  const w = d.defaultView;
  d.__tok = d.__tok || Math.random().toString(36).slice(2);
  const box = e => {
    const r = e.getBoundingClientRect();
    return [r.left + w.scrollX, r.top + w.scrollY, r.width, r.height]
      .map(v => Math.round(v * 2) / 2);
  };
  const five = d.querySelector('.ha-five');
  return {
    doc: d.__tok,
    height: +(five.getBoundingClientRect().height / 96).toFixed(3),
    under: box(d.querySelector('.ha-cta'))[1],
    els: [five, ...five.querySelectorAll('*')].map(e => ({
      el: e.tagName.toLowerCase() + [...e.classList].map(c => '.' + c).join(''),
      box: box(e).join(' '),
      opacity: w.getComputedStyle(e).opacity,
    })),
  };
});

test('a text edit leaves the carousel exactly as it was, and everything under it',
  async ({ page }) => {
    await gotoEditor(page, '?project=our-mission');
    const before = await carousel(page);

    // Below the carousel, so nothing it changes can move anything above it.
    const r = await page.evaluate(() => docsync.api.setSlot('ha-cta.eyebrow', 'Stand With Us Today'));
    expect(r.ok).not.toBe(false);
    const after = await carousel(page);

    expect(after.doc, 'the edit was patched in place, not a reload').toBe(before.doc);
    expect(after.height, '.ha-five height, inches').toBe(before.height);
    expect(after.under, 'top of the section under the carousel, px').toBe(before.under);
    // Same tree, so the same elements in the same order…
    expect(after.els.map(e => e.el)).toEqual(before.els.map(e => e.el));
    // …each where it was and as visible as it was. The focus icons are the
    // ones that showed: opacity 0 → 1 over the badges, and a bigger box.
    const moved = before.els
      .map((e, i) => ({ ...e, now: after.els[i] }))
      .filter(e => e.box !== e.now.box || e.opacity !== e.now.opacity)
      .map(e => `${e.el}: [${e.box}] ${e.opacity} -> [${e.now.box}] ${e.now.opacity}`);
    expect(moved).toEqual([]);
  });

test('the slot holds its tallest phase by itself — nothing waits on the script',
  async ({ page }) => {
    await gotoEditor(page, '?project=our-mission');
    // The patch's effect, without the patch: drop what the page's script
    // wrote and read the carousel again. Pins the CSS, whichever way the
    // editor renders.
    const read = () => page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const h = e => e.getBoundingClientRect().height;
      const bodies = [...d.querySelectorAll('.ha-five-body')];
      return {
        slot: h(d.querySelector('.ha-five-bodies')),
        tallest: Math.max(...bodies.map(h)),
        tops: [...new Set(bodies.map(b => Math.round(b.getBoundingClientRect().top)))],
        icons: [...d.querySelectorAll('.ha-five-body-c .ha-focus-icon')]
          .map(i => d.defaultView.getComputedStyle(i).opacity),
      };
    });
    const live = await read();
    await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      d.querySelector('.ha-five-bodies').style.removeProperty('min-height');
      d.querySelectorAll('.ha-focus-card').forEach(c => c.style.removeProperty('--morph'));
    });
    const bare = await read();

    expect(bare.slot).toBe(live.slot);
    expect(bare.slot).toBeCloseTo(bare.tallest, 1);   // the tallest body, not 340px
    expect(bare.tops).toHaveLength(1);                 // still stacked in one slot
    expect(bare.icons).toEqual(['0', '0', '0', '0', '0']);   // the practices phase shows
  });
