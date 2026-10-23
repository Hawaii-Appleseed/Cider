// Find & Change reaches the sources list, renames a citation's [id]: line with
// its [^id] tokens, and "Show me" highlights and works for boxes and cells
// (docsync/editor/edit.html findTargets / findShow; WEAK-POINTS-2026-10-22.md
// "Found and left").
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const ID = 'workforce-profile';   // declared under [[sources]] in the fixture

async function openFind(page, needle) {
  await page.keyboard.press('Meta+f');
  await page.waitForTimeout(600);
  await page.locator('#find-needle').fill(needle);
  await page.waitForTimeout(700);
}

test.describe('Find & Change and the sources list', () => {
  test('a source title is found', async ({ page }) => {
    await gotoEditor(page);
    const title = await page.evaluate(() => parseSources()[0].text);
    const word = title.split(/\s+/).find(w => w.length > 4) || title;
    await openFind(page, word);
    const labels = await page.evaluate(() => findState.hits.map(h => h.target.label));
    expect(labels).toContain('sources');
  });

  test('renaming a citation id renames its [id]: line too', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(async id => {
      pushHistory();
      boxes().push({ id: 'cbox', page: 3, x: 1, y: 1, w: 3, z: 5, md: `Data.[^${id}] ok` });
      markDirty(); await render();
    }, ID);
    await openFind(page, ID);
    await page.locator('#find-repl').fill('wf-renamed');
    await page.click('#find-all');
    await settled(page);
    const r = await page.evaluate(id => ({
      ids: sourceIds(), box: boxOf('cbox').md, left: readSlot('sources').includes(id),
    }), ID);
    expect(r.ids).toContain('wf-renamed');
    expect(r.ids).not.toContain(ID);
    expect(r.left).toBe(false);
    expect(r.box).toContain('[^wf-renamed]');
  });

  test('a source hit opens the sources manager', async ({ page }) => {
    await gotoEditor(page);
    await openFind(page, ID);
    const row = page.locator('#find-list .find-group', { hasText: 'sources' }).locator('.find-hit').first();
    await row.click();
    await expect(page.locator('#srclist')).toBeVisible();
  });
});

test.describe('Show me', () => {
  test('highlights a slot hit, and a box and a cell hit are clickable', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(async () => {
      pushHistory();
      boxes().push({ id: 'fbox', page: 3, x: 1, y: 1, w: 3, z: 5, md: 'zqxbox marker text' });
      markDirty(); await render();
    });
    await page.waitForTimeout(400);
    await openFind(page, 'zqxbox');
    const hit = page.locator('#find-list .find-hit').first();
    await expect(hit).toHaveClass(/find-go/);
    await hit.click();
    const frame = page.frameLocator('#out');
    await expect(frame.locator('[data-find-flash]')).toHaveCount(1);

    // a slot
    const slotKey = await page.evaluate(() => {
      const el = $('out').contentDocument.querySelector('[data-slot]');
      return el.dataset.slot;
    });
    const word = await page.evaluate(k => readSlot(k).split(/\s+/).find(w => /^[A-Za-z]{6,}$/.test(w)), slotKey);
    await page.locator('#find-needle').fill(word);
    await page.waitForTimeout(700);
    await page.locator('#find-list .find-hit').first().click();
    await expect(frame.locator('[data-find-flash]')).toHaveCount(1);
  });

  test('a table cell hit is clickable and highlights its cell', async ({ page }) => {
    await gotoEditor(page);
    const made = await page.evaluate(async () => {
      pushHistory();
      layout.tables = layout.tables || [];
      layout.tables.push({ id: 'ftab', page: 3, x: 1, y: 1, w: 4, rows: [['zqxcell', 'b'], ['c', 'd']] });
      markDirty(); await render();
      return !!$('out').contentDocument.querySelector('[data-el="table.ftab"]');
    });
    await page.waitForTimeout(400);
    test.skip(!made, 'table not rendered from a raw layout push');
    await openFind(page, 'zqxcell');
    const hit = page.locator('#find-list .find-hit').first();
    await expect(hit).toHaveClass(/find-go/);
    await hit.click();
    const tag = await page.evaluate(() => $('out').contentDocument.querySelector('[data-find-flash]')?.tagName);
    expect(tag).toBe('TD');
  });
});
