// A list inside a container that has indents (docsync/layout.py SPACE_CSS) and the
// list markdown people and models actually type (content.py _ITEM_RE, block_html,
// and their twin mdToHtml in edit.html).
//
// What went wrong: left/right/first-line indent and hang were set on every <li>, so
// a nested item took the margin again inside its parent (the indent doubled per
// level), a first-line indent moved an item's words and left its outside marker
// behind, and a hang pulled the words onto the marker. Indents now live on the
// OUTERMOST list; the items hang under it as a list already does.
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const LIST = '- First bullet with enough words to wrap onto a second line\n- Second bullet\n  - Nested child one that wraps to a second line here\n  - Nested two\n- Third';

async function addBox(page, i, md, style) {
  return page.evaluate(async ({ i, md, style }) => {
    const r = await docsync.api.addTextBox({ page: 1, x: 0.5 + (i % 2) * 4, y: 0.4 + Math.floor(i / 2) * 2.1, w: 3.6, md, style });
    return r.id;
  }, { i, md, style });
}

// Where each item's WORDS start, relative to the box, in px; and what CSS made it so.
const measure = (page, id) => page.frameLocator('#out').locator(`[data-el="${id}"]`).evaluate(el => {
  const box = el.getBoundingClientRect().left;
  const at = n => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); const t = w.nextNode();
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1); return Math.round(r.getBoundingClientRect().left - box); };
  const ul = el.querySelector('ul,ol'); const lis = [...el.querySelectorAll('li')];
  const cs = (e, p) => getComputedStyle(e)[p];
  return { ulML: cs(ul, 'marginLeft'), ulMR: cs(ul, 'marginRight'), liML: lis.map(l => cs(l, 'marginLeft')),
           liTI: lis.map(l => cs(l, 'textIndent')), x: lis.map(l => at(l)), pML: el.querySelector('p') ? cs(el.querySelector('p'), 'marginLeft') : null };
});

test.describe('lists in indented containers', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, '?project=blank-document'); await settled(page); });

  test('a left indent moves the list once, and a nested item sits one list-step in, not two', async ({ page }) => {
    const plain = await measure(page, await addBox(page, 0, LIST));
    const id = await addBox(page, 1, LIST, { indentLeft: 0.5 });
    await settled(page);
    const m = await measure(page, id);
    expect(m.ulML).toBe('48px');
    expect(m.liML.every(v => v === '0px')).toBe(true);
    // Every item is exactly the indent further right than the unindented list...
    expect(m.x.map((v, i) => v - plain.x[i])).toEqual([48, 48, 48, 48, 48]);
  });

  test('a first-line indent and a hang never reach the items (the marker cannot part from, or land on, its words)', async ({ page }) => {
    const plain = await measure(page, await addBox(page, 0, LIST));
    const a = await addBox(page, 1, LIST, { indent: 0.4 });
    const b = await addBox(page, 2, LIST, { hang: 0.3 });
    await settled(page);
    const ma = await measure(page, a), mb = await measure(page, b);
    expect(ma.liTI.every(v => v === '0px')).toBe(true);
    expect(ma.x).toEqual(plain.x);                                   // first-line indent: a list ignores it
    expect(mb.liTI.every(v => v === '0px')).toBe(true);
    expect(mb.x.map((v, i) => v - plain.x[i])).toEqual([29, 29, 29, 29, 29]);   // hang rides as plain left indent
  });

  test('a paragraph in the same box keeps its own indents, and a right indent lands on the list', async ({ page }) => {
    const id = await addBox(page, 0, 'Intro paragraph.\n\n' + LIST, { indentLeft: 0.5, indentRight: 0.25 });
    await settled(page);
    const m = await measure(page, id);
    expect(m.pML).toBe('48px');
    expect(m.ulML).toBe('48px');
    expect(m.ulMR).toBe('24px');
  });

  test('a numbered list in an indented box nests one step too', async ({ page }) => {
    const plain = await measure(page, await addBox(page, 0, '1. One\n2. Two\n   1. Sub'));
    const id = await addBox(page, 1, '1. One\n2. Two\n   1. Sub', { indentLeft: 0.5 });
    await settled(page);
    const m = await measure(page, id);
    expect(m.x.map((v, i) => v - plain.x[i])).toEqual([48, 48, 48]);
  });

  test('* + and bullet-dot items are lists; a blank line and a wrapped line keep one list', async ({ page }) => {
    for (const [i, md] of ['* a\n* b', '+ a\n+ b', '• a\n• b', '- a\n\n- b', '- a\n  more\n- b'].entries()) {
      const id = await addBox(page, i, md);
      await settled(page);
      const n = await page.frameLocator('#out').locator(`[data-el="${id}"]`).evaluate(el =>
        ({ ul: el.querySelectorAll('ul').length, li: el.querySelectorAll('li').length, p: el.querySelectorAll('p').length, t: el.textContent }));
      expect(n, md).toMatchObject({ ul: 1, li: 2, p: 0 });
    }
  });

  test('the editor reads those lists the way the renderer does', async ({ page }) => {
    const out = await page.evaluate(() => [
      mdToHtml('* a\n\n* b\n  wraps\n  - sub', { allowLists: true }),
      mdToHtml('- a\n\nafter', { allowLists: true })]);
    expect(out[0]).toBe('<ul><li>a</li><li>b wraps<ul><li>sub</li></ul></li></ul>');
    expect(out[1]).toBe('<ul><li>a</li></ul><p>after</p>');
  });

  test('setSlot refuses a list for a prose slot, and says where lists go', async ({ page }) => {
    await gotoEditor(page);      // budget-primer: real prose slots and card bullet slots
    await settled(page);
    const bad = await page.evaluate(() => docsync.api.setSlot('whopays.p1', 'Intro:\n\n- one\n- two'));
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/prose slot/);
    expect(bad.error).toMatch(/text box/);
    // ...but a sentence that merely starts with a dash or a year is not a list,
    const fine = await page.evaluate(() => docsync.api.setSlot('whopays.p1', '2026. A year, then words.'));
    expect(fine.ok).toBe(true);
    // ...and a card's bullet slot (a <ul>) takes any bullet character.
    const card = await page.evaluate(() => docsync.api.setSlot('basics.branch.legislature.bullets', '* one\n* two'));
    expect(card.ok).toBe(true);
    await expect(page.frameLocator('#out').locator('ul[data-slot="basics.branch.legislature.bullets"] li')).toHaveCount(2);
  });
});
