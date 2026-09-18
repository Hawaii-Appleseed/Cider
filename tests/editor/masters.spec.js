// Master pages — InDesign's, for page furniture. A template seeds a document
// and its section page is copied; afterwards nothing propagates, so a running
// footer changes on every page by hand. A master is a named set of boxes and
// shapes a page uses; its items render on each page as `<item>@<page>` and
// edit as ONE thing, so a change lands on every page that uses it. The engine
// half (expansion, {page}, validation) is in docsync/test_docsync.py; this is
// the editor's promise: made from a page, given to another, edited once,
// detached back into copies.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const frame = page => page.frameLocator('#out');

test('a master is made from a page, given to a second page, and edited once for both',
  async ({ page }) => {
    await gotoEditor(page);
    // Two blank pages at the end, a folio on the first.
    const ids = await page.evaluate(async () => {
      const n = docsync.api.inventory().pages.length;
      const a = await docsync.api.addPage(n);
      const b = await docsync.api.addPage(n + 1);
      await docsync.api.addTextBox({ page: a.id, x: 0.7, y: 10.4, w: 3, md: '{page} · YOUR REPORT' });
      await docsync.api.addShape({ page: a.id, kind: 'rect', x: 0.7, y: 1.6, w: 7.1, h: 0.03, fill: '#1E6194' });
      return { a: a.id, b: b.id };
    });
    await page.waitForTimeout(800);

    // Made from the page: its items MOVE into the master, the page uses it.
    const made = await page.evaluate(a => docsync.api.masterFrom(a, 'Section'), ids.a);
    expect(made.ok).toBe(true);
    expect(made.items).toBe(2);
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({
      master: layout.masters.Section, own: layout.boxes.length, shapes: layout.shapes.length,
      pm: layout.pageMasters }));
    expect(st.master.boxes.length).toBe(1);
    expect(st.master.shapes.length).toBe(1);
    expect(st.master.boxes[0].page).toBeUndefined();
    expect(st.own).toBe(0);
    expect(st.pm[ids.a]).toBe('Section');
    // On the page: an instance, numbered.
    const folioA = `text.${st.master.boxes[0].id}@${ids.a}`;
    const labelA = await page.evaluate(a => pageLabel(a), ids.a);
    await expect(frame(page).locator(`[data-el="${folioA}"]`)).toContainText(`${labelA} · YOUR REPORT`);
    await expect(frame(page).locator(`[data-el="${folioA}"]`)).toHaveAttribute('data-master', 'Section');

    // The second page takes the master from its strip.
    const r = await page.evaluate(b => docsync.api.master(b, 'Section'), ids.b);
    expect(r.ok).toBe(true);
    await page.waitForTimeout(1200);
    const folioB = `text.${st.master.boxes[0].id}@${ids.b}`;
    const labelB = await page.evaluate(b => pageLabel(b), ids.b);
    await expect(frame(page).locator(`[data-el="${folioB}"]`)).toContainText(`${labelB} · YOUR REPORT`);
    expect(labelB).not.toBe(labelA);

    // Edit the instance on page B: the master changes, so page A follows.
    const w = await page.evaluate(id => docsync.api.setBoxText(id, '{page} · A FAIRER TAX CODE'), folioB);
    expect(w.ok).toBe(true);
    await page.waitForTimeout(1200);
    await expect(frame(page).locator(`[data-el="${folioA}"]`)).toContainText(`${labelA} · A FAIRER TAX CODE`);
    expect(await page.evaluate(() => layout.boxes.length)).toBe(0);   // still no page copy

    // Select the instance: the strip says where it lives, and Delete refuses.
    await page.evaluate(id => docsync.api.select(id), folioA);
    await page.waitForTimeout(500);
    await expect(page.locator('#ty-key')).toContainText('master');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => layout.masters.Section.boxes.length)).toBe(1);
    await expect(page.locator('#stat')).toContainText('on the master');

    // Detach page B: its own numbered copies, and no master.
    const dt = await page.evaluate(b => docsync.api.detachMaster(b), ids.b);
    expect(dt.ok).toBe(true);
    expect(dt.items).toBe(2);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(b => ({
      own: layout.boxes.filter(x => String(x.page) === String(b)).map(x => x.md),
      pm: (layout.pageMasters || {})[b] || null }), ids.b);
    expect(after.own).toEqual([`${labelB} · A FAIRER TAX CODE`]);
    expect(after.pm).toBeNull();
    // Page A still uses it.
    await expect(frame(page).locator(`[data-el="${folioA}"]`)).toContainText('A FAIRER TAX CODE');
  });

test('the page strip offers the master picker, and a duplicated page keeps its master',
  async ({ page }) => {
    await gotoEditor(page);
    const a = await page.evaluate(async () => {
      const n = docsync.api.inventory().pages.length;
      const p = await docsync.api.addPage(n);
      await docsync.api.addTextBox({ page: p.id, x: 1, y: 1, w: 2, md: 'Footer' });
      await docsync.api.masterFrom(p.id, 'Plain');
      return p.id;
    });
    await page.waitForTimeout(1000);
    // Select the page (the strip's page mode): the picker shows its master.
    await page.evaluate(a => setSelPage(document.getElementById('out').contentDocument, a), a);
    await page.waitForTimeout(400);
    await expect(page.locator('#ar-master')).toBeVisible();
    await expect(page.locator('#ar-master')).toHaveValue('Plain');
    // None from the picker.
    await page.selectOption('#ar-master', '');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => layout.pageMasters || null)).toBeNull();
    // And back on.
    await page.selectOption('#ar-master', 'Plain');
    await page.waitForTimeout(1200);
    expect(await page.evaluate(a => layout.pageMasters[a], a)).toBe('Plain');
    // A duplicate of a page using a master uses it too.
    await page.evaluate(a => duplicatePage(a), a);
    await page.waitForTimeout(1500);
    const dup = await page.evaluate(a => {
      const order = pageOrder(); const i = order.findIndex(x => String(x) === String(a));
      return { id: order[i + 1], master: layout.pageMasters[order[i + 1]] };
    }, a);
    expect(dup.master).toBe('Plain');
  });
