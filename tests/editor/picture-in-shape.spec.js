// A picture inside a shape (INDESIGN_PARITY.md 58, InDesign's Paste Into).
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addShape = async (page, kind) => {
  const r = await page.evaluate(k => docsync.api.addShape({ page: 3, kind: k, x: 1, y: 1, w: 2, h: 2, fill: '#EEEEEE' }), kind);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};
const drawn = (page, id) => page.evaluate(i => {
  const g = $('out').contentDocument.querySelector(`[data-shape="${CSS.escape(i)}"]`);
  const im = g && g.querySelector('image');
  return im && { tag: g.tagName, href: im.getAttribute('href'), clip: im.getAttribute('clip-path'),
                 clipShape: g.querySelector('clipPath > *').tagName, par: im.getAttribute('preserveAspectRatio') };
}, id);

test.describe('58 a picture inside a shape', () => {
  test('a circle takes a picture, clipped to it; fit and remove; one undo step each', async ({ page }) => {
    await gotoEditor(page);
    const id = await addShape(page, 'ellipse');
    expect((await api(page, `shapeImage(${JSON.stringify(id)}, { src: 'assets/branch-0.jpg' })`)).ok).toBe(true);
    const d = await drawn(page, id);
    expect(d).toEqual({ tag: 'g', href: 'assets/branch-0.jpg', clip: `url(#ds-pi-${id})`, clipShape: 'ellipse',
                        par: 'xMidYMid slice' });
    await api(page, `shapeImage(${JSON.stringify(id)}, { src: 'assets/branch-0.jpg', fit: 'contain' })`);
    expect((await drawn(page, id)).par).toBe('xMidYMid meet');
    await page.evaluate(() => undo());
    expect((await drawn(page, id)).par).toBe('xMidYMid slice');
    await api(page, `shapeImage(${JSON.stringify(id)}, null)`);
    expect(await drawn(page, id)).toBe(null);
    // A line is not a frame.
    const ln = await addShape(page, 'line');
    expect((await api(page, `shapeImage(${JSON.stringify(ln)}, { src: 'assets/branch-0.jpg' })`)).ok).toBe(false);
  });

  test('Paste Into: a picture box and a shape selected — the picture goes inside, the box goes', async ({ page }) => {
    await gotoEditor(page);
    const sid = await addShape(page, 'star');
    await page.evaluate(() => placeImageBox('assets/branch-0.jpg', 'branch-0.jpg'));
    const bid = await page.evaluate(() => [...selIds][0]);
    await page.evaluate(([s, b]) => docsync.api.select([s, b]), [sid, bid]);
    // The right-click menu offers it.
    await page.evaluate(s => { const d = $('out').contentDocument, el = d.querySelector(`[data-shape="${CSS.escape(s)}"]`);
      const r = el.getBoundingClientRect(); layerMenu(d, el, { clientX: r.left + 5, clientY: r.top + 5, target: el }); }, sid);
    const items = await page.evaluate(() => [...$('out').contentDocument.querySelectorAll('.ds-menu button')].map(b => b.textContent));
    expect(items).toContain('Put the picture inside this shape');
    expect(items).toContain('Picture inside ▸');
    await page.evaluate(() => [...$('out').contentDocument.querySelectorAll('.ds-menu button')]
      .find(b => b.textContent === 'Put the picture inside this shape').click());
    await expect.poll(() => drawn(page, sid)).toMatchObject({ href: 'assets/branch-0.jpg', clipShape: 'polygon' });
    expect(await page.evaluate(b => !!boxOf(b), bid)).toBe(false);
    // The Links panel lists it, on the shape.
    const links = await page.evaluate(() => linksList($('out').contentDocument));
    expect(links.find(l => l.src === 'assets/branch-0.jpg').uses.some(u => u.id === sid)).toBe(true);
  });
});
