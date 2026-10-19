// Frame fitting (INDESIGN_PARITY.md 30): how a picture sits in its frame.
// `fit` is InDesign's fitting commands as object-fit — cover (Fill Frame
// Proportionally), contain (Fit Content Proportionally), fill (Fit Content to
// Frame), none (Center Content) — and `fitAlign` the reference point. Fitting
// fixes the frame at the size it has and fits the picture inside; a resized
// frame refits itself. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const PIC = 'assets/signing.jpg';

async function imageBox(page, w = 3) {
  const r = await page.evaluate(([src, ww]) => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: ww, md: `![The bill signing](${src})` }), [PIC, w]);
  expect(r.ok).toBe(true);
  await page.waitForFunction(i => {
    const im = $('out').contentDocument.querySelector(`[data-el="${i}"] img`);
    return im && im.complete && im.naturalWidth > 0;
  }, r.id);
  return r.id;
}
const imgStyle = (page, sel) => page.evaluate(s => {
  const el = $('out').contentDocument.querySelector(s);
  const im = el.tagName === 'IMG' ? el : el.querySelector('img');
  const c = getComputedStyle(im), r = im.getBoundingClientRect(), f = el.getBoundingClientRect();
  return { fit: c.objectFit, pos: c.objectPosition, ih: r.height, fh: f.height, iw: r.width, fw: f.width };
}, sel);

test.describe('frame fitting', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('an image box keeps its frame and fills it, anchored where asked', async ({ page }) => {
    const id = await imageBox(page);
    const before = await imgStyle(page, `[data-el="${id}"]`);
    const r = await page.evaluate(i => docsync.api.fit(i, 'cover', 'top'), id);
    expect(r.ok).toBe(true);
    const box = await page.evaluate(i => boxOf(i), id);
    expect(box.fit).toBe('cover');
    expect(box.h).toBeGreaterThan(0);                     // the frame got its height
    const s = await imgStyle(page, `[data-el="${id}"]`);
    expect(s.fit).toBe('cover');
    expect(s.pos).toBe('50% 0%');
    expect(Math.abs(s.ih - s.fh)).toBeLessThan(2);        // picture is the frame's height
    expect(Math.abs(s.fh - before.fh)).toBeLessThan(2);   // and the frame did not move
  });

  test('a taller frame refits: cover fills it, contain letterboxes', async ({ page }) => {
    const id = await imageBox(page);
    await page.evaluate(i => docsync.api.fit(i, 'cover'), id);
    await page.evaluate(i => docsync.api.place(i, { h: 4 }), id);
    const c = await imgStyle(page, `[data-el="${id}"]`);
    expect(Math.abs(c.ih - c.fh)).toBeLessThan(2);
    await page.evaluate(i => docsync.api.fit(i, 'contain'), id);
    expect((await imgStyle(page, `[data-el="${id}"]`)).fit).toBe('contain');
  });

  test('fit frame to content: the frame takes the picture\'s shape', async ({ page }) => {
    const id = await imageBox(page);
    await page.evaluate(i => docsync.api.fit(i, 'cover'), id);
    await page.evaluate(i => docsync.api.place(i, { h: 5 }), id);
    const r = await page.evaluate(i => docsync.api.fitFrame(i), id);
    expect(r.ok).toBe(true);
    const nat = await page.evaluate(i => {
      const im = $('out').contentDocument.querySelector(`[data-el="${i}"] img`);
      return im.naturalHeight / im.naturalWidth;
    }, id);
    // Polled: under load the re-rendered picture can still be decoding.
    await expect.poll(async () => {
      const s = await imgStyle(page, `[data-el="${id}"]`);
      return Math.round((s.ih / s.iw) * 20) / 20;
    }).toBeCloseTo(Math.round(nat * 20) / 20, 1);
  });

  test('clearing fitting gives the box back its growing height', async ({ page }) => {
    const id = await imageBox(page);
    await page.evaluate(i => docsync.api.fit(i, 'cover'), id);
    await page.evaluate(i => docsync.api.fit(i, null), id);
    const box = await page.evaluate(i => boxOf(i), id);
    expect(box.fit).toBeUndefined();
    expect((await imgStyle(page, `[data-el="${id}"]`)).fit).toBe('fill');   // the CSS default
  });

  test('a designed image fits in the flow, staying unplaced', async ({ page }) => {
    const id = 'onetime.photo';
    const has = await page.evaluate(i => !!$('out').contentDocument.querySelector(`[data-el="${i}"]`), id);
    test.skip(!has, 'the fixture has no onetime.photo');
    const r = await page.evaluate(i => docsync.api.fit(i, 'contain', 'bottom right'), id);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => layout.img[i], id)).toMatchObject({ fit: 'contain', fitAlign: 'bottom right' });
    expect(await page.evaluate(i => layout.img[i].h > 0 && !layout.positions[i], id)).toBe(true);
    const s = await imgStyle(page, `[data-el="${id}"]`);
    expect(s.fit).toBe('contain');
    expect(s.pos).toBe('100% 100%');
  });

  test('fit refuses what is not a picture', async ({ page }) => {
    const words = (await page.evaluate(() => docsync.api.addTextBox(
      { page: 3, x: 1, y: 1, w: 2, md: 'words' }))).id;
    expect((await page.evaluate(i => docsync.api.fit(i, 'cover'), words)).ok).toBe(false);
    const id = await imageBox(page);
    expect((await page.evaluate(i => docsync.api.fit(i, 'zoom'), id)).ok).toBe(false);
  });

  test('the image menu offers Fitting, with an anchor grid once fitted', async ({ page }) => {
    const id = await imageBox(page);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${id}"]`).click({ button: 'right' });
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Fitting' }).hover();
    await frame.locator('.ds-submenu button', { hasText: 'Fill frame proportionally' }).click();
    await expect.poll(() => page.evaluate(i => boxOf(i).fit, id)).toBe('cover');
    await frame.locator(`[data-el="${id}"]`).click({ button: 'right' });
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Fitting' }).hover();
    await frame.locator('.ds-fitgrid button[title="bottom"]').click();
    await expect.poll(() => page.evaluate(i => boxOf(i).fitAlign, id)).toBe('bottom');
  });
});
