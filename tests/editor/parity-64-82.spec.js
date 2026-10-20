// INDESIGN_PARITY.md 64 (named gradient swatches, fade to clear) and 82
// (links to another place in the report, and cross-reference text). Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};
/** The drawn box's computed background-image / mask-image. */
const look = (page, id) => page.evaluate(id => {
  const el = document.getElementById('out').contentDocument.querySelector(`[data-el="${CSS.escape(id)}"]`);
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundImage, mask: cs.maskImage || cs.webkitMaskImage };
}, id);

const SKY = { type: 'linear', angle: 90, stops: [{ color: '#1E6194', at: 0 }, { color: '#F2C94C', at: 1 }] };

test.describe('64 gradient swatches and fade', () => {
  test('a gradient swatch fills a box, and redefining it changes the box', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'sky');
    expect((await api(page, `defineSwatch('Sky', ${JSON.stringify(SKY)})`)).ok).toBe(true);
    await page.evaluate(id => { pushHistory(); boxOf(id).fill = '@Sky'; markDirty(); return render(); }, id);
    expect((await look(page, id)).bg).toContain('linear-gradient(90deg, rgb(30, 97, 148)');
    const red = { ...SKY, stops: [{ color: '#C0392B', at: 0 }, { color: '#FFFFFF', at: 1 }] };
    await api(page, `defineSwatch('Sky', ${JSON.stringify(red)})`);
    expect((await look(page, id)).bg).toContain('rgb(192, 57, 43)');
    // Colours in use lists the swatch, and does not choke on its value.
    const cs = (await api(page, 'colours()')).colours;
    expect(cs.some(c => c.swatch === 'Sky')).toBe(true);
  });

  test('a gradient swatch is offered for a fill, and not for a text colour', async ({ page }) => {
    await gotoEditor(page);
    await api(page, `defineSwatch('Sky', ${JSON.stringify(SKY)})`);
    const r = await page.evaluate(() => {
      const a = document.createElement('div'), b = document.createElement('div');
      colorExtras(document, a, '', () => {}, { gradients: true });
      colorExtras(document, b, '', () => {});
      return [a.querySelectorAll('.ds-sw-grad').length, b.querySelectorAll('.ds-sw-grad').length];
    });
    expect(r).toEqual([1, 0]);
  });

  test('deleting a solid swatch a gradient swatch names writes its colour into the stop', async ({ page }) => {
    await gotoEditor(page);
    await api(page, `defineSwatch('Blue', '#1E6194')`);
    const g = { ...SKY, stops: [{ color: '@Blue', at: 0 }, { color: '#FFFFFF', at: 1 }] };
    await api(page, `defineSwatch('Sky', ${JSON.stringify(g)})`);
    const id = await addBox(page, 'x');
    await page.evaluate(id => { pushHistory(); boxOf(id).fill = '@Sky'; markDirty(); return render(); }, id);
    // In use through the gradient, so not "unused".
    expect((await api(page, 'unusedStyles()')).unused.swatches).not.toContain('Blue');
    const r = await api(page, `defineSwatch('Blue', null)`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await page.evaluate(() => layout.swatches.Sky.stops[0].color)).toBe('#1E6194');
  });

  test('fade to clear masks a box from opaque to clear, and undoes', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'fade me', { fill: '#1E6194' });
    const r = await api(page, `fade(${JSON.stringify(id)}, {angle: 180, from: 0.5})`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await look(page, id)).mask).toContain('linear-gradient(rgb(0, 0, 0) 50%, rgba(0, 0, 0, 0) 100%)');
    expect((await api(page, `fade(${JSON.stringify(id)}, {from: 0.9, to: 0.5})`)).ok).toBe(false);
    await page.evaluate(() => undo());
    expect((await look(page, id)).mask).toBe('none');
  });

  test('the effects pop turns a fade on for a box', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'fade me', { fill: '#1E6194' });
    await page.evaluate(id => docsync.api.select(id), id);
    await page.evaluate(() => {
      // A lone text box shows the type bar; the effects pop is the arrange
      // strip's — open it as its button would.
      $('ar-fxbtn').click();
    });
    await page.evaluate(() => $('fx-fade').click());
    await expect.poll(async () => (await look(page, id)).mask).toContain('linear-gradient');
    expect(await page.evaluate(id => boxOf(id).fade, id)).toEqual({ angle: 180, from: 0.4, to: 1 });
  });
});

test.describe('82 internal links and cross-reference text', () => {
  test('{titleof:} shows the heading words and follows a retitle; a #link jumps to it', async ({ page }) => {
    await gotoEditor(page);
    const h = await addBox(page, '## Who pays');
    const r = await addBox(page, `See {titleof:${h}} — [jump](#${h}) and {titleof:nope}`, { y: 5 });
    const read = () => page.evaluate(([h, r]) => {
      const d = document.getElementById('out').contentDocument;
      const el = d.querySelector(`[data-el="${CSS.escape(r)}"]`);
      const a = el.querySelector('a.ds-xref');
      const target = a && d.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      return { text: el.textContent.replace(/\s+/g, ' ').trim(),
               lands: !!target && target.closest('[data-el]').dataset.el === h };
    }, [h, r]);
    const r1 = await read();
    expect(r1.text).toContain('See Who pays');
    expect(r1.text).toContain('{titleof:nope}');            // a reference to nothing shows
    expect(r1.lands, 'the link lands on the heading').toBe(true);
    expect((await api(page, `setBoxText(${JSON.stringify(h)}, '## Who really pays')`)).ok).toBe(true);
    expect((await read()).text).toContain('See Who really pays');
    // The Hyperlinks panel counts the internal link as found, not broken.
    const links = (await api(page, 'hyperlinks()')).links.filter(l => l.internal);
    expect(links.length).toBe(1);
    expect(links[0].state).toBe('ok');
  });

  test('a heading-words chip reads as the words and writes the token back', async ({ page }) => {
    await gotoEditor(page);
    const h = await addBox(page, '## Who pays');
    const r = await page.evaluate(h => {
      const chip = makeVarChip(document, 'titleof:' + h);
      const host = document.createElement('div');
      host.append('see ', chip);
      return { label: chip.textContent, md: nodeToMdInline(host) };
    }, h);
    expect(r.label).toBe('“Who pays”');
    expect(r.md).toBe(`see {titleof:${h}}`);
  });
});
