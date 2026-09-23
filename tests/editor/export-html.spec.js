// HTML export fidelity (docsync/editor/edit.html exportHtml/renderClean/
// scopeCss). The editor's iframe holds the renderer's REAL output, not a
// preview of it — so an export that matches what you see is the same render
// minus the editing scaffolding, with everything it referenced pulled inline.
// These tests hold that line: same page count, same text, no data-slot/
// data-el hooks, no external references left dangling.
const { warmTest: test, expect, gotoEditor, openFileMenu } = require('./fixtures/editor-test');

/** Run the export and capture the file instead of writing it to disk. */
async function grabExport(page, which) {
  await page.evaluate(() => {
    window.__dl = null;
    // The export ends in an <a download>.click(); intercept it.
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        window.__dlName = this.download;
        return fetch(this.href).then(r => r.text()).then(t => { window.__dl = t; });
      }
      return realClick.call(this);
    };
  });
  await openFileMenu(page);
    await page.click('#download');
  await page.click(which);
  await page.waitForFunction(() => window.__dl !== null, null, { timeout: 60_000 });
  return {
    html: await page.evaluate(() => window.__dl),
    name: await page.evaluate(() => window.__dlName),
  };
}

test.describe('HTML export', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the self-contained file matches the editor, minus the editing hooks', async ({ page }) => {
    // What the editor is showing right now.
    const shown = await page.frameLocator('#out').locator('body').evaluate(b => ({
      pages: b.querySelectorAll('section.page').length,
      text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }));

    const { html, name } = await grabExport(page, '#dl-html');
    expect(name).toMatch(/\.html$/);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);

    // Same document: same page count, same words.
    const got = await page.evaluate(h => {
      const d = new DOMParser().parseFromString(h, 'text/html');
      // innerText, not textContent: the cover title is <br>-separated lines,
      // and only innerText reports the line breaks as the spaces a reader
      // sees. Comparing textContent would fail on a document that is right.
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-99999px;top:0;width:1200px';
      probe.innerHTML = d.body.innerHTML;
      document.body.appendChild(probe);
      const text = (probe.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      probe.remove();
      return {
        pages: d.querySelectorAll('section.page').length,
        text,
        slots: d.querySelectorAll('[data-slot]').length,
        els: d.querySelectorAll('[data-el]').length,
        links: d.querySelectorAll('link[rel~="stylesheet"]').length,
        relImgs: [...d.querySelectorAll('img')]
          .filter(i => !/^(data:|https?:)/i.test(i.getAttribute('src') || '')).length,
      };
    }, html);

    expect(got.pages).toBe(shown.pages);
    expect(got.text.slice(0, 200)).toBe(shown.text.slice(0, 200));
    // The editing scaffolding must NOT ship — it only exists under DOCSYNC_EDIT.
    expect(got.slots).toBe(0);
    expect(got.els).toBe(0);
    // Self-contained: nothing left to fetch from a folder that will not be there.
    expect(got.links).toBe(0);
    expect(got.relImgs).toBe(0);
  });

  test('the editor is still editable after an export', async ({ page }) => {
    await grabExport(page, '#dl-html');
    // renderClean() runs WITHOUT DOCSYNC_EDIT; the editor has to come back
    // with its hooks, or the export silently breaks the session.
    const frame = page.frameLocator('#out');
    await expect(frame.locator('[data-slot]').first()).toBeAttached({ timeout: 30_000 });
    await expect(frame.locator('[data-el]').first()).toBeAttached();
  });

  test('the Squarespace block is a scoped, self-scaling fragment', async ({ page }) => {
    const { html, name } = await grabExport(page, '#dl-sqsp');
    expect(name).toMatch(/-squarespace\.html$/);

    // A fragment: it lives inside someone else's page.
    expect(html).not.toMatch(/<!DOCTYPE/i);
    expect(html).not.toMatch(/<html[\s>]/i);
    expect(html).not.toMatch(/<body[\s>]/i);

    const uid = (html.match(/id="(dsx-[a-z0-9]+)"/) || [])[1];
    expect(uid).toBeTruthy();

    // Every rule is scoped to the wrapper, so the block cannot style the host
    // page and the host page cannot restyle the block.
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    expect(styles.length).toBeGreaterThan(50);
    const selectors = styles
      .replace(/@(media|supports|layer|container)[^{]*\{/g, '')   // unwrap at-rules
      .split('}').map(s => s.split('{')[0].trim())
      .filter(s => s && !s.startsWith('@'));
    const unscoped = selectors.filter(s =>
      s.split(',').some(one => one.trim() && !one.includes('#' + uid)));
    expect(unscoped, `unscoped selectors: ${unscoped.slice(0, 5).join(' | ')}`).toEqual([]);

    // Scaled, not reflowed — the design is placed at a fixed page width, so
    // scaling is what keeps it identical in a narrower column.
    expect(html).toContain('dsx-scale');
    expect(html).toMatch(/'scale\(' \+ s \+ '\)'/);
    expect(html).toMatch(/ResizeObserver|addEventListener\('resize'/);
  });

  // The block is a fixed-width design scaled into someone else's column, so
  // its CSS must not re-answer any question about the viewport once it is
  // pasted. It did: the report's own `@media (min-width:1120px){.page{zoom:
  // 1.25}}` fired on a desktop Squarespace page, blew the sheet up inside a
  // wrapper sized for 1x, and overflow:hidden clipped the right-hand inch.
  test('the block resolves its media queries at export, not at the host', async ({ page }) => {
    const { html } = await grabExport(page, '#dl-sqsp');
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    const preludes = [...styles.matchAll(/@media([^{]*)\{/g)].map(m => m[1].trim());
    // Nothing width-conditional and nothing print-conditional may survive.
    expect(preludes.filter(p => /width|print/i.test(p))).toEqual([]);
    // The winner was inlined, not dropped: the fixture zooms the sheet above
    // 1120px, which is where the report is composed.
    expect(styles).toMatch(/zoom:\s*1\.25/);
  });

  test('the block fits its column exactly, wide or narrow', async ({ page }) => {
    // What the editor is showing: the block has to be THIS, scaled — not a
    // sheet squeezed into a wrapper built for some other width, which is what
    // reading the page size off the manifest produced.
    const sheetInEditor = await page.frameLocator('#out').locator('.page').first()
      .evaluate(e => Math.round(e.getBoundingClientRect().width));

    const { html } = await grabExport(page, '#dl-sqsp');
    const got = await page.evaluate(async h => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:1400px;background:#fff;z-index:9';
      host.innerHTML = h;
      document.body.appendChild(host);
      // innerHTML does not run <script>; the block's fit() has to be alive.
      for (const s of [...host.querySelectorAll('script')]) {
        const n = document.createElement('script');
        n.textContent = s.textContent;
        s.replaceWith(n);
      }
      const wrap = host.querySelector('.dsx-wrap');
      const inner = host.querySelector('.dsx-scale');
      const measure = () => {
        const w = wrap.getBoundingClientRect();
        // The SHEET, not the scale box: the whole bug was a sheet wider than
        // the box it was scaled inside, with overflow:hidden eating the
        // difference. Measuring the box would have reported that as fine.
        const sheets = [...inner.querySelectorAll('.page')];
        const boxes = (sheets.length ? sheets : [inner]).map(e => e.getBoundingClientRect());
        return {
          host: Math.round(w.width),
          shownLeft: Math.round(Math.min(...boxes.map(b => b.left)) - w.left),
          shownRight: Math.round(Math.max(...boxes.map(b => b.right)) - w.left),
          height: Math.round(w.height),
        };
      };
      const wide = measure();
      host.style.width = '700px';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const narrow = measure();
      host.remove();
      return { wide, narrow };
    }, html);

    // A column wider than the design does not scale, so the sheet must come
    // out at full size — the size the editor showed it at. Undersize means the
    // sheet was squeezed to fit a wrapper built for the wrong width, and every
    // inch-placed thing on it then overflowed into `.page{overflow:hidden}`:
    // the right-hand strip of the report, silently gone.
    expect(got.wide.shownRight - got.wide.shownLeft).toBe(sheetInEditor);
    // Nothing hangs off the right: the wrapper clips, so an overhang is lost
    // content too.
    expect(got.wide.shownRight).toBeLessThanOrEqual(got.wide.host + 1);
    expect(got.narrow.shownRight).toBeLessThanOrEqual(got.narrow.host + 1);
    // Centred, not left-hugging: in a column wider than the design the slack
    // is split evenly. (The old export pinned it to the left.)
    const slack = got.wide.host - (got.wide.shownRight - got.wide.shownLeft);
    if (slack > 2) expect(got.wide.shownLeft).toBeCloseTo(slack / 2, -0.5);
    // Below the design width it fills the column instead.
    expect(got.narrow.shownLeft).toBeLessThanOrEqual(1);
    expect(got.narrow.shownRight).toBeGreaterThan(got.narrow.host - 2);
    // The wrapper takes the scaled height, so the block leaves no gap.
    expect(got.narrow.height).toBeGreaterThan(100);
    expect(got.narrow.height).toBeLessThan(got.wide.height);
  });

  // Squarespace mounts code blocks inside tabs and accordions, which are
  // display:none until opened — so the block's very first measurement is a
  // width of zero. Remembering that left the whole report at scale(0).
  test('a block mounted hidden still fits once it is shown', async ({ page }) => {
    const { html } = await grabExport(page, '#dl-sqsp');
    const shown = await page.evaluate(async h => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:1000px;display:none';
      host.innerHTML = h;
      document.body.appendChild(host);
      // No ResizeObserver, and `load` has long since fired: the case where the
      // parse-time measurement is the ONLY signal the block ever gets. (A host
      // that renders it in a background tab has no frame loop to deliver a
      // resize record either.)
      const RO = window.ResizeObserver;
      delete window.ResizeObserver;
      try {
        for (const s of [...host.querySelectorAll('script')]) {
          const n = document.createElement('script');
          n.textContent = s.textContent;
          s.replaceWith(n);
        }
      } finally { window.ResizeObserver = RO; }
      host.style.display = 'block';
      await new Promise(r => setTimeout(r, 800));
      const wrap = host.querySelector('.dsx-wrap');
      const sheet = host.querySelector('.dsx-scale .page');
      const w = wrap.getBoundingClientRect(), p = sheet.getBoundingClientRect();
      host.remove();
      return { sheet: Math.round(p.width), wrapH: Math.round(w.height) };
    }, html);
    expect(shown.sheet).toBeGreaterThan(500);      // not scale(0)
    expect(shown.wrapH).toBeGreaterThan(500);
  });

  test('flattenMedia decides width queries at the design viewport', async ({ page }) => {
    const out = await page.evaluate(() => ({
      hit:   flattenMedia('@media screen and (min-width:1120px){.page{zoom:1.25}}', 1200),
      miss:  flattenMedia('@media screen and (max-width:850px){.page{width:100%}}', 1200),
      range: flattenMedia('@media (400px <= width <= 900px){p{color:red}}', 1200),
      bare:  flattenMedia('@media screen{a{color:blue}}', 1200),
      print: flattenMedia('@media print{.page{height:11in}}', 1200),
      keep:  flattenMedia('@media (prefers-color-scheme:dark){b{color:#fff}}', 1200),
      list:  flattenMedia('@media print,(min-width:900px){i{color:teal}}', 1200),
      vw:    freezeViewportUnits('img{max-width:calc(100vw - 20px);'
             + 'background:url(data:image/png;base64,AA12vw+BB)}', 1200),
    }));
    expect(out.hit).toBe('.page{zoom:1.25}');       // inlined, keeping source order
    expect(out.miss).toBe('');                      // never true here: dropped
    expect(out.range).toBe('');
    expect(out.bare).toBe('a{color:blue}');
    expect(out.print).toBe('');                     // a block is not a printed sheet
    expect(out.keep).toContain('@media (prefers-color-scheme:dark)');   // undecidable: kept
    expect(out.list).toBe('i{color:teal}');         // one arm of the OR is true
    // vw is frozen at the design viewport — but never inside a data: URI.
    expect(out.vw).toContain('calc(1200px - 20px)');
    expect(out.vw).toContain('AA12vw+BB');
  });

  test('scopeCss rewrites selectors without mangling at-rules', async ({ page }) => {
    const out = await page.evaluate(() => scopeCss(
      'body{margin:0}h1,.a{color:red}@media (max-width:600px){p{font-size:9px}}'
      + '@font-face{font-family:X;src:url(x.woff2)}@keyframes k{to{opacity:1}}',
      '#w'));
    expect(out).toContain('#w{margin:0}');            // body IS the wrapper
    expect(out).toContain('#w h1,#w .a{color:red}');
    expect(out).toContain('@media (max-width:600px){#w p{font-size:9px}}');
    // Naming at-rules must pass through untouched — scoping them breaks them.
    expect(out).toContain('@font-face{font-family:X;src:url(x.woff2)}');
    expect(out).toContain('@keyframes k{to{opacity:1}}');
  });
});
