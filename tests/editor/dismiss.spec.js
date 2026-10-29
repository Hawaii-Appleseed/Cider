// Clicking away closes what is open.
//
// The canvas is an IFRAME, and a mousedown inside one does not bubble to the
// parent document at all — so the one closer the chrome had could never see
// the most natural dismissing gesture there is: clicking the page. Menus
// stayed open until you clicked another piece of chrome.
//
// The rule is not "close everything", though. The rail's pickers (Text, Shape,
// Icon) are menus and close on any click away. Table, Chart and Colour are
// not: they describe the thing you have SELECTED and exist to be used while
// working on the canvas — styling a cell, recolouring one shape then the next
// — so a canvas click must leave them alone.
const { test, expect, gotoEditor, openSources } = require('./fixtures/editor-test');

/** A real mouse click on the report, well clear of the chrome.
 *
 *  page.mouse rather than a locator click on purpose: the browser routes a
 *  real click to whatever is under the point, including iframe content, which
 *  is exactly the gesture under test. A locator click also fails its
 *  actionability check whenever the very panel being dismissed is what covers
 *  the element — which is most of these tests. */
async function clickReport(page) {
  // Find a point that is genuinely ON the canvas. The surfaces under test sit
  // over it from both sides — the side panel on the left, the Sources drawer
  // on the right — so any fixed point is covered in some test and the click
  // lands on the very thing it means to dismiss.
  const pt = await page.evaluate(() => {
    const f = document.getElementById('out').getBoundingClientRect();
    const y = f.top + f.height / 2;
    for (let x = f.right - 30; x > f.left + 10; x -= 20) {
      if (document.elementFromPoint(x, y) === document.getElementById('out')) return { x, y };
    }
    return null;
  });
  if (!pt) throw new Error('no uncovered point on the canvas to click');
  await page.mouse.click(pt.x, pt.y);
}

test.describe('clicking away dismisses', () => {
  test('a popover closes when the report is clicked', async ({ page }) => {
    await gotoEditor(page);
    // Layers is a row of View ▾; its popover is what this test is about, so
    // open it programmatically (togglePop hangs it from the View button).
    await page.evaluate(() => document.getElementById('layers').click());
    await expect(page.locator('#layerspop')).toBeVisible();
    await clickReport(page);
    await expect(page.locator('#layerspop')).toBeHidden();
  });

  test('a popover still closes when other chrome is clicked', async ({ page }) => {
    await gotoEditor(page);
    // Layers is a row of View ▾; its popover is what this test is about, so
    // open it programmatically (togglePop hangs it from the View button).
    await page.evaluate(() => document.getElementById('layers').click());
    await expect(page.locator('#layerspop')).toBeVisible();
    await page.click('#stat');
    await expect(page.locator('#layerspop')).toBeHidden();
  });

  test('the File menu closes when the report is clicked', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#file');
    await expect(page.locator('#filepop')).toBeVisible();
    await clickReport(page);
    await expect(page.locator('#filepop')).toBeHidden();
  });

  test('the Sources panel closes when the report is clicked', async ({ page }) => {
    await gotoEditor(page);
    await openSources(page);
    await expect(page.locator('#srcpanel')).toBeVisible();
    // Sources is a floating surface of its own rather than a .pop, so it had
    // to be handled by name — and it is the one the report named.
    await clickReport(page);
    await expect(page.locator('#srcpanel')).toHaveCount(0);
  });

  test('a rail picker closes when the report is clicked', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#text');
    await expect(page.locator('#side')).toBeVisible();
    await expect(page.locator('#side-body #textpop')).toBeVisible();
    await clickReport(page);
    await expect(page.locator('#side')).toBeHidden();
  });

  test('a rail picker survives a click inside its own panel and on the rail', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#text');
    await expect(page.locator('#side')).toBeVisible();
    await page.click('#side-title');            // inside the panel
    await expect(page.locator('#side')).toBeVisible();
  });

  test('the Chart panel is NOT dismissed by clicking the canvas', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#chart');                 // rail: places a chart and opens its panel
    await expect(page.locator('#side')).toBeVisible();
    await expect(page.locator('#side-title')).toHaveText('Chart');
    // Recolouring a chart means clicking between the panel and the thing it
    // describes. Closing here would shut the panel on the gesture it exists
    // to serve.
    await clickReport(page);
    await expect(page.locator('#side')).toBeVisible();
    await expect(page.locator('#side-title')).toHaveText('Chart');
  });
});

test.describe('the collapsed side panel', () => {
  test('its chevron clears the tool rail instead of covering a tool', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#text');
    await page.click('#side-fold');             // collapse it
    await expect(page.locator('#side')).toHaveClass(/folded/);

    // Measured with a poll, and atomically. The panel collapses with a width
    // transition, so a boundingBox read immediately after the click catches the
    // chevron mid-flight — 250px from where it lands. That is how the first
    // version of this test passed against the very layout it was written to
    // catch: it measured a position neither the old build nor the new one ever
    // actually rests at.
    const geometry = () => page.evaluate(() => {
      const side = document.getElementById('side');
      const f = document.getElementById('side-fold').getBoundingClientRect();
      const rail = document.getElementById('leftrail').getBoundingClientRect();
      return {
        folded: side.classList.contains('folded'),
        gap: Math.round((f.left - rail.right) * 10) / 10,
        hits: [...document.querySelectorAll('#leftrail button')].filter(b => {
          const r = b.getBoundingClientRect();
          return f.left < r.right && f.right > r.left && f.top < r.bottom && f.bottom > r.top;
        }).map(b => b.id),
      };
    });
    // Folded, the panel has no width, so a chevron hung off its right edge
    // straddled the rail and sat on whichever tool the middle of the rail
    // reached — Chart, at most window heights. It must begin AT the rail's
    // outer edge, covering none of it.
    await expect.poll(geometry, { timeout: 5000 })
      .toEqual({ folded: true, gap: 0, hits: [] });
  });

  test('a dialog opened FROM a panel does not dismiss it', async ({ page }) => {
    await gotoEditor(page);
    await openSources(page);
    await expect(page.locator('#srcpanel')).toBeVisible();
    // A modal sits on top of everything, so clicking in one is not a click
    // away from what is behind it. The rename dialog opens from this panel,
    // and every keystroke in it lands outside the panel's own box.
    await page.click('#srcpanel .src-new');
    await expect(page.locator('dialog.dsdlg[open]')).toBeVisible();
    await page.locator('dialog.dsdlg input').first().click();
    await expect(page.locator('#srcpanel')).toBeVisible();
  });
});
