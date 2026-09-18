// Anchored objects — InDesign's, for a figure or a note that belongs to a
// paragraph. A placed object is pinned by inch; once text reflows every one
// of them has to be dragged back. An anchored one names the paragraph it
// follows and its distance from it, and the engine's runtime puts it there
// after the browser sets the type — the same string in the published page and
// here. The engine half (attributes, host stamp, validation) is in
// docsync/test_docsync.py; this is the editor's promise: anchoring never moves
// the thing, moving the text does, dragging keeps the paragraph and changes
// the distance, and releasing leaves it where it stands.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const frame = page => page.frameLocator('#out');

/** The first real paragraph of prose in the document (the cover has none),
 *  where it sits in page inches, and the page number the renderer files
 *  boxes under — read off the engine's mount marker, not guessed. */
async function hostOn(page) {
  return page.evaluate(() => {
    const d = document.getElementById('out').contentDocument;
    const el = [...d.querySelectorAll('section.page p[data-slot]')]
      .find(p => p.textContent.trim().length > 60);
    const pg = el.closest('section.page');
    const mount = pg.querySelector('[data-ds-mount]');
    const num = mount ? +mount.dataset.dsMount
      : [...d.querySelectorAll('section.page')].indexOf(pg) + 1;
    // The slot's whole box: a slot of several paragraphs is several <p>s.
    const b = anchorHostBox(d, pg, el.dataset.slot);
    return { key: el.dataset.slot, top: b.y, bottom: b.y + b.h, page: num };
  });
}
const boxTop = (page, id) => page.evaluate(id => {
  const d = document.getElementById('out').contentDocument;
  const el = d.querySelector(`[data-el="${id}"]`);
  return inchBox(el, el.closest('section.page')).y;
}, id);

test('an anchored box follows its paragraph when the text above it grows, and a drag keeps the anchor',
  async ({ page }) => {
    await gotoEditor(page);
    const host = await hostOn(page);
    // A note under the paragraph, half an inch below its bottom edge.
    const y0 = +(host.bottom + 0.5).toFixed(2);
    const id = await page.evaluate(async ({ y, pg }) => {
      const got = await docsync.api.addTextBox({ page: pg, x: 5.5, y, w: 2.3, md: 'A note that belongs to this paragraph.' });
      return got.id;
    }, { y: y0, pg: host.page });
    await page.waitForTimeout(600);

    // Anchoring moves NOTHING: the box stays where it was put.
    const r = await page.evaluate(({ id, key }) => docsync.api.anchor(id, key, { edge: 'bottom' }), { id, key: host.key });
    expect(r.ok).toBe(true);
    await page.waitForTimeout(600);
    const st = await page.evaluate(id => layout.boxes.find(b => 'text.' + b.id === id).anchor, id);
    expect(st.to).toBe(host.key);
    expect(st.edge).toBe('bottom');
    expect(Math.abs(st.dy - 0.5)).toBeLessThan(0.03);
    expect(Math.abs((await boxTop(page, id)) - y0)).toBeLessThan(0.03);

    // Make the paragraph longer. Its bottom moves; the note moves with it,
    // by the same amount, without anyone dragging.
    await page.evaluate(async key => {
      const cur = docsync.api.getSlot(key).md;
      await docsync.api.setSlot(key, cur + '\n\nAnd another paragraph, added later, that pushes everything below it down the page by a line or three.');
    }, host.key);
    await page.waitForTimeout(1500);
    const host2 = await hostOn(page);
    expect(host2.key).toBe(host.key);
    const grew = host2.bottom - host.bottom;
    expect(grew).toBeGreaterThan(0.2);
    const top2 = await boxTop(page, id);
    expect(Math.abs((top2 - y0) - grew)).toBeLessThan(0.03);

    // A drag (place) keeps the paragraph and changes the DISTANCE.
    await page.evaluate(({ id, y }) => docsync.api.place(id, { y }), { id, y: +(top2 + 1).toFixed(2) });
    await page.waitForTimeout(1500);
    const st2 = await page.evaluate(id => layout.boxes.find(b => 'text.' + b.id === id).anchor, id);
    expect(st2.to).toBe(host.key);
    expect(Math.abs(st2.dy - 1.5)).toBeLessThan(0.04);
    expect(Math.abs((await boxTop(page, id)) - (top2 + 1))).toBeLessThan(0.03);

    // ⌘Z undoes the drag as one step: back to half an inch under the paragraph.
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(1500);
    expect(Math.abs((await boxTop(page, id)) - top2)).toBeLessThan(0.03);
  });

test('the Anchor button arms a click on the paragraph, and clicking it again releases where it stands',
  async ({ page }) => {
    await gotoEditor(page);
    const host = await hostOn(page);
    const id = await page.evaluate(async ({ y, pg }) => {
      const got = await docsync.api.addTextBox({ page: pg, x: 5.5, y, w: 2.3, md: 'Follows the text.' });
      await docsync.api.select(got.id);
      return got.id;
    }, { y: +(host.top + 0.3).toFixed(2), pg: host.page });
    await page.waitForTimeout(800);
    // A text box takes the type bar, and its Anchor button is there.
    await expect(page.locator('#ty-anchor')).toBeVisible();
    await page.click('#ty-anchor');
    await expect(page.locator('#ty-anchor')).toHaveClass(/arming/);
    await expect(page.locator('#stat')).toContainText('click the paragraph');
    // The armed click names the paragraph — and does NOT select it.
    await frame(page).locator(`[data-slot="${host.key}"]`).first().click();
    await page.waitForTimeout(1800);
    const st = await page.evaluate(id => layout.boxes.find(b => 'text.' + b.id === id).anchor, id);
    expect(st.to).toBe(host.key);
    expect(Math.abs(st.dy - 0.3)).toBeLessThan(0.03);
    expect(await page.evaluate(() => [...selIds])).toEqual([id]);
    await expect(page.locator('#ty-anchor')).toHaveClass(/\bon\b/);
    const before = await boxTop(page, id);

    // Release: the box stays exactly where the paragraph last put it.
    await page.click('#ty-anchor');
    await page.waitForTimeout(1800);
    expect(await page.evaluate(id => layout.boxes.find(b => 'text.' + b.id === id).anchor, id)).toBeUndefined();
    expect(Math.abs((await boxTop(page, id)) - before)).toBeLessThan(0.03);
    await expect(page.locator('#ty-anchor')).not.toHaveClass(/\bon\b/);

    // Esc disarms without anchoring.
    await page.click('#ty-anchor');
    await expect(page.locator('#ty-anchor')).toHaveClass(/arming/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ty-anchor')).not.toHaveClass(/arming/);
  });

test('a shape cannot be anchored, and the verb says why', async ({ page }) => {
  await gotoEditor(page);
  const r = await page.evaluate(async () => {
    const got = await docsync.api.addShape({ page: 1, kind: 'rect', x: 1, y: 1, w: 1, h: 1 });
    await docsync.api.select(got.id);
    const key = docsync.api.inventory().pages.flatMap(p => p.slots)[0].key;
    return { verb: await docsync.api.anchor(got.id, key), button: document.getElementById('ar-anchor').hidden };
  });
  expect(r.verb.ok).toBe(false);
  expect(r.verb.error).toMatch(/cannot be anchored/);
  expect(r.button).toBe(true);
});
