// Find & Change reaches the sources list, renames a citation's [id]: line with
// its [^id] tokens, "Show me" on a source hit jumps to its endnote on the page
// (the manager only for a source nothing cites), and "Show me" highlights and
// works for boxes and cells
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

  test('Show me on a cited source jumps to its endnote on the page and lights the words', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');
    const title = await page.evaluate(() => parseSources().find(s => s.id === 'workforce-profile').text);
    const word = title.split(/\s+/).find(w => /^[A-Za-z]{6,}$/.test(w));
    expect(word).toBeTruthy();
    await openFind(page, word);
    const group = page.locator('#find-list .find-group', { hasText: 'sources' });
    const row = group.locator('.find-hit').first();
    await expect(row).toHaveClass(/find-go/);
    const before = await page.evaluate(() => $('out').contentWindow.scrollY);
    await row.click();
    // The entry itself is the place, not the whole sources slot and not the manager.
    const flashed = frame.locator('[data-find-flash]');
    await expect(flashed).toHaveCount(1);
    expect(await flashed.getAttribute('data-el')).toMatch(/^endnote\./);
    await expect(page.locator('#srclist')).toHaveCount(0);
    // The hit's words are what is lit, and the page scrolled to them.
    await expect.poll(() => page.evaluate(() => {
      const w = $('out').contentWindow;
      const h = w.CSS.highlights.get('find-show');
      return h ? [...h].map(r => r.toString()) : null;
    })).toEqual([expect.stringMatching(new RegExp('^' + word + '$', 'i'))]);
    await expect.poll(() => page.evaluate(() => $('out').contentWindow.scrollY)).not.toBe(before);
  });

  test('Show me on a source nothing cites opens the sources manager', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(async () => {
      pushHistory();
      writeSlot('sources', readSlot('sources').trimEnd() + '\n[zz-uncited]: Cited nowhere yet — https://example.org/zqxuncited\n');
      markDirty(); await render();
    });
    await settled(page);
    await openFind(page, 'zqxuncited');
    const row = page.locator('#find-list .find-group', { hasText: 'sources' }).locator('.find-hit').first();
    await row.click();
    await expect(page.locator('#srclist')).toBeVisible();
    await expect(page.frameLocator('#out').locator('[data-find-flash]')).toHaveCount(0);
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

test.describe('Show me highlights the exact words', () => {
  test('only the matched span is highlighted, and it is cleaned up', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(async () => {
      pushHistory();
      boxes().push({ id: 'hbox', page: 3, x: 1, y: 1, w: 4, z: 5,
        md: 'alpha **bold** zqxspan beta zqxspan gamma' });
      markDirty(); await render();
    });
    await page.waitForTimeout(400);
    await openFind(page, 'zqxspan');
    await page.locator('#find-list .find-hit').first().click();
    const got = () => page.evaluate(() => {
      const w = $('out').contentWindow, d = $('out').contentDocument;
      const h = w.CSS.highlights.get('find-show');
      return { text: h ? [...h].map(r => r.toString()) : null,
               startOffset: h ? [...h][0].startOffset : null,
               styled: !!d.getElementById('find-show-style'),
               outlined: !!d.querySelector('[data-find-flash]')?.style.outline };
    });
    const on = await got();
    expect(on.text).toEqual(['zqxspan']);
    expect(on.outlined).toBe(false);
    // the second hit lands on the second occurrence
    await page.locator('#find-list .find-hit').nth(1).click();
    const second = await got();
    expect(second.text).toEqual(['zqxspan']);
    expect(second.startOffset).toBeGreaterThan(on.startOffset);
    await page.waitForTimeout(2500);
    const off = await got();
    expect(off.text).toBeNull();
    expect(off.styled).toBe(false);
  });
});
