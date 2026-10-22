// Icon picker (docsync/editor/edit.html + docsync/layout.py kind:"icon").
// Thousands of open-source icons — Iconoir, Lucide, Heroicons, Bootstrap
// Icons, Phosphor, Tabler — searched through the Iconify API, which indexes
// them all behind one endpoint. The picked icon's GEOMETRY is copied into
// layout.json, so the PDF (headless Chrome, no network) and the Pyodide
// preview both render it offline.
//
// The API is mocked here: the suite must not depend on a third party being
// up, and CI has no business making outbound calls.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const HOUSE = '<g fill="none" stroke="currentColor" stroke-width="2">'
            + '<path d="M3 10a2 2 0 0 1 .709-1.528l7-6"/></g>';
const CHART = '<path fill="currentColor" d="M3 3v16a2 2 0 0 0 2 2h16"/>';

async function mockIconify(page) {
  await page.route('**/api.iconify.design/search**', route => route.fulfill({
    json: {
      icons: ['lucide:house', 'iconoir:home', 'bi:chart'],
      collections: {
        lucide: { name: 'Lucide', license: { title: 'ISC' } },
        iconoir: { name: 'Iconoir', license: { title: 'MIT' } },
      },
    },
  }));
  await page.route('**/api.iconify.design/lucide.json**', route => route.fulfill({
    json: { prefix: 'lucide', width: 24, height: 24, icons: { house: { body: HOUSE } } },
  }));
  await page.route('**/api.iconify.design/iconoir.json**', route => route.fulfill({
    // An alias: the geometry lives under another name and must be resolved,
    // or the tile comes back blank.
    json: {
      prefix: 'iconoir', width: 24, height: 24,
      aliases: { home: { parent: 'house-alt' } },
      icons: { 'house-alt': { body: HOUSE } },
    },
  }));
  await page.route('**/api.iconify.design/bi.json**', route => route.fulfill({
    json: { prefix: 'bi', width: 16, height: 16, icons: { chart: { body: CHART } } },
  }));
}

async function search(page, q) {
  await page.click('#icon');
  await page.fill('#icon-q', q);
  await page.locator('#icon-grid .icon-tile').first().waitFor({ state: 'visible' });
}

test.describe('icon picker', () => {
  test.beforeEach(async ({ page }) => {
    await mockIconify(page);
    await gotoEditor(page);
  });

  test('searching shows results from several sets, previewed as real SVG', async ({ page }) => {
    await search(page, 'house');
    const tiles = page.locator('#icon-grid .icon-tile');
    await expect(tiles).toHaveCount(3);
    // Each tile draws the actual glyph, not a placeholder.
    expect(await tiles.first().locator('svg path').count()).toBeGreaterThan(0);
    await expect(page.locator('#icon-note')).toContainText('3 icons');
    // Aliases resolve, so the Iconoir tile is not blank.
    const alias = page.locator('.icon-tile[title="iconoir:home"]');
    expect(await alias.locator('svg path').count()).toBeGreaterThan(0);
  });

  test('the set filter narrows the search to one library', async ({ page }) => {
    await page.click('#icon');
    await expect(page.locator('#icon-set option')).toHaveCount(7);   // All + 6 sets
    let asked = '';
    await page.route('**/api.iconify.design/search**', route => {
      asked = route.request().url();
      return route.fulfill({ json: { icons: ['lucide:house'] } });
    });
    await page.selectOption('#icon-set', 'lucide');
    await page.fill('#icon-q', 'house');
    await page.locator('#icon-grid .icon-tile').first().waitFor({ state: 'visible' });
    expect(asked).toContain('prefixes=lucide');
  });

  test('placing an icon stores its geometry in layout.json, not a reference', async ({ page }) => {
    await search(page, 'house');
    await page.locator('.icon-tile[title="lucide:house"]').click();
    await page.waitForTimeout(1200);

    const sh = await page.evaluate(() => layout.shapes.find(s => s.kind === 'icon'));
    expect(sh).toBeTruthy();
    expect(sh.icon).toBe('lucide:house');
    expect(sh.vb).toBe('0 0 24 24');
    expect(sh.svg).toContain('<path');          // the drawing itself travels
    expect(sh.svg).toContain('currentColor');   // ...and stays recolourable
    expect(sh.fill).toBe('#52796F');            // lands in the report's palette
  });

  test('a placed icon renders through the Python layer and recolours via Fill', async ({ page }) => {
    await search(page, 'house');
    await page.locator('.icon-tile[title="lucide:house"]').click();
    await page.waitForTimeout(1200);

    const frame = page.frameLocator('#out');
    const id = await page.evaluate(() => layout.shapes.find(s => s.kind === 'icon').id);
    const el = frame.locator(`[data-shape="${id}"]`);
    await expect(el).toHaveCount(1);
    // The renderer nests an <svg> so the icon's own viewBox does the scaling.
    expect(await el.evaluate(n => n.tagName.toLowerCase())).toBe('svg');
    expect(await el.evaluate(n => n.getAttribute('viewBox'))).toBe('0 0 24 24');
    // currentColor resolves from the colour the shape's fill sets.
    expect(await el.evaluate(n => n.style.color)).toBe('rgb(82, 121, 111)');

    await page.evaluate(() => {
      const s = layout.shapes.find(x => x.kind === 'icon');
      s.fill = '#B23A48';
    });
    await page.evaluate(() => render());
    await settled(page);
    const recoloured = frame.locator(`[data-shape="${id}"]`);
    expect(await recoloured.evaluate(n => n.style.color)).toBe('rgb(178, 58, 72)');
  });

  test('an icon scales from its corners only — stretching would distort the glyph', async ({ page }) => {
    await search(page, 'house');
    await page.locator('.icon-tile[title="lucide:house"]').click();
    await page.waitForTimeout(1200);

    const frame = page.frameLocator('#out');
    const id = await page.evaluate(() => layout.shapes.find(s => s.kind === 'icon').id);
    // Placing an icon selects it, so its handles are already up — clicking
    // again would only land on the rotate ring that is now over it.
    await expect(frame.locator(`.ds-handles[data-for="${id}"]`)).toHaveCount(1);
    await expect(frame.locator('.ds-handles .ds-h-se')).toHaveCount(1);
    await expect(frame.locator('.ds-handles .ds-h-n')).toHaveCount(0);
    await expect(frame.locator('.ds-handles .ds-h-e')).toHaveCount(0);
  });

  test('a plain click anywhere on an icon selects it — not just its thin strokes', async ({ page }) => {
    // The icon's [data-shape] is a wrapper svg that paints nothing itself;
    // under visiblePainted it had near-zero hit area, so clicks sailed
    // through to whatever sat beneath and the icon read as unselectable.
    // pointer-events:bounding-box makes the whole placed box the target.
    await search(page, 'house');
    await page.locator('.icon-tile[title="lucide:house"]').click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => clearSel($('out').contentDocument));

    const id = await page.evaluate(() => layout.shapes.find(s => s.kind === 'icon').id);
    const box = await page.frameLocator('#out').locator(`[data-shape="${id}"]`).boundingBox();
    // Dead centre of the glyph's box — transparent pixels on a stroke icon.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => [...selIds])).toContain(id);
  });

  test('markup that is not a plain drawing is refused, never placed', async ({ page }) => {
    const verdicts = await page.evaluate(() => ({
      ok: iconSvgOk('<path d="M0 0h4"/>'),
      script: iconSvgOk('<script>alert(1)</script>'),
      handler: iconSvgOk('<path onload="x" d="M0 0"/>'),
      remoteImg: iconSvgOk('<image href="http://example.com/x.png"/>'),
      link: iconSvgOk('<a href="javascript:1">x</a>'),
      foreign: iconSvgOk('<foreignObject><b>hi</b></foreignObject>'),
      huge: iconSvgOk('<path d="' + 'M0 0'.repeat(20000) + '"/>'),
    }));
    expect(verdicts.ok).toBe(true);
    for (const [k, v] of Object.entries(verdicts)) {
      if (k !== 'ok') expect(v, k).toBe(false);
    }
  });

  test('a search that finds nothing says so instead of going quiet', async ({ page }) => {
    await page.route('**/api.iconify.design/search**',
      route => route.fulfill({ json: { icons: [] } }));
    await page.click('#icon');
    await page.fill('#icon-q', 'zzzznope');
    await expect(page.locator('#icon-note')).toContainText('nothing matched');
  });

  test('offline, the picker says the search needs a connection', async ({ page }) => {
    await page.route('**/api.iconify.design/search**', route => route.abort());
    await page.click('#icon');
    await page.fill('#icon-q', 'house');
    await expect(page.locator('#icon-note')).toContainText('needs a connection');
  });
});
