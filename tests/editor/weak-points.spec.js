// The weak points found on 2026-10-21 (WEAK-POINTS-2026-10-21.md), each
// pinned here; every test fails against the editor before its fix.
const { test: plainTest, warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const PROJ = '?project=uhero-trc-summary';
const P = 'para.groc.lead', SLOT = 'groc.lead';

const addBox = (page, o) => page.evaluate(async o => (await docsync.api.addTextBox(o)).id, o);
const boxOf = (page, id) => page.evaluate(id => {
  const b = layout.boxes.find(b => 'text.' + b.id === id);
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h, z: b.z, page: b.page, md: b.md, fill: b.fill } : null;
}, id);
const nBoxes = page => page.evaluate(() => layout.boxes.length);
const select = async (page, ids) => {
  await page.evaluate(ids => docsync.api.select(ids), ids);
  await page.waitForTimeout(400);
};
const state = page => page.evaluate(() => ({
  editing, sel: [...selIds], dirty, clip: !!clip, hist: historySeq,
  stat: $('stat').textContent, failed: renderFailed,
}));
const centre = async (page, id) => {
  await page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`)
    .scrollIntoView({ block: 'center' }), id);
  await page.waitForTimeout(300);
  return page.frameLocator('#out').locator(`[data-el="${id}"]`).boundingBox();
};
async function clickWords(page, id) {
  const b = await page.frameLocator('#out').locator(`[data-el="${id}"] [data-slot]`).first().boundingBox();
  await page.mouse.click(b.x + b.width * 0.4, b.y + 8);
  await page.waitForTimeout(600);
}
async function drag(page, from, dx, dy, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await page.waitForTimeout(800);
}

test.describe('a pilot verb on its own is refused as a batch is', () => {
  for (const [name, src, what] of [
    ['place with NaN', 'id => docsync.api.place(id, { x: NaN })', /x must be a number/],
    ['place with a string', "id => docsync.api.place(id, { x: '2in' })", /x must be a number/],
    ['place with w 0', 'id => docsync.api.place(id, { w: 0 })', /w must be more than 0in/],
    ['recolor with junk', "id => docsync.api.recolor(id, 'not-a-colour')", /not a colour/],
    ['setSlot with an object', "() => docsync.api.setSlot('groc.lead', { md: 'x' })", /one string/],
    ['setSlot with a slot marker', "() => docsync.api.setSlot('groc.lead', 'words\\n\\n[[groc.pay.p]]\\n\\nmore')", /slot marker/],
    ['addTextBox with w -2', "() => docsync.api.addTextBox({ page: 2, x: 1, y: 3, w: -2, md: 'neg' })", /w must be more than 0in/],
  ]) {
    test(name, async ({ page }) => {
      await gotoEditor(page, PROJ);
      const id = await addBox(page, { page: 2, x: 1, y: 1, w: 3, md: 'R' });
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => ({ layout: JSON.stringify(layout), src: source, hist: historySeq }));
      const r = await page.evaluate(async ([id, src]) => {
        try { return await new Function('id', 'return (' + src + ')(id)')(id); }
        catch (e) { return { threw: String(e.message || e) }; }
      }, [id, src]);
      await page.waitForTimeout(600);
      expect(r.ok).toBe(false);
      expect(r.threw).toBeUndefined();
      expect(r.error).toMatch(what);
      expect(r.error).not.toMatch(/^op 0/);
      const after = await page.evaluate(() => ({ layout: JSON.stringify(layout), src: source, hist: historySeq }));
      expect(after).toEqual(before);                    // nothing changed, no undo step
      expect(await page.evaluate(() => renderFailed)).toBe(false);
      expect(await boxOf(page, id)).toMatchObject({ x: 1, w: 3 });
    });
  }

  test('a swatch, tinted or not, is a colour and never a batch ref', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const r = await page.evaluate(async () => {
      pushHistory();
      layout.swatches = { ...(layout.swatches || {}), Brand: '#1E6194' };
      markDirty(); await render();
      const s = await docsync.api.addShape({ page: 2, kind: 'rect', x: 2, y: 3, w: 2, h: 1, fill: '@Brand 20%' });
      const b = await docsync.api.addTextBox({ page: 2, x: 1, y: 1, w: 3, md: 'R' });
      const c = await docsync.api.recolor(b.id, '@Brand');
      const d = await docsync.api.recolor(b.id, '@Nope');
      return { s: s.ok, sfill: s.ok && layout.shapes.find(x => x.id === s.id.replace(/^shape\./, '')) ? 'shape' : s.error,
               c: c.ok, fill: layout.boxes.find(x => 'text.' + x.id === b.id).fill, d: d.ok, derr: d.error };
    });
    expect(r).toMatchObject({ s: true, c: true, fill: '@Brand', d: false, derr: "no swatch called 'Nope'" });
  });

  test('a hex colour, a swatch and null still recolour', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 2, x: 1, y: 1, w: 3, md: 'R' });
    const r = await page.evaluate(async id => {
      const a = await docsync.api.recolor(id, '#FFF6D8');
      const fill1 = layout.boxes.find(b => 'text.' + b.id === id).fill;
      const b = await docsync.api.recolor(id, null);
      const fill2 = layout.boxes.find(b => 'text.' + b.id === id).fill;
      return { a: a.ok, fill1, b: b.ok, fill2, id: a.id, box: a.fill };
    }, id);
    expect(r).toMatchObject({ a: true, fill1: '#FFF6D8', b: true, fill2: undefined, id, box: '#FFF6D8' });
  });
});

test.describe('a fake ʻokina becomes the real one as the words are committed', () => {
  test('typed into a paragraph', async ({ page }) => {
    await gotoEditor(page, PROJ);
    await centre(page, P);
    await clickWords(page, P);
    await page.keyboard.type(" Hawai'i, O’ahu and Kaua`i; Hawaii's ʻohana says it's ");   // okina-lint:ignore — the fake ʻokina is the point
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const now = await page.evaluate(k => readSlot(k), SLOT);
    expect(now).toContain("Hawaiʻi, Oʻahu and Kauaʻi; Hawaii's ʻohana says it's");
  });

  test('sent by a pilot, and in a new text box', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const r = await page.evaluate(async () => {
      await docsync.api.setSlot('groc.lead', "Groceries in Hawai'i and on O'ahu.");   // okina-lint:ignore — the fake ʻokina is the point
      const t = await docsync.api.addTextBox({ page: 2, x: 1, y: 1, w: 3, md: "Lana'i and Moloka'i" });   // okina-lint:ignore — the fake ʻokina is the point
      return { slot: readSlot('groc.lead'), box: layout.boxes.find(b => 'text.' + b.id === t.id).md };
    });
    expect(r).toEqual({ slot: 'Groceries in Hawaiʻi and on Oʻahu.', box: 'Lānaʻi and Molokaʻi' });
  });

  plainTest('a Save a hook refused keeps its whole message in the status tooltip', async ({ page, context }) => {
    const msg = 'git commit failed:\nokina: fake ʻokina found — the correct character is U+02BB (ʻ)\n\n'
      + '  projects/x/content.md:3: "Hawai\'i" should be \'Hawaiʻi\'\n  To fix and re-stage:\n'
      + '      python3 ~/.config/git-hooks/okina-lint.py --fix';
    await context.route(/\/__save(\?|$)/, route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ok: false, error: msg }) }));
    await gotoEditor(page, PROJ);
    await page.evaluate(() => docsync.api.setSlot('groc.lead', 'changed'));
    await page.waitForTimeout(500);
    await page.evaluate(() => docsync.api.save());
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({ text: $('stat').textContent, title: $('stat').title, disabled: $('save').disabled }));
    expect(st.text).toMatch(/^save failed: git commit failed: okina: fake ʻokina found/);
    expect(st.text).not.toContain('\n');
    expect(st.title).toBe(msg);
    expect(st.disabled).toBe(false);
  });
});

test.describe('the object chords every design tool shares', () => {
  test('⌘⇧] brings to the front and ⌘⇧[ sends to the back', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const a = await addBox(page, { page: 2, x: 1, y: 1, w: 3, md: 'A' });
    const b = await addBox(page, { page: 2, x: 1.5, y: 1.2, w: 3, md: 'B' });
    const c = await addBox(page, { page: 2, x: 2, y: 1.4, w: 3, md: 'C' });
    await centre(page, a);
    await select(page, [a]);
    await page.keyboard.press('Meta+Shift+BracketRight');
    await page.waitForTimeout(700);
    const z = async () => [(await boxOf(page, a)).z, (await boxOf(page, b)).z, (await boxOf(page, c)).z];
    let zs = await z();
    expect(zs[0]).toBeGreaterThan(Math.max(zs[1], zs[2]));
    await page.keyboard.press('Meta+Shift+BracketLeft');
    await page.waitForTimeout(700);
    zs = await z();
    expect(zs[0]).toBeLessThan(Math.min(zs[1], zs[2]));
  });

  test('⌘A selects everything placed on the page, not the chrome\'s words', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const a = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
    const b = await addBox(page, { page: 2, x: 4, y: 1, w: 2, md: 'B' });
    const other = await addBox(page, { page: 3, x: 1, y: 1, w: 2, md: 'elsewhere' });
    await centre(page, a);
    await select(page, [a]);
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(500);
    const s = await state(page);
    expect(s.sel).toEqual(expect.arrayContaining([a, b]));
    expect(s.sel).not.toContain(other);
    expect(await page.evaluate(() => document.getSelection().toString().length)).toBe(0);
    // and from inside the page's own document, with nothing selected
    await page.keyboard.press('Escape');
    await page.frameLocator('#out').locator('section.page').nth(1).click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(500);
    expect((await state(page)).sel).toEqual(expect.arrayContaining([a, b]));
  });

  test('⌘X cuts, and ⌘V puts it on the page in view', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 1, x: 1, y: 2, w: 3, md: 'Cut me' });
    await centre(page, id);
    await select(page, [id]);
    const n0 = await nBoxes(page);
    await page.keyboard.press('Meta+x');
    await page.waitForTimeout(800);
    expect(await nBoxes(page)).toBe(n0 - 1);
    expect(await boxOf(page, id)).toBeNull();
    expect((await state(page)).clip).toBe(true);
    await page.evaluate(() => $('out').contentDocument.querySelectorAll('section.page')[2].scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(800);
    expect(await nBoxes(page)).toBe(n0);
    const last = await page.evaluate(() => { const b = layout.boxes[layout.boxes.length - 1]; return { page: b.page, md: b.md }; });
    expect(last).toEqual({ page: 3, md: 'Cut me' });
  });

  test('Ctrl+Y redoes', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 2, x: 1, y: 1, w: 3, md: 'N' });
    await centre(page, id);
    await select(page, [id]);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1200);
    expect((await boxOf(page, id)).x).toBeCloseTo(1.05, 2);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(800);
    expect((await boxOf(page, id)).x).toBe(1);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(800);
    expect((await boxOf(page, id)).x).toBeCloseTo(1.05, 2);
  });

  test('Enter opens a selected text box\'s words, and Escape keeps them', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 2, x: 1, y: 1, w: 3, md: 'Open me' });
    await centre(page, id);
    await select(page, [id]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    expect((await state(page)).editing).toBe(true);
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    expect((await boxOf(page, id)).md).toBe('Open me now');
  });
});

test.describe('a selection of several has handles', () => {
  test('two text boxes, and a group: four corners that scale them together', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const a = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
    const b = await addBox(page, { page: 2, x: 4, y: 2, w: 2, md: 'B' });
    await centre(page, a);
    await select(page, [a, b]);
    const handles = () => page.evaluate(() => [...$('out').contentDocument.querySelectorAll('.ds-handles-group .ds-h')].map(h => h.className));
    expect((await handles()).length).toBe(4);
    await page.keyboard.press('Meta+g');
    await page.waitForTimeout(800);
    expect((await handles()).length).toBe(4);
    const h = await page.frameLocator('#out').locator('.ds-handles-group .ds-h-se').boundingBox();
    const a0 = await boxOf(page, a), b0 = await boxOf(page, b);
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, 192, 0);   // 2in at 100%
    const a1 = await boxOf(page, a), b1 = await boxOf(page, b);
    // The union was 5in wide (1 → 6): +2in is ×1.4, about the top-left corner.
    expect(a1.x).toBeCloseTo(1, 1);
    expect(a1.y).toBeCloseTo(1, 1);
    expect(a1.w).toBeCloseTo(2.8, 1);
    expect(b1.x).toBeCloseTo(1 + 3 * 1.4, 1);
    expect(b1.w).toBeCloseTo(2.8, 1);
    expect(b1.y).toBeGreaterThan(b0.y);
    expect(await page.evaluate(() => renderFailed)).toBe(false);
    await page.evaluate(() => undo());
    await page.waitForTimeout(800);
    expect(await boxOf(page, a)).toMatchObject({ x: a0.x, w: a0.w });
    expect(await boxOf(page, b)).toMatchObject({ x: b0.x, w: b0.w });
  });
});

test.describe('from outside, with nothing open', () => {
  test('pasted words become a text box on the page in view', async ({ page }) => {
    await gotoEditor(page, PROJ);
    await page.evaluate(() => $('out').contentDocument.querySelectorAll('section.page')[1].scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    const n0 = await nBoxes(page);
    const prevented = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', "Words from the clipboard about Hawai'i");   // okina-lint:ignore — the fake ʻokina is the point
      return !$('out').contentDocument.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(1200);
    expect(prevented).toBe(true);
    expect(await nBoxes(page)).toBe(n0 + 1);
    const last = await page.evaluate(() => { const b = layout.boxes[layout.boxes.length - 1]; return { page: b.page, md: b.md }; });
    expect(last).toEqual({ page: 2, md: 'Words from the clipboard about Hawaiʻi' });
    expect((await state(page)).sel).toEqual(['text.' + await page.evaluate(() => layout.boxes[layout.boxes.length - 1].id)]);
  });

  test('a pasted or dropped picture becomes a picture box; the drop lands under the pointer', async ({ page }) => {
    await gotoEditor(page, PROJ);
    await page.evaluate(() => $('out').contentDocument.querySelectorAll('section.page')[1].scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    const n0 = await nBoxes(page);
    const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    await page.evaluate(png => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(png)], 'pasted.png', { type: 'image/png' }));
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [...png()]);
    await page.waitForTimeout(2500);
    expect(await nBoxes(page)).toBe(n0 + 1);
    let last = await page.evaluate(() => layout.boxes[layout.boxes.length - 1]);
    expect(last.md).toMatch(/^!\[pasted\.png\]\(.*pasted\.png\)$/);
    expect(last.page).toBe(2);
    // the drop: Chrome's default (opening the file) is taken over, and the
    // box lands where the pointer let go
    const r = await page.evaluate(png => {
      const d = $('out').contentDocument;
      const pg = d.querySelectorAll('section.page')[1];
      const pr = pg.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(png)], 'dropped.png', { type: 'image/png' }));
      const over = pg.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: pr.left + 300, clientY: pr.top + 400 }));
      const drop = pg.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: pr.left + 300, clientY: pr.top + 400 }));
      return { overPrevented: !over, dropPrevented: !drop, zoom: zoomOf(pg) };
    }, [...png()]);
    await page.waitForTimeout(2500);
    expect(r.overPrevented).toBe(true);
    expect(r.dropPrevented).toBe(true);
    expect(await nBoxes(page)).toBe(n0 + 2);
    last = await page.evaluate(() => layout.boxes[layout.boxes.length - 1]);
    expect(last.md).toMatch(/dropped\.png/);
    expect(last.page).toBe(2);
    expect(last.x).toBeCloseTo(300 / 96 / r.zoom - 1.5, 1);
    expect(last.y).toBeCloseTo(400 / 96 / r.zoom - 0.5, 1);
  });
});

test.describe('the hand, and a table that grows', () => {
  test('Space-drag pans the page and selects nothing', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 2, x: 1, y: 1, w: 3, md: 'S' });
    await centre(page, id);
    await page.keyboard.press('Escape');
    const pg = await page.frameLocator('#out').locator('section.page').nth(1).boundingBox();
    const sc0 = await page.evaluate(() => $('out').contentWindow.scrollY);
    // from a point on the sheet that is on screen (the page is taller than the viewport)
    await drag(page, { x: pg.x + pg.width / 2, y: Math.min(pg.y + 400, 600) }, 0, -150, ['Space']);
    const sc1 = await page.evaluate(() => $('out').contentWindow.scrollY);
    expect(sc1 - sc0).toBeGreaterThan(100);
    const s = await state(page);
    expect(s.sel).toEqual([]);
    expect(await boxOf(page, id)).toMatchObject({ x: 1, y: 1 });
    expect(await page.evaluate(() => $('out').contentDocument.body.classList.contains('ds-hand'))).toBe(false);
  });

  test('Tab out of the last cell adds a row and opens its first cell', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const tid = await page.evaluate(async () => (await docsync.api.addTable({ page: 2, x: 1, y: 2, w: 4, headerRows: 1,
      rows: [['Program', 'FY26'], ['SNAP', '14.75']] })).id);
    await centre(page, tid);
    await page.frameLocator('#out').locator(`[data-el="${tid}"] td[data-cell="1,1"]`).dblclick();
    await page.waitForTimeout(500);
    expect((await state(page)).editing).toBe(true);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1200);
    const rows = () => page.evaluate(id => layout.tables.find(t => 'table.' + t.id === id).rows, tid);
    expect((await rows()).length).toBe(3);
    const where = await page.evaluate(() => { const a = $('out').contentDocument.activeElement; const td = a && a.closest ? a.closest('td') : null; return { editing, cell: td ? td.dataset.cell : null }; });
    expect(where).toEqual({ editing: true, cell: '2,0' });
    await page.keyboard.type('WIC');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(800);
    expect((await rows())[2][0]).toBe('WIC');
    // Shift+Tab out of the first cell adds nothing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.frameLocator('#out').locator(`[data-el="${tid}"] td[data-cell="1,0"]`).dblclick();
    await page.waitForTimeout(500);
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(800);
    expect((await rows()).length).toBe(3);
  });
});
