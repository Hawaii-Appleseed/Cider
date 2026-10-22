// Insert image (#ar-img in the arrange strip). One flow: the upload posts
// /__upload to the dev server in local mode (no GitHub token), which writes
// the file into the BINDING's own assets dir on disk; the image is then
// placed as a floating box whose markdown is just the image, so it moves,
// resizes and layers like any placed thing and persists through layout.json.
//
// The endpoint itself is MOCKED here (fixtures/editor-test.js) for the same
// reason __save/__push are: the default project's binding roots in a real
// checkout on this machine. The mock honours the real response contract, so
// everything editor-side — payload, box, preview, markdown path, movability
// — is exercised for real; the server's disk write is serve.py's _upload,
// small enough to read.
const path = require('path');
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const PIXEL = path.join(__dirname, 'fixtures', 'spec-pixel.png');

test.describe('insert image', () => {
  test('button is present and enabled with nothing selected', async ({ page }) => {
    await gotoEditor(page);
    await expect(page.locator('#ar-img')).toBeVisible();
    await expect(page.locator('#ar-img')).toBeEnabled();
  });

  test('uploads and places a movable image box', async ({ page }) => {
    await gotoEditor(page);
    const uploaded = page.waitForRequest('**/__upload');
    // Insert Image has TWO legitimate flows (edit.html's #ar-img handler):
    // a project whose staged manifest bundles images opens the #imgpop
    // picker, where "Upload from computer…" reaches the file dialog; one
    // with nothing bundled goes straight to the dialog. Which one this
    // fixture gets has proven environment-dependent (the picker locally,
    // the direct dialog on the CI runner), and every earlier shape of this
    // spec hard-coded one flow and timed out 90s in the other. So: take
    // whichever the app offers, as one retried unit that must end with the
    // chooser in hand.
    let chooser;
    await expect(async () => {
      const c = page.waitForEvent('filechooser', { timeout: 3000 })
        .catch(() => null);
      const pop = page.locator('#imgpop');
      if (!(await pop.isVisible())) await page.click('#ar-img');
      const picker = await pop.waitFor({ state: 'visible', timeout: 700 })
        .then(() => true).catch(() => false);
      if (picker) await page.click('#img-upload', { timeout: 2000 });
      chooser = await c;
      if (!chooser) throw new Error('file chooser did not open');
    }).toPass();
    await chooser.setFiles(PIXEL);
    // the editor posted real image bytes with the sanitised name
    const req = JSON.parse((await uploaded).postData());
    expect(req.name).toBe('spec-pixel.png');
    expect(req.data.length).toBeGreaterThan(20);          // base64 payload
    // the box appears once the upload lands and render() returns
    const img = page.frameLocator('#out').locator('[data-el^="text."] img.inline-img');
    await expect(img).toBeVisible({ timeout: 20000 });
    // its markdown is the image at the path the server answered with,
    // stored in layout.json like any box — that is the persistence hook
    const box = await page.evaluate(() =>
      (layout.boxes || []).find(b => /^!\[/.test(b.md)));
    expect(box.md).toMatch(/^!\[.*\]\(assets\/spec-pixel\.png\)$/);
    // movable: drag it and the stored position follows. Two fixture-hygiene
    // steps first: settle the insert's own iframe swap (same race gotoEditor
    // settles after boot), and lift the box above the cover's logo — the
    // default drop spot overlaps it, and the topmost element takes the grab.
    await page.evaluate(id => {
      layout.boxes.find(b => b.id === id).z = 99;
      return render();
    }, box.id);
    await settled(page);
    const el = page.frameLocator('#out')
      .locator(`[data-el="text.${box.id}"]`);
    const b0 = await el.boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 + 80, b0.y + b0.height / 2 + 50, { steps: 4 });
    await page.mouse.up();
    const moved = await page.evaluate(id =>
      (layout.boxes || []).find(b => b.id === id), box.id);
    expect(moved.x).toBeGreaterThan(box.x + 0.3);
  });

  // Two bugs shared this shape, both fixed in togglePop()/#leftrail CSS and
  // guarded here at a height where the picker MUST overlap the page strip:
  //  - #leftrail's z-index:2 stacking context trapped the popover's
  //    z-index:1000 under the strip (z-index:6), which intercepted the click
  //    on "Upload from computer…" whenever the two overlapped — CI's font
  //    metrics hit that band at the default 720px window on every run.
  //  - with no viewport clamp a tall picker's bottom rows simply left the
  //    screen on a short window, unreachable by scroll or anything else.
  test('the picker stays reachable and clickable on a short window', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await gotoEditor(page);
    await page.click('#ar-img');
    await page.locator('#imgpop').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.click('#img-upload', { timeout: 5000 });
    await chooser;
  });
});
