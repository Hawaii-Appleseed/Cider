// The labelled left rail and its trays (docsync/editor/edit.html, #leftrail).
//
// Five categories — Text, Elements, Data, Images, Colors — each with a word
// under its icon, each opening a roomy tray docked in #side. Elements holds
// shapes AND icons, Data holds charts AND tables. The old seven-button ids
// (#shape #icon #table #chart) survive as hidden aliases, which the older
// specs still click; this spec reaches everything the way a person does,
// through the visible rail and the tray's own tiles.
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const HOUSE = '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l9-7 9 7v10H3z"/></g>';

async function mockIconify(page) {
  await page.route('**/api.iconify.design/search**', route => route.fulfill({
    json: { icons: ['lucide:house'], collections: { lucide: { name: 'Lucide', license: { title: 'ISC' } } } },
  }));
  await page.route('**/api.iconify.design/lucide.json**', route => route.fulfill({
    json: { prefix: 'lucide', width: 24, height: 24, icons: { house: { body: HOUSE } } },
  }));
}

const RAIL = [['text', 'Text'], ['elements', 'Elements'], ['data', 'Data'], ['ar-img', 'Images'], ['colors', 'Colors']];

test.describe('the labelled rail', () => {
  test.beforeEach(async ({ page }) => {
    await mockIconify(page);
    await gotoEditor(page);
  });

  test('five categories, each with a readable word under its icon', async ({ page }) => {
    const rows = await page.evaluate(() => [...document.querySelectorAll('#leftrail .rb')].map(b => ({
      id: b.id, label: b.querySelector('span').textContent.trim(),
      px: parseFloat(getComputedStyle(b.querySelector('span')).fontSize),
      vis: b.getBoundingClientRect().width > 40,
    })));
    expect(rows.map(r => [r.id, r.label])).toEqual(RAIL);
    for (const r of rows) {
      expect(r.px, `${r.id} label size`).toBeGreaterThanOrEqual(12);
      expect(r.vis, `${r.id} is drawn`).toBe(true);
    }
    // --rail-w is the rail's real outer width: everything anchored to it lines up.
    const w = await page.evaluate(() => ({
      rail: document.getElementById('leftrail').getBoundingClientRect().width,
      varPx: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-w')),
    }));
    expect(w.rail).toBe(w.varPx);
    expect(w.rail).toBe(84);
  });

  test('the old tool ids are still there, but never drawn or tabbable', async ({ page }) => {
    for (const id of ['shape', 'icon', 'table', 'chart']) {
      const r = await page.evaluate(i => {
        const b = document.getElementById(i), box = b.getBoundingClientRect();
        return { w: box.width, h: box.height, tab: b.tabIndex, op: getComputedStyle(b.parentElement).opacity };
      }, id);
      expect(r, id).toEqual({ w: 1, h: 1, tab: -1, op: '0' });
    }
  });

  for (const [id, title, pop] of [['text', 'Text', 'textpop'], ['elements', 'Elements', 'elementspop'],
                                  ['data', 'Data', 'datapop'], ['ar-img', 'Images', 'imgpop']]) {
    test(`${title} opens its tray, lights its button, and closes on a second press`, async ({ page }) => {
      await page.click('#' + id);
      await expect(page.locator('#side')).toBeVisible();
      await expect(page.locator('#side-title')).toHaveText(title);
      await expect(page.locator(`#side-body #${pop}`)).toBeVisible();
      await expect(page.locator('#' + id)).toHaveClass(/\bon\b/);
      // roomy: wider than the 252px panels, with a search box at 13px or more
      const g = await page.evaluate(p => {
        const side = document.getElementById('side').getBoundingClientRect();
        const q = document.querySelector(`#${p} .tr-search input`);
        return { w: side.width, left: side.left, q: parseFloat(getComputedStyle(q).fontSize) };
      }, pop);
      expect(g.w).toBeGreaterThanOrEqual(340);
      expect(g.left).toBe(84);                       // starts exactly where the rail ends
      expect(g.q).toBeGreaterThanOrEqual(13);
      await page.click('#' + id);
      await expect(page.locator('#side')).toBeHidden();
      await expect(page.locator('#' + id)).not.toHaveClass(/\bon\b/);
    });
  }

  test('Colors still opens its own panel, at the panel width', async ({ page }) => {
    await page.click('#colors');
    await expect(page.locator('#side-title')).toHaveText('Colors');
    await expect(page.locator('#colors')).toHaveClass(/\bon\b/);
    expect(await page.evaluate(() => document.getElementById('side').getBoundingClientRect().width)).toBe(252);
  });

  test('switching category swaps the tray and moves the lit button', async ({ page }) => {
    await page.click('#elements');
    await page.click('#data');
    await expect(page.locator('#side-title')).toHaveText('Data');
    await expect(page.locator('#elements')).not.toHaveClass(/\bon\b/);
    await expect(page.locator('#data')).toHaveClass(/\bon\b/);
    await expect(page.locator('#elementspop')).toBeHidden();
  });
});

test.describe('Elements: shapes and icons', () => {
  test.beforeEach(async ({ page }) => {
    await mockIconify(page);
    await gotoEditor(page);
    await page.click('#elements');
  });

  test('All shows shapes and icons together; the tabs narrow it', async ({ page }) => {
    await expect(page.locator('#shapepop')).toBeVisible();
    await expect(page.locator('#icon-set')).toBeVisible();
    await page.click('#el-tabs [data-tab="shapes"]');
    await expect(page.locator('#shapepop')).toBeVisible();
    await expect(page.locator('#icon-set')).toBeHidden();
    await page.click('#el-tabs [data-tab="icons"]');
    await expect(page.locator('#shapepop')).toBeHidden();
    await expect(page.locator('#icon-set')).toBeVisible();
    await expect(page.locator('#el-tabs [data-tab="icons"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('every shape tile is labelled at 13px and places its shape', async ({ page }) => {
    const tiles = page.locator('#shapepop .shp');
    await expect(tiles).toHaveCount(10);
    const px = await tiles.first().evaluate(b => parseFloat(getComputedStyle(b).fontSize));
    expect(px).toBeGreaterThanOrEqual(13);
    for (const kind of ['rect', 'ellipse', 'line', 'triangle', 'arrow', 'polygon', 'star']) {
      const before = await page.evaluate(() => layout.shapes.length);
      await page.click(`#shapepop .shp[data-k="${kind}"]`);
      await expect.poll(() => page.evaluate(() => layout.shapes.length)).toBe(before + 1);
      expect(await page.evaluate(() => layout.shapes[layout.shapes.length - 1].kind)).toBe(kind);
      await settled(page);
      // the tray stays open, so a run of shapes needs no re-opening
      await expect(page.locator('#shapepop')).toBeVisible();
    }
  });

  test('the search box filters the shape tiles by name', async ({ page }) => {
    await page.fill('#icon-q', 'star');
    await expect(page.locator('#shapepop .shp:visible')).toHaveCount(1);
    await expect(page.locator('#shapepop .shp[data-k="star"]')).toBeVisible();
    await page.fill('#icon-q', 'zzzz');
    await expect(page.locator('#shapepop')).toBeHidden();       // nothing to show under Shapes
    await page.click('#el-tabs [data-tab="shapes"]');
    await expect(page.locator('#el-empty')).toBeVisible();
    await page.fill('#icon-q', '');
    await expect(page.locator('#shapepop .shp:visible')).toHaveCount(10);
  });

  test('the same search finds icons, and an icon tile places the icon', async ({ page }) => {
    await page.fill('#icon-q', 'house');
    const tile = page.locator('#icon-grid .icon-tile').first();
    await tile.waitFor({ state: 'visible' });
    await tile.click();
    await expect.poll(() => page.evaluate(() => layout.shapes.some(s => s.kind === 'icon'))).toBe(true);
    expect(await page.evaluate(() => layout.shapes.find(s => s.kind === 'icon').icon)).toBe('lucide:house');
  });

  test('a suggestion chip runs that search', async ({ page }) => {
    await page.click('#el-tabs [data-tab="icons"]');
    await page.click('#icon-sugg [data-q="house"]');
    await expect(page.locator('#icon-q')).toHaveValue('house');
    await page.locator('#icon-grid .icon-tile').first().waitFor({ state: 'visible' });
  });

  test('Pen and QR close the tray so the page has the room', async ({ page }) => {
    await page.click('#shapepop [data-pen]');
    await expect(page.locator('#side')).toBeHidden();
  });
});

test.describe('Data: charts and tables', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the chart tiles are only types the engine draws, each named at 13px', async ({ page }) => {
    await page.click('#data');
    const kinds = await page.locator('#data-charts .tr-tile').evaluateAll(els => els.map(e => e.dataset.chart));
    expect(kinds).toEqual(['bar', 'row', 'stacked-bar', 'stacked-row', 'pie', 'donut', 'line', 'area']);
    const known = await page.evaluate(() => CHART_KINDS.map(k => k[0]));
    for (const k of kinds) expect(known, k).toContain(k);
    const px = await page.locator('#data-charts .tr-tile').first().evaluate(b => parseFloat(getComputedStyle(b).fontSize));
    expect(px).toBeGreaterThanOrEqual(13);
  });

  for (const type of ['bar', 'row', 'stacked-bar', 'stacked-row', 'pie', 'donut', 'line', 'area']) {
    test(`the ${type} tile places a ${type} chart and opens the Chart panel`, async ({ page }) => {
      await page.click('#data');
      await page.click(`#data-charts [data-chart="${type}"]`);
      await expect.poll(() => page.evaluate(() => layout.shapes.filter(s => s.kind === 'chart').length)).toBe(1);
      expect(await page.evaluate(() => layout.shapes.find(s => s.kind === 'chart').chart.type)).toBe(type);
      await expect(page.locator('#side-title')).toHaveText('Chart');
      await expect(page.locator('#data')).toHaveClass(/\bon\b/);
      // and the engine drew it
      await page.frameLocator('#out').locator('[data-shape] rect, [data-shape] path, [data-shape] circle')
        .first().waitFor({ state: 'attached', timeout: 20000 });
    });
  }

  test('a stacked chart starts with two series, so it reads as stacked', async ({ page }) => {
    await page.click('#data');
    await page.click('#data-charts [data-chart="stacked-bar"]');
    await expect.poll(() => page.evaluate(() => layout.shapes.some(s => s.kind === 'chart'))).toBe(true);
    expect(await page.evaluate(() => layout.shapes.find(s => s.kind === 'chart').chart.series.length)).toBe(2);
  });

  test('the Table row places a table and opens the Table panel', async ({ page }) => {
    await page.click('#data');
    await page.click('#data-table');
    await expect.poll(() => page.evaluate(() => tables().length)).toBeGreaterThan(0);
    await expect(page.locator('#side-title')).toHaveText('Table');
    await expect(page.locator('#data')).toHaveClass(/\bon\b/);
  });

  test('search narrows the tiles, and says so when nothing matches', async ({ page }) => {
    await page.click('#data');
    await page.fill('#data-q', 'donut');
    await expect(page.locator('#data-charts .tr-tile:visible')).toHaveCount(1);
    await expect(page.locator('#data-table')).toBeHidden();
    await page.fill('#data-q', 'grid');                    // a keyword of Table, not of any chart
    await expect(page.locator('#data-table')).toBeVisible();
    await expect(page.locator('#data-charts')).toBeHidden();
    await page.fill('#data-q', 'zzzz');
    await expect(page.locator('#data-empty')).toBeVisible();
  });

  test('the tabs show charts or tables on their own', async ({ page }) => {
    await page.click('#data');
    await page.click('#data-tabs [data-tab="tables"]');
    await expect(page.locator('#data-table')).toBeVisible();
    await expect(page.locator('#data-charts')).toBeHidden();
    await page.click('#data-tabs [data-tab="charts"]');
    await expect(page.locator('#data-charts')).toBeVisible();
    await expect(page.locator('#data-table')).toBeHidden();
  });

  test('the hidden #chart and #table aliases still place a bar chart and a table', async ({ page }) => {
    await page.click('#chart');
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.kind === 'chart')?.chart.type)).toBe('bar');
    await page.click('#table');
    await expect.poll(() => page.evaluate(() => tables().length)).toBeGreaterThan(0);
  });
});

test.describe('Images tray', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('Upload is the first row and reaches the file dialog', async ({ page }) => {
    await page.click('#ar-img');
    await expect(page.locator('#imgpop')).toBeVisible();
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.click('#img-upload');
    await chooser;
  });

  test('pictures already in the report are tiles; search filters them; a click places one', async ({ page }) => {
    await page.evaluate(() => {
      window.projectImages = () => ['logo.svg', 'cover.png', 'photo.jpg'];
      window.__placed = [];
      window.placeImageBox = (path, name) => window.__placed.push([path, name]);
    });
    await page.click('#ar-img');
    await expect(page.locator('#img-list .shp')).toHaveCount(3);
    await page.fill('#img-q', 'cov');
    await expect(page.locator('#img-list .shp')).toHaveCount(1);
    await page.click('#img-list .shp');
    expect(await page.evaluate(() => window.__placed)).toEqual([['assets/cover.png', 'cover.png']]);
    await page.fill('#img-q', 'nothing like it');
    await expect(page.locator('#img-empty')).toContainText('No image in this report matches');
  });

  test('with no pictures in the report the tray says so and Upload stays', async ({ page }) => {
    await page.evaluate(() => { window.projectImages = () => []; });
    await page.click('#ar-img');
    await expect(page.locator('#img-empty')).toContainText('no images yet');
    await expect(page.locator('#img-upload')).toBeVisible();
  });
});

test.describe('Text tray', () => {
  test('the search box filters the styles, and the old buttons still add text', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#text');
    await expect(page.locator('#textpop .txtpreset')).toHaveCount(5);
    await page.fill('#text-q', 'head');
    await expect(page.locator('#textpop .txtpreset:visible')).toHaveCount(2);   // Heading, Subheading
    await page.fill('#text-q', 'zzzz');
    await expect(page.locator('#text-empty')).toBeVisible();
    await page.fill('#text-q', '');
    await page.click('#textpop .txtpreset[data-k="heading"]');
    await expect.poll(() => page.evaluate(() => (layout.boxes || []).some(b => b.md === 'Heading'))).toBe(true);
  });
});

test.describe('layering and narrow windows', () => {
  for (const id of ['text', 'elements', 'data', 'ar-img']) {
    test(`the ${id} tray sits above the rulers`, async ({ page }) => {
      await gotoEditor(page);
      await page.evaluate(() => { if (!guidesOn) toggleGuides(); });
      await page.click('#' + id);
      const bad = await page.evaluate(() => {
        const side = document.getElementById('side'), b = side.getBoundingClientRect();
        const out = [];
        for (const rid of ['ruler-t', 'ruler-l', 'ruler-c']) {
          const q = document.getElementById(rid).getBoundingClientRect();
          const l = Math.max(q.left, b.left + 2), r = Math.min(q.right, b.right - 2),
                t = Math.max(q.top, b.top + 10), btm = Math.min(q.bottom, b.bottom - 10);
          if (r <= l || btm <= t) continue;
          const e = document.elementFromPoint((l + r) / 2, (t + btm) / 2);
          if (!e || !side.contains(e)) out.push(rid);
        }
        return out;
      });
      expect(bad).toEqual([]);
    });
  }

  for (const width of [760, 375]) {
    test(`at ${width}px the rail and every tray stay inside the window`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await gotoEditor(page);
      for (const id of ['text', 'elements', 'data', 'ar-img']) {
        await page.click('#' + id);
        const g = await page.evaluate(() => {
          const s = document.getElementById('side').getBoundingClientRect();
          const r = document.getElementById('leftrail').getBoundingClientRect();
          return { sideRight: s.right, railRight: r.right, vw: innerWidth, railBottom: r.bottom, vh: innerHeight };
        });
        expect(g.sideRight, id).toBeLessThanOrEqual(g.vw);
        expect(g.sideRight, id).toBeGreaterThan(g.railRight + 150);
        expect(g.railBottom, id).toBeLessThanOrEqual(g.vh);
      }
    });
  }

  test('the rail takes a light surface by a body attribute, labels staying legible', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { document.body.dataset.chrome = 'light'; });
    // polled: the label's colour rides a .14s transition, so a read right
    // after the switch catches it halfway between the two inks
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('#text span')).color))
      .toBe('rgb(47, 62, 70)');                                // ink #2F3E46 on a pale rail
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('leftrail')).backgroundImage);
    expect(bg).toContain('251, 252, 251');
  });
});
