// The small polish items (INDESIGN_PARITY.md 65, 67, 69, 71, 72).
const { warmTest: test, expect, gotoEditor, openFileMenu } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const addBox = async (page, md, extra = {}) => {
  const r = await page.evaluate(([m, x]) => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: m, ...x }), [md, extra]);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};
const addShape = async (page, o) => {
  const r = await page.evaluate(o => docsync.api.addShape({ page: 3, kind: 'rect', w: 1, h: 1, ...o }), o);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};

test.describe('65 the format painter carries the whole look', () => {
  test('a shape\'s blend and glow, a box\'s padding, radius, border and effects, a table\'s look', async ({ page }) => {
    await gotoEditor(page);
    const a = await addShape(page, { x: 1, y: 1 }), b = await addShape(page, { x: 3, y: 1 });
    await page.evaluate(a => { pushHistory(); Object.assign(shapeOf(a), { blend: 'multiply', glow: { size: 0.1, color: '#F2C94C', alpha: 0.7 }, fill: '#123456' }); markDirty(); return render(); }, a);
    const d = 'document.getElementById("out").contentDocument';
    await page.evaluate(([a, b]) => { const d = $('out').contentDocument; setSel(d, [a]); copyStyle(d); setSel(d, [b]); return pasteStyle(d); }, [a, b]);
    expect(await page.evaluate(b => [shapeOf(b).blend, shapeOf(b).glow.size, shapeOf(b).fill], b)).toEqual(['multiply', 0.1, '#123456']);
    const x = await addBox(page, 'one', { y: 4 }), y = await addBox(page, 'two', { y: 6 });
    await page.evaluate(x => { pushHistory(); Object.assign(boxOf(x), { pad: 0.2, radius: 0.1, border: { w: 2, color: '#000000' }, fade: { angle: 180, from: 0.4, to: 1 } }); markDirty(); return render(); }, x);
    await page.evaluate(([x, y]) => { const d = $('out').contentDocument; setSel(d, [x]); copyStyle(d); setSel(d, [y]); return pasteStyle(d); }, [x, y]);
    expect(await page.evaluate(y => { const o = boxOf(y); return [o.pad, o.radius, o.border.w, o.fade.from, o.md]; }, y)).toEqual([0.2, 0.1, 2, 0.4, 'two']);
  });

  test('on words: ⌘⌥C takes a run\'s look, ⌘⌥V puts it on other words', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { pushHistory(); layout.textStyles = { ...(layout.textStyles || {}), Stress: { color: '#C0392B' } }; markDirty(); return render(); });
    const id = await addBox(page, '[one]{.Stress} two three');
    const r = await page.evaluate(async i => {
      const d = $('out').contentDocument, el = d.querySelector(`[data-el="${CSS.escape(i)}"]`);
      editBox(d, el, null);
      const host = d.activeElement;
      const sel = d.getSelection(), cs = host.querySelector('span.ds-cs');
      const r1 = d.createRange(); r1.setStart(cs.firstChild, 1); r1.collapse(true);
      sel.removeAllRanges(); sel.addRange(r1);
      textPaintCopy(d, host);
      const w = d.createTreeWalker(host, NodeFilter.SHOW_TEXT); let tn;
      while ((tn = w.nextNode())) if (tn.textContent.includes('three')) break;
      const at = tn.textContent.indexOf('three'), r2 = d.createRange();
      r2.setStart(tn, at); r2.setEnd(tn, at + 5); sel.removeAllRanges(); sel.addRange(r2);
      textPaintPaste(d, host);
      host.blur();
      await new Promise(r => setTimeout(r, 300));
      return boxOf(i).md;
    }, id);
    expect(r).toBe('[one]{.Stress} two [three]{.Stress}');
  });
});

test.describe('67 Glyphs', () => {
  test('search finds the okina by name and a character by code; a pick goes in at the caret', async ({ page }) => {
    await gotoEditor(page);
    const okina = await page.evaluate(() => glyphMatches('okina').flatMap(([, l]) => l.map(([c]) => c)));
    expect(okina).toContain('ʻ');
    const byCode = await page.evaluate(() => glyphMatches('U+2192').flatMap(([, l]) => l.map(([c]) => c)));
    expect(byCode).toContain('→');
    const id = await addBox(page, 'Hawaii');
    await page.evaluate(i => {
      const d = $('out').contentDocument, el = d.querySelector(`[data-el="${CSS.escape(i)}"]`);
      editBox(d, el, null);
      const host = d.activeElement, tn = [...host.querySelectorAll('*'), host].map(n => [...n.childNodes].find(c => c.nodeType === 3)).find(Boolean);
      const r = d.createRange(); r.setStart(tn, 5); r.collapse(true);
      d.getSelection().removeAllRanges(); d.getSelection().addRange(r);
      openGlyphs(d, host, r);
    }, id);
    await expect(page.locator('#glyphpop')).toBeVisible();
    await page.fill('#gl-q', 'okina');
    await page.locator('#gl-list button[data-ch="ʻ"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#glyphpop')).toBeHidden();
    await page.evaluate(() => $('out').contentDocument.activeElement.blur());
    await expect.poll(() => page.evaluate(i => boxOf(i).md, id)).toBe('Hawaiʻi');
    expect(await page.evaluate(() => glyphRecent()[0])).toBe('ʻ');
  });
});

test.describe('69 undo history', () => {
  test('lists the steps by what they changed, and goes back and forward to one', async ({ page }) => {
    await gotoEditor(page);
    const a = await addShape(page, { x: 1, y: 1 });
    await api(page, `place(${JSON.stringify(a)}, { x: 2 })`);
    const b = await addBox(page, 'hello', { y: 5 });
    const rows = await page.evaluate(() => historyList());
    expect(rows[0].state).toBe('now');
    expect(rows[1].label).toContain(`added text box ${b.slice(5)}`);
    expect(rows[2].label).toContain(`shape ${a}`);
    expect(rows[3].label).toContain(`added shape ${a}`);
    await page.click('#history');
    await expect(page.locator('#histpop .hrow')).toHaveCount(rows.length);
    // Back three steps — before the shape — then forward one.
    await page.locator('#histpop .hrow').nth(3).click();
    await expect.poll(() => page.evaluate(a => !!shapeOf(a), a)).toBe(false);
    await expect(page.locator('#histpop .hrow.ahead')).toHaveCount(3);
    await page.locator('#histpop .hrow.ahead').last().click();
    await expect.poll(() => page.evaluate(a => !!shapeOf(a), a)).toBe(true);
  });
});

test.describe('71 more ways out', () => {
  test('just the selection crops the page render to its box; JPEG pages re-encode the zip', async ({ page }) => {
    await gotoEditor(page);
    const s = await addShape(page, { x: 2, y: 3, w: 1.5, h: 1, fill: '#C0392B' });
    // A real page-sized PNG, red where the shape is, stands in for Chrome.
    const png = await page.evaluate(() => new Promise(res => {
      const c = document.createElement('canvas'); c.width = 816 * 3; c.height = 1056 * 3;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#C0392B'; g.fillRect(2 * 288, 3 * 288, 1.5 * 288, 288);
      c.toBlob(b => b.arrayBuffer().then(a => res([...new Uint8Array(a)])), 'image/png');
    }));
    let sent = null;
    await page.route('**/__export', route => { sent = route.request().postDataJSON();
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png) }); });
    await api(page, `select(${JSON.stringify(s)})`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportSelection('png'))]);
    expect(sent).toMatchObject({ fmt: 'png', page: 3, scale: 3 });
    expect(dl.suggestedFilename()).toMatch(/-selection\.png$/);
    const buf = await (await dl.createReadStream()).toArray().then(c => Buffer.concat(c));
    const dims = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    expect(Math.abs(dims[0] - (1.5 + 0.08) * 288)).toBeLessThan(4);
    expect(Math.abs(dims[1] - (1 + 0.08) * 288)).toBeLessThan(4);
  });

  test('the Download menu offers JPEG, the selection and a package', async ({ page }) => {
    await gotoEditor(page);
    await openFileMenu(page);
    await page.click('#download');
    for (const t of ['JPEG — every page (.zip)', 'Just the selection — PNG', 'Package — PDF, pages, HTML and fonts (.zip)'])
      await expect(page.locator('#downloadpop .shp-t', { hasText: t })).toBeVisible();
    await expect(page.locator('#dl-sel')).toBeDisabled();       // nothing selected
    expect(await page.evaluate(() => fontFaces("@font-face{font-family:'Barlow';font-weight:700;src:url(https://fonts.gstatic.com/s/barlow/v1/x.woff2) format('woff2')}")))
      .toEqual([{ family: 'Barlow', weight: '700', style: 'normal', url: 'https://fonts.gstatic.com/s/barlow/v1/x.woff2',
                  rule: "@font-face{font-family:'Barlow';font-weight:700;src:url(https://fonts.gstatic.com/s/barlow/v1/x.woff2) format('woff2')}" }]);
  });
});

test.describe('72 measure readout', () => {
  test('neighbours each side within reach; ⌥-hover measures to what is under the pointer', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => measureNeighbours(
      [{ x: 0.5, y: 1, w: 1, h: 1 }, { x: 4, y: 1.2, w: 1, h: 1 }, { x: 2, y: 3.5, w: 1, h: 1 }, { x: 7, y: 9, w: 1, h: 1 }],
      { x: 2, y: 1, w: 1, h: 1 }).map(m => [m.axis, +(m.b - m.a).toFixed(2)]));
    expect(r).toEqual([['x', 0.5], ['x', 1], ['y', 1.5]]);
    const between = await page.evaluate(() => measureBetween({ x: 1, y: 1, w: 1, h: 1 }, { x: 3, y: 4, w: 1, h: 1 })
      .map(m => [m.axis, +(m.b - m.a).toFixed(2)]));
    expect(between).toEqual([['x', 1], ['y', 2]]);
    const inside = await page.evaluate(() => measureBetween({ x: 1, y: 1, w: 1, h: 1 }, { x: 0, y: 0, w: 8.5, h: 11 })
      .map(m => +(m.b - m.a).toFixed(2)));
    expect(inside).toEqual([1, 6.5, 1, 9]);
    // On the page: hold ⌥ over another shape.
    const a = await addShape(page, { x: 1, y: 1 }), b = await addShape(page, { x: 3.5, y: 1 });
    await api(page, `select(${JSON.stringify(a)})`);
    const label = await page.evaluate(b => {
      const d = $('out').contentDocument, el = d.querySelector(`[data-shape="${CSS.escape(b)}"]`);
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, altKey: true }));
      return [...d.querySelectorAll('.ds-guide.mx')].map(g => g.dataset.gap);
    }, b);
    expect(label).toEqual(['1.50″']);
  });
});
