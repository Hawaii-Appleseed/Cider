// Scaffolding an IMPORTED project (docs/primer/start.html placedTemplate /
// manifestTemplate / createProject). An import brings its own page size (the
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

  test('a staged import is what createProject builds from', async ({ page }) => {
    // Stand in for a real trace, then read back what createProject would
    // commit — without letting it reach the network.
    const built = await page.evaluate(async () => {
      sessionStorage.setItem('ds-import', JSON.stringify({
        name: 'src.html', title: 'Imported Page',
        layout: { boxes: [{ id: 'b1', page: 1, x: 1, y: 1, w: 3, md: 'hello' }],
                  shapes: [], tables: [], positions: {}, fill: {} },
        content: '[[title]]\nImported Page\n\n[[sources]]\n[x]: y — https://e.com\n',
        page: { w: 12.5, h: 23.786 },
        counts: { boxes: 1, shapes: 0, tables: 0, images: 1 },
      }));
      PENDING_ASSETS = [{ name: 'logo.png', b64: 'aGk=' }];

      // Capture the tree instead of pushing it.
      const seen = { blobs: 0, tree: null };
      window.gh = async (repo, path, opts) => {
        if (path === '') return { permissions: { push: true } };   // token can write
        if (path === 'git/ref/heads/main') return { object: { sha: 'base' } };
        if (path.startsWith('git/commits/')) return { tree: { sha: 't0' } };
        if (path === 'git/blobs') { seen.blobs++; return { sha: 'blob' + seen.blobs }; }
        if (path === 'git/trees') { seen.tree = JSON.parse(opts.body).tree; return { sha: 't1' }; }
        if (path === 'git/commits') return { sha: 'c1' };
        return {};
      };
      window.currentRepo = () => 'o/r';
      window.askToken = async () => true;
      await createProject('Imported Page', 'imported-page', 'letter');
      return { tree: seen.tree, blobs: seen.blobs,
               leftover: sessionStorage.getItem('ds-import'),
               pending: PENDING_ASSETS.length };
    });

    const paths = built.tree.map(t => t.path);
    // The traced objects reach BOTH the project and the staged copy the
    // editor loads before any draft exists.
    expect(paths).toContain('projects/imported-page/layout.json');
    expect(paths).toContain('docs/primer/projects/imported-page/engine/projects/imported-page/layout.json');

    // Images are bytes: a base64 blob first, then referenced by sha — a tree
    // entry's `content` is text only and would corrupt them.
    expect(built.blobs).toBe(1);
    const asset = built.tree.find(t => t.path.endsWith('web/assets/logo.png'));
    expect(asset).toBeTruthy();
    expect(asset.sha).toBe('blob1');
    expect(asset.content).toBeUndefined();
    expect(paths).toContain('docs/primer/projects/imported-page/assets/logo.png');

    // The renderer committed is the placed one, carrying the measured size.
    const rp = built.tree.find(t => t.path === 'projects/imported-page/tools/render_report.py');
    expect(rp.content).toContain('L.text_boxes(pid)');
    expect(rp.content).toContain('page=(12.5, 23.786)');

    // content.md is the import's own, not the "start writing here" stub.
    const md = built.tree.find(t => t.path === 'projects/imported-page/content.md');
    expect(md.content).toContain('Imported Page');
    expect(md.content).not.toContain('Start writing here');

    // The import is spent — a reload must not scaffold it twice.
    expect(built.leftover).toBeNull();
    expect(built.pending).toBe(0);
  });

  test('a tampered import is refused before any commit', async ({ page }) => {
    // sessionStorage sits between extractDoc() tracing a page and
    // createProject() committing it — this stands in for that gap being
    // abused (devtools, a future bug, anything) rather than a real trace.
    const result = await page.evaluate(async () => {
      sessionStorage.setItem('ds-import', JSON.stringify({
        name: 'src.html', title: 'Imported Page',
        layout: { boxes: [],
                  shapes: [{ id: 'g1', page: 1, kind: 'icon', x: 1, y: 1, w: 1, h: 1,
                             vb: '0 0 24 24', svg: '<path onclick="alert(1)"/>' }],
                  tables: [], positions: {}, fill: {} },
        content: '[[title]]\nImported Page\n\n[[sources]]\n[x]: y — https://e.com\n',
        page: { w: 8.5, h: 11 },
        counts: { boxes: 0, shapes: 1, tables: 0, images: 0 },
      }));
      let calls = 0;
      window.gh = async () => { calls++; return {}; };
      window.currentRepo = () => 'o/r';
      window.askToken = async () => true;
      let message = null;
      try { await createProject('Imported Page', 'imported-page', 'letter'); }
      catch (e) { message = e.message; }
      return { message, calls, leftover: sessionStorage.getItem('ds-import') };
    });

    expect(result.message).toMatch(/safety check/);
    // Rejected before askToken/gh ever ran — nothing was committed.
    expect(result.calls).toBe(0);
    // Not spent — the caller can show the error and let the person try again.
    expect(result.leftover).not.toBeNull();
  });
});
