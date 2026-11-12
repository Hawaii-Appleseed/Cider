// CONNECTOR_PARITY.md step 5: the right-click menu's look, by name, for the
// hub's connector — written into the same stores the menu writes, so the
// menu reads back what a pilot set. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, fn, ...args) => page.evaluate(([f, a]) => docsync.api[f](...a), [fn, args]);
const shape = async (page, o) => {
  const r = await api(page, 'addShape', { page: 3, x: 1, y: 1, w: 1, h: 1, ...o });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id;
};
const table = async page => {
  const r = await api(page, 'addTable', { page: 3, x: 1, y: 4, w: 4, rows: [['A', 'B'], ['1', '2'], ['3', '4']] });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.id.startsWith('table.') ? r.id : 'table.' + r.id;
};

test.describe('look verbs', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('setShape takes dash, ends, sides, points and QR data, and refuses them on the wrong kind', async ({ page }) => {
    const ln = await shape(page, { kind: 'line', h: 0 });
    let r = await api(page, 'setShape', ln, { dash: 'dotted', ends: 'both' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await page.evaluate(i => ({ dash: shapeOf(i).dash, ends: shapeOf(i).ends }), ln)).toEqual({ dash: [0.02, 0.04], ends: 'both' });
    await api(page, 'setShape', ln, { dash: 'solid', ends: 'none' });
    expect(await page.evaluate(i => [shapeOf(i).dash, shapeOf(i).ends], ln)).toEqual([undefined, undefined]);
    const rect = await shape(page, {});
    expect((await api(page, 'setShape', rect, { ends: 'end' })).ok).toBe(false);
    expect((await api(page, 'setShape', rect, { sides: 5 })).ok).toBe(false);
    const poly = await shape(page, { kind: 'polygon', sides: 8 });
    expect(await page.evaluate(i => shapeOf(i).sides, poly)).toBe(8);
    expect((await api(page, 'setShape', poly, { sides: 5 })).ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).sides, poly)).toBe(5);
    const star = await shape(page, { kind: 'star', points: 7, inner: 0.4 });
    expect(await page.evaluate(i => [shapeOf(i).points, shapeOf(i).inner], star)).toEqual([7, 0.4]);
    const qr = await shape(page, { kind: 'qr' });
    expect((await api(page, 'setShape', qr, { data: 'https://example.org/x' })).ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).data, qr)).toBe('https://example.org/x');
  });

  test('setLook sets opacity, blend and shadow where the menu keeps them, as one undo step', async ({ page }) => {
    const id = await shape(page, {});
    const r = await api(page, 'setLook', id, { alpha: 0.5, blend: 'multiply', shadow: { blur: 0.2 } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const s = await page.evaluate(i => shapeOf(i), id);
    expect(s.alpha).toBe(0.5);
    expect(s.blend).toBe('multiply');
    expect(s.shadow).toEqual({ offset: 0.05, direction: 135, blur: 0.2, alpha: 0.35 });
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(i => [shapeOf(i).alpha, shapeOf(i).blend, shapeOf(i).shadow], id)).toEqual([undefined, undefined, undefined]);
    expect((await api(page, 'setLook', id, { alpha: 2 })).ok).toBe(false);
    expect((await api(page, 'setLook', id, { blend: 'glow' })).ok).toBe(false);
    expect((await api(page, 'setLook', id, { colour: 'red' })).ok).toBe(false);
    const t = await table(page);
    expect((await api(page, 'setLook', t, { shadow: true })).error).toMatch(/shadow is for shapes and text boxes/);
    expect((await api(page, 'setLook', t, { alpha: 0.7 })).ok).toBe(true);
  });

  test('animate sets and clears an entrance', async ({ page }) => {
    const id = await shape(page, {});
    expect((await api(page, 'animate', id, { kind: 'rise', duration: 1.2 })).ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).anim, id)).toEqual({ kind: 'rise', duration: 1.2, delay: 0 });
    expect((await api(page, 'animate', id, null)).ok).toBe(true);
    expect(await page.evaluate(i => shapeOf(i).anim, id)).toBeUndefined();
    expect((await api(page, 'animate', id, { kind: 'spin' })).ok).toBe(false);
  });

  test('tableRow and tableCol insert, delete and move lines, and refuse what is not there', async ({ page }) => {
    const t = await table(page);
    const rows = () => page.evaluate(i => tableOfId(i).rows, t);
    expect((await api(page, 'tableRow', t, 'insert', 1)).ok).toBe(true);
    expect((await rows()).length).toBe(4);
    expect((await api(page, 'tableRow', t, 'delete', 1)).ok).toBe(true);
    expect((await api(page, 'tableRow', t, 'move', 2, 0)).ok).toBe(true);
    expect((await rows()).map(r => r[0])).toEqual(['3', 'A', '1']);
    expect((await api(page, 'tableCol', t, 'insert', 2)).ok).toBe(true);
    expect((await rows())[0].length).toBe(3);
    expect((await api(page, 'tableCol', t, 'move', 0, 1)).ok).toBe(true);
    expect((await rows())[0]).toEqual(['4', '3', '']);
    expect((await api(page, 'tableRow', t, 'even')).ok).toBe(true);
    expect(await page.evaluate(i => (tableOfId(i).rowh || []).length, t)).toBe(3);
    expect((await api(page, 'tableCol', t, 'fit')).ok).toBe(true);
    expect((await api(page, 'tableRow', t, 'delete', 9)).ok).toBe(false);
    expect((await api(page, 'tableRow', t, 'fit')).ok).toBe(false);
    expect((await api(page, 'tableRow', 'table.nope', 'insert', 0)).ok).toBe(false);
  });

  test('copyStyle puts one shape\'s look on others, and refuses a different kind', async ({ page }) => {
    const a = await shape(page, { fill: '#C4602F', stroke: '#2F3E46', sw: 0.04 });
    const b = await shape(page, { x: 3 });
    const c = await shape(page, { x: 5 });
    const r = await api(page, 'copyStyle', a, [b, c]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    for (const id of [b, c]) expect(await page.evaluate(i => [shapeOf(i).fill, shapeOf(i).stroke, shapeOf(i).sw], id)).toEqual(['#C4602F', '#2F3E46', 0.04]);
    const t = await table(page);
    expect((await api(page, 'copyStyle', a, [t])).error).toMatch(/every target is a shape/);
  });

  test('crop and tone work on a designed picture and refuse anything else', async ({ page }) => {
    const id = 'onetime.photo';
    const has = await page.evaluate(i => !!$('out').contentDocument.querySelector(`[data-el="${i}"]`), id);
    test.skip(!has, 'the fixture has no onetime.photo');
    let r = await api(page, 'tone', id, { brightness: 1.2, mono: 1 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await page.evaluate(i => layout.img[i].filter, id)).toEqual({ bright: 1.2, gray: 1 });
    r = await api(page, 'crop', id, { imgW: 6, dx: 0.5, dy: 0.25 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await page.evaluate(i => layout.img[i].crop, id)).toEqual({ imgW: 6, dx: 0.5, dy: 0.25 });
    expect((await api(page, 'crop', id, null)).ok).toBe(true);
    expect(await page.evaluate(i => layout.img[i].crop, id)).toBeUndefined();
    const sh = await shape(page, {});
    expect((await api(page, 'tone', sh, { gray: 1 })).ok).toBe(false);
    expect((await api(page, 'crop', sh, { imgW: 2 })).ok).toBe(false);
  });

  test('the relay takes the new verbs: batch for the looks, alone for copyStyle and setWebsite', async ({ page }) => {
    for (const v of ['setLook', 'animate', 'crop', 'tone', 'tableRow', 'tableCol'])
      expect(await page.evaluate(x => !!PILOT_BATCH_VERBS[x], v), v).toBe(true);
    for (const v of ['copyStyle', 'setWebsite'])
      expect(await page.evaluate(x => PILOT_SINGLE_VERBS.has(x) && !PILOT_BATCH_VERBS[x], v), v).toBe(true);
  });
});
