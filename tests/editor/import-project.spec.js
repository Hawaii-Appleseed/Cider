// Scaffolding an IMPORTED project (docs/primer/start.html placedTemplate /
// manifestTemplate). An import brings its own page size (the
// source page's measured height), its own layout.json full of traced objects,
// and a renderer that draws placed objects rather than flowing prose — the
// scaffold's normal renderer would draw none of it.
const { warmTest: test, expect } = require('./fixtures/editor-test');

test.describe('imported project scaffold', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('start.html');
    await page.waitForFunction(() => typeof placedTemplate === 'function');
  });

  test('the placed renderer draws layout.json, not prose', async ({ page }) => {
    const py = await page.evaluate(() => placedTemplate(12.5, 23.786));
    // The three calls that ARE a placed document.
    expect(py).toContain('L.layer(pid)');
    expect(py).toContain('L.text_boxes(pid)');
    expect(py).toContain('L.tables_html(pid)');
    expect(py).toContain('from docsync.layout import Layout');
    // The measured page size is baked in, not read back from a manifest.
    expect(py).toContain('page=(12.5, 23.786)');
    expect(py).toContain('width:12.5in');
    expect(py).toContain('min-height:23.786in');
    // Absolutely-placed children need their page to be the containing block.
    expect(py).toContain('position:relative');
    // It must NOT be the prose scaffold.
    expect(py).not.toContain('C.extras(');
  });

  test('the manifest names layout.json only for a placed project', async ({ page }) => {
    const [placed, prose] = await page.evaluate(() => [
      JSON.parse(manifestTemplate('demo', 'o/r', { w: 12.5, h: 23.8 }, true)),
      JSON.parse(manifestTemplate('demo', 'o/r', { w: 8.5, h: 11 }, false)),
    ]);
    // Without this the renderer boots with nothing to draw.
    expect(placed.layout).toBe('projects/demo/layout.json');
    expect(Object.keys(placed.files)).toContain('engine/projects/demo/layout.json');
    expect(placed.page).toEqual({ w: 12.5, h: 23.8 });

    expect(prose.layout).toBeNull();
    expect(Object.keys(prose.files).some(k => k.includes('layout.json'))).toBe(false);
  });

  test('the manifest carries a deploy branch — its own, or main by default', async ({ page }) => {
    const [dflt, custom] = await page.evaluate(() => [
      JSON.parse(manifestTemplate('demo', 'o/r', { w: 8.5, h: 11 }, false)),
      JSON.parse(manifestTemplate('demo', 'o/r', { w: 8.5, h: 11 }, false, 'production')),
    ]);
    // Absent = main, so a project that never asked keeps publishing where it
    // always did; present = whatever the repo actually deploys from.
    expect(dflt.branch).toBe('main');
    expect(custom.branch).toBe('production');
  });
});
