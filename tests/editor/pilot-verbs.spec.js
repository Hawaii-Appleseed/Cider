// The pilot API's second wave (edit.html window.docsync.api): the verbs that
// used to force a pilot back to clicking — typography (setStyle), a text box's
// own words (setBoxText — they live in layout.json, out of setSlot's reach),
// rotate/lock/group/ungroup/remove/duplicate — plus batch() cross-references
// ({as:'name'} / '@name') and audit(), the mechanical eye that replaces
// screenshot round-trips for geometry questions. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addBox(page, opts = {}) {
  const r = await page.evaluate(o => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 2, md: 'verb fixture', ...o }), opts);
  expect(r.ok).toBe(true);
  return r.id;
}

test.describe('pilot verbs', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('setStyle writes a slot\'s typography through layout.text, and undo clears it',
    async ({ page }) => {
      const r = await api(page, `setStyle('basics.h1', { size: 30, color: '#E23B3B' })`);
      expect(r.ok).toBe(true);
      expect(r.style).toMatchObject({ size: 30, color: '#E23B3B' });
      expect(await page.evaluate(() => layout.text['basics.h1'].size)).toBe(30);
      // The rendered heading actually wears it.
      const fs = await page.evaluate(() => getComputedStyle(
        $('out').contentDocument.querySelector('[data-slot="basics.h1"]')).fontSize);
      expect(parseFloat(fs)).toBeCloseTo(30, 0);
      await api(page, 'undo()');
      expect(await page.evaluate(() => (layout.text || {})['basics.h1'])).toBeUndefined();
    });

  test('setStyle routes a text box\'s style to the box object, not layout.text',
    async ({ page }) => {
      const id = await addBox(page);
      const r = await page.evaluate(i => docsync.api.setStyle(i, { size: 18 }), id);
      expect(r.ok).toBe(true);
      expect(await page.evaluate(i =>
        (layout.boxes.find(b => 'text.' + b.id === i) || {}).style, id)).toMatchObject({ size: 18 });
      expect(await page.evaluate(() => layout.text)).toBeFalsy();
      // A key that names nothing refuses.
      expect((await api(page, `setStyle('no.such.key', { size: 12 })`)).ok).toBe(false);
      // A non-object patch refuses.
      expect((await api(page, `setStyle('basics.h1', 12)`)).ok).toBe(false);
    });

  test('setBoxText replaces a box\'s words — the write setSlot cannot make',
    async ({ page }) => {
      const id = await addBox(page);
      const r = await page.evaluate(i => docsync.api.setBoxText(i, 'retexted **by pilot**'), id);
      expect(r.ok).toBe(true);
      expect(await page.evaluate(i =>
        layout.boxes.find(b => 'text.' + b.id === i).md, id)).toBe('retexted **by pilot**');
      await expect(page.frameLocator('#out').locator(`[data-el="${id}"]`))
        .toContainText('retexted');
      expect((await api(page, `setBoxText('text.nope', 'x')`)).ok).toBe(false);
      // Emptying is remove()'s job, refused here.
      expect((await page.evaluate(i => docsync.api.setBoxText(i, '  '), id)).ok).toBe(false);
    });

  test('rotate writes rot into the element\'s store and 0 clears it', async ({ page }) => {
    const id = await addBox(page);
    const r = await page.evaluate(i => docsync.api.rotate(i, 15), id);
    expect(r.ok).toBe(true);
    expect(r.rot).toBe(15);
    expect(await page.evaluate(i =>
      layout.boxes.find(b => 'text.' + b.id === i).rot, id)).toBe(15);
    await page.evaluate(i => docsync.api.rotate(i, 0), id);
    expect(await page.evaluate(i =>
      layout.boxes.find(b => 'text.' + b.id === i).rot, id)).toBeUndefined();
  });

  test('lock stops place() until unlocked — and unlocking a locked element is possible',
    async ({ page }) => {
      const id = await addBox(page);
      const l = await page.evaluate(i => docsync.api.lock(i), id);
      expect(l.ok).toBe(true);
      expect(l.locked).toBe(true);
      const refused = await page.evaluate(i => docsync.api.place(i, { x: 2 }), id);
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain('locked');
      const u = await page.evaluate(i => docsync.api.lock(i, false), id);
      expect(u.ok).toBe(true);
      expect((await page.evaluate(i => docsync.api.place(i, { x: 2 }), id)).ok).toBe(true);
    });

  test('group ties elements, ungroup dissolves, membership is exclusive', async ({ page }) => {
    // The fixture seeds its own groups (a detachable card's default), so every
    // assertion is relative to the groups THIS test makes.
    const mine = ids => page.evaluate(list =>
      (layout.groups || []).filter(g => g.some(m => list.includes(m))), ids);
    const a = await addBox(page, { x: 1 });
    const b = await addBox(page, { x: 4 });
    const c = await addBox(page, { x: 6 });
    const g1 = await page.evaluate(ids => docsync.api.group(ids), [a, b]);
    expect(g1.ok).toBe(true);
    expect(await mine([a, b, c])).toEqual([[a, b]]);
    // Regrouping b with c pulls b out of the first group, which dissolves.
    const g2 = await page.evaluate(ids => docsync.api.group(ids), [b, c]);
    expect(g2.ok).toBe(true);
    expect(await mine([a, b, c])).toEqual([[b, c]]);
    const un = await page.evaluate(i => docsync.api.ungroup(i), b);
    expect(un.ok).toBe(true);
    expect(un.members).toEqual([b, c]);
    expect(await mine([a, b, c])).toEqual([]);
    expect((await api(page, `group(['only.one'])`)).ok).toBe(false);
    expect((await api(page, `ungroup('${a}')`)).ok).toBe(false);
  });

  test('remove deletes a box outright and hides a designed element (reversibly)',
    async ({ page }) => {
      const id = await addBox(page);
      const r = await page.evaluate(i => docsync.api.remove(i), id);
      expect(r.ok).toBe(true);
      expect(await page.evaluate(i =>
        layout.boxes.some(b => 'text.' + b.id === i), id)).toBe(false);
      // A designed element in its designed place ghosts instead of dying —
      // pick one the fixture has NOT pinned (a pinned one's Delete resets its
      // override instead, deleteSel's documented ladder).
      const target = await page.evaluate(() => {
        const d = $('out').contentDocument;
        return [...d.querySelectorAll('[data-el]')].map(el => el.dataset.el)
          .find(i => i && !layout.positions[i] && !i.startsWith('text.')
                     && !i.startsWith('table.') && !i.startsWith('endnote.'));
      });
      expect(target).toBeTruthy();
      const del = await page.evaluate(i => docsync.api.remove(i), target);
      expect(del.ok).toBe(true);
      expect(await page.evaluate(() => (layout.hidden || []))).toContain(target);
      await api(page, 'undo()');
      expect(await page.evaluate(() => (layout.hidden || []))).not.toContain(target);
      expect((await api(page, `remove('no.such.thing')`)).ok).toBe(false);
    });

  test('remove refuses when everything named is locked', async ({ page }) => {
    const id = await addBox(page);
    await page.evaluate(i => docsync.api.lock(i), id);
    const r = await page.evaluate(i => docsync.api.remove(i), id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('locked');
  });

  test('duplicate clones a box and reports the copy\'s id, not the original\'s',
    async ({ page }) => {
      const id = await addBox(page);
      const r = await page.evaluate(i => docsync.api.duplicate(i), id);
      expect(r.ok).toBe(true);
      expect(r.copies).toHaveLength(1);
      expect(r.copies[0]).not.toBe(id);
      expect(await page.evaluate(() => layout.boxes.length)).toBe(2);
    });

  test.describe('batch refs', () => {
    test('addTextBox {as} then place/@name/setBoxText in ONE call, one history entry',
      async ({ page }) => {
        const pastBefore = await page.evaluate(() => past.length);
        const r = await page.evaluate(async () => docsync.api.batch([
          { verb: 'addTextBox', args: { page: 3, x: 1, y: 1, w: 2, h: 1.5, md: 'ref me' }, as: 'note' },
          { verb: 'place', args: ['@note', { x: 3, y: 2 }] },
          { verb: 'setBoxText', args: ['@note', 'placed and retexted'] },
          { verb: 'setStyle', args: ['@note', { size: 11 }] },
        ]));
        expect(r.ok).toBe(true);
        expect(r.results).toHaveLength(4);
        const id = r.results[0].id;
        expect(r.results[1].id).toBe(id);
        expect(Math.abs(r.results[1].box.x - 3)).toBeLessThan(0.05);
        const box = await page.evaluate(i =>
          layout.boxes.find(b => 'text.' + b.id === i), id);
        expect(box.md).toBe('placed and retexted');
        expect(box.h).toBe(1.5);              // h landed at creation, no second op
        expect(box.style).toMatchObject({ size: 11 });
        expect(await page.evaluate(() => past.length)).toBe(pastBefore + 1);
      });

    test('a ref to a name no earlier op defined refuses up front', async ({ page }) => {
      const r = await page.evaluate(async () => docsync.api.batch([
        { verb: 'place', args: ['@ghost', { x: 1 }] },
        { verb: 'addTextBox', args: { page: 3 }, as: 'ghost' },   // defined LATER
      ]));
      expect(r.ok).toBe(false);
      expect(r.error).toContain("'@ghost'");
      expect(await page.evaluate(() => dirty)).toBe(false);
    });

    test('a deferred validation failing mid-batch rolls the WHOLE batch back',
      async ({ page }) => {
        const boxesBefore = await page.evaluate(() => (layout.boxes || []).length);
        const pastBefore = await page.evaluate(() => past.length);
        const r = await page.evaluate(async () => docsync.api.batch([
          { verb: 'addTextBox', args: { page: 3, x: 1, y: 1 }, as: 'note' },
          // setBoxText's validate runs at apply time (it holds a ref) — and
          // refuses the empty text, which must un-land the addTextBox too.
          { verb: 'setBoxText', args: ['@note', '   '] },
        ]));
        expect(r.ok).toBe(false);
        expect(r.error).toContain('op 1');
        expect(await page.evaluate(() => (layout.boxes || []).length)).toBe(boxesBefore);
        expect(await page.evaluate(() => dirty)).toBe(false);
        expect(await page.evaluate(() => past.length)).toBe(pastBefore);
      });
  });

  test.describe('audit', () => {
    test('the untouched fixture reports no off-sheet, overlap or orphan issues — and print-overflow mirrors lastFit exactly',
      async ({ page }) => {
        const r = await api(page, 'audit()');
        expect(r.ok).toBe(true);
        // covers-flow in this list is the false-positive net: the untouched
        // fixture is a real, dense document full of DESIGNED overlap (cards,
        // backgrounds, pinned elements over bands) and must report none.
        for (const k of ['off-sheet', 'overlap', 'orphaned-group-member',
                         'covers-flow'])
          expect(r.issues.filter(i => i.kind === k), k).toHaveLength(0);
        // The fixture genuinely overflows (its own real state) — audit must
        // say exactly what lastFit says, no more, no fewer.
        const n = await page.evaluate(() => lastFit.length);
        expect(r.issues.filter(i => i.kind === 'print-overflow')).toHaveLength(n);
      });

    test('overlapping placed boxes are named as a pair — unless grouped', async ({ page }) => {
      const a = await addBox(page, { x: 1, y: 1, w: 2 });
      const b = await addBox(page, { x: 1.2, y: 1.1, w: 2 });
      let r = await api(page, 'audit()');
      const hit = r.issues.find(i => i.kind === 'overlap');
      expect(hit).toBeTruthy();
      expect(hit.ids.sort()).toEqual([a, b].sort());
      // Grouped, the same overlap is composition, not collision.
      await page.evaluate(ids => docsync.api.group(ids), [a, b]);
      r = await api(page, 'audit()');
      expect(r.issues.filter(i => i.kind === 'overlap')).toHaveLength(0);
    });

    test('an off-sheet element and a print overflow are both reported', async ({ page }) => {
      // A shape hung past the right edge — pilot writes layout directly, as a
      // stale layout.json from another machine might.
      await page.evaluate(async () => {
        pushHistory();
        layout.shapes.push({ id: 'aud-rect', page: 3, kind: 'rect',
                             x: 7.5, y: 1, w: 2, h: 1, fill: '#ccc', z: 3 });
        markDirty(); await render();
      });
      let r = await api(page, 'audit()');
      const off = r.issues.find(i => i.kind === 'off-sheet');
      expect(off).toBeTruthy();
      expect(off.ids).toEqual(['aud-rect']);
      // print-overflow mirrors lastFit — the same truth save() refuses on.
      await page.evaluate(() => { lastFit = [{ page: 3, who: 'text.t9', over: 0.3 }]; });
      r = await api(page, 'audit()');
      expect(r.issues.find(i => i.kind === 'print-overflow')).toBeTruthy();
      await page.evaluate(() => { lastFit = []; });
    });

    test('a text box parked on flow prose is a covers-flow pair; undone, it is clean', async ({ page }) => {
      // Aim at a real flow element: the first non-placed data-el with words
      // and a measurable box, on whichever page it actually lives.
      const tgt = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        for (const el of d.querySelectorAll('section.page [data-el]')) {
          const id = el.getAttribute('data-el');
          if (/^(text|table)\./.test(id)) continue;
          if ((layout.positions || {})[id]) continue;
          if (!(el.textContent || '').trim()) continue;
          const sec = el.closest('section[data-page]');
          const mount = el.closest('section.page')?.querySelector('.ds-mount');
          const pg = (sec && sec.dataset.page) || (mount && mount.dataset.dsMount);
          const m = _pilotMeasure(id);
          if (m && pg && m.w > 1 && m.h > 0.2) return { id, m, page: pg };
        }
        return null;
      });
      expect(tgt).toBeTruthy();
      const boxId = await addBox(page, {
        page: isNaN(+tgt.page) ? tgt.page : +tgt.page,
        x: tgt.m.x, y: tgt.m.y, w: Math.min(2, tgt.m.w),
      });
      let r = await api(page, 'audit()');
      const hit = r.issues.find(i => i.kind === 'covers-flow'
        && i.ids.includes(boxId) && i.ids.includes(tgt.id));
      expect(hit).toBeTruthy();
      await api(page, 'undo()');
      r = await api(page, 'audit()');
      expect(r.issues.filter(i => i.kind === 'covers-flow'
        && i.ids.includes(boxId))).toHaveLength(0);
    });

    test('uncited sources are reported by id', async ({ page }) => {
      await api(page, `addSource('aud-uncited', 'Never referenced', 'https://example.com/x')`);
      const r = await api(page, 'audit()');
      const hit = r.issues.find(i => i.kind === 'uncited-source' && i.ids[0] === 'aud-uncited');
      expect(hit).toBeTruthy();
    });
  });
});
