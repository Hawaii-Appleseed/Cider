// File ▸ Publish as a website… (docsync/website.py). The choice is a
// {site, slug, home} record in layout.json — so these tests check the record,
// the dialog's guard on the address, undo, the "stop" row, and that the hub's
// Publish treats a chosen website like a publish: block (siteOf). Building and
// publishing the page itself is docsync/test_docsync.py's.
// affected-by: docsync/editor/edit.html docsync/stage.py docsync/website.py docsync.yml
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const dlg = page => page.locator('dialog[open]');

test.describe('publish as a website', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('the File menu offers it when the repository lists a site', async ({ page }) => {
    const sites = await page.evaluate(() => M.sites);
    expect(Object.keys(sites)).toContain('reports');
    await page.click('#file');
    await expect(page.locator('#file-website')).toBeVisible();
    await expect(page.locator('#file-website-off')).toBeHidden();
  });

  test('choosing writes the record, names the address, and undoes', async ({ page }) => {
    await page.click('#file');
    await page.click('#file-website');
    const slug = dlg(page).locator('input[name="slug"]');
    await slug.fill('Not An Address');
    await dlg(page).locator('.dsdlg-ok').click();
    await expect(dlg(page).locator('.dsdlg-err')).toContainText('lowercase');
    await slug.fill('budget-primer-2027');
    await dlg(page).locator('.dsdlg-ok').click();
    await expect(dlg(page).locator('.dsdlg-msg')).toContainText('https://hawaii-appleseed.github.io/reports/budget-primer-2027/');
    await dlg(page).locator('.dsdlg-ok').click();
    const after = await page.evaluate(() => ({ w: layout.website, url: siteOf() && siteOf().url, dirty }));
    expect(after.w).toEqual({ site: 'reports', slug: 'budget-primer-2027', home: 'local' });
    expect(after.url).toBe('https://hawaii-appleseed.github.io/reports/budget-primer-2027/');
    expect(after.dirty).toBe(true);
    await expect(page.locator('#stat')).toContainText('Save to put it live');

    await page.click('#file');
    await expect(page.locator('#file-website')).toContainText('Website: https://hawaii-appleseed.github.io/reports/budget-primer-2027/');
    await expect(page.locator('#file-website-off')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => undo());
    expect(await page.evaluate(() => layout.website || null)).toBeNull();
  });

  test('cancelling the confirm leaves the page alone', async ({ page }) => {
    await page.click('#file');
    await page.click('#file-website');
    await dlg(page).locator('.dsdlg-ok').click();              // the default address
    await dlg(page).locator('.dsdlg-cancel').click();
    expect(await page.evaluate(() => layout.website || null)).toBeNull();
  });

  test('stop publishing removes the record', async ({ page }) => {
    await page.evaluate(async () => { layout.website = { site: 'reports', slug: 'x-page', home: 'local' }; await render(); });
    await page.click('#file');
    await page.click('#file-website-off');
    await expect(dlg(page).locator('.dsdlg-msg')).toContainText('https://hawaii-appleseed.github.io/reports/x-page/');
    await dlg(page).locator('.dsdlg-ok').click();
    expect(await page.evaluate(() => layout.website || null)).toBeNull();
  });

  test("the hub's Publish confirm names a chosen website like a publish: block", async ({ page }) => {
    const text = await page.evaluate(async () => {
      const real = { confirm: window.dsConfirm, version: docVersion, wasDirty: dirty };
      const asked = [];
      window.dsConfirm = async t => { asked.push(t); return false; };
      docVersion = 'v1'; dirty = false;
      layout.website = { site: 'reports', slug: 'x-page', home: 'hub' };
      await docStorePublish();
      delete layout.website;
      window.dsConfirm = real.confirm; docVersion = real.version; dirty = real.wasDirty;
      return asked[0];
    });
    expect(text).toContain('The public page (https://hawaii-appleseed.github.io/reports/x-page/) is then rebuilt from it.');
  });
});
