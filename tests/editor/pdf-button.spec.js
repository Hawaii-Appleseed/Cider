// The editor-native Download-PDF button: a text box carrying act:'pdf'
// (layout.py renders it as a real window.print() button when published; the
// engine side of that is pinned in docsync/test_docsync.py). Here: the box IS
// an ordinary editor citizen — inserted from the Text panel, moved, restyled,
// relabelled, duplicated — with no new code paths to teach. Local mode.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

async function addButton(page) {
  // Off the cover: a box inserted there lands under the cover's full-bleed
  // artwork, where nothing can click it — the same reason the table specs
  // work on a prose page.
  const frame0 = page.frameLocator('#out');
  await frame0.locator('section.page').nth(3).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.click('#text');
  await page.click('#textpop .txtpreset[data-k="pdfbtn"]');
  const frame = page.frameLocator('#out');
  await frame.locator('.ds-textbox[data-el^="text."]').first()
    .waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => boxes().find(b => b.act === 'pdf'));
}

// One worker, in order: the publish test below snapshots and restores
// docsync.yml, which fullyParallel would race from a second worker.
test.describe.configure({ mode: 'serial' });

test.describe('download-pdf button', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('inserts from the Text panel as a styled, filled box', async ({ page }) => {
    const b = await addButton(page);
    expect(b).toBeTruthy();
    expect(b.md).toBe('Download PDF');
    expect(b.fill).toBe('#2F3E46');
    expect(b.act).toBe('pdf');
    // On the canvas it is a filled pill with white bold type — WYSIWYG with
    // the published button, which test_docsync.py pins from the same fields.
    const el = page.frameLocator('#out').locator(`[data-el="text.${'t'}${b.id.slice(1)}"]`);
    const got = await page.evaluate(id => {
      const d = document.getElementById('out').contentDocument;
      const el = d.querySelector(`[data-el="text.${id}"]`);
      const cs = d.defaultView.getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius,
               tag: el.tagName, onclick: el.getAttribute('onclick') };
    }, b.id);
    expect(got.bg).toBe('rgb(47, 62, 70)');
    expect(got.color).toBe('rgb(255, 255, 255)');
    expect(got.radius).toBe('8px');
    // and in the EDITOR it is a div with no live action — a real <button>
    // would be skipped by the drag guard and become unmovable.
    expect(got.tag).toBe('DIV');
    expect(got.onclick).toBeNull();
  });

  test('moves and restyles like any text box', async ({ page }) => {
    const b = await addButton(page);
    const frame = page.frameLocator('#out');
    const el = frame.locator(`[data-el="text.${b.id}"]`);
    const before = await page.evaluate(id => {
      const bx = boxes().find(x => x.id === id);
      return { x: bx.x, y: bx.y };
    }, b.id);

    // Straight to the drag: a click would open the button's words, and a
    // press in open words selects text. The press selects what it moves.
    await el.scrollIntoViewIfNeeded();
    const bb = await el.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 80, bb.y + bb.height / 2 + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const after = await page.evaluate(id => {
      const bx = boxes().find(x => x.id === id);
      return { x: bx.x, y: bx.y, act: bx.act };
    }, b.id);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.act).toBe('pdf');          // moving never sheds the behaviour

    // Recolour through the same fill store every box uses.
    await page.evaluate(async id => {
      pushHistory();
      boxes().find(x => x.id === id).fill = '#52796F';
      markDirty(); await render();
    }, b.id);
    await page.waitForTimeout(800);
    const bg = await page.evaluate(id => {
      const d = document.getElementById('out').contentDocument;
      return d.defaultView.getComputedStyle(
        d.querySelector(`[data-el="text.${id}"]`)).backgroundColor;
    }, b.id);
    expect(bg).toBe('rgb(82, 121, 111)');
  });

  test('the label is just text — dblclick, retype, keep the behaviour', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox',
      'Playwright cannot deliver synthetic keys into an iframe contenteditable '
      + 'on Gecko — page.keyboard, locator.press and fill all arrive nowhere. '
      + 'Harness limitation, not product risk: real keys focus the frame '
      + 'natively, and the same input->blur commit path passes on Firefox in '
      + 'the paste specs.');
    const b = await addButton(page);
    const frame = page.frameLocator('#out');
    const el = frame.locator(`[data-el="text.${b.id}"]`);
    await el.dblclick();
    await page.waitForTimeout(600);
    await expect(frame.locator('.ds-edit')).toHaveCount(1);
    // Element-targeted keys, not page.keyboard: top-level synthetic keys
    // only reach an iframe's contenteditable in Chromium — on Gecko they
    // went nowhere and the label survived untouched. (Focusing the iframe
    // wrapper first is no fix either: that BLURS the inner editor, which
    // commits and re-renders.) locator.press delivers to the element itself,
    // identically in every engine.
    const editHost = frame.locator('.ds-edit');
    await editHost.press('ControlOrMeta+a');
    await editHost.pressSequentially('Get the PDF');
    await page.evaluate(() => document.getElementById('out')
      .contentDocument.querySelector('.ds-edit')?.blur());
    await page.waitForTimeout(1500);

    const after = await page.evaluate(id => boxes().find(x => x.id === id), b.id);
    expect(after.md).toBe('Get the PDF');
    expect(after.act).toBe('pdf');
    await expect(frame.locator(`[data-el="text.${b.id}"]`)).toContainText('Get the PDF');
  });

  test('duplicate copies the whole button, behaviour included', async ({ page }) => {
    const b = await addButton(page);
    await page.evaluate(id => {
      setSel($('out').contentDocument, ['text.' + id]);
    }, b.id);
    await page.waitForTimeout(400);
    // A solo text box puts the TYPE controls in hand, not the arrange strip —
    // its Duplicate is the floating mini toolbar's, same as a person's click.
    await page.frameLocator('#out')
      .locator('.ds-mini button[aria-label^="Duplicate"]').click();
    await page.waitForTimeout(1500);
    const acts = await page.evaluate(() => boxes().filter(x => x.act === 'pdf').length);
    expect(acts).toBe(2);
  });
});

// The other face, end to end: the REAL disk build of a scaffolded project
// whose layout carries an act box — publish markup, print hiding, and the
// click genuinely reaching window.print(). Serial file: shares docsync.yml
// snapshot/restore discipline with the specs above.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');
const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-btn';

test('published output of a real build carries the working button', async ({ page }) => {
  try {
    await page.goto('start.html');
    await page.waitForTimeout(600);
    await page.click('#new');
    await page.fill('#np-name', 'Button Report');
    await page.fill('#np-slug', SLUG);
    await page.click('#np-create');
    await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
    await page.frameLocator('#out').locator('section.page[data-page="1"]')
      .waitFor({ state: 'visible', timeout: 75000 });

    // The act box straight into the project's layout.json, then the REAL
    // disk build — the exact pipeline a Save would run.
    const lj = path.join(REPO, 'projects', SLUG, 'layout.json');
    const d = JSON.parse(fs.readFileSync(lj, 'utf8'));
    d.boxes = [{ id: 't9', page: 1, x: 5.5, y: 0.4, w: 1.9, md: 'Download PDF',
                 fill: '#52796F', style: { size: 14, weight: 700, color: '#FFFFFF', align: 'center' },
                 act: 'pdf' }];
    fs.writeFileSync(lj, JSON.stringify(d, null, 2));
    execSync(`python3 ${JSON.stringify(path.join(REPO, 'projects', SLUG, 'render_report.py'))}`,
      { cwd: REPO });

    const html = fs.readFileSync(
      path.join(REPO, 'projects', SLUG, 'web', 'index.html'), 'utf8');
    expect(html).toContain('<button type="button" class="ds-actbtn noprint"');
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('@media print{.ds-actbtn{display:none}}');
    expect(html).toContain('background:#52796F');
    expect(html).not.toContain('data-el');            // publish is clean

    // And the button really fires: open the built page in the browser, stub
    // print, click it.
    // A BLOB URL, not document.write. The published page now carries an inline
    // <script> inside section.page (the toggle animation's __dsTgl), and
    // document.write's parser STOPS at a script: everything after it —
    // including this button — was silently dropped, so the page under test was
    // never the page that shipped. A blob url is a real navigation, which
    // parses the bytes exactly as a browser opening the file would.
    const fired = await page.evaluate(async raw => {
      const w = window.open(
        URL.createObjectURL(new Blob([raw], { type: 'text/html' })), '_blank');
      const t0 = Date.now();
      let btn;
      while (!(btn = w.document && w.document.querySelector('.ds-actbtn'))) {
        if (Date.now() - t0 > 5000) throw new Error('published page never loaded');
        await new Promise(r => setTimeout(r, 50));
      }
      let called = false;
      w.print = () => { called = true; };
      btn.click();
      const out = called; w.close();
      return out;
    }, html);
    expect(fired).toBe(true);
  } finally {
    // Our binding only — a whole-file restore was the scaffold race
    // (fixtures/host-state.js).
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  }
});
