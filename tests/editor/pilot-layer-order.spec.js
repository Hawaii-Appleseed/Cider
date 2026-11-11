// The connector's missing Arrange rows: sendToBack / bringToFront / sendBackward /
// bringForward / setLayer, and `behind` / `z` on addTextBox (which is what the
// hub's addImage becomes). The regression: a full-page picture added over a
// page's text hid it, and nothing a connector could send changed that.
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const zs = (page, ids) => page.evaluate(ids => ids.map(i => zOf(i)), ids);

test.describe('pilot layer order', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); await settled(page); });

  test('sendToBack puts a later full-page picture behind the text boxes', async ({ page }) => {
    const a = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2, md: 'title' }));
    const b = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 3, w: 2, md: 'subtitle' }));
    // the "background": a box holding a picture, added last so it is on top
    const bg = await page.evaluate(() => docsync.api.addTextBox(
      { page: 3, x: 0, y: 0, w: 8, md: '![bg](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=)' }));
    expect(a.ok && b.ok && bg.ok).toBe(true);
    let [za, zb, zbg] = await zs(page, [a.id, b.id, bg.id]);
    expect(zbg).toBeGreaterThan(Math.max(za, zb));
    const r = await page.evaluate(i => docsync.api.sendToBack([i]), bg.id);
    expect(r.ok).toBe(true);
    [za, zb, zbg] = await zs(page, [a.id, b.id, bg.id]);
    expect(zbg).toBeLessThan(Math.min(za, zb));
    // and it paints behind: the text boxes come later in paint order
    const order = await page.evaluate(ids => {
      const d = $('out').contentDocument;
      const zi = id => parseInt(getComputedStyle(d.querySelector(`[data-el="${CSS.escape(id)}"]`)).zIndex, 10);
      return ids.map(zi);
    }, [a.id, b.id, bg.id]);
    expect(order[2]).toBeLessThan(order[0]);
    expect(order[2]).toBeLessThan(order[1]);
    // one undo step takes it back to the front
    await page.evaluate(() => docsync.api.undo());
    expect((await zs(page, [bg.id]))[0]).toBeGreaterThan(Math.max(za, zb));
  });

  test('bringToFront, sendBackward and bringForward step like the menu', async ({ page }) => {
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push((await page.evaluate(i => docsync.api.addTextBox({ page: 3, x: 1, y: 1 + i, w: 2, md: 'b' + i }), i)).id);
    await page.evaluate(i => docsync.api.sendToBack(i), ids[2]);
    await page.evaluate(i => docsync.api.bringToFront(i), ids[2]);
    let z = await zs(page, ids);
    expect(z[2]).toBeGreaterThan(Math.max(z[0], z[1]));
    await page.evaluate(i => docsync.api.sendBackward(i), ids[2]);
    z = await zs(page, ids);
    expect(z[2]).toBeLessThan(z[1]);
    expect(z[2]).toBeGreaterThan(z[0]);
    await page.evaluate(i => docsync.api.bringForward(i), ids[2]);
    z = await zs(page, ids);
    expect(z[2]).toBeGreaterThan(z[1]);
  });

  test('addTextBox takes behind: true and z; setLayer sets a number; refusals are plain', async ({ page }) => {
    const a = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2, md: 'front' }));
    const back = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 0, y: 0, w: 4, md: 'back', behind: true }));
    let [za, zb] = await zs(page, [a.id, back.id]);
    expect(zb).toBeLessThan(0);
    expect(zb).toBeLessThan(za);
    const zed = await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 5, w: 2, md: 'z', z: 9 }));
    expect((await zs(page, [zed.id]))[0]).toBe(9);
    expect((await page.evaluate(i => docsync.api.setLayer(i, -5), zed.id)).ok).toBe(true);
    expect((await zs(page, [zed.id]))[0]).toBe(-5);
    expect((await page.evaluate(() => docsync.api.sendToBack(['no.such']))).ok).toBe(false);
    expect((await page.evaluate(() => docsync.api.setLayer('no.such', 1))).ok).toBe(false);
    expect((await page.evaluate(() => docsync.api.addTextBox({ page: 3, md: 'x', z: 'high' }))).ok).toBe(false);
    // batch: made behind and ordered in one undo step
    const r = await page.evaluate(() => docsync.api.batch([
      { verb: 'addTextBox', args: [{ page: 3, x: 0, y: 0, w: 3, md: 'bg2', behind: true }] },
    ]));
    expect(r.ok).toBe(true);
  });
});
