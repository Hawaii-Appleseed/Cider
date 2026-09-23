// A field must not change size, place or type the moment it is clicked.
//
// Reported on tfc-2027-priorities: "when I click on fields, they change in
// size." edit() opened every slot in a STAND-IN — a <div> wearing the slot's
// classes with a <p> inside — and an ingested page's fields are the page's
// own elements, styled by tag: the <h1> opened at 16px regular instead of
// 46.4px bold (the tag was gone, and .ds-edit's font:inherit outranked the
// page's h1 rule), a stat's <span> gained a paragraph's margins (30px tall
// became 89px), and the inline "of 30" beside it jumped onto a line of its
// own. Six of the first eight fields on the page moved.
//
// A slot that is ONE element holding one paragraph's words is now edited as
// that element (edit(): inPlace). What must still open in the stand-in is
// pinned too: a C.html paragraph slot, where Enter makes a second paragraph.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

// Open a slot as a person would (click, or double-click inside a movable
// object), measure it before and while open, then cancel.
async function openAndMeasure(page, key) {
  return page.evaluate(async (key) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const d = document.getElementById('out').contentDocument;
    const el = d.querySelector(`[data-slot="${key}"]`);
    // Measured from the top of the DOCUMENT: focusing a field below the fold
    // scrolls it into view, which is not the field moving.
    const box = e => { const r = e.getBoundingClientRect(), cs = d.defaultView.getComputedStyle(e);
      const o = d.body.getBoundingClientRect();
      return { tag: e.tagName, x: Math.round(r.left - o.left), y: Math.round(r.top - o.top), w: Math.round(r.width),
               h: Math.round(r.height), fs: cs.fontSize, fw: cs.fontWeight, display: cs.display }; };
    const before = box(el);
    el.dispatchEvent(new MouseEvent(el.closest('[data-el]') ? 'dblclick' : 'click',
      { bubbles: true, cancelable: true, view: d.defaultView }));
    await sleep(100);
    const host = d.querySelector(`.ds-edit[data-slot="${key}"]`);
    // A button is edited from a span INSIDE it; what must not change is the
    // button, so that is what is measured.
    const outer = host && host.parentElement && host.parentElement.tagName === 'BUTTON'
      && host.parentElement.dataset.slot === key ? host.parentElement : host;
    const open = host ? { ...box(outer), host: host.tagName, mode: host.dataset.richMode,
                          inPlace: host.classList.contains('ds-edit-in') } : null;
    if (host) host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    return { before, open };
  }, key);
}

test.describe('editing a field in place', () => {
  test('an ingested page\'s heading, stats and lede keep their size while open', async ({ page }) => {
    await gotoEditor(page, '?project=tfc-2027-priorities');
    for (const key of ['sheet.h1-1', 'num.span-2', 'of.span-1', 'lbl.span-1', 'standfirst.p-1']) {
      const { before, open } = await openAndMeasure(page, key);
      expect(open, `${key} opened an editor`).not.toBeNull();
      expect(open.inPlace, `${key} is edited as its own element`).toBe(true);
      expect(open.tag, `${key} keeps its tag`).toBe(before.tag);
      for (const k of ['x', 'y', 'w', 'h']) {
        expect(Math.abs(open[k] - before[k]), `${key} ${k}: ${before[k]} -> ${open[k]}`).toBeLessThanOrEqual(1);
      }
      expect(open.fs, `${key} font-size`).toBe(before.fs);
      expect(open.fw, `${key} font-weight`).toBe(before.fw);
      expect(open.display, `${key} display`).toBe(before.display);
    }
  });

  test('a heading edited in place commits to its slot and stays a heading', async ({ page }) => {
    await gotoEditor(page, '?project=tfc-2027-priorities');
    const frame = page.frameLocator('#out');
    const h1 = frame.locator('[data-slot="sheet.h1-1"]');
    const was = (await page.evaluate(() => readSlot('sheet.h1-1')));
    await h1.click();
    const host = frame.locator('.ds-edit[data-slot="sheet.h1-1"]');
    await expect(host).toHaveJSProperty('tagName', 'H1');
    // A click puts the caret where it landed (caretAt); put it after the
    // words, so the probe appends.
    await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const h = d.querySelector('.ds-edit[data-slot="sheet.h1-1"]');
      const r = d.createRange(); r.selectNodeContents(h); r.collapse(false);
      const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await host.pressSequentially(' PROBE');
    await host.press('Enter');                       // inline mode: Enter commits
    await expect.poll(() => page.evaluate(() => readSlot('sheet.h1-1'))).toBe(was + ' PROBE');
    await expect(frame.locator('h1[data-slot="sheet.h1-1"]')).toContainText('PROBE');
  });

  test('a button\'s words edit inside it, and Space types instead of pressing it', async ({ page }) => {
    // our-mission's phase tabs are <button> slots. The button stays (so its
    // size and its own rules do); only its words become editable.
    await gotoEditor(page, '?project=our-mission');
    const key = 'ha-five.phase-1';
    const { before, open } = await openAndMeasure(page, key);
    expect(open).not.toBeNull();
    expect(open.tag).toBe('BUTTON');
    expect(open.host).toBe('SPAN');
    for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(open[k] - before[k]), k).toBeLessThanOrEqual(1);
    expect(open.fs).toBe(before.fs);
    const frame = page.frameLocator('#out');
    const was = await page.evaluate(k => readSlot(k), key);
    const btn = frame.locator(`button[data-slot="${key}"]`);
    await btn.click();
    const host = frame.locator(`button[data-slot="${key}"] > .ds-edit`);
    await expect(host).toBeVisible();
    await expect(frame.locator(`button[data-slot="${key}"]`)).toHaveCount(1);   // still the button
    await page.evaluate(k => {
      const d = document.getElementById('out').contentDocument;
      const h = d.querySelector(`button[data-slot="${k}"] > .ds-edit`);
      const r = d.createRange(); r.selectNodeContents(h); r.collapse(false);
      const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    }, key);
    await host.pressSequentially(' A B');
    await host.press('Enter');
    await expect.poll(() => page.evaluate(k => readSlot(k), key)).toBe(was + ' A B');
  });

  test('a field drawn twice edits the copy clicked, with its own footnote numbers', async ({ page }) => {
    // The Budget Primer draws table 1 once per fiscal year and hides one.
    // Two copies read as a multi-paragraph slot, so a header opened as a
    // <div><p> and lost its bold; and the chips counted both copies'
    // numbers, gave up, and were labelled by id — a wider column.
    await gotoEditor(page);
    const key = 'table1.header.executive';
    const frame = page.frameLocator('#out');
    const th = frame.locator(`th[data-slot="${key}"]:visible`);
    await expect(th).toHaveCount(1);
    const b = await th.boundingBox();
    // edit() as the click handler calls it, with the copy that was clicked —
    // this pins what edit() does with a repeat, not how a click reaches it.
    await th.evaluate((el, key) => { const w = el.ownerDocument.defaultView.parent;
      w.showType(key); w.edit(el.ownerDocument, key, el); }, key);
    const host = frame.locator(`.ds-edit[data-slot="${key}"]`);
    await expect(host).toBeVisible();
    const a = await host.boundingBox();
    expect(await host.evaluate(h => h.tagName)).toBe('TH');
    expect(await host.evaluate(h => getComputedStyle(h).fontWeight)).toBe('600');
    expect(Math.abs(a.width - b.width), `${b.width} -> ${a.width}`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height), `${b.height} -> ${a.height}`).toBeLessThanOrEqual(1);
    await expect(host.locator('.ds-fnchip')).toHaveText('2');
    await expect(frame.locator(`[data-slot="${key}"]`)).toHaveCount(2);   // the other year's copy stays
    await host.press('Escape');
  });

  test('a stand-in list keeps its own classes, and its items theirs', async ({ page }) => {
    // rxkids-fiscal's benefit pills: ul.benefit-row is a flex row of
    // li.benefit-pill. The class went on the wrapper instead, the list
    // stacked, and 55px became 136px while open.
    await gotoEditor(page, '?project=rxkids-fiscal');
    const { before, open } = await openAndMeasure(page, 'p2.benefits.items');
    expect(open.mode).toBe('block');
    expect(Math.abs(open.h - before.h), `${before.h} -> ${open.h}`).toBeLessThanOrEqual(2);
  });

  test('a soft-wrapped inline slot opens on one line, and leaving it rewrites nothing', async ({ page }) => {
    // content.md wraps long lines; text() joins them with spaces. Opened
    // raw, each wrap became a <br> — a line the page does not have.
    await gotoEditor(page, '?project=staff-toolkit');
    const key = 'p2.sub';
    const was = await page.evaluate(k => readSlot(k), key);
    expect(was, 'the fixture slot is soft-wrapped').toContain('\n');
    const { before, open } = await openAndMeasure(page, key);
    expect(Math.abs(open.h - before.h), `${before.h} -> ${open.h}`).toBeLessThanOrEqual(1);
    // Open it and click away (a blur commits) without typing anything.
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-slot="${key}"]`).first().dblclick();
    await expect(frame.locator(`.ds-edit[data-slot="${key}"] br`)).toHaveCount(0);
    await page.evaluate(k => document.getElementById('out').contentDocument
      .querySelector(`.ds-edit[data-slot="${k}"]`).blur(), key);
    await page.waitForTimeout(600);
    expect(await page.evaluate(k => readSlot(k), key)).toBe(was);
  });

  test('a word wider than its box does not break mid-word when opened', async ({ page }) => {
    // Chrome gives [contenteditable] overflow-wrap:break-word; rxkids' 112px
    // "RxKeiki" overflows its heading slightly and broke onto two lines.
    await gotoEditor(page, '?project=rxkids');
    const { before, open } = await openAndMeasure(page, 'hero.title');
    expect(Math.abs(open.h - before.h), `${before.h} -> ${open.h}`).toBeLessThanOrEqual(1);
  });

  test('a C.html paragraph slot still opens as a block you can add paragraphs to', async ({ page }) => {
    await gotoEditor(page);
    const key = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const p = d.querySelector('[data-el^="para."] > p[data-slot]');
      return p && p.dataset.slot;
    });
    expect(key, 'the fixture has a C.html paragraph slot').toBeTruthy();
    const { open } = await openAndMeasure(page, key);
    expect(open).not.toBeNull();
    expect(open.inPlace).toBe(false);
    expect(open.mode).toBe('block');
    expect(open.tag).toBe('DIV');
  });
});
