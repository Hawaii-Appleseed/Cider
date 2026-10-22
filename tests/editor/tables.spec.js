// Tables (docsync/editor/edit.html + layout.py tables_html): a placed,
// draggable, editable grid. The "Table" button creates one; cells edit in
// place on double-click; right-click a cell for rows & columns. Local mode.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

async function addTable(page) {
  // Create on a CONTENT page — the cover (page 1) has a full-bleed overlay
  // that would sit over the cells. Scroll a content page into view first so
  // visiblePageId() targets it.
  const frame = page.frameLocator('#out');
  await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.click('#table');
  const tbl = frame.locator('table.ds-table[data-el]').first();
  await tbl.waitFor({ state: 'attached', timeout: 20000 });
  await tbl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  return tbl;
}

test.describe('tables', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the Table button creates a header table with rows and cells', async ({ page }) => {
    const tbl = await addTable(page);
    await expect(tbl.locator('th')).toHaveCount(2);        // header row
    await expect(tbl.locator('tr')).toHaveCount(3);        // 1 header + 2 body
    // Selected on create, so it's deletable from the toolbar.
    await expect(page.locator('#ar-del')).toBeEnabled();
  });

  test('double-clicking a cell edits it in place', async ({ page }) => {
    const tbl = await addTable(page);
    const frame = page.frameLocator('#out');
    // Edit a body cell (row 1, col 0).
    const cell = tbl.locator('td[data-cell="1,0"]');
    await cell.dblclick();
    const editor = frame.locator('.ds-cell-edit');
    await editor.waitFor({ state: 'visible' });
    await editor.fill('Human Services');
    await editor.evaluate(el => el.blur());

    // The cell text (and the underlying model) now hold the new value.
    await expect(page.evaluate(() => layout.tables[0].rows[1][0])).resolves.toBe('Human Services');
    await expect(frame.locator('table.ds-table td', { hasText: 'Human Services' })).toHaveCount(1);
  });

  test('right-click inserts a row via the rows & columns menu', async ({ page }) => {
    const tbl = await addTable(page);
    const frame = page.frameLocator('#out');
    const before = await page.evaluate(() => layout.tables[0].rows.length);

    await tbl.locator('td[data-cell="1,0"]').click({ button: 'right' });
    const menu = frame.locator('.ds-menu');
    await expect(menu).toBeVisible();
    await menu.locator('button', { hasText: 'Add row' }).click();

    await expect(page.evaluate(() => layout.tables[0].rows.length)).resolves.toBe(before + 1);
  });

  test('right-click inserts a column across every row', async ({ page }) => {
    const tbl = await addTable(page);
    const frame = page.frameLocator('#out');

    await tbl.locator('th[data-cell="0,0"]').click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Add column' }).click();

    const widths = await page.evaluate(() => layout.tables[0].rows.map(r => r.length));
    expect(widths.every(w => w === 3)).toBe(true);   // every row gained a cell
  });

  // Regression: layout.py validates shapes, boxes AND tables against ONE id
  // namespace, but the editor had two allocators that each saw only part of
  // it — freeBoxId skipped tables, freeTableId skipped boxes and shapes. So a
  // text box took 't1', the next table took 't1' too, and the render that
  // followed died in the validator: the whole canvas went to "This draft does
  // not build: duplicate id 't1' — already a shape or box".
  test('a table added after a text box gets its own id, and the draft still builds', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    await page.click('#text');
    await page.click('#textpop .txtpreset[data-k="body"]');
    await frame.locator('.ds-textbox').first().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(600);

    await page.click('#table');
    await frame.locator('table.ds-table[data-el]').first()
      .waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForTimeout(800);

    const ids = await page.evaluate(() => ({
      boxes: (layout.boxes || []).map(b => b.id),
      tables: (layout.tables || []).map(t => t.id),
      shapes: (layout.shapes || []).map(s => s.id),
    }));
    const all = [...ids.boxes, ...ids.tables, ...ids.shapes];
    expect(ids.tables).toHaveLength(1);
    expect(new Set(all).size).toBe(all.length);          // no id used twice

    // The validator ran and passed: the report is on screen, not the error page.
    await expect(frame.locator('section.page').first()).toBeVisible();
    await expect(page.locator('#stat')).not.toContainText('does not build');
  });
});

// --- table styling: the Canva-style panel -----------------------------------
// Cells, rows, columns, fills and borders all live in layout.json and render
// through layout.py's tables_html, so each of these asserts BOTH the stored
// shape and what actually came out on the page.
test.describe('table styling', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('creating a table opens its panel, and cells select by clicking', async ({ page }) => {
    await addTable(page);
    await expect(page.locator('#side')).toBeVisible();
    await expect(page.locator('#side-title')).toHaveText('Table');
    // The table is selected on create, so a click inside picks a CELL rather
    // than starting a drag of the whole table.
    const frame = page.frameLocator('#out');
    await frame.locator('td[data-cell="1,0"]').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => cellSel && [cellSel.r0, cellSel.c0])).toEqual([1, 0]);
    await expect(frame.locator('td.ds-cell-sel')).toHaveCount(1);
    await expect(page.locator('.tp-scope')).toContainText('Cell selected');
  });

  test('a fill applies to the selected cell only, and renders', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('td[data-cell="1,1"]').click();
    await page.waitForTimeout(200);

    // Second swatch: the first is "none". Pick whatever colour it carries.
    const sw = page.locator('#tablepop .tp-sw').first().locator('.tp-swatch').nth(1);
    await sw.click();
    await page.waitForTimeout(1200);

    const cells = await page.evaluate(() => layout.tables[0].cells);
    expect(Object.keys(cells)).toEqual(['1,1']);
    expect(cells['1,1'].fill).toMatch(/^#/);
    // ...and the renderer put it on that cell and no other.
    const bg = await frame.locator('td[data-cell="1,1"]')
      .evaluate(el => el.style.background || el.style.backgroundColor);
    expect(bg).toBeTruthy();
    const other = await frame.locator('td[data-cell="1,0"]')
      .evaluate(el => el.style.background || el.style.backgroundColor);
    expect(other).toBeFalsy();
  });

  test('borders write a spec and render as real edges; "Outer" drops the gridlines', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await page.locator('#tablepop .tp-btn', { hasText: 'Outer' }).click();
    await page.waitForTimeout(1200);

    expect(await page.evaluate(() => layout.tables[0].border.sides)).toBe('outer');
    // Top-left cell: outer edges drawn, inner edges explicitly off.
    const tl = await frame.locator('th[data-cell="0,0"]').evaluate(el => ({
      top: el.style.borderTop, right: el.style.borderRight,
    }));
    expect(tl.top).not.toBe('');
    expect(tl.right).toMatch(/^0/);          // inner gridline suppressed
  });

  test('inserting a row moves per-cell fills with it instead of stranding them', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('td[data-cell="1,0"]').click();
    await page.waitForTimeout(200);
    await page.locator('#tablepop .tp-sw').first().locator('.tp-swatch').nth(1).click();
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => layout.tables[0].cells['1,0'].fill);

    // Insert a row ABOVE the filled one: its override must follow to row 2.
    await page.locator('#tablepop .tp-btn', { hasText: '↑ Row' }).click();
    await page.waitForTimeout(1200);

    const cells = await page.evaluate(() => layout.tables[0].cells);
    expect(cells['2,0'].fill).toBe(before);
    expect(cells['1,0']).toBeUndefined();     // the new blank row is unstyled
    expect(await page.evaluate(() => layout.tables[0].rows.length)).toBe(4);
  });

  test('adding a column keeps the grid rectangular and the draft building', async ({ page }) => {
    await addTable(page);
    await page.locator('#tablepop .tp-btn', { hasText: '→ Col' }).click();
    await page.waitForTimeout(1200);

    const widths = await page.evaluate(() => layout.tables[0].rows.map(r => r.length));
    expect(widths.every(w => w === 3)).toBe(true);
    // The validator ran and passed — the report is on screen, not the error page.
    await expect(page.frameLocator('#out').locator('section.page').first()).toBeVisible();
    await expect(page.locator('#stat')).not.toContainText('does not build');
  });

  test('with nothing selected the panel styles the whole table', async ({ page }) => {
    await addTable(page);
    await expect(page.locator('.tp-scope')).toContainText('whole table');
    await page.locator('#tablepop .tp-sw').first().locator('.tp-swatch').nth(1).click();
    await page.waitForTimeout(1200);
    // One table-wide property, not a per-cell override for all six cells.
    const t = await page.evaluate(() => layout.tables[0]);
    expect(t.fill).toMatch(/^#/);
    expect(t.cells).toBeUndefined();
  });
});

// --- direct editing: a table cell behaves like a spreadsheet cell -----------
// The complaint this answers: you could not just click a cell and type. It
// took click (select table) → click (select cell) → double-click (edit), and
// nothing but the mouse moved you between cells.
test.describe('table cells edit directly', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('one click puts the cursor on a cell, and typing replaces it', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('td[data-cell="1,0"]').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => cellSel && [cellSel.r0, cellSel.c0])).toEqual([1, 0]);

    await page.keyboard.type('Revenue');
    await page.waitForTimeout(300);
    // The first keystroke opened the editor AND was kept, rather than being
    // swallowed opening it.
    await expect(frame.locator('.ds-cell-edit')).toHaveText('Revenue');

    // Escape keeps what was typed, as InDesign's does, and leaves the cell selected.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => layout.tables[0].rows[1][0])).toBe('Revenue');
    expect(await page.evaluate(() => editing)).toBe(false);
  });

  test('Enter commits and drops a row; Tab commits and moves right', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('td[data-cell="1,0"]').click();
    await page.waitForTimeout(200);

    await page.keyboard.type('one');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1400);
    expect(await page.evaluate(() => layout.tables[0].rows[1][0])).toBe('one');
    // Enter landed on the cell below.
    expect(await page.evaluate(() => cellSel && [cellSel.r0, cellSel.c0])).toEqual([2, 0]);

    await page.keyboard.type('two');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1400);
    expect(await page.evaluate(() => layout.tables[0].rows[2][0])).toBe('two');
    expect(await page.evaluate(() => cellSel && [cellSel.r0, cellSel.c0])).toEqual([2, 1]);
  });

  test('arrows walk the grid and Delete empties the cell, not the table', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('th[data-cell="0,0"]').click();
    await page.waitForTimeout(200);

    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => [cellSel.r0, cellSel.c0])).toEqual([0, 1]);
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => [cellSel.r0, cellSel.c0])).toEqual([1, 1]);
    // Off the top edge is a no-op, not a wrap or a crash.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => [cellSel.r0, cellSel.c0])).toEqual([0, 1]);

    // Delete on a selected CELL clears its text; the table survives.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(1400);
    expect(await page.evaluate(() => layout.tables[0].rows[0][1])).toBe('');
    expect(await page.evaluate(() => layout.tables.length)).toBe(1);
  });

  test('the context menu offers the full Canva set, and Move row down works', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    // Give row 1 a marker so the move is observable.
    await frame.locator('td[data-cell="1,0"]').click();
    await page.keyboard.type('marker');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await page.evaluate(() => { layout.tables[0].rows[1][0] = 'marker'; });
    await page.evaluate(() => render());
    await settled(page);

    await frame.locator('td[data-cell="1,0"]').click({ button: 'right' });
    const menu = frame.locator('.ds-menu.ds-tmenu');
    await expect(menu).toBeVisible();
    for (const label of ['Copy', 'Duplicate', 'Delete table', 'Delete column',
                         'Delete row', 'Add column', 'Add row',
                         'Fit columns to content', 'Move row down',
                         'Move column right', 'Table styles…']) {
      await expect(menu.locator('.ds-mi-lab', { hasText: label }).first()).toBeVisible();
    }
    await menu.locator('button', { hasText: 'Move row down' }).click();
    await page.waitForTimeout(1400);
    expect(await page.evaluate(() => layout.tables[0].rows[2][0])).toBe('marker');
  });

  test('Fit columns to content writes widths and renders a colgroup', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('td[data-cell="1,0"]').click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Fit columns to content' }).click();
    await page.waitForTimeout(1400);

    const colw = await page.evaluate(() => layout.tables[0].colw);
    expect(colw).toHaveLength(2);
    expect(colw.every(w => w > 0)).toBe(true);
    await expect(frame.locator('table.ds-table col')).toHaveCount(2);
  });
});

// --- style presets + the collapsible panel ----------------------------------
test.describe('table style presets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the gallery offers three looks per palette colour', async ({ page }) => {
    await addTable(page);
    const presets = page.locator('#tablepop .tp-preset');
    // grey + the report palette, three variants each.
    expect(await presets.count()).toBeGreaterThanOrEqual(9);
    expect((await presets.count()) % 3).toBe(0);
    // Each thumbnail is drawn from the same rules the renderer will apply.
    await expect(presets.first().locator('.tp-preset-grid')).toBeVisible();
  });

  test('a banded preset writes header + zebra and renders both', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    // Index 5 = the first palette colour's "banded" variant.
    await page.locator('#tablepop .tp-preset').nth(5).click();
    await page.waitForTimeout(1600);

    const t = await page.evaluate(() => layout.tables[0]);
    expect(t.headerFill).toMatch(/^#/);
    expect(t.headerColor).toMatch(/^#/);
    expect(t.band).toMatch(/^#/);
    expect(t.border.sides).toBe('none');

    // Rendered: header band coloured, and the zebra on alternate BODY rows.
    const hdr = await frame.locator('th[data-cell="0,0"]').getAttribute('style');
    expect(hdr).toContain('background');
    const row1 = await frame.locator('td[data-cell="1,0"]').getAttribute('style');
    const row2 = await frame.locator('td[data-cell="2,0"]').getAttribute('style');
    expect(row1 || '').not.toContain(t.band.toLowerCase());
    expect((row2 || '').toLowerCase()).toContain(t.band.toLowerCase());

    // ...and the gallery now shows which one is in force.
    await expect(page.locator('#tablepop .tp-preset.on')).toHaveCount(1);
  });

  test('the panel folds away and comes back, keeping its tool', async ({ page }) => {
    await addTable(page);
    const side = page.locator('#side');
    await expect(side).toBeVisible();
    await expect(page.locator('#tablepop')).toBeVisible();

    await page.click('#side-fold');
    await expect(side).toHaveClass(/folded/);
    await expect(page.locator('#side-body')).toBeHidden();
    // Folded, not closed: the tool is still the one that was open.
    expect(await page.evaluate(() => sidePanelTool)).toBe('table');
    // The chevron itself stays reachable on the canvas edge.
    await expect(page.locator('#side-fold')).toBeVisible();

    await page.click('#side-fold');
    await expect(side).not.toHaveClass(/folded/);
    await expect(page.locator('#tablepop')).toBeVisible();
  });

  test('opening another tool unfolds the panel', async ({ page }) => {
    await addTable(page);
    await page.click('#side-fold');
    await expect(page.locator('#side')).toHaveClass(/folded/);
    await page.click('#shape');
    await expect(page.locator('#side')).not.toHaveClass(/folded/);
    await expect(page.locator('#shapepop')).toBeVisible();
  });
});

// --- the right-click menu is the SAME menu, wherever and whenever ------------
test.describe('table context menu consistency', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  const menuInfo = (page) => page.evaluate(() => {
    const d = document.getElementById('out').contentDocument;
    const m = d.querySelector('.ds-menu');
    if (!m) return { menu: 'NONE' };
    const labels = [...m.querySelectorAll('button')].map(b => b.textContent.trim());
    return { menu: m.classList.contains('ds-tmenu') ? 'TABLE' : 'layer',
             addCol: labels.some(t => /add column/i.test(t)) };
  });
  const clearMenus = (page) => page.evaluate(() => {
    document.getElementById('out').contentDocument
      .querySelectorAll('.ds-menu').forEach(m => m.remove());
  });

  test('every part of a table gives the table menu, with Add column', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('table.ds-table').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    // Coordinates via boundingBox, which is top-document space and already
    // accounts for the iframe's offset AND the canvas scale — computing them
    // from inside the frame aims at the wrong pixel entirely.
    const tbl = await frame.locator('table.ds-table').boundingBox();
    const spots = [[0.02, 0.06], [0.5, 0.5], [0.98, 0.94], [0.001, 0.5], [0.999, 0.5]];
    for (const [fx, fy] of spots) {
      await clearMenus(page);
      await page.mouse.click(tbl.x + tbl.width * fx, tbl.y + tbl.height * fy,
                             { button: 'right' });
      await page.waitForTimeout(350);
      const r = await menuInfo(page);
      expect(r.menu, `at ${fx},${fy}`).toBe('TABLE');
      expect(r.addCol, `Add column at ${fx},${fy}`).toBe(true);
    }
  });

  // Regression: right-clicking a cell that is being EDITED blurs it, and the
  // blur commits and re-renders the whole document — so the menu was built
  // into a document about to be thrown away and nothing appeared at all.
  // `editing` is already false by the time contextmenu fires, so the guard has
  // to be on the render, not on the flag.
  test('right-clicking a cell mid-edit still opens the menu', async ({ page }) => {
    await addTable(page);
    const frame = page.frameLocator('#out');
    await frame.locator('table.ds-table').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    await frame.locator('td[data-cell="1,0"]').dblclick();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => editing)).toBe(true);

    await clearMenus(page);
    await frame.locator('td[data-cell="1,0"]').click({ button: 'right' });
    await page.waitForTimeout(900);
    const r = await menuInfo(page);
    expect(r.menu).toBe('TABLE');
    expect(r.addCol).toBe(true);
  });
});
