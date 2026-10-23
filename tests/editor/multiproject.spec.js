// Multi-project registry (docsync/editor/edit.html): loadRegistry() reads
// projects.json beside the editor — one editor, any number of reports.
//
// Switching used to be a <select> in the toolbar. It is File > Open now: a
// second control doing the same job, in a place that had to explain itself,
// was one too many once the menu existed. These tests moved with it.
const { test, expect, gotoEditor, fillDialog, submitDialog, cancelDialog,
        clickAddSection, openFileMenu } = require('./fixtures/editor-test');

/** Open File > Open and return the list of reports it offers. */
async function openList(page) {
  await openFileMenu(page);
  await page.click('#file-open');
  await page.locator('#openpop').waitFor({ state: 'visible' });
  return page.locator('#open-list button[data-open]');
}

async function withTwoProjectRegistry(context) {
  // Serve a registry this test OWNS rather than editing whatever is on disk.
  // projects.json is per-machine and untracked now, so on one computer it
  // lists several reports, on another it is absent entirely and the server
  // falls back to every binding in docsync.yml — either way "exactly these
  // two ids" was at the mercy of the machine, which is what made these four
  // fail here while passing in CI. Both entries point at the SAME engine/
  // (base: ''), because the switching mechanism is what is under test, not a
  // second real report's content.
  // get()'s cache-buster appends ?cb=<timestamp> — match that suffix too.
  await context.route('**/projects.json*', route => route.fulfill({
    json: {
      'budget-primer': { name: 'Budget Primer', base: '' },
      'second-report': { name: 'Second Report', base: '' },
    },
  }));
}

test.describe('multi-project registry', () => {
  test.beforeEach(async ({ context }) => {
    await withTwoProjectRegistry(context);
  });

  test('every registered report is offered, and the open one is marked', async ({ page }) => {
    await gotoEditor(page);
    const items = await openList(page);
    const ids = await items.evaluateAll(bs => bs.map(b => b.dataset.open).sort());
    expect(ids).toEqual(['budget-primer', 'second-report']);
    await expect(page.locator('#open-list button[aria-current="true"]'))
      .toHaveAttribute('data-open', 'budget-primer');
  });

  test('switching projects navigates with ?project= and the picker reflects it', async ({ page }) => {
    // Switching reloads the page, which boots Pyodide (~30MB) a SECOND time in
    // one test — the default budget cannot cover two cold boots.
    test.setTimeout(180_000);
    await gotoEditor(page);
    (await openList(page)).filter({ has: page.locator('[data-open]') });
    await page.click('#open-list button[data-open="second-report"]');
    // 'commit' — the assertion is about the URL the switch navigates to; make
    // it wait on the navigation itself rather than on the whole load, then
    // wait for the render separately with its own generous budget.
    await page.waitForURL(/[?&]project=second-report/, { waitUntil: 'commit' });
    await page.frameLocator('#out').locator('.page').first()
      .waitFor({ state: 'visible', timeout: 90_000 });

    expect(new URL(page.url()).searchParams.get('project')).toBe('second-report');
    const items = await openList(page);
    await expect(page.locator('#open-list button[aria-current="true"]'))
      .toHaveAttribute('data-open', 'second-report');
    expect(await items.count()).toBe(2);
  });

  test('an unknown ?project= falls back to the default engine, not an error', async ({ page }) => {
    await gotoEditor(page, '?project=does-not-exist');
    await openList(page);
    await expect(page.locator('#open-list button[aria-current="true"]'))
      .toHaveAttribute('data-open', 'budget-primer');
    await expect(page.locator('#title')).toContainText('budget-primer');
  });

  test('switching with unsaved edits asks for confirmation first', async ({ page }) => {
    await gotoEditor(page);
    // Make a real edit so dirty=true — reuse the +Section flow (already proven
    // in sections.spec.js) via its <dialog> form.
    await clickAddSection(page);
    await fillDialog(page, { page: 'basics', slug: 'mp-test-section' });
    await submitDialog(page);
    await page.frameLocator('#out').locator('.ds-edit').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page.locator('#undo')).toBeEnabled();   // confirms the edit landed, dirty=true

    const urlBefore = page.url();
    await openList(page);
    await page.click('#open-list button[data-open="second-report"]');
    await cancelDialog(page);   // decline the "Open ...? Unsaved edits are lost" confirm
    await page.waitForTimeout(500);   // give a (wrongly) accepted navigation a chance to happen

    expect(page.url()).toBe(urlBefore);   // declined -> no navigation
  });
});

// Regression: a freshly opened report reported UNSAVED EDITS. The editor fills
// in empty containers on load (positions/shapes/sections) so the rest of the
// code need not null-check them, and markDirty compared the raw object against
// the file — so their appearance read as a change. Save sat lit with nothing
// to save, and switching project warned about losing edits that did not exist,
// which is what wedged the switch test above: the confirm dialog opened and no
// navigation ever happened.
test('a freshly opened report is not dirty', async ({ page }) => {
  await gotoEditor(page);
  expect(await page.evaluate(() => dirty)).toBe(false);
  await expect(page.locator('#save')).toBeDisabled();

  // A real edit still registers...
  await page.evaluate(() => {
    layout.shapes.push({ id: 'zz', page: 3, kind: 'rect', x: 1, y: 1, w: 1, h: 1 });
    markDirty();
  });
  expect(await page.evaluate(() => dirty)).toBe(true);

  // ...and so does genuinely emptying a container the file had content in.
  await page.evaluate(() => {
    layoutOrig = JSON.stringify({ shapes: [{ id: 'was-here' }] });
    layout.shapes = [];
    markDirty();
  });
  expect(await page.evaluate(() => dirty)).toBe(true);
});

// Regression, and the second home of the same bug: _pull() decides whether a
// disk change collides with your unsaved work. It compared layout RAW, so the
// empty containers the editor fills in on load counted as edits — and every
// change that landed on disk (a rebuild, a vendored engine) came back as
// "Claude changed the same thing you have unsaved" over an editor nobody had
// typed in. markDirty was fixed for this; this comparison was missed.
test('a disk change on an untouched editor is adopted, not reported as a clash', async ({ page }) => {
  await gotoEditor(page);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => dirty)).toBe(false);

  // _pull's own test for "the person has unsaved work here".
  const mineChanged = () => page.evaluate(() =>
    layoutSaid(layout) !== layoutSaid(JSON.parse(layoutOrig || '{}')));
  expect(await mineChanged()).toBe(false);          // nothing typed -> no clash

  await page.evaluate(() => {
    layout.shapes.push({ id: 'clash-probe', page: 3, kind: 'rect', x: 1, y: 1, w: 1, h: 1 });
    markDirty();
  });
  expect(await mineChanged()).toBe(true);           // real work -> still protected
});
