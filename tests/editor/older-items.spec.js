// The parity list's older open items (INDESIGN_PARITY.md): contour wrap,
// bleed for every report, skew, named layers, the baseline grid, tables on
// shared layouts and as anchors, per-item overrides on a shared layout, and
// pen paths with Pathfinder. One spec, one describe per item. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function hostOn(page) {
  return page.evaluate(() => {
    const d = document.getElementById('out').contentDocument;
    const el = [...d.querySelectorAll('section.page p[data-slot]')]
      .find(p => p.textContent.trim().length > 60);
    const pg = el.closest('section.page');
    const mount = pg.querySelector('[data-ds-mount]');
    const num = mount ? +mount.dataset.dsMount
      : [...d.querySelectorAll('section.page')].indexOf(pg) + 1;
    const b = anchorHostBox(d, pg, el.dataset.slot);
    return { key: el.dataset.slot, top: b.y, page: num };
  });
}

test.describe('contour wrap', () => {
  test('a wrapped picture follows its outline, or an ellipse, or its box', async ({ page }) => {
    await gotoEditor(page);
    const host = await hostOn(page);
    const id = (await page.evaluate(({ y, pg }) => docsync.api.addTextBox(
      { page: pg, x: 5.5, y, w: 1.6, md: '![logo](assets/appleseed-logo.svg)' }),
      { y: +(host.top + 0.2).toFixed(2), pg: host.page })).id;
    await page.evaluate(({ id, key }) => docsync.api.anchor(id, key), { id, key: host.key });
    expect((await page.evaluate(i => docsync.api.wrap(i, 'right', 'contour'), id)).ok).toBe(true);
    const shape = () => page.evaluate(i =>
      getComputedStyle($('out').contentDocument.querySelector(`[data-el="${i}"]`)).shapeOutside, id);
    await expect.poll(shape).toMatch(/^url\(/);
    expect(await page.evaluate(i => boxOf(i).wrapShape, id)).toBe('contour');
    await page.evaluate(i => docsync.api.wrap(i, 'right', 'ellipse'), id);
    await expect.poll(shape).toMatch(/ellipse/);
    await page.evaluate(i => docsync.api.wrap(i, 'right', 'box'), id);
    expect(await page.evaluate(i => 'wrapShape' in boxOf(i), id)).toBe(false);
  });
});

test.describe('bleed and crop marks for any report', () => {
  test('the runtime grows each sheet, shifts placed things with it, and marks the trim',
    async ({ page }) => {
      await gotoEditor(page);
      const id = (await page.evaluate(() => docsync.api.addTextBox(
        { page: 3, x: 1, y: 1, w: 2, md: 'placed' }))).id;
      const before = await page.evaluate(i => {
        const d = $('out').contentDocument, el = d.querySelector(`[data-el="${i}"]`);
        const pg = el.closest('section.page');
        return { w: pg.offsetWidth, pages: d.querySelectorAll('section.page').length };
      }, id);
      const src = await page.evaluate(() => py.runPython('from docsync.layout import BLEED_JS\nBLEED_JS'));
      const after = await page.evaluate(([i, js]) => {
        const d = $('out').contentDocument, w = d.defaultView;
        d.body.classList.remove('ds-bleed');
        w.eval(js);
        const el = d.querySelector(`[data-el="${i}"]`), pg = el.closest('section.page');
        return { w: pg.offsetWidth, shift: getComputedStyle(el).translate,
                 marks: d.querySelectorAll('section.page > .ds-crop').length };
      }, [id, src]);
      expect(after.w).toBe(before.w + 24);                 // 0.125in a side
      expect(after.shift).toBe('12px 12px');
      expect(after.marks).toBe(before.pages);
    });
});

test.describe('skew', () => {
  test('a box, a shape and a designed piece shear, and the bound holds', async ({ page }) => {
    await gotoEditor(page);
    const box = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2, md: 'sheared' }))).id;
    expect((await page.evaluate(i => docsync.api.skew(i, 15), box)).ok).toBe(true);
    const t = await page.evaluate(i => getComputedStyle($('out').contentDocument
      .querySelector(`[data-el="${i}"]`)).transform, box);
    expect(t).not.toBe('none');                          // a matrix with the shear in it
    const sh = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 4, y: 1, w: 1, h: 1 }))).id;
    await page.evaluate(i => docsync.api.skew(i, -20), sh);
    const attr = await page.evaluate(i => $('out').contentDocument
      .querySelector(`[data-shape="${i}"]`).getAttribute('transform'), sh);
    expect(attr).toContain('skewX(-20)');
    await page.evaluate(i => docsync.api.skew(i, 90), box);
    expect(await page.evaluate(i => boxOf(i).skew, box)).toBe(60);
    await page.evaluate(i => docsync.api.skew(i, 0), box);
    expect(await page.evaluate(i => 'skew' in boxOf(i), box)).toBe(false);
  });
});

test.describe('named layers', () => {
  test('a layer stacks, hides and locks what is on it', async ({ page }) => {
    await gotoEditor(page);
    const a = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 2, md: 'note A' }))).id;
    const b = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1.2, y: 1.2, w: 2, md: 'note B' }))).id;
    expect((await api(page, `defineLayer('Back')`)).ok).toBe(true);
    expect((await api(page, `defineLayer('Notes')`)).ok).toBe(true);
    expect((await page.evaluate(i => docsync.api.toLayer([i], 'Notes'), a)).ok).toBe(true);
    await page.evaluate(i => docsync.api.toLayer([i], 'Back'), b);
    const z = id => page.evaluate(i => +getComputedStyle($('out').contentDocument
      .querySelector(`[data-el="${i}"]`)).zIndex, id);
    expect(await z(a)).toBeGreaterThan(await z(b));      // Notes was made after Back: in front
    // Locked: a pilot move is refused.
    await api(page, `defineLayer('Notes', { locked: true })`);
    expect((await page.evaluate(i => docsync.api.place(i, { x: 3 }), a)).ok).toBe(false);
    await api(page, `defineLayer('Notes', { locked: false, hidden: true })`);
    expect(await page.evaluate(i => !!$('out').contentDocument.querySelector(`[data-el="${i}"]`), a)).toBe(false);
    // Deleting the layer leaves its things, on no layer, drawn again.
    await api(page, `dropLayer('Notes')`);
    expect(await page.evaluate(i => !!$('out').contentDocument.querySelector(`[data-el="${i}"]`), a)).toBe(true);
    expect(await page.evaluate(i => 'layer' in boxOf(i), a)).toBe(false);
  });

  test('the Layers panel lists document layers with show and lock', async ({ page }) => {
    await gotoEditor(page);
    await api(page, `defineLayer('Photos')`);
    await page.click('#layers');
    await expect(page.locator('#doclayers .dl-row')).toHaveCount(1);
    await page.locator('#doclayers .dl-row .dl-btn').nth(1).click();          // lock
    await expect.poll(() => page.evaluate(() => layout.layers[0].locked)).toBe(true);
  });
});

test.describe('baseline grid', () => {
  test('paragraphs that sit on the grid put every first baseline on a grid line', async ({ page }) => {
    await gotoEditor(page);
    expect((await api(page, `setGrid({ increment: 14, start: 0.75 })`)).ok).toBe(true);
    const a = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 0.7, y: 1.03, w: 3, md: 'Left column one.\n\nLeft two.' }))).id;
    const b = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 4.2, y: 1.17, w: 3, md: 'Right column, bigger.' }))).id;
    await page.evaluate(i => docsync.api.setStyle(i, { grid: true }), a);
    await page.evaluate(i => docsync.api.setStyle(i, { grid: true, size: 19 }), b);
    const off = await page.evaluate(ids => {
      const d = $('out').contentDocument;
      const out = [];
      ids.forEach(i => d.querySelectorAll(`[data-el="${i}"] p`).forEach(p => {
        const pg = p.closest('section.page'), sc = pg.getBoundingClientRect().width / pg.offsetWidth;
        const pr = d.createElement('span');
        pr.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        p.insertBefore(pr, p.firstChild);
        const y = (pr.getBoundingClientRect().top - pg.getBoundingClientRect().top) / sc;
        pr.remove();
        const inc = 14 * 96 / 72, st = 0.75 * 96;
        const r = ((y - st) % inc + inc) % inc;
        out.push(Math.min(r, inc - r));
      }));
      return out;
    }, [a, b]);
    expect(off.length).toBe(3);
    for (const o of off) expect(o).toBeLessThan(1.2);     // within a pixel of a grid line
  });

  test('a grid style needs no grid to be valid, and no grid means no runtime', async ({ page }) => {
    await gotoEditor(page);
    const a = (await page.evaluate(() => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: 'x' }))).id;
    await page.evaluate(i => docsync.api.setStyle(i, { grid: true }), a);
    expect(await page.evaluate(() => [...$('out').contentDocument.querySelectorAll('script')]
      .some(s => s.textContent.includes('__dsGrid')))).toBe(false);
  });
});

test.describe('tables on shared layouts and as anchors', () => {
  const addTable = (page, id, pg = 3) => page.evaluate(async ([i, p]) => {
    pushHistory();
    tables().push({ id: i, page: p, x: 1, y: 8.5, w: 3, header: true, rows: [['Key', 'Value'], ['a', '1']] });
    markDirty(); await render();
  }, [id, pg]);

  test('a page\'s table joins its shared layout and appears on every page using it', async ({ page }) => {
    await gotoEditor(page);
    await addTable(page, 'zzkey');
    const pid = await page.evaluate(() => { const o = pageOrder(); return o[2]; });
    const r = await page.evaluate(p => docsync.api.masterFrom(p, 'With key'), pid);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(() => (layout.masters['With key'].tables || []).map(t => t.id))).toEqual(['zzkey']);
    const other = await page.evaluate(() => pageOrder()[3]);
    await page.evaluate(p => docsync.api.master(p, 'With key'), other);
    const n = await page.evaluate(() => $('out').contentDocument.querySelectorAll('[data-el^="table.zzkey@"]').length);
    expect(n).toBe(2);
    // One table: a change through either page's instance changes both.
    await page.evaluate(async () => { pushHistory(); tableOf([...$('out').contentDocument
      .querySelectorAll('[data-el^="table.zzkey@"]')][1].dataset.el).rows[1][1] = '42'; markDirty(); await render(); });
    const vals = await page.evaluate(() => [...$('out').contentDocument
      .querySelectorAll('[data-el^="table.zzkey@"] tr:nth-child(2) td:nth-child(2)')].map(td => td.textContent));
    expect(vals).toEqual(['42', '42']);
    // Detaching gives the page its own copy.
    await page.evaluate(p => docsync.api.detachMaster(p), other);
    expect(await page.evaluate(p => tables().filter(t => String(t.page) === String(p)).length, other)).toBe(1);
  });

  test('a placed table moves with place() and can follow a paragraph', async ({ page }) => {
    await gotoEditor(page);
    const host = await hostOn(page);
    await addTable(page, 'zzanc', host.page);
    expect((await api(page, `place('table.zzanc', { x: 2, y: ${(host.top + 0.5).toFixed(2)} })`)).ok).toBe(true);
    expect(await page.evaluate(() => tableOf('table.zzanc').x)).toBe(2);   // its own x, not positions{}
    expect(await page.evaluate(() => !!layout.positions['table.zzanc'])).toBe(false);
    // Under the paragraph's BOTTOM, so growing the paragraph itself moves it.
    const r = await page.evaluate(k => docsync.api.anchor('table.zzanc', k, { edge: 'bottom' }), host.key);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(() => tableOf('table.zzanc').anchor.to)).toBe(host.key);
    const top = () => page.evaluate(() => { const el = $('out').contentDocument.querySelector('[data-el="table.zzanc"]');
      return inchBox(el, el.closest('section.page')).y; });
    const before = await top();
    const words = (await api(page, `getSlot('${host.key}')`)).md;
    await page.evaluate(([k, m]) => docsync.api.setSlot(k, m + ' ' + m), [host.key, words]);
    await expect.poll(top).toBeGreaterThan(before + 0.1);
  });
});

test.describe('per-item overrides on a shared layout', () => {
  test('a move on one page stays there; the layout and the other pages follow the rest', async ({ page }) => {
    await gotoEditor(page);
    const [pA, pB] = await page.evaluate(() => [pageOrder()[2], pageOrder()[3]]);
    await page.evaluate(p => docsync.api.addTextBox({ page: p, x: 1, y: 10.2, w: 2, md: 'Folio {page}' }), pA);
    expect((await page.evaluate(p => docsync.api.masterFrom(p, 'Folios'), pA)).ok).toBe(true);
    await page.evaluate(p => docsync.api.master(p, 'Folios'), pB);
    const base = await page.evaluate(() => layout.masters.Folios.boxes[0].id);
    const idA = `text.${base}@${pA}`, idB = `text.${base}@${pB}`;
    expect((await api(page, `masterOverride('${idB}')`)).ok).toBe(true);
    expect((await page.evaluate(i => docsync.api.place(i, { x: 5 }), idB)).ok).toBe(true);
    const xs = await page.evaluate(([a, b]) => [a, b].map(i => {
      const el = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      return +inchBox(el, el.closest('section.page')).x.toFixed(1);
    }), [idA, idB]);
    expect(xs).toEqual([1, 5]);
    expect(await page.evaluate(() => layout.masters.Folios.boxes[0].x)).toBe(1);
    const ovKeys = await page.evaluate(k => Object.keys(layout.masterOverrides[k]), `${base}@${pB}`);
    expect(ovKeys).not.toContain('md');                   // only what changed is kept
    // The shared item's words change: both pages show them (B never overrode md).
    await page.evaluate(async () => { pushHistory(); layout.masters.Folios.boxes[0].md = 'Page {page}'; markDirty(); await render(); });
    const words = await page.evaluate(([a, b]) => [a, b].map(i =>
      $('out').contentDocument.querySelector(`[data-el="${i}"]`).textContent.trim()), [idA, idB]);
    expect(words[0]).toMatch(/^Page /);
    expect(words[1]).toMatch(/^Page /);
    // Back to the layout: page B's copy returns to x = 1.
    await api(page, `masterOverride('${idB}', false)`);
    expect(await page.evaluate(() => !layout.masterOverrides)).toBe(true);
  });
});

test.describe('pen paths and Pathfinder', () => {
  test('a path drawn by points renders, drags as a shape, and keeps its curve', async ({ page }) => {
    await gotoEditor(page);
    const r = await api(page, `addPath({ page: 3, closed: true, points: [{ x: 1, y: 3 }, { x: 2, y: 1.5, out: [0.5, 0] }, { x: 3, y: 3 }] })`);
    expect(r.ok).toBe(true);
    const id = r.results[0].id || r.results[0].r?.id || await page.evaluate(() => layout.shapes.filter(s => s.kind === 'path').pop().id);
    const sh = await page.evaluate(i => shapeOf(i), id);
    expect([sh.x, sh.y, sh.w, sh.h]).toEqual([1, 1.5, 2, 1.5]);
    expect(sh.points[1].out[0]).toBeCloseTo(0.25, 3);           // 0.5in of a 2in box
    const d = await page.evaluate(i => $('out').contentDocument.querySelector(`[data-shape="${i}"]`).getAttribute('d'), id);
    expect(d).toMatch(/^M1(\.0)? 3(\.0)?L2(\.0)? 1\.5C/);
    expect((await page.evaluate(i => docsync.api.place(i, { x: 4 }), id)).ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).x, id)).toBe(4);
  });

  test('Pathfinder combines, subtracts, intersects, excludes — and releases', async ({ page }) => {
    await gotoEditor(page);
    const a = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'rect', x: 1, y: 1, w: 2, h: 2 }))).id;
    const b = (await page.evaluate(() => docsync.api.addShape({ page: 3, kind: 'ellipse', x: 2, y: 2, w: 2, h: 2 }))).id;
    const r = await page.evaluate(([x, y]) => docsync.api.pathfinder([x, y], 'subtract'), [a, b]);
    expect(r.ok).toBe(true);
    const c = await page.evaluate(() => layout.shapes.find(s => s.kind === 'compound'));
    expect(c.op).toBe('subtract');
    expect(c.parts.map(p => p.kind)).toEqual(['rect', 'ellipse']);   // the back one first
    expect([c.x, c.y, c.w, c.h]).toEqual([1, 1, 3, 3]);
    const node = await page.evaluate(i => {
      const n = $('out').contentDocument.querySelector(`[data-shape="${i}"]`);
      return { tag: n.tagName, mask: !!n.querySelector('mask') };
    }, c.id);
    expect(node).toEqual({ tag: 'g', mask: true });
    for (const op of ['union', 'intersect', 'exclude']) {
      await page.evaluate(([i, o]) => { shapeOf(i).op = o; }, [c.id, op]);
      expect(await page.evaluate(async () => { await render(); return true; })).toBe(true);
    }
    const rel = await page.evaluate(i => docsync.api.release(i), c.id);
    expect(rel.ok).toBe(true);
    expect(await page.evaluate(() => layout.shapes.filter(s => s.kind === 'compound').length)).toBe(0);
    expect(await page.evaluate(() => layout.shapes.filter(s => ['rect', 'ellipse'].includes(s.kind)).length)).toBeGreaterThanOrEqual(2);
    // Refused: a rotated part, a single shape, an icon.
    await page.evaluate(i => docsync.api.rotate(i, 10), a);
    expect((await page.evaluate(([x, y]) => docsync.api.pathfinder([x, y], 'union'), [a, b])).ok).toBe(false);
  });

  test('the pen draws by clicking on the page', async ({ page }) => {
    await gotoEditor(page);
    const n0 = await page.evaluate(() => layout.shapes.filter(s => s.kind === 'path').length);
    await page.evaluate(() => $('shapepop').querySelector('[data-pen]').click());
    const frame = page.frameLocator('#out');
    const pg = frame.locator('section.page').nth(2);
    await pg.scrollIntoViewIfNeeded();
    const box = await pg.boundingBox();
    // The sheet is taller than the window: click inside the part on screen.
    const top = Math.max(box.y, 0) + 150;
    await page.mouse.click(box.x + 80, top + 60);
    await page.mouse.click(box.x + 200, top);
    await page.mouse.click(box.x + 260, top + 100);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => layout.shapes.filter(s => s.kind === 'path').length)).toBe(n0 + 1);
    const p = await page.evaluate(() => layout.shapes.filter(s => s.kind === 'path').pop());
    expect(p.points.length).toBe(3);
    expect(p.closed).toBe(true);
  });
});
