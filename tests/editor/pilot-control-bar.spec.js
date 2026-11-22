// The Control bar's small adjustments, by verb (INDESIGN_PARITY control-bar
// plan; the 2026-11-18 verb audit): transform (X/Y/W/H about a reference
// point, scale %, X%/Y%, rotate/turn, flip), setFrame (columns, gutter, inset,
// vertical alignment), setRun (size / leading / tracking on words, a kern at a
// caret) and setType (the type fields in the bar's units) — plus the reads
// that let a pilot see what the bar shows (inventory's xf, r, frame, type).
// Each verb is ONE undo step and lands through the one render, and
// transform/setFrame run the very code the bar runs, which the first two
// tests hold it to.
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const elOf = async (page, id) => page.evaluate(async id => {
  const inv = docsync.api.inventory();
  return inv.pages.flatMap(p => p.elements).find(e => e.id === id) || null;
}, id);
const steps = page => page.evaluate(() => undoHistory.steps().past.length);

test.describe('pilot: the control bar, by verb', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await settled(page);
  });

  test('transform: X/Y about a reference point, one undo step, the bar lands the same', async ({ page }) => {
    const sh = await api(page, `addShape({ page: 3, kind: 'rect', x: 1, y: 4, w: 2, h: 1 })`);
    expect(sh.ok).toBe(true);
    const before = await steps(page);
    const r = await api(page, `transform('${sh.id}', { ref: 'br', X: 6, Y: 7, w: 3, h: 2 })`);
    expect(r.ok).toBe(true);
    expect(await steps(page)).toBe(before + 1);
    // The bottom-right corner is at (6, 7) and the box is 3 x 2.
    const b = (await elOf(page, sh.id)).box;
    expect(b.x + b.w).toBeCloseTo(6, 1); expect(b.y + b.h).toBeCloseTo(7, 1);
    expect(b.w).toBeCloseTo(3, 1); expect(b.h).toBeCloseTo(2, 1);
    const viaVerb = await page.evaluate(id => JSON.stringify(layout.shapes.find(s => s.id === id)), sh.id);
    // The bar's own path, same patch, same reference point: the same store.
    await api(page, 'undo()');
    const same = await page.evaluate(async id => {
      docsync.api.select(id);
      const was = [ctlRef, ctlLink];
      ctlRef = 'br'; ctlLink = false;
      try { await ctlFrameChange({ X: 6, Y: 7, w: 3, h: 2 }); }
      finally { [ctlRef, ctlLink] = was; docsync.api.select(null); ctlPaint($('out').contentDocument); }
      return JSON.stringify(layout.shapes.find(s => s.id === id));
    }, sh.id);
    expect(same).toBe(viaVerb);
    // Undo puts it back.
    await api(page, 'undo()');
    const back = (await elOf(page, sh.id)).box;
    expect(back.x).toBeCloseTo(1, 1); expect(back.w).toBeCloseTo(2, 1);
  });

  test('transform: link keeps proportion, sx/sy are percents, turn adds, flip toggles', async ({ page }) => {
    const sh = await api(page, `addShape({ page: 3, kind: 'rect', x: 1, y: 4, w: 2, h: 1 })`);
    await api(page, `transform('${sh.id}', { w: 4, link: true })`);
    let b = (await elOf(page, sh.id)).box;
    expect(b.w).toBeCloseTo(4, 1); expect(b.h).toBeCloseTo(2, 1);
    await api(page, `transform('${sh.id}', { sx: 50, sy: 50 })`);      // half of 4 x 2, linked: a quarter of the area twice over
    b = (await elOf(page, sh.id)).box;
    expect(b.w).toBeLessThan(2.01);
    await api(page, `transform('${sh.id}', { turn: 90 })`);
    await api(page, `transform('${sh.id}', { turn: 90 })`);
    expect((await elOf(page, sh.id)).xf.rot).toBe(180);
    await api(page, `transform('${sh.id}', { rot: 0, flip: 'h' })`);
    const xf = (await elOf(page, sh.id)).xf;
    expect(xf.flip).toBe('h'); expect(xf.rot).toBeUndefined();
    await api(page, `transform('${sh.id}', { flip: 'h' })`);                // a toggle, as the bar's button is
    expect((await elOf(page, sh.id)).xf).toBeUndefined();
  });

  test('transform: a drawing is scaled in percent; refusals say why', async ({ page }) => {
    const r = await api(page, `transform('cover.logo', { scale: 150 })`);
    expect(r.ok).toBe(true);
    expect((await elOf(page, 'cover.logo')).xf.scale).toBe(150);
    const sh = await api(page, `addShape({ page: 3, kind: 'rect', x: 1, y: 4, w: 2, h: 1 })`);
    expect((await api(page, `transform('${sh.id}', { scale: 150 })`)).error).toContain('drawings');
    expect((await api(page, `transform('cover.logo', { w: 3 })`)).error).toContain('scale');
    expect((await api(page, `transform('${sh.id}', { ref: 'x' })`)).error).toContain('tl t tr');
    expect((await api(page, `transform('${sh.id}', { rot: 5, turn: 5 })`)).error).toContain('one or the other');
    expect((await api(page, `transform('no.such', { X: 1 })`)).ok).toBe(false);
    await api(page, `lock('${sh.id}', true)`);
    expect((await api(page, `transform('${sh.id}', { X: 1 })`)).error).toContain('locked');
  });

  test('setFrame: columns, gutter, inset, vertical alignment — read back, one undo, bar parity', async ({ page }) => {
    const tb = await api(page, `addTextBox({ page: 3, x: 1, y: 1, w: 4, h: 3, md: 'Some words in a frame' })`);
    const before = await steps(page);
    const r = await api(page, `setFrame('${tb.id}', { cols: 2, gap: 0.3, pad: 0.15, vAlign: 'middle' })`);
    expect(r.ok).toBe(true);
    expect(await steps(page)).toBe(before + 1);
    expect(r.frame).toMatchObject({ cols: 2, gap: 0.3, pad: 0.15, vAlign: 'middle' });
    expect((await elOf(page, tb.id)).frame).toMatchObject({ cols: 2, gap: 0.3, pad: 0.15, vAlign: 'middle' });
    // The bar's setBoxFrame writes the same store.
    const viaVerb = await page.evaluate(id => JSON.stringify(boxOf(id)), tb.id);
    await api(page, 'undo()');
    expect((await elOf(page, tb.id)).frame).toBeUndefined();
    const viaBar = await page.evaluate(async id => {
      await setBoxFrame(id, { cols: 2, gap: 0.3, pad: 0.15, vAlign: 'middle' });
      return JSON.stringify(boxOf(id));
    }, tb.id);
    expect(viaBar).toBe(viaVerb);
    // null takes one back; top is the bar's "no alignment" button.
    await api(page, `setFrame('${tb.id}', { cols: 1, vAlign: 'top', pad: null })`);
    expect((await elOf(page, tb.id)).frame).toBeUndefined();
    expect((await api(page, `setFrame('${tb.id}', { cols: 5 })`)).error).toContain('1 to 4');
    expect((await api(page, `setFrame('${tb.id}', { gap: 3 })`)).error).toContain('0 to 2');
    expect((await api(page, `setFrame('${tb.id}', { vAlign: 'center' })`)).error).toContain('middle');
    expect((await api(page, `setFrame('cover.logo', { cols: 2 })`)).ok).toBe(false);
  });

  test('setRun: size and tracking on words, a kern at a caret, merged and split like the bar', async ({ page }) => {
    const tb = await api(page, `addTextBox({ page: 3, x: 1, y: 1, w: 4, md: 'Hello AV world' })`);
    const before = await steps(page);
    let r = await api(page, `setRun('${tb.id}', { find: 'world' }, { size: 14, track: 20 })`);
    expect(r.ok).toBe(true);
    expect(r.md).toBe('Hello AV [world]{size=14 track=20}');
    expect(await steps(page)).toBe(before + 1);
    // The engine drew it: 14pt is 18.67px.
    const px = await page.evaluate(() =>
      getComputedStyle($('out').contentDocument.querySelector('span[data-cr]')).fontSize);
    expect(parseFloat(px)).toBeCloseTo(14 * 4 / 3, 1);
    // Kern at a caret: the pair A|V is a one-character run.
    r = await api(page, `setRun('${tb.id}', { find: 'AV', caretAfter: 1 }, { kern: -60 })`);
    expect(r.md).toBe('Hello [A]{kern=-60}V [world]{size=14 track=20}');
    // A selection across a run splits it and merges what it touches.
    r = await api(page, `setRun('${tb.id}', { find: 'rld' }, { size: 20 })`);
    expect(r.md).toBe('Hello [A]{kern=-60}V [wo]{size=14 track=20}[rld]{size=20 track=20}');
    // null takes a key off, and an emptied run is plain words again.
    r = await api(page, `setRun('${tb.id}', { find: 'A' }, { kern: null })`);
    expect(r.md.startsWith('Hello AV ')).toBe(true);
    // The same string the bar's applyCharRun would write: read it back as a slot.
    expect((await api(page, `getSlot('basics.h1')`)).md).toBe('# BUDGET BASICS');
    r = await api(page, `setRun('basics.h1', { find: 'BASICS' }, { lead: 30 })`);
    expect(r.ok).toBe(true);
    expect((await api(page, `getSlot('basics.h1')`)).md).toBe('# BUDGET [BASICS]{lead=30}');
    await api(page, 'undo()');
    expect((await api(page, `getSlot('basics.h1')`)).md).toBe('# BUDGET BASICS');
  });

  test('setRun refuses what the bar refuses: under the floor, wrong units, words not there', async ({ page }) => {
    const tb = await api(page, `addTextBox({ page: 3, x: 1, y: 1, w: 4, md: 'Hello **big bold** world' })`);
    const bad = async (sel, p) => (await api(page, `setRun('${tb.id}', ${JSON.stringify(sel)}, ${JSON.stringify(p)})`));
    expect((await bad({ find: 'Hello' }, { size: 5 })).error).toContain('7.875pt floor');
    expect((await bad({ find: 'Hello' }, { lead: -2 })).error).toContain('points');
    expect((await bad({ find: 'Hello' }, { track: 12.5 })).error).toContain('thousandths');
    expect((await bad({ find: 'Hello' }, { colour: 1 })).error).toContain('not a run key');
    expect((await bad({ find: 'nothere' }, { size: 14 })).error).toContain('not in these words');
    expect((await bad({ find: 'bold** wo' }, { size: 14 })).error).toContain('bold or italic marker');
    expect((await bad({ find: 'Hello', caretAfter: 9 }, { kern: 5 })).error).toContain('character count');
    expect((await bad({ find: 'Hello', caretAfter: 2 }, { size: 14 })).error).toContain('kerning only');
    expect((await api(page, `setRun('nope', { find: 'a' }, { size: 14 })`)).ok).toBe(false);
    // Inside a bold stretch is fine: the run sits inside the marker.
    const ok = await bad({ find: 'big' }, { size: 14 });
    expect(ok.md).toBe('Hello **[big]{size=14} bold** world');
    // The Character panel's other keys: a family the report cannot load, a
    // weight that family has not got, a colour that is not one, a shift past 24.
    expect((await bad({ find: 'Hello' }, { font: 'Comic Sans' })).error).toContain('not a font');
    expect((await bad({ find: 'Hello' }, { font: 'Lora', weight: 300 })).error).toContain('no weight 300');
    expect((await bad({ find: 'Hello' }, { color: 'red' })).error).toContain('hex colour');
    expect((await bad({ find: 'Hello' }, { case: 'shout' })).error).toContain('upper, lower or title');
    expect((await bad({ find: 'Hello' }, { shift: 30 })).error).toContain('-24 to 24');
  });

  test('setRun: font, weight, colour, case, small caps, strike and shift on words', async ({ page }) => {
    const tb = await api(page, `addTextBox({ page: 3, x: 1, y: 1, w: 4, md: 'Hello brave world' })`);
    let r = await api(page, `setRun('${tb.id}', { find: 'brave' }, { font: 'Lora', weight: 700, color: '#C0392B', case: 'upper', smcp: 'small', strike: true, shift: 2 })`);
    expect(r.ok).toBe(true);
    expect(r.md).toBe('Hello [brave]{font="Lora" weight=700 color=#C0392B case=upper smcp=small strike=1 shift=2} world');
    const cs = await page.evaluate(() => {
      const e = $('out').contentDocument.querySelector('span[data-cr]');
      const c = getComputedStyle(e);
      return { fam: c.fontFamily, w: c.fontWeight, col: c.color, tt: c.textTransform, deco: c.textDecorationLine };
    });
    expect(cs.fam).toContain('Lora');
    expect(cs.w).toBe('700');
    expect(cs.col).toBe('rgb(192, 57, 43)');
    expect(cs.tt).toBe('uppercase');
    expect(cs.deco).toContain('line-through');
    // strike false and null take keys off; the rest stay.
    r = await api(page, `setRun('${tb.id}', { find: 'brave' }, { strike: false, smcp: null, shift: null, case: null })`);
    expect(r.md).toBe('Hello [brave]{font="Lora" weight=700 color=#C0392B} world');
  });

  test('setType: the type fields in the bar\'s units, as one undo step', async ({ page }) => {
    const tb = await api(page, `addTextBox({ page: 3, x: 1, y: 1, w: 4, md: 'Some words' })`);
    const before = await steps(page);
    const r = await api(page, `setType('${tb.id}', { size: 18, lead: 24, track: 50, shift: 2 })`);
    expect(r.ok).toBe(true);
    expect(await steps(page)).toBe(before + 1);
    // The style keeps px, a multiple and px; the bar's units come back beside it.
    expect(r.style.size).toBeCloseTo(24, 1);                 // 18pt
    expect(r.style.leading).toBeCloseTo(24 / 18, 2);          // 24pt on 18pt
    expect(r.style.tracking).toBeCloseTo(0.05 * 24, 1);       // 50/1000 em of 24px
    expect(r.style.shift).toBe(2);
    expect(r.bar.size).toBe(18); expect(r.bar.track).toBe(50);
    expect(r.bar.lead).toBeCloseTo(24, 1);
    // The inventory reads it back in the same units.
    expect((await elOf(page, tb.id)).type).toMatchObject({ size: 18, track: 50 });
    // A multiple instead of points; null is auto.
    const x = await api(page, `setType('${tb.id}', { leadX: 1.5 })`);
    expect(x.style.leading).toBe(1.5);
    const auto = await api(page, `setType('${tb.id}', { lead: null, track: null })`);
    expect(auto.style.leading).toBeUndefined(); expect(auto.style.tracking).toBeUndefined();
    expect((await api(page, `setType('${tb.id}', { size: 5 })`)).error).toContain('7.875');
    expect((await api(page, `setType('${tb.id}', { lead: 20, leadX: 1.4 })`)).error).toContain('not both');
    expect((await api(page, `setType('nope', { size: 14 })`)).ok).toBe(false);
  });

  test('setShape takes the bar\'s corner range, 0 to 2 inches', async ({ page }) => {
    const sh = await api(page, `addShape({ page: 3, kind: 'rect', x: 1, y: 4, w: 4, h: 3 })`);
    expect((await api(page, `setShape('${sh.id}', { r: 1.5 })`)).ok).toBe(true);
    expect((await elOf(page, sh.id)).r).toBe(1.5);
    expect((await api(page, `setShape('${sh.id}', { r: 2.5 })`)).error).toContain('0 to 2');
  });

  test('inventory carries what the bar shows: rotation, shear, flip, opacity, fit', async ({ page }) => {
    const sh = await api(page, `addShape({ page: 3, kind: 'rect', x: 1, y: 4, w: 2, h: 1 })`);
    await api(page, `batch([{verb:'rotate',args:['${sh.id}',15]},{verb:'skew',args:['${sh.id}',10]},{verb:'flip',args:['${sh.id}','v']},{verb:'setLook',args:['${sh.id}',{alpha:0.5}]}])`);
    const e = await elOf(page, sh.id);
    expect(e.xf).toEqual({ rot: 15, skew: 10, flip: 'v' });
    expect(e.alpha).toBe(0.5);
    // Slots carry their type in the bar's units too.
    const slot = await page.evaluate(() => docsync.api.inventory().pages.flatMap(p => p.slots).find(s => s.key === 'basics.h1'));
    expect(slot.type.size).toBeGreaterThan(8);
    // And a batch mixes them: one undo step for the lot.
    const before = await steps(page);
    const r = await api(page, `batch([
      {verb:'transform',args:['${sh.id}',{X:5,Y:5,ref:'c'}]},
      {verb:'setRun',args:['basics.h1',{find:'BUDGET'},{size:30}]},
      {verb:'setType',args:['whopays.p1',{size:16}]}])`);
    if (!r.ok) throw new Error(r.error);
    expect(await steps(page)).toBe(before + 1);
  });
});
