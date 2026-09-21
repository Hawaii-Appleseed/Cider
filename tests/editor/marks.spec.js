// Bold/italic without execCommand (docsync/editor/edit.html toggleMark /
// markActive / insertBreak). document.execCommand is deprecated; these do the
// same jobs on Ranges. The cases that matter are the ones execCommand used to
// hide: a selection covering only PART of an existing mark, and re-applying a
// mark that is already there (which must not nest and double the ** on save).
const { test, expect, gotoEditor, fillDialog, submitDialog, clickAddSection } = require('./fixtures/editor-test');

let counter = 0;

async function openSection(page) {
  await clickAddSection(page);
  await fillDialog(page, { page: 'basics', slug: 'marks-' + (++counter) });
  await submitDialog(page);
  const ta = page.frameLocator('#out').locator('.ds-edit');
  await ta.waitFor({ state: 'visible' });
  return ta;
}

/** Put the selection over a character range within the host's text, counting
 *  across element boundaries the way a person dragging over words would. */
async function selectChars(page, from, to) {
  await page.evaluate(({ from, to }) => {
    const d = document.querySelector('#out').contentDocument;
    const host = d.querySelector('.ds-edit');
    const w = d.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    let seen = 0, r = d.createRange();
    for (const n of nodes) {
      const len = n.nodeValue.length;
      if (seen <= from && from <= seen + len) r.setStart(n, from - seen);
      if (seen <= to && to <= seen + len) { r.setEnd(n, to - seen); break; }
      seen += len;
    }
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    host.focus();
  }, { from, to });
}

const md = page => page.evaluate(() => {
  const host = document.querySelector('#out').contentDocument.querySelector('.ds-edit');
  return htmlToMd(host, { allowLists: true });
});

// The inline toolbar under the text is gone (it pushed the page around while
// an edit was open) — Bold/Italic live on the CHROME bar now, kept in sync
// with the edit selection by wireMarkState().
const clickTool = (page, label) =>
  page.locator(label === 'Bold' ? '#ty-mb' : '#ty-mi').click();

test.describe('bold / italic (no execCommand)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('bolds a selection and un-bolds it again', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p>alpha beta gamma</p>'; });

    await selectChars(page, 6, 10);            // "beta"
    await clickTool(page, 'Bold');
    expect(await md(page)).toBe('alpha **beta** gamma');

    await selectChars(page, 6, 10);
    await clickTool(page, 'Bold');
    expect(await md(page)).toBe('alpha beta gamma');
  });

  test('un-bolding PART of a bold run splits it, leaving the rest bold', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p><b>hello world</b></p>'; });

    await selectChars(page, 6, 9);             // "wor" inside the bold run
    await clickTool(page, 'Bold');

    // The space the split left at the end of the first run rides OUTSIDE
    // its markers — same two bold runs, markdown that cannot be misread.
    expect(await md(page)).toBe('**hello** wor**ld**');
    expect(await ta.locator('b').count()).toBe(2);
  });

  test('bolding a selection that already contains bold does not nest', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p>one <b>two</b> three</p>'; });

    await selectChars(page, 0, 13);            // the whole line
    await clickTool(page, 'Bold');

    // One mark, not <b>one <b>two</b> three</b> — which would serialize to
    // doubled stars and render as literal asterisks.
    expect(await md(page)).toBe('**one two three**');
    expect(await ta.evaluate(el => el.querySelectorAll('b b').length)).toBe(0);
  });

  test('a mark wraps the word, not the space a double-click came with',
    async ({ page }) => {
      const ta = await openSection(page);
      await ta.evaluate(el => { el.innerHTML = '<p>alpha beta gamma</p>'; });

      // Chromium hands a double-click the word AND its trailing space. Left
      // inside the markers that is `*beta *`, which md_inline refuses — the
      // rule wants no space beside the marker — so the asterisks reached the
      // page as asterisks and the words were never italic.
      await selectChars(page, 6, 11);            // "beta "
      await clickTool(page, 'Italic');
      expect(await md(page)).toBe('alpha *beta* gamma');

      // and it is really a mark, not two literal asterisks
      expect(await ta.locator('i').count()).toBe(1);
    });

  test('the button shows whether the selection is already marked', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p>plain <b>strong</b></p>'; });
    const boldBtn = page.locator('#ty-mb');

    await selectChars(page, 0, 5);             // "plain"
    await expect(boldBtn).not.toHaveClass(/\bon\b/);

    await selectChars(page, 6, 12);            // "strong"
    await expect(boldBtn).toHaveClass(/\bon\b/);
  });

  test('italic works the same, and stays mutually exclusive with bold', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p>one <b>two</b></p>'; });

    await selectChars(page, 0, 3);             // "one"
    await clickTool(page, 'Italic');
    expect(await md(page)).toBe('*one* **two**');

    // Inside the bold run, Italic is refused — md_inline cannot round-trip
    // ***both***, so the UI must not offer it.
    await selectChars(page, 4, 7);
    await expect(page.locator('#ty-mi')).toBeDisabled();
  });

  test('Shift+Enter in a table cell inserts a real line break', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.click('#table');
    const tbl = frame.locator('table.ds-table[data-el]').first();
    await tbl.waitFor({ state: 'attached', timeout: 20000 });
    await tbl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    await tbl.locator('td[data-cell="1,0"]').dblclick();
    const cell = frame.locator('.ds-cell-edit');
    await cell.waitFor({ state: 'visible' });
    await page.keyboard.type('top');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('bottom');

    expect(await cell.locator('br').count()).toBe(1);
    await cell.evaluate(el => el.blur());
    await page.waitForTimeout(600);
    // The break survives into layout.json, and no zero-width caret padding
    // rides along with it.
    const stored = await page.evaluate(() => layout.tables[0].rows[1][0]);
    expect(stored).toBe('top\nbottom');
  });
});
