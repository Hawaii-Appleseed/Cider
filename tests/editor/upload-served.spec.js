// An image uploaded through /__upload is served at once, with no stage step.
//
// The editor's page resolves a picture's "assets/…" against its own staged
// folder (docs/<id>/), and only docsync.stage filled that, on the next build.
// The file picker hid the gap behind a local preview (localImages), but a
// picture placed any other way, such as the pilot's addTextBox with
// ![…](assets/…), which is how an agent lays out figures, drew as a broken
// image, and fitFrame answered "has no loaded picture to measure" until
// somebody ran `python3 -m docsync.stage --id <slug>` by hand (2026-11-09: the
// Wealth Tax report's four figures).
//
// The suite's /__upload is a mock that writes nothing (PRIMER_TEST_SAFE); the
// X-Primer-Test-Upload header lifts it for a project this spec scaffolded
// itself, as X-Primer-Test-Save does for /__save.
// affected-by: report2027/tools/serve.py
const { test, expect, gotoEditor } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-upload-now';
const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'spec-pixel.png'));

// One slug, scaffolded and removed by each test: in parallel they would
// delete each other's project mid-test.
test.describe.configure({ mode: 'serial' });

test.describe('an uploaded picture', () => {
  test.afterEach(() => {
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('is served at once, so a picture the pilot places shows and measures',
    async ({ page, request }) => {
    const j = await (await request.post('/__scaffold', { data: {
      name: 'Spec Upload Now', slug: SLUG, size: { w: 8.5, h: 11 } } })).json();
    expect(j.ok, j.error).toBe(true);

    const up = await (await request.post('/__upload', {
      headers: { 'X-Primer-Test-Upload': '1' },
      data: { project: SLUG, name: 'figure-1.png', data: PNG.toString('base64') },
    })).json();
    expect(up.ok, up.error).toBe(true);
    expect(up.src).toBe('assets/figure-1.png');
    // Kept in the project, where the next Save commits it ...
    expect(fs.existsSync(path.join(REPO, 'projects', SLUG, 'web', 'assets', 'figure-1.png')))
      .toBe(true);
    // ... and served where the editor's page resolves it, before any rebuild.
    const got = await request.get(`/${SLUG}/assets/figure-1.png`);
    expect(got.status()).toBe(200);
    expect(Buffer.compare(await got.body(), PNG)).toBe(0);

    // The pilot's way of placing it: a box holding the picture, then Fit
    // Frame, which needs the picture loaded to measure it.
    await gotoEditor(page, `?project=${SLUG}`);
    const box = await page.evaluate(() => docsync.api.addTextBox({
      page: 1, x: 1, y: 1, w: 2, md: '![A four-pixel test picture](assets/figure-1.png)' }));
    expect(box.ok, box.error).toBe(true);
    const img = page.frameLocator('#out').locator(`[data-el="${box.id}"] img`);
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth)).toBe(4);
    const fit = await page.evaluate(id => docsync.api.fitFrame(id), box.id);
    expect(fit.ok, fit.error).toBe(true);
  });

  test('a second upload under the same name replaces what is served', async ({ request }) => {
    const j = await (await request.post('/__scaffold', { data: {
      name: 'Spec Upload Now', slug: SLUG, size: { w: 8.5, h: 11 } } })).json();
    expect(j.ok, j.error).toBe(true);
    const send = data => request.post('/__upload', {
      headers: { 'X-Primer-Test-Upload': '1' },
      data: { project: SLUG, name: 'chart.png', data: data.toString('base64') },
    });
    expect((await (await send(PNG)).json()).ok).toBe(true);
    // Different bytes, same name: what the page fetches is the new file, not
    // a copy staged the first time.
    const other = Buffer.concat([PNG, Buffer.from('extra')]);
    expect((await (await send(other)).json()).ok).toBe(true);
    const got = await request.get(`/${SLUG}/assets/chart.png`);
    expect(got.status()).toBe(200);
    expect(Buffer.compare(await got.body(), other)).toBe(0);
  });
});
