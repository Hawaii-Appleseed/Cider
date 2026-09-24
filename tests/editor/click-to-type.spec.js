// A click in text types there; a press that travels moves the box.
//
// Reported on tfc-2027-priorities: "why do I have to double click on the text
// to start editing it? single click highlights the entire text box" — and
// "why can't I move those text boxes around". Three things made that true:
//
//   * a field's editor opened with every word in it SELECTED (edit() selected
//     the host's whole contents), so the first click lit the box up and only
//     a second click put the caret down;
//   * on every report but that one, a click on a movable object's words only
//     selected the object — the words opened on a double-click;
//   * and on that one, no field could move at all: docsync.propose wired each
//     as a slot and never as an object, and the page's own text boxes were
//     drawn outside its sheet.
//
// Now a click that does not travel opens the words with the caret where the
// pointer was (caretAt, typeOnClick); a press that travels moves the box; the
// handles resize it; Escape leaves the words with the box still selected; and
// while the words are open, a grip under the box moves it without closing
// them.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** The top-level point over `text` inside the first element matching `sel`
 *  in the report — `dx` CSS px into it (null: its middle). Where a person
 *  puts the pointer to click that word. The report iframe is scaled with a
 *  CSS transform, so iframe px are converted through its rendered size. */
async function pointAt(page, sel, text, dx = null) {
  return page.evaluate(({ sel, text, dx }) => {
    const fr = document.getElementById('out');
    const d = fr.contentDocument;
    const el = d.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = text ? n.textContent.indexOf(text) : 0;
      if (i < 0 || !n.textContent.trim()) continue;
      const r = d.createRange();
      r.setStart(n, i);
      r.setEnd(n, text ? i + text.length : n.textContent.length);
      const b = r.getClientRects()[0];
      const fb = fr.getBoundingClientRect();
      const s = fb.width / fr.offsetWidth;
      const x = b.left + (dx === null ? b.width / 2 : dx);
      return { x: fb.left + x * s, y: fb.top + (b.top + b.height / 2) * s };
    }
    return null;
  }, { sel, text, dx });
}

/** The middle of an element in the report, as a top-level point. */
async function centreOf(page, sel) {
  return page.evaluate(sel => {
    const fr = document.getElementById('out');
    const el = fr.contentDocument.querySelector(sel);
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect(), fb = fr.getBoundingClientRect();
    const s = fb.width / fr.offsetWidth;
    return { x: fb.left + (b.left + b.width / 2) * s, y: fb.top + (b.top + b.height / 2) * s };
  }, sel);
}

/** What the open editor holds and where its caret is. */
const caret = page => page.evaluate(() => {
  const d = document.getElementById('out').contentDocument;
  const host = d.querySelector('.ds-edit');
  const s = d.getSelection();
  const anchorIn = !!host && !!s.anchorNode && host.contains(s.anchorNode);
  return {
    editing, slot: host && host.dataset.slot, collapsed: s.isCollapsed,
    selected: s.toString(), inHost: anchorIn,
    before: anchorIn ? (s.anchorNode.textContent || '').slice(0, s.anchorOffset) : null,
  };
});

/** An element's top in the report's own px — what "stays put" is measured in. */
const topOf = (page, sel) => page.evaluate(sel => {
  const d = document.getElementById('out').contentDocument;
  const el = d.querySelector(sel);
  const pg = el.closest('section.page');
  return el.getBoundingClientRect().top - pg.getBoundingClientRect().top;
}, sel);

async function drag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 3, from.y + dy / 3, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('a click types, a drag moves (tfc-2027-priorities)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page, '?project=tfc-2027-priorities');
  });

  test('one click opens the field with the caret where it landed — nothing selected', async ({ page }) => {
    const at = await pointAt(page, '[data-slot="standfirst.p-1"]', 'legislative', 1);
    expect(at).toBeTruthy();
    await page.mouse.click(at.x, at.y);
    const c = await caret(page);
    expect(c.editing).toBe(true);
    expect(c.slot).toBe('standfirst.p-1');
    // The whole complaint: the first click used to light up every word.
    expect(c.selected).toBe('');
    expect(c.collapsed).toBe(true);
    expect(c.inHost).toBe(true);
    expect(c.before).toMatch(/2027 $/);
    // The field is the selection too, so Escape can hand it back as a box.
    expect(await page.evaluate(() => [...selIds])).toEqual(['field.standfirst.p-1']);
    await page.keyboard.type('NEW ');
    await page.keyboard.press('Enter');          // one line: Enter commits
    await expect.poll(() => page.evaluate(() => readSlot('standfirst.p-1')))
      .toContain('2027 NEW legislative');
  });

  test('Escape leaves the words and keeps the box selected, with its handles', async ({ page }) => {
    const at = await pointAt(page, '[data-slot="sheet.h1-1"]', 'Priorities');
    await page.mouse.click(at.x, at.y);
    expect((await caret(page)).editing).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => editing)).toBe(false);
    await expect.poll(() => page.evaluate(() => [...selIds])).toEqual(['field.sheet.h1-1']);
    await expect(page.frameLocator('#out').locator('.ds-handles .ds-h-e')).toHaveCount(1);
  });

  test('shift-click selects a field without opening its words', async ({ page }) => {
    const at = await pointAt(page, '[data-slot="sheet.h1-1"]', 'Priorities');
    await page.keyboard.down('Shift');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => editing)).toBe(false);
    expect(await page.evaluate(() => [...selIds])).toEqual(['field.sheet.h1-1']);
  });

  test('a press that travels moves the field, and the words under it do not move', async ({ page }) => {
    const below = '[data-el="field.standfirst.p-1"]';
    const was = await topOf(page, below);
    const from = await pointAt(page, '[data-slot="sheet.h1-1"]', 'Coalition');
    await drag(page, from, 40, 160);
    const pos = await page.evaluate(() => layout.positions['field.sheet.h1-1']);
    expect(pos, 'the drop is recorded').toBeTruthy();
    expect(pos.reserve).toBeGreaterThan(0);
    // The strut holds the heading's MARGIN box: holding its border box left
    // the line below 12px short, and it rose that much on every move.
    expect(pos.reserveMargin).toBeTruthy();
    expect(await page.evaluate(() => editing)).toBe(false);
    expect(Math.abs(await topOf(page, below) - was), 'live').toBeLessThanOrEqual(1);
    await page.evaluate(() => render());
    await page.waitForTimeout(300);
    expect(Math.abs(await topOf(page, below) - was), 'rendered').toBeLessThanOrEqual(1);
    // And it draws where it was dropped.
    const drawn = await page.evaluate(() => _pilotMeasure('field.sheet.h1-1'));
    const p2 = await page.evaluate(() => layout.positions['field.sheet.h1-1']);
    expect(Math.abs(drawn.x - p2.x)).toBeLessThan(0.03);
    expect(Math.abs(drawn.y - p2.y)).toBeLessThan(0.03);
  });

  test('the width handle resizes a field', async ({ page }) => {
    const at = await pointAt(page, '[data-slot="sheet.h1-1"]', 'Priorities');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => editing)).toBe(false);
    const before = await page.evaluate(() => _pilotMeasure('field.sheet.h1-1').w);
    const h = page.frameLocator('#out').locator('.ds-handles .ds-h-e');
    await expect(h).toHaveCount(1);
    const hb = await h.boundingBox();
    await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, -160, 0);
    const pos = await page.evaluate(() => layout.positions['field.sheet.h1-1']);
    expect(pos && pos.w, 'a width is recorded').toBeTruthy();
    expect(pos.w).toBeLessThan(before - 1);
  });

  test('while the words are open, the grip under the box moves it and they stay open', async ({ page }) => {
    const at = await pointAt(page, '[data-slot="sheet.h1-1"]', 'Priorities');
    await page.mouse.click(at.x, at.y);
    expect((await caret(page)).editing).toBe(true);
    const grip = page.frameLocator('#out').locator('.ds-handles .ds-movegrip');
    await expect(grip).toHaveCount(1);
    // The floating strip goes while typing; the handles stay.
    await expect(page.frameLocator('#out').locator('.ds-mini')).toHaveCount(0);
    const gb = await grip.boundingBox();
    await drag(page, { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 }, 30, 120);
    expect(await page.evaluate(() => layout.positions['field.sheet.h1-1']), 'moved').toBeTruthy();
    const c = await caret(page);
    expect(c.editing, 'the words are still open').toBe(true);
    expect(c.inHost).toBe(true);
    await page.keyboard.type('Z');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => readSlot('sheet.h1-1'))).toContain('Z');
    expect(await page.evaluate(() => layout.positions['field.sheet.h1-1'])).toBeTruthy();
  });

  test('a stat card moves as one, its figure and label together', async ({ page }) => {
    // The voted card: its figure is computed from the turnout bar and its
    // label is a slot, and the card still moves as one.
    const card = '[data-el="stat.voted"]';
    await expect(page.frameLocator('#out').locator(`${card} [data-slot="lbl.span-1"]`)).toHaveCount(1);
    const from = await centreOf(page, card);
    await drag(page, from, 60, 40);
    expect(await page.evaluate(() => layout.positions['stat.voted'])).toBeTruthy();
  });

  test('a text box added to the page lands ON it, and stays where it was put', async ({ page }) => {
    // The renderer drew the editor's own layer after </section>, so a box was
    // positioned against <body> while the drag measured it against the page:
    // it drew one page-margin to the left of where it was dropped.
    const id = await page.evaluate(() =>
      docsync.api.addTextBox({ page: 1, x: 2, y: 3, w: 2.5, md: 'Probe' }).then(r => r.id));
    await expect.poll(() => page.evaluate(id =>
      !!document.getElementById('out').contentDocument
        .querySelector(`[data-el="${id}"]`)?.closest('section.page'), id)).toBe(true);
    const m = await page.evaluate(id => _pilotMeasure(id), id);
    expect(Math.abs(m.x - 2)).toBeLessThan(0.03);
    expect(Math.abs(m.y - 3)).toBeLessThan(0.03);
  });
});

test.describe('a click types on every kind of text', () => {
  test('a paragraph block (C.html) opens at the caret, not select-all', async ({ page }) => {
    await gotoEditor(page);
    const key = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const p = [...d.querySelectorAll('[data-el^="para."] > p[data-slot]')]
        .find(n => (n.textContent || '').trim().split(/\s+/).length > 8
          && n.getClientRects().length);
      return p && p.dataset.slot;
    });
    expect(key, 'the fixture has a paragraph block').toBeTruthy();
    const word = await page.evaluate(k => {
      const d = document.getElementById('out').contentDocument;
      return (d.querySelector(`p[data-slot="${k}"]`).textContent.trim()
        .split(/\s+/).find(w => /^[A-Za-z]{5,}$/.test(w)));
    }, key);
    const at = await pointAt(page, `p[data-slot="${key}"]`, word);
    await page.mouse.click(at.x, at.y);
    const c = await caret(page);
    expect(c.editing).toBe(true);
    expect(c.slot).toBe(key);
    expect(c.selected).toBe('');
    expect(c.collapsed).toBe(true);
    expect(c.inHost).toBe(true);
  });

  test('a text box opens at the caret on a click too', async ({ page }) => {
    await gotoEditor(page);
    const id = await page.evaluate(() =>
      docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: 'Alpha beta gamma delta' })
        .then(r => r.id));
    await page.evaluate(() => docsync.api.select(null));
    const at = await pointAt(page, `[data-el="${id}"]`, 'gamma', 1);
    await page.mouse.click(at.x, at.y);
    const c = await caret(page);
    expect(c.editing).toBe(true);
    expect(c.selected).toBe('');
    expect(c.before).toMatch(/beta $/);
  });

  test('a label inside a chart keeps its double-click: a click selects the drawing', async ({ page }) => {
    await gotoEditor(page, '?project=rxkids-fiscal');
    const sel = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const t = [...d.querySelectorAll('.ds-graphic svg text[data-slot]')]
        .find(n => n.getClientRects().length && (n.textContent || '').trim().length > 3);
      return t && `text[data-slot="${t.dataset.slot}"]`;
    });
    expect(sel, 'the fixture has a chart label').toBeTruthy();
    const at = await centreOf(page, sel);
    await page.mouse.click(at.x, at.y);
    expect(await page.evaluate(() => editing), 'a click selects, it does not type').toBe(false);
    expect((await page.evaluate(() => [...selIds])).length).toBe(1);
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.frameLocator('#out').locator('input.ds-svg-edit')).toHaveCount(1);
  });
});
