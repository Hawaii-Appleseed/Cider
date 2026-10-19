// INDESIGN_PARITY.md 32–46: the gap list read from InDesign itself. One
// describe per item. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok).toBe(true);
  return r.id;
};
const cs = (page, sel, prop) => page.evaluate(([s, p]) =>
  getComputedStyle($('out').contentDocument.querySelector(s)).getPropertyValue(p), [sel, prop]);

test.describe('46 character extras', () => {
  test('strike, baseline shift and OpenType features land, and a run can carry them', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'Words 1/2 and [up]{.Up}.');
    await page.evaluate(i => docsync.api.setStyle(i, { strike: true, features: ['frac', 'ss02'] }), id);
    expect(await cs(page, `[data-el="${id}"]`, "text-decoration-line")).toContain("line-through");   // the box carries it; decoration does not inherit
    expect(await cs(page, `[data-el="${id}"] p`, 'font-feature-settings')).toMatch(/"frac".*"ss02"/);   // Chrome drops the 1
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Up', shift: 4 })`)).ok).toBe(true);
    expect(await cs(page, `[data-el="${id}"] span.ds-cs`, 'vertical-align')).toMatch(/px/);
  });
});

test.describe('40 named swatches and tints', () => {
  test('a colour names a swatch, a tint lightens it, and redefining recolours', async ({ page }) => {
    await gotoEditor(page);
    expect((await api(page, `defineSwatch('Tax Blue', '#1E6194')`)).ok).toBe(true);
    const id = await addBox(page, 'swatched');
    await page.evaluate(async i => { pushHistory(); boxOf(i).fill = '@Tax Blue 20%'; boxOf(i).style = { color: '@Tax Blue' }; markDirty(); await render(); }, id);
    expect(await cs(page, `[data-el="${id}"]`, 'background-color')).toBe('rgb(210, 223, 234)');
    expect(await cs(page, `[data-el="${id}"] p`, 'color')).toBe('rgb(30, 97, 148)');
    await api(page, `defineSwatch('Tax Blue', '#C0392B')`);
    expect(await cs(page, `[data-el="${id}"] p`, 'color')).toBe('rgb(192, 57, 43)');
    // Dropping it writes the colour in, so nothing names a missing swatch.
    await api(page, `defineSwatch('Tax Blue', null)`);
    expect(await page.evaluate(i => [boxOf(i).fill, boxOf(i).style.color], id)).toEqual(['#F2D7D5', '#C0392B']);
  });
});

test.describe('41 shape options and 39 effects', () => {
  test('polygons, stars and corner styles draw, drag and combine', async ({ page }) => {
    await gotoEditor(page);
    const poly = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'polygon', x: 1, y: 1, w: 2, h: 2 }))).id;
    const star = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'star', x: 3.5, y: 1, w: 2, h: 2 }))).id;
    const pts = i => page.evaluate(id => ($('out').contentDocument.querySelector(`[data-shape="${id}"]`)
      .getAttribute('points') || '').trim().split(/\s+/).length, i);
    expect(await pts(poly)).toBe(6);
    expect(await pts(star)).toBe(10);
    await page.evaluate(async i => { pushHistory(); shapeOf(i).sides = 8; markDirty(); await render(); }, poly);
    expect(await pts(poly)).toBe(8);
    const rect = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 4, w: 2, h: 1 }))).id;
    await page.evaluate(async i => { pushHistory(); shapeOf(i).corner = 'bevel'; shapeOf(i).r = 0.25; markDirty(); await render(); }, rect);
    expect(await page.evaluate(i => $('out').contentDocument.querySelector(`[data-shape="${i}"]`).tagName, rect)).toBe('path');
    expect((await page.evaluate(i => docsync.api.place(i, { x: 2 }), star)).ok).toBe(true);
    expect((await page.evaluate(([a, b]) => docsync.api.pathfinder([a, b], 'union'), [poly, rect])).ok).toBe(true);
    const c = await page.evaluate(() => layout.shapes.find(s => s.kind === 'compound'));
    expect(c.parts.map(p => p.kind)).toContain('polygon');
    await page.evaluate(i => docsync.api.release(i), c.id);
    expect(await page.evaluate(() => layout.shapes.filter(s => s.kind === 'polygon')[0].sides)).toBe(8);
  });

  test('a box glows, shades inside and feathers; a shape glows', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'effects', { fill: '#E8F1EC' });
    await page.evaluate(async i => { pushHistory(); Object.assign(boxOf(i),
      { shadow: { blur: 0.05 }, glow: { size: 0.1 }, innerShadow: { size: 0.05 }, feather: 0.2 }); markDirty(); await render(); }, id);
    const bs = await cs(page, `[data-el="${id}"]`, 'box-shadow');
    expect(bs.split('rgba').length - 1).toBe(3);           // shadow, glow and inner shadow in one
    expect(bs).toContain('inset');
    expect(await cs(page, `[data-el="${id}"]`, 'mask-image')).toContain('linear-gradient');
    const sh = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'ellipse', x: 4, y: 4, w: 1, h: 1 }))).id;
    await page.evaluate(async i => { pushHistory(); shapeOf(i).glow = { size: 0.1 }; markDirty(); await render(); }, sh);
    expect(await cs(page, `[data-shape="${sh}"]`, 'filter')).toContain('drop-shadow');
  });
});

test.describe('42 QR codes, 43 live captions, 45 conditional text', () => {
  test('a QR code draws its link as modules, square, and says what it is', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'qr', x: 1, y: 1, w: 1.2, data: 'https://www.hiappleseed.org' }));
    expect(r.ok).toBe(true);
    const q = await page.evaluate(i => {
      const n = $('out').contentDocument.querySelector(`[data-shape="${i}"]`);
      return { tag: n.tagName, vb: n.getAttribute('viewBox'), label: n.getAttribute('aria-label'),
               d: n.querySelector('path').getAttribute('d').length, h: shapeOf(i).h };
    }, r.id);
    expect(q.tag).toBe('svg');
    expect(q.vb).toMatch(/^0 0 (33|37) (33|37)$/);           // version 3 with its quiet zone
    expect(q.label).toBe('QR code: https://www.hiappleseed.org');
    expect(q.d).toBeGreaterThan(200);
    expect(q.h).toBe(1.2);                                   // square by default
  });

  test('a caption shows its image\'s description and follows it', async ({ page }) => {
    await gotoEditor(page);
    const img = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: '![Lawmakers at the signing](assets/signing.jpg)' }))).id;
    const cap = (await page.evaluate(i => docsync.api.addTextBox({ page: 3, x: 1, y: 4, w: 3, md: `{caption:${i}}` }), img)).id;
    const words = () => page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).textContent.trim(), cap);
    expect(await words()).toBe('Lawmakers at the signing');
    await page.evaluate(i => docsync.api.describeImage(i, 'The governor signs HB 2296'), img);
    expect(await words()).toBe('The governor signs HB 2296');
    // The token stays the token in the file, and is a chip while typing.
    expect(await page.evaluate(i => boxOf(i).md, cap)).toBe(`{caption:${img}}`);
    expect(await page.evaluate(m => { const e = document.createElement('div'); e.innerHTML = mdToHtml(m, { inline: true });
      return e.querySelectorAll('.ds-varchip').length; }, `{caption:${img}}`)).toBe(1);
  });

  test('conditional text: marked in the editor, and its rules ship', async ({ page }) => {
    await gotoEditor(page);
    const id = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 4,
      md: 'Read it [online at hiappleseed.org]{?web}[ in this PDF]{?print}.' }))).id;
    const conds = await page.evaluate(i => [...$('out').contentDocument.querySelectorAll(`[data-el="${i}"] .ds-cond`)]
      .map(s => [s.dataset.cond, getComputedStyle(s).display]), id);
    expect(conds).toEqual([['web', 'inline'], ['print', 'inline']]);   // both visible while editing
    const md = 'a [b]{?print} c';
    expect(await page.evaluate(m => { const e = document.createElement('div'); e.innerHTML = mdToHtml(m, { inline: true });
      return htmlToMd(e, { inline: true }); }, md)).toBe(md);
    expect((await api(page, `setCondition('draft', false)`)).ok).toBe(true);
    expect(await page.evaluate(() => layout.conditions.draft)).toBe(false);
  });
});

test.describe('38 placement: paste in place, step and repeat, transform again, select next', () => {
  test('the four placement commands', async ({ page }) => {
    await gotoEditor(page);
    const a = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 1, h: 1 }))).id;
    // Paste in place: same x/y, a new id.
    await page.evaluate(async i => { const d = $('out').contentDocument; setSel(d, [i]); copySel(d); await pasteClip(d, true); }, a);
    const pasted = await page.evaluate(() => layout.shapes[layout.shapes.length - 1]);
    expect(pasted.id).not.toBe(a);
    expect([pasted.x, pasted.y]).toEqual([1, 1]);
    // Step and repeat through the pilot: three copies a quarter inch apart.
    const r = await page.evaluate(i => docsync.api.stepRepeat([i], 3, 0.5, 0.25), a);
    expect(r.ok).toBe(true);
    const xs = await page.evaluate(() => layout.shapes.slice(-3).map(s => [s.x, s.y]));
    expect(xs).toEqual([[1.5, 1.25], [2, 1.5], [2.5, 1.75]]);
    // Transform again: a nudge recorded, then repeated on another object.
    const moved = await page.evaluate(async ([i, j]) => {
      const d = $('out').contentDocument; setSel(d, [i]); nudgeSel(d, [0.5, 0]);
      await render(); setSel($('out').contentDocument, [j]);
      await transformAgain($('out').contentDocument);
      return [lastXform, shapeOf(j).x];
    }, [a, pasted.id]);
    expect(moved[0]).toEqual({ kind: 'move', dx: 0.5, dy: 0 });
    expect(moved[1]).toBeCloseTo(1.5, 2);
    // Select next above / below walks the page's stack, by ⌥] as well.
    const walk = await page.evaluate(i => {
      const d = $('out').contentDocument; setSel(d, [i]);
      const pg = d.querySelector(`[data-shape="${i}"]`).closest('section.page');
      const stack = pageStack(d, pg).map(idOf);
      d.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight', key: '‘', altKey: true, bubbles: true }));
      const up = [...selIds][0];
      selectNextObject(d, -1);
      return { stack, at: stack.indexOf(i), up, back: [...selIds][0] };
    }, a);
    expect(walk.up).toBe(walk.stack[(walk.at + 1) % walk.stack.length]);
    expect(walk.back).toBe(a);
  });
});

test.describe('36 margins, columns and guide grids', () => {
  test('margins draw and snap, and create guides fills a grid', async ({ page }) => {
    await gotoEditor(page);
    const r = await api(page, `setMargins({ top: 0.75, bottom: 0.75, left: 0.5, right: 0.5, columns: 3, gutter: 0.25 })`);
    expect(r.ok).toBe(true);
    const g = await page.evaluate(() => { showGuidesNow(); const d = $('out').contentDocument; drawGuideLayer(d);
      return { box: d.querySelectorAll('.ds-mg').length, cols: d.querySelectorAll('.ds-mgc').length,
               pages: d.querySelectorAll('section.page').length, mg: marginGuides(docSheets()[0].id) }; });
    expect(g.box).toBe(g.pages);
    expect(g.cols).toBe(4 * g.pages);                    // two gutters, two sides each
    expect(g.mg.l).toBe(0.5);
    // The middle column is as wide as the others.
    const [a, b, c, e] = g.mg.cols;
    expect(c - b).toBeCloseTo(a - g.mg.l, 2);
    // Snap lines include them.
    const snaps = await page.evaluate(() => { const d = $('out').contentDocument; const pg = d.querySelector('section.page'); return snapLines(d, pg, []).xs; });
    expect(snaps).toContain(e);
    // Create guides: a 2×2 grid with a gutter, fitted to the margins.
    const cg = await api(page, `createGuides({ rows: 2, columns: 2, gutter: 0.2, fit: 'margins' })`);
    expect(cg.ok).toBe(true);
    expect(await page.evaluate(() => layout.guides.x.length)).toBe(2);
    expect((await api(page, `setMargins({ cols: 2 })`)).ok).toBe(false);
  });
});

test.describe('44 links panel', () => {
  test('lists pictures by file, flags a missing one, and relinks it everywhere', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, '![a picture](assets/no-such-file.png)');
    await page.evaluate(i => { const d = $('out').contentDocument; return Promise.all([...d.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))); }, id);
    const links = await api(page, 'links()');
    const miss = links.find(l => l.src === 'assets/no-such-file.png');
    expect(miss.missing).toBe(true);
    const good = links.find(l => !l.missing && l.size);
    expect(good).toBeTruthy();
    expect(good.ppi).toBeGreaterThan(0);
    // The panel draws a row per file, the missing one marked.
    await page.click('#links');
    expect(await page.locator('#links-list .lk-row.missing').count()).toBe(1);
    const r = await page.evaluate(([a, b]) => docsync.api.relink(a, b), ['assets/no-such-file.png', good.src]);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => boxOf(i).md, id)).toBe(`![a picture](${good.src})`);
    expect((await api(page, 'links()')).some(l => l.src === 'assets/no-such-file.png')).toBe(false);
  });
});

test.describe('37 find/change: GREP, by format, find font', () => {
  test('GREP with groups, a literal dollar, style filters and wraps, and a font swap', async ({ page }) => {
    await gotoEditor(page);
    expect((await api(page, `defineStyle({ scope: 'text', name: 'Num', weight: 700 })`)).ok).toBe(true);
    const a = await addBox(page, 'ZQ2026 and ZQ2027 cost $5.');
    const b = await addBox(page, 'ZQ2026 here too.', { style: { use: 'Num' } });
    // GREP: groups in the change.
    let r = await api(page, `findChange({ find: 'ZQ(\\\\d{2})(\\\\d{2})', change: 'ZQ$2', grep: true })`);
    expect(r.ok).toBe(true);
    expect(r.hits).toBe(3);
    expect(await page.evaluate(i => boxOf(i).md, a)).toBe('ZQ26 and ZQ27 cost $5.');
    // Plain mode: a $ in the change is a dollar sign.
    await api(page, `findChange({ find: 'cost', change: 'cost $&' })`);
    expect(await page.evaluate(i => boxOf(i).md, a)).toBe('ZQ26 and ZQ27 cost $& $5.');
    // Find format: only text wearing Num. Change format: wrap in a style.
    r = await api(page, `findChange({ find: 'here', change: '', inStyle: 'Num', applyStyle: 'Num' })`);
    expect(r.hits).toBe(1);
    expect(await page.evaluate(i => boxOf(i).md, b)).toBe('ZQ26 [here]{.Num} too.');
    expect((await api(page, `findChange({ find: '(', grep: true })`)).ok).toBe(false);
    // Find font.
    await page.evaluate(i => docsync.api.setStyle(i, { font: 'Manrope' }), a);
    const before = await api(page, 'fontsInUse()');
    expect(before.find(f => f.family === 'Manrope').uses).toContain(a.replace(/^text\./, ''));
    const other = await page.evaluate(() => Object.keys(fonts).find(f => f !== 'Manrope'));
    r = await page.evaluate(o => docsync.api.replaceFont('Manrope', o), other);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => boxOf(i).style.font, a)).toBe(other);
    // The panel shows the GREP box and the font list.
    await page.evaluate(() => openFindPanel());
    expect(await page.locator('#findpop .find-font').count()).toBeGreaterThan(0);
  });
});

test.describe('32 tab stops with leaders', () => {
  test('a right stop with a dot leader lines the figures up at the stop', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'Apples\t$4.50\n\nPears and plums\t$12.00', { w: 5 });
    await page.evaluate(i => docsync.api.setStyle(i, { tabs: [{ at: 4, align: 'right', leader: '.' }] }), id);
    const got = await page.evaluate(i => {
      const d = $('out').contentDocument;
      const box = d.querySelector(`[data-el="${i}"]`);
      return [...box.querySelectorAll('p')].map(p => {
        const t = p.querySelector('.ds-tab');
        const sc = p.getBoundingClientRect().width / p.offsetWidth;
        const r = d.createRange(); r.setStartAfter(t); r.setEnd(p, p.childNodes.length);
        return { right: (r.getBoundingClientRect().right - p.getBoundingClientRect().left) / sc / 96,
                 dots: /^\.+$/.test(t.textContent) };
      });
    }, id);
    expect(got.length).toBe(2);
    got.forEach(g => { expect(g.right).toBeCloseTo(4, 1); expect(g.dots).toBe(true); });
    // The words round-trip with their tab.
    expect(await page.evaluate(i => boxOf(i).md, id)).toContain('Apples\t$4.50');
  });
});

test.describe('33 table structure', () => {
  test('merge, header and footer rows, inset, valign, row height, alternating stroke, text to table', async ({ page }) => {
    await gotoEditor(page);
    const box = await addBox(page, 'Item\tQ1\tQ2\nRent\t10\t12\nFood\t5\t6\nTotal\t15\t18');
    let r = await page.evaluate(i => docsync.api.textToTable(i), box);
    expect(r.ok).toBe(true);
    const tid = r.id;
    expect(await page.evaluate(i => tableOf(i).rows.length, tid)).toBe(4);
    r = await page.evaluate(i => docsync.api.mergeCells(i, 1, 0, 2, 1), tid);
    expect(r.ok).toBe(true);
    r = await page.evaluate(i => docsync.api.setTable(i, { footerRows: 1, inset: 0.08, valign: 'bottom',
      rowh: [null, 0.6, null, null], bandStroke: { w: 2, color: '#333333' } }), tid);
    expect(r.ok).toBe(true);
    const dom = await page.evaluate(i => {
      const t = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      const a = t.querySelector('[data-cell="1,0"]');
      return { rowspan: a.rowSpan, covered: !!t.querySelector('[data-cell="2,0"]'),
               merged: a.textContent, foot: !!t.querySelector('tfoot [data-cell="3,0"]'),
               pad: getComputedStyle(a).paddingTop, va: getComputedStyle(a).verticalAlign,
               rowH: t.rows[1].getBoundingClientRect().height / (t.getBoundingClientRect().width / t.offsetWidth),
               stroke: getComputedStyle(t.querySelector('[data-cell="2,1"]')).borderBottomWidth };
    }, tid);
    expect(dom).toMatchObject({ rowspan: 2, covered: false, merged: 'Rent Food', foot: true,
                                pad: '7.68px', va: 'bottom' });
    expect(parseFloat(dom.stroke)).toBeGreaterThan(1.4);       // 2px, snapped to device pixels at the zoom
    expect(dom.rowH).toBeGreaterThanOrEqual(57);
    // A row inserted inside the merge grows it; a merge across another's edge is refused whole.
    await page.evaluate(async i => { pushHistory(); tableInsertRow(tableOf(i), 2); markDirty(); await render(); }, tid);
    expect(await page.evaluate(i => tableOf(i).merges, tid)).toEqual([[1, 0, 3, 1]]);
    r = await page.evaluate(i => docsync.api.mergeCells(i, 2, 0, 1, 2), tid);
    expect(r.ok).toBe(false);
    r = await page.evaluate(i => docsync.api.unmergeCells(i, 2, 0), tid);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => tableOf(i).merges, tid)).toBeUndefined();
  });
});

test.describe('34 reading order', () => {
  test('listed objects are stamped and the page owns them first, nothing moves', async ({ page }) => {
    await gotoEditor(page);
    const a = await addBox(page, 'read second');
    const b = await addBox(page, 'read first', { y: 4 });
    const before = await page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).getBoundingClientRect().top, a);
    const r = await page.evaluate(([x, y]) => docsync.api.setReadingOrder(3, [y, x]), [a, b]);
    expect(r.ok).toBe(true);
    const got = await page.evaluate(([x, y]) => {
      const d = $('out').contentDocument;
      d.defaultView.eval(py.runPython('from docsync.layout import ORDER_JS\nORDER_JS'));
      const ea = d.querySelector(`[data-el="${x}"]`), eb = d.querySelector(`[data-el="${y}"]`);
      const pg = ea.closest('section.page');
      return { ro: [ea.dataset.ro, eb.dataset.ro], owns: pg.getAttribute('aria-owns').split(' ').slice(0, 2),
               ids: [eb.id, ea.id], top: ea.getBoundingClientRect().top };
    }, [a, b]);
    expect(got.ro).toEqual(['1', '0']);
    expect(got.owns).toEqual(got.ids);
    expect(got.top).toBeCloseTo(before, 0);
    expect((await page.evaluate(() => docsync.api.setReadingOrder(3, null))).ok).toBe(true);
    expect(await page.evaluate(() => layout.readingOrder)).toBeUndefined();
  });
});
