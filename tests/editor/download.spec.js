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

  staticTest('PDF falls back to the browser\'s own print(), never calling /__export', async ({ page }) => {
    let exportCalled = false;
    await page.route('**/__export', route => { exportCalled = true; route.continue(); });

    // doExport('pdf') calls $('out').contentWindow.print() directly — stub it
    // on the iframe's own window so the test can observe the call without a
    // real (blocking, OS-level) print dialog.
    await page.evaluate(() => {
      document.getElementById('out').contentWindow.print = () => {
        document.getElementById('out').contentWindow.__printed = true;
      };
    });

    await openFileMenu(page);
    await page.click('#download');
    await page.click('#dl-pdf');
    await expect.poll(() => page.evaluate(() =>
      document.getElementById('out').contentWindow.__printed)).toBe(true);
    expect(exportCalled).toBe(false);
  });
});
