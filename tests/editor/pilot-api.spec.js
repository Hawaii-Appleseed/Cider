// The pilot API (edit.html's window.docsync.api): the stable command surface
// for driving the editor programmatically — an AI pilot, a script, a console.
// It is the test suite's own fast path (the editor's verbs, called directly)
// blessed and held stable, so this spec IS the contract: every verb goes
// through pushHistory (⌘Z undoes a pilot like a human), lands through the one
// render(), and returns plain data — geometry in page inches — so a pilot
// never needs a screenshot to know what happened. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

test.describe('pilot api', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('inventory maps the document: pages, elements with geometry, slots, sources',
    async ({ page }) => {
      const inv = await api(page, 'inventory()');
      expect(inv.ok).toBe(true);
      expect(inv.project).toBe('budget-primer');
      expect(inv.dirty).toBe(false);
      expect(inv.pages.length).toBeGreaterThan(10);
      expect(inv.sources.length).toBeGreaterThan(10);

      // The cover carries known designed elements and slots.
      const cover = inv.pages[0];
      const logo = cover.elements.find(e => e.id === 'cover.logo');
      expect(logo).toBeTruthy();
      expect(logo.kind).toBe('designed');
      // Geometry is page inches: finite, on the sheet.
      expect(logo.box.w).toBeGreaterThan(0);
      expect(logo.box.x).toBeGreaterThanOrEqual(0);
      expect(logo.box.x + logo.box.w).toBeLessThanOrEqual(inv.page.w + 0.1);
      expect(cover.slots.some(s => s.key === 'cover.title')).toBe(true);
      // Slot snippets carry text, so a pilot can find prose by reading, not
      // by screenshotting.
      const slot = inv.pages.flatMap(p => p.slots).find(s => s.key === 'whopays.p1');
      expect(slot.text).toContain('low- and middle-income');
    });

  test('setSlot writes through the real path: renders, dirties, and one undo restores',
    async ({ page }) => {
      const before = await api(page, `getSlot('basics.h1')`);
      expect(before.ok).toBe(true);

      const r = await api(page, `setSlot('basics.h1', 'PILOTED HEADING')`);
      expect(r.ok).toBe(true);
      expect(r.dirty).toBe(true);
      await expect(page.frameLocator('#out').locator('[data-slot="basics.h1"]'))
        .toContainText('PILOTED HEADING');

      // One ⌘Z-equivalent puts it back — a pilot's edit is a human's edit.
      const u = await api(page, 'undo()');
      expect(u.ok).toBe(true);
      expect((await api(page, `getSlot('basics.h1')`)).md).toBe(before.md);

      // A key that does not exist refuses instead of silently no-opping.
      expect((await api(page, `setSlot('no.such.slot', 'x')`)).ok).toBe(false);
    });

  test('place moves a designed element to exact inches, reported back from the DOM',
    async ({ page }) => {
      // cover.logo is 7.1in wide, so x can range 0..~1.4 on an 8.5in sheet.
      const r = await api(page, `place('cover.logo', { x: 1, y: 4 })`);
      expect(r.ok).toBe(true);
      // The returned box is measured from the re-rendered document, so it is
      // the truth of where the element now paints — placer's coordinate-space
      // correction included.
      expect(Math.abs(r.box.x - 1)).toBeLessThan(0.1);
      expect(Math.abs(r.box.y - 4)).toBeLessThan(0.1);
      // And the write landed in layout (positions or the element's own store).
      expect(await page.evaluate(() =>
        !!(layout.positions['cover.logo']))).toBe(true);

      expect((await api(page, `place('no.such.el', { x: 1 })`)).ok).toBe(false);
    });

  test('place clamps to the page like a drag, and the returned box says so',
    async ({ page }) => {
      // Asking for the impossible — a 7.1in-wide element at x=6 — keeps the
      // element on the sheet, exactly as the drag's own clamp does ("better
      // to refuse the pixel than fail the build"). The pilot is not lied to:
      // the returned geometry is where it really landed.
      const r = await api(page, `place('cover.logo', { x: 6, y: 4 })`);
      expect(r.ok).toBe(true);
      const inv = await api(page, 'status()');
      expect(r.box.x + r.box.w).toBeLessThanOrEqual(inv.page.w + 0.05);
      expect(r.box.x).toBeLessThan(2);          // clamped way back from 6
    });

  test('addTextBox -> place -> recolor, all by returned id', async ({ page }) => {
    const added = await api(page,
      `addTextBox({ page: 3, x: 1, y: 1, w: 2.5, md: 'Pilot box' })`);
    expect(added.ok).toBe(true);
    expect(added.id).toMatch(/^text\./);

    const moved = await page.evaluate(id =>
      docsync.api.place(id, { x: 2, y: 2.5 }), added.id);
    expect(moved.ok).toBe(true);
    expect(Math.abs(moved.box.x - 2)).toBeLessThan(0.05);

    const painted = await page.evaluate(id =>
      docsync.api.recolor(id, '#E23B3B'), added.id);
    expect(painted.ok).toBe(true);
    const fill = await page.evaluate(id =>
      (layout.boxes.find(b => 'text.' + b.id === id) || {}).fill, added.id);
    expect(fill).toBe('#E23B3B');
  });

  test('addShape lands a Shapes-panel shape on the page a pilot names',
    async ({ page }) => {
    // The build-out case: a hairline rule, exact geometry, exact fill, on a
    // page duplicate() could never reach (it clones same-page only).
    const r = await api(page,
      `addShape({ page: 3, kind: 'rect', x: 0.7, y: 1.62, w: 7.1, h: 0.02,
                  fill: '#1E6194', z: 2 })`);
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/-rect$/);
    expect(r.page).toBe(3);
    const stored = await page.evaluate(id =>
      layout.shapes.find(s => s.id === id), r.id);
    expect(stored).toMatchObject(
      { page: 3, kind: 'rect', x: 0.7, y: 1.62, w: 7.1, h: 0.02,
        fill: '#1E6194', z: 2 });

    // One undo withdraws it — a pilot's shape is a human's shape.
    const u = await api(page, 'undo()');
    expect(u.ok).toBe(true);
    expect(await page.evaluate(id =>
      layout.shapes.some(s => s.id === id), r.id)).toBe(false);

    // A kind the Shapes panel does not offer is refused, naming the menu.
    const bad = await api(page, `addShape({ kind: 'star' })`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('rect');
  });

  test('recolor takes a page id, and null resets it', async ({ page }) => {
    const r = await api(page, `recolor('page.3', '#FFF6D8')`);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(() => layout.fill['page.3'])).toBe('#FFF6D8');
    await api(page, `recolor('page.3', null)`);
    expect(await page.evaluate(() => (layout.fill || {})['page.3'])).toBeUndefined();
  });

  test('addPage returns the new page id, in the order', async ({ page }) => {
    const r = await api(page, 'addPage()');
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^p\d+$/);
    expect(r.pageOrder).toContain(r.id);
  });

  test('addSource validates, then the source is citable', async ({ page }) => {
    expect((await api(page, `addSource('bad id!', 'x', 'https://x.example')`)).ok).toBe(false);
    const r = await api(page,
      `addSource('pilot-src', 'A pilot-added source', 'https://example.com/pilot')`);
    expect(r.ok).toBe(true);
    const inv = await api(page, 'inventory()');
    expect(inv.sources.some(s => s.id === 'pilot-src')).toBe(true);
  });

  test('addEndnotesSection refuses where the UI disables — this renderer has its own list',
    async ({ page }) => {
      // budget-primer's page 12 IS its endnotes; a second list would renumber
      // beside it. The API applies the same guard as the Sources panel button.
      const r = await api(page, 'addEndnotesSection()');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('already draws its own');
    });

  test('mutators refuse while an inline editor is open, instead of committing over the caret',
    async ({ page }) => {
      await page.evaluate(() => {
        const d = $('out').contentDocument;
        edit(d, 'basics.h1');
      });
      await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
      const r = await api(page, `setSlot('basics.h1', 'x')`);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('editor is open');
      await page.keyboard.press('Escape');
    });

  test('save refuses with a reason while content overflows the print cut',
    async ({ page }) => {
      // Force an overflow report, as reportFit would.
      await page.evaluate(() => { lastFit = [{ page: 3, who: 'text.t1', over: 0.4 }]; });
      const r = await api(page, 'save()');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('cut off in print');
      await page.evaluate(() => { lastFit = []; });
    });

  test.describe('batch', () => {
    test('several ops apply as ONE history entry and ONE render', async ({ page }) => {
      const pastBefore = await page.evaluate(() => past.length);

      const r = await page.evaluate(async () => docsync.api.batch([
        { verb: 'setSlot', args: ['basics.h1', 'BATCHED HEADING'] },
        { verb: 'place', args: ['cover.logo', { x: 1, y: 4 }] },
        { verb: 'recolor', args: ['page.3', '#FFF6D8'] },
      ]));

      expect(r.ok).toBe(true);
      expect(r.results).toHaveLength(3);
      expect(r.results[0]).toMatchObject({ verb: 'setSlot', key: 'basics.h1' });
      expect(r.results[1].verb).toBe('place');
      expect(Math.abs(r.results[1].box.x - 1)).toBeLessThan(0.1);
      expect(r.results[2]).toMatchObject({ verb: 'recolor', id: 'page.3', fill: '#FFF6D8' });

      // ONE history entry for all three — not three.
      expect(await page.evaluate(() => past.length)).toBe(pastBefore + 1);

      // All three landed.
      expect((await api(page, `getSlot('basics.h1')`)).md).toBe('BATCHED HEADING');
      expect(await page.evaluate(() => layout.fill['page.3'])).toBe('#FFF6D8');
      await expect(page.frameLocator('#out').locator('[data-slot="basics.h1"]'))
        .toContainText('BATCHED HEADING');

      // ONE undo reverts all three together.
      const u = await api(page, 'undo()');
      expect(u.ok).toBe(true);
      expect((await api(page, `getSlot('basics.h1')`)).md).not.toBe('BATCHED HEADING');
      expect(await page.evaluate(() => (layout.fill || {})['page.3'])).toBeUndefined();
    });

    test('a bad op refuses the WHOLE batch — nothing partially applies',
      async ({ page }) => {
        const before = (await api(page, `getSlot('basics.h1')`)).md;
        const pastBefore = await page.evaluate(() => past.length);

        const r = await page.evaluate(async () => docsync.api.batch([
          { verb: 'setSlot', args: ['basics.h1', 'SHOULD NOT LAND'] },
          { verb: 'place', args: ['no.such.element', { x: 1, y: 1 }] },  // fails validation
        ]));

        expect(r.ok).toBe(false);
        expect(r.error).toContain('op 1 (place)');
        // Op 0 was VALIDATED but never applied — validation is a full pass
        // before any mutation, precisely so this could not half-land.
        expect((await api(page, `getSlot('basics.h1')`)).md).toBe(before);
        expect(await page.evaluate(() => dirty)).toBe(false);
        expect(await page.evaluate(() => past.length)).toBe(pastBefore);
      });

    test('an unsupported verb is refused by name, not attempted', async ({ page }) => {
      const r = await page.evaluate(async () => docsync.api.batch([
        { verb: 'addPage', args: [] },
      ]));
      expect(r.ok).toBe(false);
      expect(r.error).toContain("op 0: unsupported verb 'addPage'");
      expect(r.error).toContain('setSlot');   // names what IS supported
    });

    test('an empty or missing ops array is refused', async ({ page }) => {
      expect((await api(page, 'batch([])')).ok).toBe(false);
      expect((await api(page, 'batch(null)')).ok).toBe(false);
    });

    test('refuses while an inline editor is open, like every other mutator',
      async ({ page }) => {
        await page.evaluate(() => edit($('out').contentDocument, 'basics.h1'));
        await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
        const r = await page.evaluate(async () => docsync.api.batch([
          { verb: 'setSlot', args: ['basics.h1', 'x'] },
        ]));
        expect(r.ok).toBe(false);
        expect(r.error).toContain('editor is open');
        await page.keyboard.press('Escape');
      });
  });
});
