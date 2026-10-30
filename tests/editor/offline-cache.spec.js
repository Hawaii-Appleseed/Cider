// Offline draft cache (docsync/editor/edit.html): unsaved edits are autosaved
// to IndexedDB via idb-keyval (debounced, only when there is no local server)
// and auto-restored on the next boot, so a closed tab or a refresh does not
// lose work. Static mode — page.reload() keeps the same origin, so the same
// IndexedDB survives the reload.
const { staticTest: test, expect, gotoEditor, waitForFirstRender,
        fillDialog, submitDialog, PING, clickAddSection } = require('./fixtures/editor-test');

async function addSection(page, slug) {
  await clickAddSection(page);
  await fillDialog(page, { page: 'basics', slug });
  await submitDialog(page);
  await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
}

test.describe('offline draft cache', () => {
  test('an unsaved section survives a reload and is auto-restored', async ({ page }) => {
    await gotoEditor(page);
    await addSection(page, 'cache-survivor');
    const key = 'extra.basics.cache-survivor';
    await expect(page.frameLocator('#out').locator(`[data-slot="${key}"]`)).toHaveCount(1);

    // Let the debounced (800ms) autosave land in IndexedDB before reloading.
    await page.waitForTimeout(1200);
    await page.reload();
    await waitForFirstRender(page);

    // The unsaved section is back — restored from IndexedDB (a static
    // viewer has nowhere to save it).
    await expect(page.frameLocator('#out').locator(`[data-slot="${key}"]`)).toHaveCount(1);
    await expect(page.locator('#stat')).toContainText('restored unsaved edits');
  });

  test('the cache does not fire in local mode (files on disk are the truth)', async ({ page, context }) => {
    // Undo the static fixture's /__ping block for this one test so the app runs
    // in local mode, then confirm nothing was written to the cache.
    await context.unroute(PING);
    await gotoEditor(page);
    await addSection(page, 'local-no-cache');
    await page.waitForTimeout(1200);

    const cached = await page.evaluate(async () => {
      try {
        const { get } = await import('https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/dist/index.js');
        return (await get('draft-cache:budget-primer')) || null;
      } catch (e) { return 'import-failed'; }
    });
    expect(cached).toBeNull();
  });
});
