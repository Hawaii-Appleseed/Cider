// deafenStickyChrome() sets pointer-events:none on a report's own fixed/sticky
// body-level chrome so it cannot eat canvas clicks — and that silently made
// blocks.pdf_button() unclickable on the artboard: real clicks passed straight
// through it, while synthetic dispatchEvent (which ignores pointer-events)
// still fired, which is how the breakage got past a hand test. The ds- class
// prefix is the exemption: an editor-aware control declares itself with it and
// stays live. These tests use REAL Playwright clicks, which do respect
// pointer-events, so a regression here times out rather than false-passing.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('sticky-chrome deafening and its ds- exemption', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  async function plantButtons(page) {
    // Two fixed buttons at the top of the report body, exactly the shape
    // pdf_button() emits: one editor-aware (ds- prefix), one plain chrome.
    await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      for (const [id, cls] of [['t-live', 'ds-pdfbtn noprint'],
                               ['t-deaf', 'noprint']]) {
        const b = d.createElement('button');
        b.id = id; b.className = cls; b.textContent = id;
        b.style.cssText = 'position:fixed;top:4px;' +
          (id === 't-live' ? 'right:4px' : 'right:120px') + ';z-index:99';
        b.onclick = () => { b.dataset.clicked = '1'; };
        d.body.appendChild(b);
      }
      deafenStickyChrome(d);
    });
  }

  test('a ds- control stays clickable; plain fixed chrome is deafened', async ({ page }) => {
    await plantButtons(page);
    const frame = page.frameLocator('#out');

    const live = frame.locator('#t-live');
    const deaf = frame.locator('#t-deaf');
    expect(await live.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('auto');
    expect(await deaf.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');

    // A REAL click lands on the ds- button and runs its handler.
    await live.click();
    await expect(live).toHaveAttribute('data-clicked', '1');

    // The deafened one cannot be hit: Playwright refuses the click because the
    // element never receives pointer events. trial:true keeps it fast.
    let refused = false;
    try {
      await deaf.click({ timeout: 1500 });
    } catch (e) {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  test("the report's own pdf button rides the exemption end to end", async ({ page }) => {
    // The fixture's renderer does not emit pdf_button(), so emit its edit-mode
    // markup shape directly and prove the whole path: pointer-events survive
    // deafening, and a real click posts the export message the chrome handles.
    await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      const b = d.createElement('button');
      b.className = 'ds-pdfbtn noprint';
      b.id = 't-pdf';
      b.textContent = '↓ Download PDF';
      b.style.cssText = 'position:fixed;top:4px;right:4px;z-index:60';
      b.onclick = () => parent.postMessage({ ds: 'export-pdf' }, '*');
      d.body.appendChild(b);
      deafenStickyChrome(d);
    });
    await page.frameLocator('#out').locator('#t-pdf').click();
    // The fixture mocks /__export (STANDALONE.md §C); doExport reports what it
    // "downloaded", which is proof the message crossed and the exporter ran.
    await expect(page.locator('#stat')).toContainText(/rendering|downloaded/,
                                                      { timeout: 15000 });
  });
});
