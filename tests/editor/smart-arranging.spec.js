// Smarter arranging (INDESIGN_PARITY.md 57): the key object, Distribute with
// an exact gap, and equal-spacing guides while dragging. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

/** Three one-inch text boxes on the first page, at the given x (and y). */
const addBoxes = (page, spots) => page.evaluate(async spots => {
  const pid = pageOrder()[0];
  const ids = [];
  for (const [x, y, w] of spots)
    ids.push((await docsync.api.addTextBox({ page: pid, x, y, w: w || 1, md: 'box' })).id);
  return ids;
}, spots);

const boxOf = (page, id) => page.evaluate(id => {
  const d = document.getElementById('out').contentDocument;
  const el = d.querySelector(`[data-el="${CSS.escape(id)}"]`);
  const b = inchBox(el, el.closest('section.page'));
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}, id);

test.describe('smarter arranging', () => {
  test('shift-click adds to the selection even from words being typed', async ({ page }) => {
    // A click in a box types there; a shift-click on another object then
    // closed the words and selected nothing more, so "click this, shift-click
    // that" never made a selection of two to align or put a picture into.
    await gotoEditor(page);
    const ids = await page.evaluate(async () => ({
      t: (await docsync.api.addTextBox({ page: 3, x: 1, y: 2, w: 2, md: 'Words here' })).id,
      r: (await docsync.api.addShape({ page: 3, kind: 'rect', x: 5, y: 2, w: 1.5, h: 1, fill: '#cccccc' })).id }));
    await page.evaluate(s => $('out').contentDocument.querySelector(s).scrollIntoView({ block: 'center' }), `[data-el="${ids.t}"]`);
    await page.waitForTimeout(800);
    const box = async s => { const fr = await page.locator('#out[data-ds-live]').boundingBox();
      const r = await page.evaluate(s => { const b = $('out').contentDocument.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }, s);
      return [fr.x + r[0] + r[2] / 2, fr.y + r[1] + r[3] / 2]; };
    const [tx, ty] = await box(`[data-el="${ids.t}"]`);
    await page.mouse.click(tx, ty);
    await expect.poll(() => page.evaluate(() => editing)).toBe(true);
    const [rx, ry] = await box(`[data-shape="${ids.r}"]`);
    await page.keyboard.down('Shift'); await page.mouse.click(rx, ry); await page.keyboard.up('Shift');
    await expect.poll(() => page.evaluate(() => [...selIds].sort())).toEqual([ids.t, ids.r].sort());
    expect(await page.evaluate(() => editing)).toBe(false);
  });
  test('a second click on a selected thing makes it the key object, and Align keeps it still',
    async ({ page }) => {
      await gotoEditor(page, '?project=demo-report');
      const [a, b, c] = await addBoxes(page, [[0.8, 8], [2.6, 8.5], [4.4, 9]]);
      await page.evaluate(ids => docsync.api.select(ids), [a, b, c]);
      const B0 = await boxOf(page, b);
      // A real click, on b's own box, that does not travel.
      const at = await page.evaluate(id => {
        const f = document.getElementById('out');
        const el = f.contentDocument.querySelector(`[data-el="${CSS.escape(id)}"]`);
        el.scrollIntoView({ block: 'center' });
        const fr = f.getBoundingClientRect(), r = el.getBoundingClientRect();
        return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2 };
      }, b);
      await page.mouse.click(at.x, at.y);
      const key = await page.evaluate(() => ({ key: keyOf(), n: selIds.size,
        ring: !!document.getElementById('out').contentDocument.querySelector('.ds-key') }));
      expect(key).toEqual({ key: b, n: 3, ring: true });
      await page.evaluate(() => alignSel(document.getElementById('out').contentDocument, 'left'));
      await page.evaluate(() => render());
      const [A1, B1, C1] = [await boxOf(page, a), await boxOf(page, b), await boxOf(page, c)];
      expect(near(B1.x, B0.x) && near(B1.y, B0.y), `key moved ${B0.x} -> ${B1.x}`).toBe(true);
      expect(near(A1.x, B0.x), `a to the key: ${A1.x}`).toBe(true);
      expect(near(C1.x, B0.x), `c to the key: ${C1.x}`).toBe(true);
    });

  test('without a key object, Align to page puts several on the page, not on each other',
    async ({ page }) => {
      await gotoEditor(page, '?project=demo-report');
      const [a, b] = await addBoxes(page, [[1.5, 8], [3, 8.6]]);
      const r = await page.evaluate(ids => docsync.api.align(ids, 'left', { to: 'page' }), [a, b]);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      const m = await page.evaluate(() => MARGIN_IN);
      expect(near(r.boxes[a].x, m) && near(r.boxes[b].x, m), JSON.stringify(r.boxes)).toBe(true);
      // to: 'key' with no key refuses rather than guessing.
      const k = await page.evaluate(ids => docsync.api.align(ids, 'top', { to: 'key' }), [a, b]);
      expect(k.ok).toBe(false);
    });

  test('Distribute with a gap spaces exactly, out from the key object', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const [a, b, c] = await addBoxes(page, [[0.8, 8], [3, 8], [5.5, 8]]);
    const r = await page.evaluate(ids => docsync.api.distribute(ids, 'h', { gap: 0.25, key: ids[1] }), [a, b, c]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const { [a]: A, [b]: B, [c]: C } = r.boxes;
    expect(near(B.x, 3), `key stayed: ${B.x}`).toBe(true);
    expect(near(C.x - (B.x + B.w), 0.25), `b→c gap ${C.x - (B.x + B.w)}`).toBe(true);
    expect(near(B.x - (A.x + A.w), 0.25), `a→b gap ${B.x - (A.x + A.w)}`).toBe(true);
    // Two things are enough for an exact gap; an even spread still wants three.
    const two = await page.evaluate(ids => docsync.api.distribute(ids, 'v', { gap: 0.5 }), [a, b]);
    expect(two.ok, JSON.stringify(two)).toBe(true);
    expect(near(two.boxes[b].y - (two.boxes[a].y + two.boxes[a].h), 0.5)).toBe(true);
    const even = await page.evaluate(ids => docsync.api.distribute(ids, 'h'), [a, b]);
    expect(even.ok).toBe(false);
    // One undo step each.
    await page.evaluate(() => undo());
    const back = await boxOf(page, b);
    expect(near(back.y, 8), `undo put b back: ${back.y}`).toBe(true);
  });

  test('the gap field and Align to sit in the strip when several are selected', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const ids = await addBoxes(page, [[0.8, 8], [3, 8]]);
    await page.evaluate(ids => docsync.api.select(ids), ids);
    await page.locator('#ar-pos').click();                        // the Position pop
    await expect(page.locator('#ar-gap')).toBeVisible();
    await expect(page.locator('#ar-alto')).toBeVisible();
    await expect(page.locator('#ar-dh')).toBeDisabled();          // two: no even spread
    await page.locator('#ar-gap').fill('0.3');
    await expect(page.locator('#ar-dh')).toBeEnabled();           // but a gap is fine
    await page.locator('#ar-dh').click();
    const [A, B] = [await boxOf(page, ids[0]), await boxOf(page, ids[1])];
    expect(near(B.x - (A.x + A.w), 0.3), `gap ${B.x - (A.x + A.w)}`).toBe(true);
  });

  test('dragging between two things clicks to the middle and shows the equal gaps',
    async ({ page }) => {
      await gotoEditor(page, '?project=demo-report');
      const [a, b, c] = await addBoxes(page, [[0.8, 8], [5.2, 8], [2.6, 9.5]]);
      // c is 1in wide; a ends at 1.8 and b starts at 5.2, so the middle is 3.0.
      // Drag it up into the row and drop it 0.05in short of the middle.
      const C0 = await boxOf(page, c);
      const pts = await page.evaluate(([id, dx, dy]) => {
        const f = document.getElementById('out');
        const el = f.contentDocument.querySelector(`[data-el="${CSS.escape(id)}"]`);
        el.scrollIntoView({ block: 'center' });
        const fr = f.getBoundingClientRect(), r = el.getBoundingClientRect();
        const px = DPI * zoomOf(el.closest('section.page'));
        // Press on the box's edge band, not its words (a press on words that
        // does not travel types; one that travels moves either way).
        const x0 = fr.left + r.left + 3, y0 = fr.top + r.top + r.height / 2;
        return { x0, y0, x1: x0 + dx * px, y1: y0 + dy * px };
      }, [c, 3.0 - 0.05 - C0.x, -1.5]);
      await page.mouse.move(pts.x0, pts.y0);
      await page.mouse.down();
      await page.mouse.move(pts.x0 + 10, pts.y0 - 10, { steps: 3 });
      await page.mouse.move(pts.x1, pts.y1, { steps: 8 });
      const guides = await page.evaluate(() => [...document.getElementById('out').contentDocument
        .querySelectorAll('.ds-guide.gx')].map(g => g.dataset.gap));
      await page.mouse.up();
      await page.evaluate(() => render());
      const C1 = await boxOf(page, c);
      expect(near(C1.x, 3.0, 0.011), `dropped at ${C1.x}`).toBe(true);
      expect(guides.length, 'two gap markers').toBe(2);
      expect(guides[0]).toBe(guides[1]);
      expect(guides[0]).toBe('1.20');
    });

  test('a gap already on the page is offered to the next thing in the row', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const r = await page.evaluate(() => {
      // Pure: A [1,2] and B [2.5,3.5] are 0.5 apart; a box moved to just past B
      // clicks to 0.5 after it.
      const boxes = [{ x: 1, y: 8, w: 1, h: 0.4 }, { x: 2.5, y: 8, w: 1, h: 0.4 }];
      const s = spaceSnap(boxes, 'x', 4.03, 8.1, 1, 0.4);
      const far = spaceSnap(boxes, 'x', 4.6, 8.1, 1, 0.4);
      const offRow = spaceSnap(boxes, 'x', 4.03, 9.5, 1, 0.4);
      return { at: s && s.at, gaps: s && s.gaps.length, far, offRow };
    });
    expect(near(r.at, 4.0, 0.001), `at ${r.at}`).toBe(true);
    expect(r.gaps).toBe(2);
    expect(r.far, 'too far to snap').toBe(null);
    expect(r.offRow, 'not in the row').toBe(null);
  });
});
