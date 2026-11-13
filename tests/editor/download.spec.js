// Download / export (docsync/editor/edit.html): $('download') opens a
// popover with PDF/PNG choices; doExport() posts to /__export in local mode
// (mocked by the shared fixture — see STANDALONE.md §C, this never spawns the
// real headless-Chrome PDF/PNG renderer in tests) or falls back to the
// browser's own print() for PDF-only when there's no local server.
const { test, staticTest, expect, gotoEditor, openFileMenu } = require('./fixtures/editor-test');

/** The exported file is named after the report as a PERSON knows it, which
 *  comes from the registry — and projects.json is per-machine, so a test that
 *  reads whatever this computer happens to have is asserting the computer.
 *  Serve one the test owns instead. */
async function withNamedProject(context, name) {
  await context.route('**/projects.json*', route => route.fulfill({
    json: { 'budget-primer': { name, base: '' } },
  }));
}

test.describe('download: local mode (server-rendered PDF/PNG via /__export)', () => {
  test.beforeEach(async ({ page, context }) => {
    await withNamedProject(context, 'Budget Primer FY2026–27');
    await gotoEditor(page);
  });

  test('the popover offers PNG (and bleed marks) only when a local server is present', async ({ page }) => {
    await openFileMenu(page);
    await page.click('#download');
    await expect(page.locator('#downloadpop')).toBeVisible();
    await expect(page.locator('#dl-png')).toBeEnabled();
    await expect(page.locator('#dl-marks')).toBeEnabled();
  });

  test('PDF downloads a file named for the report', async ({ page }) => {
    await openFileMenu(page);
    await page.click('#download');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#dl-pdf'),
    ]);
    expect(download.suggestedFilename()).toBe('Budget-Primer-FY2026-27.pdf');
    await expect(page.locator('#stat')).toContainText('downloaded Budget-Primer-FY2026-27.pdf');
  });

  test('PNG downloads a per-page zip', async ({ page }) => {
    await openFileMenu(page);
    await page.click('#download');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#dl-png'),
    ]);
    // The SAME basename as the PDF — this expected a shorter one, from back
    // when the registry name was shorter, so the two tests disagreed about
    // what one report is called.
    expect(download.suggestedFilename()).toBe('Budget-Primer-FY2026-27-pages.zip');
    await expect(page.locator('#stat')).toContainText('downloaded Budget-Primer-FY2026-27-pages.zip');
  });
});

test.describe('download: source zip (fflate, client-side)', () => {
  test('bundles content.md + layout.json into a zip named for the project', async ({ page }) => {
    await gotoEditor(page);
    await openFileMenu(page);
    await page.click('#download');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#dl-src'),
    ]);
    expect(download.suggestedFilename()).toBe('budget-primer-source.zip');
    await expect(page.locator('#stat')).toContainText('downloaded budget-primer-source.zip');

    // Read the downloaded bytes and confirm it's a real zip carrying both
    // authored files — fflate wrote a genuine archive, not an empty stub.
    const fs = require('fs');
    const path = await download.path();
    const buf = fs.readFileSync(path);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');   // zip local-file signature
    const asText = buf.toString('latin1');
    expect(asText).toContain('content.md');
    expect(asText).toContain('layout.json');
  });
});

staticTest.describe('download: static mode (no local server)', () => {
  staticTest.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  staticTest('PNG and bleed marks are disabled, with a tooltip explaining why', async ({ page }) => {
    await openFileMenu(page);
    await page.click('#download');
    await expect(page.locator('#dl-png')).toBeDisabled();
    await expect(page.locator('#dl-png')).toHaveAttribute('title', /local live server/);
    await expect(page.locator('#dl-marks')).toBeDisabled();
  });

  // The hub and a static copy have no server to print for them. This used to
  // call print() on the report: a print dialog, nothing saved, and an
  // automated browser frozen on it. A PDF is now made in the page (every sheet
  // drawn to a picture, the words laid over it as invisible text).
  /** The objects of a PDF by number, read through its own cross-reference
   *  table, so a wrong offset anywhere fails here instead of in a viewer. */
  const readPdf = buf => {
    const txt = buf.toString('latin1');
    const start = +/startxref\n(\d+)\n%%EOF\n$/.exec(txt)[1];
    const m = /^xref\n0 (\d+)\n/.exec(txt.slice(start));
    const n = +m[1], rows = txt.slice(start + m[0].length).split('\n').slice(1, n);   // row 0 is the free entry
    rows.forEach((row, i) => {
      expect(row).toMatch(/^\d{10} 00000 n $/);
      expect(txt.slice(+row.slice(0, 10)).startsWith(`${i + 1} 0 obj\n`)).toBe(true);
    });
    return txt;
  };
  const pageBoxes = txt => [...txt.matchAll(/\/Type \/Page \/Parent[^\n]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [+m[1], +m[2]]);

  staticTest('PDF is a real file from one click: no print dialog, no /__export', async ({ page }) => {
    staticTest.setTimeout(120000);
    let exportCalled = false;
    await page.route('**/__export', route => { exportCalled = true; route.continue(); });
    await page.evaluate(() => {
      const hit = () => { window.__printed = true; };
      window.print = hit;
      document.getElementById('out').contentWindow.print = hit;
    });
    await openFileMenu(page);
    await page.click('#download');
    await page.fill('#dl-pages', '1-2');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl-pdf')]);
    expect(download.suggestedFilename()).toMatch(/-p1-2\.pdf$/);
    await expect(page.locator('#stat')).toContainText('2 pages');
    const buf = require('fs').readFileSync(await download.path());
    expect(buf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.5');
    const txt = readPdf(buf);
    expect(pageBoxes(txt)).toEqual([[612, 792], [612, 792]]);          // letter, in points
    expect(txt).toContain('/Subtype /Link');                            // the cover's link survived
    expect(txt).toContain('/ToUnicode');
    expect(await page.evaluate(() => window.__printed)).toBeFalsy();
    expect(exportCalled).toBe(false);
    await expect(page.locator('#out')).toBeVisible();                   // the editor is still there
  });

  staticTest('the PDF pages field is honoured: "3" is one page, "1,4-6" is four', async ({ page }) => {
    staticTest.setTimeout(180000);
    const pdf = async spec => {
      await openFileMenu(page);
      await page.click('#download');
      await page.fill('#dl-pages', spec);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl-pdf')]);
      return readPdf(require('fs').readFileSync(await download.path()));
    };
    expect(pageBoxes(await pdf('3')).length).toBe(1);
    expect(pageBoxes(await pdf('1,4-6')).length).toBe(4);
    await openFileMenu(page);
    await page.click('#download');
    await page.fill('#dl-pages', '99');
    await page.click('#dl-pdf');
    await expect(page.locator('#stat')).toContainText('the report has');   // refused before any drawing
  });

  staticTest('inlineCssUrls leaves a #fragment written as %23 inside a data: URI alone (no false "could not be fetched")', async ({ page }) => {
    const missed = await page.evaluate(async () => {
      const css = `.n{background:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'/><rect filter='url(%23n)'/></svg>")}`;
      const m = [];
      await inlineCssUrls(css, m);
      return m;
    });
    expect(missed).toEqual([]);
  });

  staticTest('buildPdf: the words copy out with their okina and kahako, and the file is well formed', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // A 1x1 JPEG; the words are what is under test.
      const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), c => c.charCodeAt(0));
      const blob = buildPdf([{ w: 96, h: 96, iw: 1, ih: 1, jpeg,
        words: [{ x: 4, y: 4, w: 60, h: 14, t: 'Hawai\u02bbi' }, { x: 4, y: 24, w: 40, h: 14, t: 'k\u0101ne' }],
        links: [{ x: 4, y: 4, w: 60, h: 14, url: 'https://example.org/a(b)' }] }], 'Hawai\u02bbi report');
      return new TextDecoder('latin1').decode(await blob.arrayBuffer());
    });
    expect(r).toMatch(/<02bb>|02bb/);                    // the okina is in the ToUnicode table
    expect(r).toContain('0101');                         // and the macron a
    expect(r).toContain('/URI (https://example.org/a\\(b\\))');
    expect(r).toContain('<FEFF00480061');                // title as UTF-16
    readPdf(Buffer.from(r, 'latin1'));
  });
});
