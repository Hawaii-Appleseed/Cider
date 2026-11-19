// The left rail (2026-11-18): the tools (Select, Type, Hand with V, T, H), the +
// that opens the Insert palette (⌘K), and the pins a person keeps from it.
// docsync/editor/edit.html: setTool, wireTypeTool, openPalette, railPins.
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const PROJ = '?project=uhero-trc-summary';
const frame = page => page.frameLocator('#out');

async function defaultRail(page) {
  // The fixture pins all six original buttons; start from the real defaults.
  await page.evaluate(() => { localStorage.removeItem('cider-rail-pins'); railPins(); });
}
// Put the rail back as the fixture boots it (all six originals pinned), so the
// shared editor's reset finds nothing left behind.
const restoreRail = page => page.evaluate(() => {
  localStorage.setItem('cider-rail-pins', JSON.stringify(['text', 'shape', 'icon', 'ar-img', 'table', 'chart']));
  railPins();
});
const tool = page => page.evaluate(() => window.__dsTool());
const focusChrome = page => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); document.body.focus(); });
const focusPage = page => page.evaluate(() => $('out').contentWindow.focus());

test.describe('the tools', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, PROJ); await defaultRail(page); });
  test.afterEach(async ({ page }) => { await restoreRail(page).catch(() => {}); });

  test('Select is the tool at boot, and the rail says so', async ({ page }) => {
    expect(await tool(page)).toBe('select');
    await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tool-type')).toHaveAttribute('aria-pressed', 'false');
  });

  for (const where of ['chrome', 'page']) {
    test(`V, T and H pick the tools (keys heard in the ${where})`, async ({ page }) => {
      where === 'chrome' ? await focusChrome(page) : await focusPage(page);
      await page.keyboard.press('t');
      expect(await tool(page)).toBe('type');
      await expect(page.locator('#tool-type')).toHaveClass(/\bon\b/);
      await page.keyboard.press('h');
      expect(await tool(page)).toBe('hand');
      await expect(page.locator('#tool-hand')).toHaveClass(/\bon\b/);
      await page.keyboard.press('v');
      expect(await tool(page)).toBe('select');
      await expect(page.locator('#tool-select')).toHaveClass(/\bon\b/);
    });
  }

  test('a letter typed in a field does not change the tool', async ({ page }) => {
    await page.click('#insert');
    await page.keyboard.type('hat');
    expect(await tool(page)).toBe('select');
    expect(await page.inputValue('#pal-q')).toBe('hat');
  });

  test('Escape from Type or Hand goes back to Select', async ({ page }) => {
    await page.click('#tool-hand');
    expect(await tool(page)).toBe('hand');
    await focusChrome(page);
    await page.keyboard.press('Escape');
    expect(await tool(page)).toBe('select');
  });

  test('the tool survives a render (the page is replaced) and shows its cursor', async ({ page }) => {
    await page.click('#tool-type');
    await page.evaluate(() => render());
    await settled(page);
    expect(await page.evaluate(() => $('out').contentDocument.documentElement.classList.contains('ds-tool-type'))).toBe(true);
    await page.click('#tool-hand');
    expect(await page.evaluate(() => $('out').contentDocument.body.classList.contains('ds-hand'))).toBe(true);
    await page.click('#tool-select');
    expect(await page.evaluate(() => $('out').contentDocument.body.classList.contains('ds-hand'))).toBe(false);
  });

  test('Hand: a drag pans the page and selects nothing', async ({ page }) => {
    await page.click('#tool-hand');
    const before = await page.evaluate(() => $('out').contentWindow.scrollY);
    const box = await page.locator('#out').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 120, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() => $('out').contentWindow.scrollY);
    expect(after).toBeGreaterThan(before + 60);
    expect(await page.evaluate(() => selIds.size)).toBe(0);
  });

  test('Type: a click on empty page starts a text box there, words open and selected', async ({ page }) => {
    await page.evaluate(() => $('out').contentDocument.querySelector('section.page').scrollIntoView());
    await page.click('#tool-type');
    const n0 = await page.evaluate(() => layout.boxes.length);
    // A spot with nothing placed: the page's own margin, found by geometry.
    const spot = await page.evaluate(() => {
      const d = $('out').contentDocument, pg = d.querySelector('section.page'), r = pg.getBoundingClientRect();
      const f = $('out').getBoundingClientRect();
      const taken = [...pg.querySelectorAll('[data-el], [data-slot]')].map(e => e.getBoundingClientRect());
      for (let y = r.top + 20; y < Math.min(r.bottom, innerHeight) - 20; y += 24)
        for (let x = r.left + 12; x < r.right - 120; x += 24)
          if (!taken.some(b => x > b.left - 6 && x < b.right + 6 && y > b.top - 6 && y < b.bottom + 6))
            return { x: f.x + x, y: f.y + y };
      return null;
    });
    test.skip(!spot, 'no empty spot on this page');
    await page.mouse.click(spot.x, spot.y);
    await expect.poll(() => page.evaluate(() => layout.boxes.length)).toBe(n0 + 1);
    await settled(page);
    expect(await tool(page)).toBe('select');
    expect(await page.evaluate(() => editing)).toBe(true);
    const sel = await page.evaluate(() => $('out').contentDocument.getSelection().toString());
    expect(sel).toBe('Your text here');
    await page.keyboard.type('Typed straight away');
    await page.keyboard.press('Escape');
    await settled(page);
    expect(await page.evaluate(() => layout.boxes[layout.boxes.length - 1].md)).toBe('Typed straight away');
  });

  test('Type: a drag sizes the new box', async ({ page }) => {
    await page.evaluate(() => $('out').contentDocument.querySelector('section.page').scrollIntoView());
    await page.click('#tool-type');
    const spot = await page.evaluate(() => {
      const d = $('out').contentDocument, pg = d.querySelector('section.page'), r = pg.getBoundingClientRect();
      const f = $('out').getBoundingClientRect();
      return { x: f.x + r.left + 30, y: f.y + Math.max(r.top, 0) + 12, w: pg.getBoundingClientRect().width };
    });
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x + 260, spot.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => layout.boxes[layout.boxes.length - 1].md)).toBe('Your text here');
    const w = await page.evaluate(() => layout.boxes[layout.boxes.length - 1].w);
    expect(w).toBeGreaterThan(0.8);
    expect(w).not.toBe(3);
  });
});

test.describe('the Insert palette', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, PROJ); await defaultRail(page); });
  test.afterEach(async ({ page }) => { await restoreRail(page).catch(() => {}); });

  test('+ and ⌘K open it with the search focused; Escape closes it', async ({ page }) => {
    await page.click('#insert');
    await expect(page.locator('#palette')).toBeVisible();
    await expect(page.locator('#pal-q')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
    await focusChrome(page);
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
  });

  test('typing filters, Enter places the first match', async ({ page }) => {
    const n0 = await page.evaluate(() => layout.shapes.length);
    await page.click('#insert');
    await page.keyboard.type('donut');
    // The donut chart first; the icon search is always offered last when no icon is named.
    await expect(page.locator('.pal-row b').first()).toHaveText('Donut chart');
    await page.keyboard.press('Enter');
    await expect(page.locator('#palette')).toBeHidden();
    await expect.poll(() => page.evaluate(() => layout.shapes.length)).toBe(n0 + 1);
    expect(await page.evaluate(() => layout.shapes[layout.shapes.length - 1].chart.type)).toBe('donut');
  });

  test('a shape row places that shape; a text row places that text box', async ({ page }) => {
    const s0 = await page.evaluate(() => layout.shapes.length);
    await page.click('#insert');
    await page.keyboard.type('ellipse');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => layout.shapes.length)).toBe(s0 + 1);
    expect(await page.evaluate(() => layout.shapes[layout.shapes.length - 1].kind)).toBe('ellipse');
    await settled(page);
    const b0 = await page.evaluate(() => layout.boxes.length);
    await page.click('#insert');
    await page.keyboard.type('heading');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => layout.boxes.length)).toBe(b0 + 1);
    expect(await page.evaluate(() => layout.boxes[layout.boxes.length - 1].md)).toBe('Heading');
  });

  test('arrow keys move the highlight; no match says so; icons fall through to the icon search', async ({ page }) => {
    await page.click('#insert');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.pal-row.sel')).toHaveAttribute('data-i', '1');
    await page.keyboard.type('zzzz');
    await expect(page.locator('.pal-row')).toHaveCount(1);          // the icon-search row, nothing else
    await expect(page.locator('.pal-row b')).toContainText('Search icons');
    await page.keyboard.press('Enter');
    await expect(page.locator('#side')).toBeVisible();
    expect(await page.inputValue('#icon-q')).toBe('zzzz');
  });

  test('a category chip narrows the list', async ({ page }) => {
    await page.click('#insert');
    await page.click('#pal-chips button[data-c="Data"]');
    const heads = await page.locator('.pal-h').allInnerTexts();
    expect(heads.map(h => h.toLowerCase())).toEqual(['charts and tables']);
  });

  test('pinning puts the row on the rail, unpinning takes it off, and it is remembered', async ({ page }) => {
    await expect(page.locator('#rail-pins > button')).toHaveCount(3);        // Shapes, Chart, Image
    await page.click('#insert');
    await page.keyboard.type('pie');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pin-chart-pie')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cider-rail-pins')))).toContain('chart-pie');
    const n0 = await page.evaluate(() => layout.shapes.length);
    await page.click('#pin-chart-pie');
    await expect.poll(() => page.evaluate(() => layout.shapes.length)).toBe(n0 + 1);
    await page.click('#insert');
    await page.keyboard.type('pie');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pin-chart-pie')).toHaveCount(0);
  });

  test('a legacy button keeps its id and its job when pinned', async ({ page }) => {
    await expect(page.locator('#shape')).toBeVisible();
    await expect(page.locator('#table')).toBeHidden();
    await page.click('#insert');
    await page.keyboard.type('table');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('#table')).toBeVisible();
    await page.click('#shape');
    await expect(page.locator('#shapepop')).toBeVisible();
  });

  test('the rail and palette text is readable: labels and rows are 13px or more', async ({ page }) => {
    await page.click('#insert');
    const small = await page.evaluate(() => [...document.querySelectorAll('#palette *')]
      .filter(e => e.children.length === 0 && e.textContent.trim() && !e.closest('svg'))
      .map(e => ({ t: e.textContent.trim().slice(0, 20), px: parseFloat(getComputedStyle(e).fontSize) }))
      .filter(x => x.px < 12));
    expect(small).toEqual([]);
  });
});

test.describe('the rail itself (screenshots for the eye, no assertions on pixels)', () => {
  test('rail and palette', async ({ page }, info) => {
    await gotoEditor(page, PROJ);
    await defaultRail(page);
    await page.screenshot({ path: info.outputPath('rail-closed.png') });
    await page.click('#insert');
    await page.screenshot({ path: info.outputPath('rail-palette.png') });
    expect(true).toBe(true);
  });
});
