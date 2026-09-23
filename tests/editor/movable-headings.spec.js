// Movable/resizable designed headings (report2027/tools/render_report.py +
// docsync/layout.py Layout.attr/spacer). Section headings (e.g. "BUDGET
// BASICS") now carry the same data-el position-override hook already used for
// logos and images: a single click selects the heading as a draggable/
// resizable object (like any other element), while double-clicking its actual
// text still opens the inline text editor — the same split already proven for
// prose paragraphs and callout titles. Local mode.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('movable headings', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('a click beside a heading\'s words selects it as an object; on the words it types', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const h1 = frame.locator('[data-el="basics.h1"]');
    await expect(h1).toHaveCount(1);
    await h1.scrollIntoViewIfNeeded();
    // The heading's box runs the width of the column and its words do not:
    // a click in the box beside them lands on no slot, so it selects.
    const hb = await h1.boundingBox();
    await page.mouse.click(hb.x + hb.width - 6, hb.y + hb.height / 2);

    await expect(frame.locator('.ds-edit')).toHaveCount(0);   // no text editor opened
    // A heading is a single-slot text object, so one click puts the TYPE
    // controls in hand (Canva behaviour) — arrange stays on the mini toolbar.
    await expect(page.locator('#type')).toBeVisible();
    await expect(page.locator('#ty-key')).toHaveAttribute('title', 'basics.h1');
    // A heading takes the full text-box handle set: it IS a text box the
    // renderer happened to place, and its height is written as a floor
    // (layout.py's hmin) so the extra edges cannot clip the words. Cornered,
    // so it rotates from the corner rings rather than the dangling grip.
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      await expect(frame.locator(`.ds-handles .ds-h-${dir}`)).toHaveCount(1);
    }
    await expect(frame.locator('.ds-handles .ds-rot')).toHaveCount(0);
    await expect(frame.locator('.ds-handles .ds-rot-corner')).toHaveCount(4);

    // On the words, the same click types — no double-click, nothing selected.
    const wb = await frame.locator('[data-el="basics.h1"] [data-slot="basics.h1"]').boundingBox();
    await page.mouse.click(wb.x + 3, wb.y + wb.height / 2);
    await expect(frame.locator('.ds-edit')).toHaveCount(1);
    expect(await page.evaluate(() =>
      document.getElementById('out').contentDocument.getSelection().isCollapsed)).toBe(true);
  });

  test('dragging the heading records a position, and the flow below it stays put', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const h1 = frame.locator('[data-el="basics.h1"]');
    await h1.scrollIntoViewIfNeeded();
    const box = await h1.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const pos = await page.evaluate(() => layout.positions['basics.h1']);
    expect(pos).toBeTruthy();
    expect(pos.x).toBeGreaterThan(0);
    // A spacer holds the vacated flow slot so the prose that followed the
    // heading doesn't jump up into the gap. (Other spacers may already exist
    // on the page for unrelated moved elements — just confirm one shows up.)
    expect(pos.reserve).toBeGreaterThan(0);
    expect(await frame.locator('.ds-spacer').count()).toBeGreaterThanOrEqual(1);
  });

  // Pin a prose block by dragging it, the way a person does. Returns the id.
  async function pin(page, frame, key, dy = 40) {
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const id = 'para.' + key;
    const el = frame.locator(`[data-el="${id}"]`);
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    return id;
  }
  const grow = (page, key, times) => page.evaluate(async ({ key, times }) => {
    const t = readSlot(key);
    writeSlot(key, Array.from({ length: times }, () => t).join(' '));
    markDirty(); await render();
  }, { key, times });

  test('a moved flow element follows the text it came out of when that text grows', async ({ page }) => {
    // Its inch used to be fixed while the flow was not: a sentence added
    // above moved the strut and everything after it, and the pinned block
    // stayed, over whatever had flowed under it. The drop anchors it to its
    // own vacated slot, so it keeps its distance from the prose it left.
    const frame = page.frameLocator('#out');
    const id = await pin(page, frame, 'basics.p2');
    const pos = await page.evaluate(id => layout.positions[id], id);
    expect(pos.anchor).toEqual(expect.objectContaining({ to: 'spacer:' + id }));
    const el = frame.locator(`[data-el="${id}"]`);
    const spacer = frame.locator(`.ds-spacer[data-spacer-for="${id}"]`);
    const before = (await el.boundingBox()).y, spBefore = (await spacer.boundingBox()).y;
    await grow(page, 'basics.p1', 3);          // the paragraph ABOVE the slot it left
    await page.waitForTimeout(400);
    const after = (await el.boundingBox()).y, spAfter = (await spacer.boundingBox()).y;
    expect(spAfter - spBefore).toBeGreaterThan(20);           // the flow moved...
    expect(Math.abs((after - before) - (spAfter - spBefore))).toBeLessThan(3);   // ...and it went along
  });

  test('the strut holds the height the moved element has now, not the height it had when moved', async ({ page }) => {
    // `reserve` was written once, at the first move, so a block that later
    // grew a line left the flow holding the old gap forever.
    const frame = page.frameLocator('#out');
    const id = await pin(page, frame, 'basics.p2');
    const r0 = await page.evaluate(id => layout.positions[id].reserve, id);
    expect(r0).toBeGreaterThan(0);
    await grow(page, 'basics.p2', 3);
    await page.waitForTimeout(600);
    const r1 = await page.evaluate(id => layout.positions[id].reserve, id);
    expect(r1).toBeGreaterThan(r0 + 0.2);
    const h = await frame.locator(`.ds-spacer[data-spacer-for="${id}"]`).evaluate(e => e.style.height);
    expect(h).toBe(r1 + 'in');
  });

  test('a resize handle sets a width override', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const h1 = frame.locator('[data-el="basics.h1"]');
    await h1.click();
    const handle = frame.locator('.ds-handles .ds-h-e');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 80, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const pos = await page.evaluate(() => layout.positions['basics.h1']);
    expect(pos.w).toBeGreaterThan(0);
  });

  test('double-clicking the heading text still opens the inline text editor', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const text = frame.locator('[data-slot="basics.h1"]');
    await text.dblclick({ force: true });
    const ta = frame.locator('.ds-edit');
    await ta.waitFor({ state: 'visible' });
    await expect(ta).toHaveText(/BUDGET BASICS/i);
  });

  test('a moved element with a margin lands where it was dropped — live, and after the render', async ({ page }) => {
    // A margin on a placed element is ADDED to its left and top. The renderer
    // puts margin:0 on anything placed (layout.py _style); the drag did not,
    // so the cover title (33.6px of top margin) was drawn that far below the
    // pointer for the whole drag and jumped back up on the render after the
    // drop — and the live Budget Primer's lifecycle ring, 0.28in.
    const frame = page.frameLocator('#out');
    const el = frame.locator('[data-el="cover.title"]');
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox();
    await page.mouse.move(b.x + 10, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 25, b.y + b.height / 2 + 30, { steps: 4 });
    await page.mouse.move(b.x + 40, b.y + b.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => layout.positions['cover.title'])).toBeTruthy();
    const live = await page.evaluate(() => _pilotMeasure('cover.title'));
    await page.evaluate(() => render());
    await page.waitForTimeout(800);
    const drawn = await page.evaluate(() => _pilotMeasure('cover.title'));
    expect(Math.abs(drawn.y - live.y), `live ${live.y} vs drawn ${drawn.y}`).toBeLessThan(0.03);
    expect(Math.abs(drawn.x - live.x), `live ${live.x} vs drawn ${drawn.x}`).toBeLessThan(0.03);
  });

  test('an unmoved heading publishes with no position scaffolding (published bytes unchanged)', async ({ page }) => {
    // Sanity: moving is opt-in — a heading nobody touched must render exactly
    // as it always did (verified at the Python level in the render script;
    // here we just confirm the editor never writes a position without a drag).
    const pos = await page.evaluate(() => (layout.positions || {})['basics.h1']);
    expect(pos).toBeUndefined();
  });

  // Standalone lines of text — the byline, the copyright, a figure caption —
  // are placed things too, not just headings. They were the last text in the
  // report a click could edit but not move.
  for (const id of ['toc.author', 'toc.copyright', 'process.fig1.caption']) {
    test(`${id} is a movable object, not just editable text`, async ({ page }) => {
      const frame = page.frameLocator('#out');
      const el = frame.locator(`[data-el="${id}"]`);
      await expect(el).toHaveCount(1);
      await el.scrollIntoViewIfNeeded();
      // A click on its WORDS types into them (the caret where it landed) with
      // the line still the selection; Escape leaves the words and keeps it
      // selected. On the words, not the line's middle: a caption's middle can
      // be its "Figure 1." label, which is not a slot — a click there selects.
      await frame.locator(`[data-el="${id}"] [data-slot], [data-el="${id}"][data-slot]`)
        .first().click();
      await expect(frame.locator('.ds-edit')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(frame.locator('.ds-edit')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => [...selIds])).toEqual([id]);
      await expect(page.locator('#ty-key'))                     // single-slot text: type controls
        .toHaveAttribute('title', id);

      // Leaving the words re-renders the page; find the line again.
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400);

      // y, not x: a full-width line (the copyright) has no horizontal room —
      // placer clamps it back to 0 — so vertical is the axis that always
      // proves the drag landed.
      const pos = await page.evaluate(k => layout.positions[k], id);
      expect(pos).toBeTruthy();
      expect(pos.y).toBeGreaterThan(0);
    });
  }
});
