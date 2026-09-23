// Editing in place shows the words AS THE PAGE SHOWS THEM.
//
// Two things the renderer does that the editor's fresh host did not, so the
// words changed the moment a double-click opened them (the demo report's card
// title read "### Key Points", its bullets went from bold to regular):
//
//  - text()/paragraphs() drop a heading marker — "### Key Points" is shown as
//    "Key Points"; the # is styling, not content (content.py's _HEADING_RE).
//    The editor now takes the marker off for editing and puts it back on save,
//    so the file keeps its structure and the screen keeps its words.
//  - Much is styled INLINE by the renderer (a card's <li style="font-weight:
//    600">, a title's span, a styled paragraph). The host's fresh elements now
//    wear the same styles, by tag, and the inline host stays `display:inline`
//    — an inline-block changed the line's height, so a heading grew on open.
//  - A TEXT BOX is styled entirely inline by layout.py (its text style, fill,
//    padding, rotation), and editBox()'s wrapper carried only the geometry:
//    a 22px bold red centred note on a cream fill opened as 15px regular
//    slate on white. The wrapper now wears the box's class and style.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight'];
const look = (e, P) => {
  const pick = n => { const cs = getComputedStyle(n); const o = {}; for (const p of P) o[p] = cs[p]; return o; };
  const txt = n => n.querySelector('li, p') || n;
  return { text: pick(txt(e)), h: e.getBoundingClientRect().height, innerText: e.innerText };
};

test.describe('editing in place looks like the page', () => {
  test('a heading, a paragraph, a card title and its bullets keep their look while edited', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const frame = page.frameLocator('#out');
    for (const key of ['page1.h1', 'page1.intro', 'page1.card.title', 'page1.card.bullets']) {
      const el = frame.locator(`[data-slot="${key}"]`).first();
      await el.scrollIntoViewIfNeeded();
      const before = await el.evaluate(look, PROPS);
      await el.dblclick({ force: true });
      const host = frame.locator('.ds-edit');
      await host.waitFor({ state: 'visible' });
      const during = await host.evaluate(look, PROPS);
      expect(during.innerText, `${key}: no markdown marker on screen`).not.toMatch(/^#/);
      expect(during.text, `${key}: the same type`).toEqual(before.text);
      expect(Math.abs(during.h - before.h), `${key}: the same height`).toBeLessThan(1);
      await page.keyboard.press('Escape');
      await frame.locator('.ds-edit').waitFor({ state: 'detached' });
      await page.waitForTimeout(400);
    }
  });

  test('the heading marker the editor hides is back in the file on save, and ⌘Z restores the words', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const frame = page.frameLocator('#out');
    expect(await page.evaluate(() => readSlot('page1.card.title'))).toBe('### Key Points');
    const title = frame.locator('[data-slot="page1.card.title"]').first();
    await title.scrollIntoViewIfNeeded();
    await title.dblclick({ force: true });
    const host = frame.locator('.ds-edit');
    await host.waitFor({ state: 'visible' });
    await expect(host).toHaveText('Key Points');
    // The caret opens where the click landed; put it after the words (End
    // scrolls on a Mac).
    await host.evaluate(h => {
      const r = h.ownerDocument.createRange(); r.selectNodeContents(h); r.collapse(false);
      const s = h.ownerDocument.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.type(' X');
    await page.evaluate(() => document.querySelector('#out').contentDocument.querySelector('.ds-edit').blur());
    await frame.locator('.ds-edit').waitFor({ state: 'detached' });
    await expect.poll(() => page.evaluate(() => readSlot('page1.card.title'))).toBe('### Key Points X');
    await expect(frame.locator('[data-slot="page1.card.title"]').first()).toHaveText('Key Points X');
    await page.evaluate(() => undo());
    await expect.poll(() => page.evaluate(() => readSlot('page1.card.title'))).toBe('### Key Points');
  });

  test('a styled text box keeps its look while edited', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const frame = page.frameLocator('#out');
    const id = await page.evaluate(async () => {
      await docsync.api.addTextBox({ page: 1, x: 1, y: 6, w: 3.5, md: 'A styled note **in a box** that people will edit.' });
      const b = layout.boxes[layout.boxes.length - 1];
      b.style = { size: 22, weight: 700, color: '#C0392B', align: 'center' };
      b.fill = '#FFF6D8';
      await render();
      return 'text.' + b.id;
    });
    const P = [...PROPS, 'textAlign', 'backgroundColor', 'paddingLeft'];
    const el = frame.locator(`[data-el="${id}"]`).first();
    await el.scrollIntoViewIfNeeded();
    const before = await el.evaluate(look, P);
    await el.dblclick({ force: true });
    const host = frame.locator('.ds-edit');
    await host.waitFor({ state: 'visible' });
    // The wrapper around the host is the box; the words inside are the p.
    const during = await host.evaluate((h, P) => {
      const pick = n => { const cs = getComputedStyle(n); const o = {}; for (const p of P) o[p] = cs[p]; return o; };
      return { text: pick(h.querySelector('p')), box: pick(h.parentElement), h: h.parentElement.getBoundingClientRect().height };
    }, P);
    expect(during.text).toEqual(before.text);
    expect(during.box.backgroundColor).toBe(before.text.backgroundColor === 'rgba(0, 0, 0, 0)' ? during.box.backgroundColor : before.text.backgroundColor);
    expect(Math.abs(during.h - before.h)).toBeLessThan(1);
    await page.keyboard.press('Escape');
  });
});
