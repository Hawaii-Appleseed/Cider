// Third weak-points pass (WEAK-POINTS-2026-10-23.md): comments, tables and
// charts, image upload and replacement, keyboard and screen-reader reach,
// phone width, pageless reports, ʻokina and kahakō, and the pilot verbs that
// answered ok over a draft the engine would not build. Each test fails on the
// editor before the change and passes after. Local mode.
const path = require('path');
const { test, expect, gotoEditor, settled, openFileMenu, dialog, fillDialog, submitDialog } = require('./fixtures/editor-test');

const PIXEL = path.join(__dirname, 'fixtures', 'spec-pixel.png');
const frameOf = page => page.frameLocator('#out');

test.describe('ʻokina and kahakō', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('a fake ʻokina is fixed in capitals and at a sentence start, and a combining kahakō is composed', async ({ page }) => {
    const r = await page.evaluate(() => ({
      caps: fixOkina("HAWAI'I and O'AHU"),
      lead: fixOkina("'Ōlelo Hawai'i, 'Āina, 'Ohana"),
      nfd: fixOkina('Kahākō āina').length,
      niihau: fixOkina("Ni'ihau"),
      untouched: fixOkina("Maui's and don't"),
    }));
    expect(r.caps).toBe('HAWAIʻI and OʻAHU');
    expect(r.lead).toBe('ʻŌlelo Hawaiʻi, ʻĀina, ʻOhana');
    expect(r.nfd).toBe('Kahakō āina'.length);
    expect(r.niihau).toBe('Niʻihau');
    expect(r.untouched).toBe("Maui's and don't");
  });

  test('a chart and a table made by a pilot carry the real ʻokina, not what was typed', async ({ page }) => {
    await page.evaluate(async () => {
      await docsync.api.addChart({ page: 3, x: 1, y: 1, w: 6, h: 3, chart: { type: 'bar', title: "Hawai'i title",
        labels: ["O'ahu", "Kaua'i"], series: [{ name: "Hawai'i", data: [1, 2] }] } });
      await docsync.api.addTable({ page: 3, x: 1, y: 6, w: 6, rows: [['Moku', "Hawai'i"], ["O'ahu", '2']] });
    });
    await settled(page);
    const dump = await page.evaluate(() => JSON.stringify(layout));
    expect(dump).not.toMatch(/Hawai'i|O'ahu|Kaua'i/);
    expect(dump).toContain('Oʻahu');
    expect(dump).toContain('Kauaʻi');
  });

  test('a picture keeps its name: kahakō fold, ʻokina goes', async ({ page }) => {
    const posted = [];
    await page.route('**/__upload', route => {
      const b = JSON.parse(route.request().postData()); posted.push(b.name);
      route.fulfill({ json: { ok: true, src: 'assets/' + b.name, path: 'x/' + b.name } });
    });
    await page.evaluate(async () => {
      const f = new File([new Uint8Array([1, 2, 3])], 'Hōkūleʻa Voyage.JPG', { type: 'image/jpeg' });
      await uploadImageBlob(f, () => {});
    });
    expect(posted).toEqual(['hokulea-voyage.jpg']);
  });

  test('a second picture with a name the report already uses does not overwrite the first', async ({ page }) => {
    const posted = [];
    await page.route('**/__upload', route => {
      const b = JSON.parse(route.request().postData()); posted.push(b.name);
      route.fulfill({ json: { ok: true, src: 'assets/' + b.name, path: 'x/' + b.name } });
    });
    await page.evaluate(async () => {
      for (const bytes of [[1, 2, 3], [4, 5, 6]])
        await uploadImageBlob(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }), () => {});
    });
    expect(posted[0]).toBe('image.png');
    expect(posted[1]).toMatch(/^image-[0-9a-f]{8}\.png$/);
  });

  test('a swatch, a cell style and a section take a Hawaiian name as ASCII instead of refusing it', async ({ page }) => {
    const r = await page.evaluate(() => ({
      a: asciiName(" Ōhiʻa red "), b: asciiName("Hōkūleʻa"), f: foldHaw('Hawaiʻi ʻĀina'),
    }));
    expect(r).toEqual({ a: 'Ohia red', b: 'Hokulea', f: 'hawaii aina' });
  });
});

test.describe('verbs that answered ok over a draft the engine would not build', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('setChart with a series the engine refuses is rolled back, not ok', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const c = await docsync.api.addChart({ page: 3, x: 1, y: 5, w: 6, h: 3,
        chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }] } });
      const bad = await docsync.api.setChart('chart.' + c.id, { type: 'nonsense' });
      return { ok: bad.ok, err: bad.error || '', failed: renderFailed, stat: $('stat').textContent };
    });
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/would not build/);
    expect(r.failed).toBe(false);
    expect(r.stat).not.toMatch(/does not build/);
  });

  test('setStyle with a size or a colour the engine refuses is rolled back, not ok', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const t = await docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: 'hello' });
      const a = await docsync.api.setStyle(t.id, { size: 'abc' });
      const b = await docsync.api.setStyle(t.id, { color: 'nope' });
      return { a: a.ok, b: b.ok, failed: renderFailed };
    });
    expect(r).toEqual({ a: false, b: false, failed: false });
  });

  test('setBoxText with a number says so instead of throwing', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const t = await docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 3, md: 'hello' });
      try { const x = await docsync.api.setBoxText(t.id, 5); return { ok: x.ok, err: x.error }; }
      catch (e) { return { threw: String(e) }; }
    });
    expect(r.threw).toBeUndefined();
    expect(r.ok).toBe(false);
  });

  test('addTable off the page is refused, as a chart and a shape are', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const t = await docsync.api.addTable({ page: 3, x: 50, y: 800, rows: [['a']] });
      return { ok: t.ok, err: t.error || '', n: (layout.tables || []).length };
    });
    expect(r.ok).toBe(false);
    expect(r.err).toMatch(/off the page/);
    expect(r.n).toBe(0);
  });
});

test.describe('tables', () => {
  test('deleting a header row takes one off the header count; a body row does not become a header', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(async () => {
      const { id } = await docsync.api.addTable({ page: 3, x: 1, y: 1, w: 6, headerRows: 2, footerRows: 1,
        rows: [['h1', 'h1'], ['h2', 'h2'], ['b', 'b'], ['f', 'f']] });
      const t = tables().find(x => 'table.' + x.id === id);
      const out = { before: [t.headerRows, t.footerRows] };
      tableDeleteRow(t, 0); out.afterHeader = [t.headerRows, t.footerRows, t.rows.length];
      tableDeleteRow(t, t.rows.length - 1); out.afterFooter = [t.headerRows, t.footerRows ?? 0, t.rows.length];
      tableDeleteRow(t, 1); out.afterBody = [t.headerRows, t.footerRows ?? 0, t.rows.length];
      return out;
    });
    expect(r.before).toEqual([2, 1]);
    expect(r.afterHeader).toEqual([1, 1, 3]);
    expect(r.afterFooter).toEqual([1, 0, 2]);
    expect(r.afterBody[0]).toBe(1);
  });
});

test.describe('image replacement', () => {
  test('Replace image starts uncropped: the crop framed the old picture', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(async () => {
      pushHistory();
      layout.img = layout.img || {};
      layout.img['onetime.photo'] = { src: 'assets/hb2296-signing.jpg', crop: { imgW: 9, dx: 1, dy: 1 } };
      markDirty(); await render();
    });
    await settled(page);
    await page.evaluate(() => {
      const el = $('out').contentDocument.querySelector('[data-el="onetime.photo"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: $('out').contentWindow,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 }));
    });
    const chooser = page.waitForEvent('filechooser');
    await frameOf(page).locator('.ds-menu button', { hasText: 'Replace image' }).click();
    (await chooser).setFiles(PIXEL);
    await expect.poll(() => page.evaluate(() => (layout.img['onetime.photo'] || {}).src)).toMatch(/spec-pixel/);
    const g = await page.evaluate(() => layout.img['onetime.photo']);
    expect(g.crop).toBeUndefined();
  });
});

test.describe('keyboard and screen readers', () => {
  test('the status line is a polite live region', async ({ page }) => {
    await gotoEditor(page);
    await expect(page.locator('#stat')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#stat')).toHaveAttribute('role', 'status');
  });

  test('⌥] goes on to the next page after the last object of this one, and ⌥[ comes back', async ({ page }) => {
    await gotoEditor(page);
    const pageOf = () => page.evaluate(() => {
      const d = $('out').contentDocument; const id = [...selIds][0];
      const el = d.querySelector(`[data-el="${CSS.escape(id)}"], [data-shape="${CSS.escape(id)}"]`);
      return { id, page: el && el.closest('section.page').dataset.page };
    });
    await page.evaluate(() => $('out').contentWindow.focus());
    const seen = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Alt+BracketRight'); seen.push(await pageOf()); }
    expect(new Set(seen.map(s => s.page)).size).toBeGreaterThan(1);
    const here = seen[seen.length - 1];
    await page.keyboard.press('Alt+BracketLeft');
    const back = await pageOf();
    expect(back.id).not.toBe(here.id);
  });

  test('Escape closes the File menu and puts focus back on the File button', async ({ page }) => {
    await gotoEditor(page);
    await page.focus('#file');
    await page.keyboard.press('Enter');
    await expect(page.locator('#filepop')).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('#filepop') !== null)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#filepop')).toBeHidden();
    expect(await page.evaluate(() => document.activeElement.id)).toBe('file');
  });
});

test.describe('a phone', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  test('Bold, Italic and Underline lead the type strip rather than sitting four swipes along it', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { $('out').contentDocument.querySelectorAll('.page')[1].scrollIntoView(); });
    await settled(page);
    const slot = frameOf(page).locator('.page').nth(1).locator('[data-slot]').first();
    const b = await slot.boundingBox();
    await page.touchscreen.tap(b.x + 20, b.y + 10);
    await expect(page.locator('#ty-mb')).toBeVisible();
    const left = await page.evaluate(() => document.getElementById('ty-mb').getBoundingClientRect().left);
    expect(left).toBeLessThan(375);
  });
});

test.describe('a pageless report', () => {
  test('place() cannot bury a box 175 inches below the end of the sheet', async ({ page }) => {
    await gotoEditor(page, '?project=our-mission');
    const r = await page.evaluate(async () => {
      const a = await docsync.api.addTextBox({ page: 1, x: 1, y: 5, w: 3, md: 'low' });
      const p = await docsync.api.place(a.id, { y: 5000 });
      const sheet = $('out').contentDocument.querySelector('section.page').getBoundingClientRect().height / 96;
      return { y: p.box.y, sheet };
    });
    expect(r.y).toBeLessThan(r.sheet);
  });
});

test.describe('forgetting a report with the server gone', () => {
  test('says the server is not answering, not a parser error', async ({ page, context }) => {
    await context.route('**/projects.json*', r => r.fulfill({ json: {
      'budget-primer': { name: 'Budget Primer', base: '' }, 'zz-other': { name: 'Other Report', base: '' } } }));
    await context.route('**/__forget', route => route.abort());
    await gotoEditor(page);
    await openFileMenu(page);
    await page.click('#file-open');
    await page.locator('#open-list .open-forget[data-forget="zz-other"]').click();
    await submitDialog(page);
    await expect(page.locator('#stat')).toContainText(/not answering|live server/);
    await expect(page.locator('#stat')).not.toContainText('Failed to fetch');
  });
});

test.describe('the export package and a font host that never answers', () => {
  test('the Google Fonts stylesheet times out and stays a link instead of hanging the export', async ({ page, context }) => {
    await gotoEditor(page);
    await context.route('**/fonts.googleapis.com/**', () => { /* never answers */ });
    const r = await page.evaluate(async () => {
      FONT_FETCH_MS = 400;
      const doc = new DOMParser().parseFromString(
        '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope"></head><body></body></html>', 'text/html');
      const res = { fonts: [], fontsLinked: [] };
      const t = performance.now();
      await inlineWebFonts(doc, res);
      return { ms: Math.round(performance.now() - t), linked: res.fontsLinked.length, link: !!doc.querySelector('link') };
    });
    expect(r.linked).toBe(1);
    expect(r.link).toBe(true);
    expect(r.ms).toBeLessThan(5000);
  });
});
