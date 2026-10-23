// The export package's fonts and scripts (docsync/editor/edit.html
// exportPackage / inlineEverything / inlineWebFonts / inlineScripts).
//
// The package used to say "0 of 0 font files": Google Fonts stayed <link>s, so
// there was no @font-face to collect, and the "self-contained" HTML still
// loaded primer.js from beside it. Now the woff2 files are fetched (SIL OFL, so
// they may ship), embedded in the HTML as data: URIs and written to fonts/,
// primer.js is inlined, and if the fonts cannot be fetched the <link> stays and
// the package says so in the status line and the README.
// affected-by: docsync/editor/edit.html
const { warmTest: test, expect, gotoEditor, openFileMenu } = require('./fixtures/editor-test');

const FONT_CSS = `/* cyrillic */
@font-face { font-family: 'Libre Franklin'; font-style: normal; font-weight: 400;
  src: url(https://fonts.gstatic.com/s/x/cyr.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin */
@font-face { font-family: 'Libre Franklin'; font-style: normal; font-weight: 400;
  src: url(https://fonts.gstatic.com/s/x/lat.woff2) format('woff2'); unicode-range: U+0000-00FF; }
/* latin-ext */
@font-face { font-family: 'Libre Franklin'; font-style: normal; font-weight: 400;
  src: url(https://fonts.gstatic.com/s/x/ext.woff2) format('woff2'); unicode-range: U+0100-02BA; }
`;
const CORS = { 'access-control-allow-origin': '*' };

/** Run Package with /__export stubbed (the real one drives Chrome) and return
 *  what landed in the zip: file names, the HTML and README text, the status line. */
async function runPackage(page) {
  await page.evaluate(async () => {
    const { zipSync, strToU8 } = await fflateLib();
    window.exportBlob = async body => body.fmt === 'pdf'
      ? new Blob([strToU8('%PDF-1.4 stub')], { type: 'application/pdf' })
      : new Blob([zipSync({ '1.png': new Uint8Array([137, 80, 78, 71]) })], { type: 'application/zip' });
    window.__pkg = null;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        return fetch(this.href).then(r => r.arrayBuffer()).then(async b => {
          const { unzipSync, strFromU8 } = await fflateLib();
          const z = unzipSync(new Uint8Array(b));
          const name = Object.keys(z);
          const text = n => strFromU8(z[name.find(k => k.endsWith(n))]);
          window.__pkg = { name, html: text('.html'), readme: text('README.txt'),
                           sizes: Object.fromEntries(name.map(k => [k, z[k].length])) };
        });
      }
      return realClick.call(this);
    };
  });
  await openFileMenu(page);
  await page.click('#download');
  await page.click('#dl-pkg');
  await page.waitForFunction(() => window.__pkg !== null, null, { timeout: 90_000 });
  const pkg = await page.evaluate(() => window.__pkg);
  pkg.stat = await page.locator('#stat').textContent();
  return pkg;
}

test.describe('export package: fonts and scripts', () => {
  test('ships woff2 files, embeds them, and inlines primer.js', async ({ page, context }) => {
    await context.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status: 200, contentType: 'text/css', headers: CORS, body: FONT_CSS }));
    await context.route('https://fonts.gstatic.com/**', r =>
      r.fulfill({ status: 200, contentType: 'font/woff2', headers: CORS,
                  body: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 7)]) }));
    await gotoEditor(page);
    const pkg = await runPackage(page);

    // fonts/: the latin and latin-ext files and a stylesheet; no cyrillic.
    const fonts = pkg.name.filter(n => /^fonts\/.*\.woff2$/.test(n));
    expect(fonts.length).toBe(2);
    expect(fonts.some(n => /cyrillic/.test(n))).toBe(false);
    expect(pkg.name).toContain('fonts/fonts.css');
    expect(pkg.readme).toMatch(/2 of 2 font files included/);
    expect(pkg.readme).toMatch(/embedded in the HTML as woff2/);
    expect(pkg.stat).toMatch(/2 font files embedded/);
    expect(pkg.stat).not.toMatch(/LINKED/);

    // The HTML carries them itself: @font-face with data: URIs, no Google link,
    // no relative script.
    expect(pkg.html).not.toMatch(/<link[^>]+fonts\.googleapis\.com\/css/);
    expect(pkg.html).toMatch(/@font-face[^}]*url\(data:font\/woff2;base64,/);
    expect(pkg.html).not.toMatch(/<script[^>]+src="primer\.js"/);
    expect(pkg.html).toMatch(/<script>[\s\S]{200,}<\/script>\s*<\/body>/);
  });

  test('falls back to the <link> when the fonts cannot be fetched, and says so', async ({ page, context }) => {
    await context.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status: 200, contentType: 'text/css', headers: CORS, body: FONT_CSS }));
    await context.route('https://fonts.gstatic.com/**', r => r.abort());
    await gotoEditor(page);
    const pkg = await runPackage(page);

    expect(pkg.html).toMatch(/<link[^>]+fonts\.googleapis\.com\/css/);     // the web copy stays
    expect(pkg.html).not.toMatch(/data:font\/woff2/);
    expect(pkg.name.filter(n => /\.woff2$/.test(n))).toEqual([]);
    expect(pkg.readme).toMatch(/Fonts NOT embedded/);
    expect(pkg.stat).toMatch(/fonts LINKED, not embedded/);
    // The script is a local file: still inlined, fonts or not.
    expect(pkg.html).not.toMatch(/<script[^>]+src="primer\.js"/);
  });
});

// A web-page report is BUILT pageless (docsync.yml page: [12.5, null]) — one
// continuous sheet. The editor has to know that without a layout.json override,
// and a page range means nothing on it.
test.describe('a report built pageless', () => {
  test('is pageless with no layout override, and a page range says why it is refused', async ({ page }) => {
    await gotoEditor(page, '?project=our-mission');
    const st = await page.evaluate(() => ({
      pageless: isPageless(), h: PAGE_H_IN, override: !!layout.page,
      min: getComputedStyle(document.getElementById('out').contentDocument.querySelector('.page')).minHeight,
    }));
    expect(st.pageless).toBe(true);
    expect(st.override).toBe(false);
    expect(st.h).toBe(200);
    expect(st.min).toBe('0px');                 // not 160in of mostly-empty sheet
    await page.evaluate(() => { $('dl-pages').value = '2'; });
    const msg = await page.evaluate(() => exportPages());
    expect(msg).toMatch(/one continuous page/);
  });
});
