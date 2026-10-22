// Two seams hardened on 2026-10-22: the object chords live in ONE table that
// both documents' key listeners consult (a chord used to work only where it
// had been copied to), and a width or height lands through ONE commitSize
// (a handle drag, a group's corner and the pilot's place() each wrote the
// stores their own way and had drifted).
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const PROJ = '?project=uhero-trc-summary';
const P = 'para.groc.lead';

const addBox = (page, o) => page.evaluate(async o => (await docsync.api.addTextBox(o)).id, o);
const boxOf = (page, id) => page.evaluate(id => {
  const b = layout.boxes.find(b => 'text.' + b.id === id);
  return b ? { x: b.x, y: b.y, w: b.w, h: b.h, z: b.z } : null;
}, id);
const select = async (page, ids) => { await page.evaluate(ids => docsync.api.select(ids), ids); await page.waitForTimeout(150); };
const centre = async (page, id) => {
  await page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).scrollIntoView({ block: 'center' }), id);
  await page.waitForTimeout(100);
  return page.frameLocator('#out').locator(`[data-el="${id}"]`).boundingBox();
};
// Where the keyboard focus sits: the chrome (a click on the status bar's
// row) or the page's own document (a click on the sheet, which selects it).
async function focusChrome(page) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); document.body.focus(); });
  expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true);
}
async function focusPage(page) {
  // A click on the sheet keeps focus where it was (the press prevents its
  // default, so the page never "jumps"); the iframe's window takes it here.
  await page.evaluate(() => $('out').contentWindow.focus());
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('out');
}

test.describe('one chord table, both documents', () => {
  test('the table names every chord', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const names = await page.evaluate(() => window.__dsChords());
    for (const n of ['undo / redo', 'redo (Ctrl+Y)', 'to front / back', 'forward / back', 'select all on the page',
      'duplicate', 'copy / copy style', 'cut', 'paste in place', 'paste / paste style', 'step and repeat',
      'transform again', 'next / previous object', 'group / ungroup', 'deselect', 'delete', 'open the words', 'nudge'])
      expect(names, n).toContain(n);
  });

  for (const where of ['chrome', 'page']) {
    test(`from the ${where}: duplicate, nudge, to front, group, paste in place, next object, delete, undo`, async ({ page }) => {
      await gotoEditor(page, PROJ);
      const a = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
      const b = await addBox(page, { page: 2, x: 4, y: 1, w: 2, md: 'B' });
      await centre(page, a);
      const focus = where === 'chrome' ? focusChrome : focusPage;
      const n = () => page.evaluate(() => layout.boxes.length);
      const sel = () => page.evaluate(() => [...selIds]);

      await select(page, [a]); await focus(page);
      await page.keyboard.press('Meta+d'); await settled(page);
      expect(await n()).toBe(3);
      const dup = (await sel())[0];
      expect(dup).not.toBe(a);

      await select(page, [a]); await focus(page);
      await page.keyboard.press('ArrowRight'); await settled(page);
      expect((await boxOf(page, a)).x).toBeCloseTo(1.05, 2);

      await focus(page);
      await page.keyboard.press('Meta+Shift+BracketRight'); await settled(page);
      expect((await boxOf(page, a)).z).toBeGreaterThan((await boxOf(page, b)).z);

      await select(page, [a, b]); await focus(page);
      await page.keyboard.press('Meta+g'); await settled(page);
      expect(await page.evaluate(() => (layout.groups || []).length)).toBe(1);
      await page.keyboard.press('Meta+Shift+g'); await settled(page);
      expect(await page.evaluate(() => (layout.groups || []).length)).toBe(0);

      await select(page, [b]); await focus(page);
      await page.keyboard.press('Meta+c');
      await page.keyboard.press('Meta+Alt+Shift+v'); await settled(page);
      expect(await n()).toBe(4);
      const pasted = (await sel())[0];
      expect(await boxOf(page, pasted)).toMatchObject({ x: 4, y: 1 });   // in place

      await select(page, [a]); await focus(page);
      await page.keyboard.press('Alt+BracketRight'); await page.waitForTimeout(150);
      expect((await sel())[0]).not.toBe(a);

      await select(page, [pasted]); await focus(page);
      await page.keyboard.press('Backspace'); await settled(page);
      expect(await n()).toBe(3);
      await focus(page);
      await page.keyboard.press('Meta+z'); await settled(page);
      expect(await n()).toBe(4);
      await page.keyboard.press('Control+y'); await settled(page);
      expect(await n()).toBe(3);

      await select(page, [a]); await focus(page);
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      expect(await sel()).toEqual([]);
    });
  }

  test('a chord never fires inside a text field or open words', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const a = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
    await centre(page, a);
    await select(page, [a]);
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);     // the words open
    expect(await page.evaluate(() => editing)).toBe(true);
    await page.keyboard.press('Meta+d'); await page.waitForTimeout(300);     // ⌘D while typing: nothing
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape'); await settled(page);
    expect(await page.evaluate(() => layout.boxes.length)).toBe(1);
    expect((await boxOf(page, a))).not.toBeNull();
  });
});

test.describe('one size write', () => {
  test("place() writes a paragraph's height as its floor, like a drag", async ({ page }) => {
    await gotoEditor(page, PROJ);
    await centre(page, P);
    const r = await page.evaluate(async id => {
      const a = await docsync.api.place(id, { w: 4, h: 3 });
      const p = layout.positions[id];
      return { ok: a.ok, w: p && p.w, h: p && p.h, hmin: p && p.hmin };
    }, P);
    expect(r).toMatchObject({ ok: true, w: 4, h: 3, hmin: true });
    const r2 = await page.evaluate(async id => {
      await docsync.api.place(id, { h: 0.2 });                    // back to nothing: grows again
      const p = layout.positions[id];
      return { h: p.h, hmin: p.hmin, w: p.w };
    }, P);
    expect(r2).toEqual({ h: undefined, hmin: undefined, w: 4 });
  });

  test("place() gives a text box the drag's height floor, and a table width only", async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
    const tid = await page.evaluate(async () => (await docsync.api.addTable({ page: 2, x: 1, y: 3, w: 4, rows: [['a', 'b'], ['c', 'd']] })).id);
    const r = await page.evaluate(async ([id, tid]) => {
      await docsync.api.place(id, { h: 0.2 });                    // under the floor: auto height
      const b1 = layout.boxes.find(b => 'text.' + b.id === id);
      const h1 = b1.h;
      await docsync.api.place(id, { w: 3.333, h: 2.004 });
      const b2 = layout.boxes.find(b => 'text.' + b.id === id);
      const t = await docsync.api.place(tid, { w: 5, h: 9 });
      const tb = layout.tables.find(t => 'table.' + t.id === tid);
      return { h1, w: b2.w, h: b2.h, tok: t.ok, tw: tb.w, th: tb.h };
    }, [id, tid]);
    expect(r).toEqual({ h1: undefined, w: 3.33, h: 2, tok: true, tw: 5, th: undefined });
  });

  test('a corner drag and place() land on the same fields', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const id = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
    const bb = await centre(page, id);
    await select(page, [id]);
    const h = await page.frameLocator('#out').locator('.ds-h-se').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 96, h.y + 96, { steps: 6 });
    await page.mouse.up();
    await settled(page);
    const dragged = await boxOf(page, id);
    expect(dragged.w).toBeCloseTo(3, 1);
    expect(dragged.h).toBeGreaterThan(MINH(bb));
    const placed = await page.evaluate(async ([id, w, h]) => {
      await docsync.api.place(id, { w, h });
      const b = layout.boxes.find(b => 'text.' + b.id === id);
      return { w: b.w, h: b.h };
    }, [id, dragged.w, dragged.h]);
    expect(placed).toEqual({ w: dragged.w, h: dragged.h });
  });
});
const MINH = bb => 0.4;
