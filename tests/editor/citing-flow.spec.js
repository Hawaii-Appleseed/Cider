// Citing from the text: a click on a citation number keeps the report where
// it is and opens a card for that note (edit it, remove this one citation);
// the right-click list of existing notes carries the numbers the page shows,
// in order, and finds a note by typing; and a new note needs only a title.
//
// The Wealth Tax Report: every citation sits in a text box, so content.md
// alone knows none of the numbers, and the draft is a srcdoc with a <base
// href> — the case where "#en1" used to resolve against the report's folder.
const { test, expect, gotoEditor, fillDialog, submitDialog, settled } = require('./fixtures/editor-test');

const Q = '?project=wealth-tax-report';

/** The first citation marker in the text, with its number and note id. */
async function firstMarker(page) {
  const frame = page.frameLocator('#out');
  const mk = frame.locator('section.page a[href^="#en"]')
    .filter({ hasNot: frame.locator('xpath=ancestor::*[starts-with(@data-el,"endnote.")]') }).first();
  await mk.scrollIntoViewIfNeeded();
  const num = (await mk.getAttribute('href')).replace('#en', '');
  const sid = await page.evaluate(n => noteIdByNumber(n), num);
  return { mk, num, sid };
}

/** Open the first cited paragraph's words for typing; returns the editor. */
async function openCitedText(page) {
  const frame = page.frameLocator('#out');
  const host = frame.locator('section.page a[href^="#en"]').first()
    .locator('xpath=ancestor::*[@data-el][1]');
  await host.scrollIntoViewIfNeeded();
  for (let i = 0; i < 3 && !(await frame.locator('.ds-edit').count()); i++) {
    await host.click({ position: { x: 30, y: 10 } });
    await page.waitForTimeout(300);   // the press-release that opens typing
  }
  const ed = frame.locator('.ds-edit').first();
  await expect(ed).toBeVisible();
  return ed;
}

test.describe('citing from the text', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, Q); });

  test('a click on a citation number keeps the report and opens its note', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const pages0 = await frame.locator('section.page').count();
    const { mk, num, sid } = await firstMarker(page);
    expect(sid).toBeTruthy();
    await mk.click();
    const pop = frame.locator('.ds-citepop');
    await expect(pop).toBeVisible();
    // Still the draft, every sheet still there: no navigation happened.
    expect(await page.evaluate(() => document.querySelector('#out').contentWindow.location.href))
      .toBe('about:srcdoc');
    await expect(frame.locator('section.page')).toHaveCount(pages0);
    await expect(pop.locator('.ds-menu-head')).toHaveText(`Endnote ${num}`);
    const text = await page.evaluate(id => parseSources().find(r => r.id === id).text, sid);
    await expect(pop.locator('.ds-citepop-t')).toHaveText(text);

    await pop.locator('button', { hasText: 'Edit note' }).click();
    await expect(frame.locator('.ds-citepop')).toHaveCount(0);
    const li = frame.locator(`[data-el="endnote.${sid}"]`);
    await expect(li.locator('.ds-en-text')).toBeVisible();
    await expect(li.locator('.ds-en-text')).toHaveValue(text);
  });

  test('"Remove this citation" takes out that one marker, and undo brings it back', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const { mk, sid } = await firstMarker(page);
    const n0 = await page.evaluate(id => citeCount(id), sid);
    await mk.click();
    await frame.locator('.ds-citepop button', { hasText: 'Remove this citation' }).click();
    await settled(page);
    expect(await page.evaluate(id => citeCount(id), sid)).toBe(n0 - 1);
    // The note itself stays in Sources.
    expect(await page.evaluate(id => sourceIds().includes(id), sid)).toBe(true);
    await page.evaluate(() => undo());
    await settled(page);
    expect(await page.evaluate(id => citeCount(id), sid)).toBe(n0);
  });

  test('a hash link that is not a citation scrolls in place', async ({ page }) => {
    const frame = page.frameLocator('#out');
    // A plain in-page link, put on the drawn page the way a contents entry is.
    await page.evaluate(() => {
      const d = document.querySelector('#out').contentDocument;
      const a = d.createElement('a');
      a.href = '#zz-target'; a.id = 'zz-link'; a.textContent = 'go';
      d.querySelector('section.page').prepend(a);
      const t = d.createElement('div'); t.id = 'zz-target'; t.textContent = 'here';
      d.querySelectorAll('section.page')[3].appendChild(t);
    });
    // dispatchEvent: the cover photo's box overlays the top of page 1.
    await frame.locator('#zz-link').dispatchEvent('click');
    await page.waitForTimeout(400);   // jumpTo's smooth scroll
    expect(await page.evaluate(() => document.querySelector('#out').contentWindow.location.href))
      .toBe('about:srcdoc');
    await expect(frame.locator('#zz-target')).toBeInViewport();
  });

  test('the existing-note list shows the page numbers in order and finds a note by typing', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const ed = await openCitedText(page);
    await ed.click({ button: 'right' });
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Existing endnote' }).hover();
    const sub = frame.locator('.ds-submenu');
    await expect(sub).toBeVisible();
    const nums = await sub.locator('.ds-note-n').allTextContents();
    const cited = nums.filter(n => n !== '–').map(Number);
    expect(cited.length).toBeGreaterThan(5);
    expect(cited).toEqual([...cited].sort((a, b) => a - b));
    expect(cited[0]).toBe(1);

    // Type "3": only note 3 is left, highlighted; Enter cites it here.
    await page.keyboard.press('3');
    await expect(sub.locator('.ds-note-q')).toHaveText('Find: 3');
    const vis = sub.locator('button.ds-note:not([hidden])');
    await expect(vis).toHaveCount(1);
    await expect(vis.locator('.ds-note-n')).toHaveText('3');
    const sid3 = await page.evaluate(() => noteIdByNumber('3'));
    const before = await ed.locator(`.ds-fnchip[data-fn-id="${sid3}"]`).count();
    await page.keyboard.press('Enter');
    await expect(frame.locator('.ds-menu')).toHaveCount(0);
    await expect(ed.locator(`.ds-fnchip[data-fn-id="${sid3}"]`)).toHaveCount(before + 1);
    // The paragraph is still open: Enter went to the list, not the words.
    await expect(ed).toBeVisible();
  });

  test('a new note needs only a title; its id is made from it', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const ed = await openCitedText(page);
    await ed.click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'New endnote' }).click();
    const dlg = page.locator('dialog[open]');
    // Two fields up front; the structured ones wait behind a fold.
    await expect(dlg.locator('input:visible')).toHaveCount(2);
    await expect(dlg.locator('input[name="title"]')).toBeFocused();
    await fillDialog(page, { title: 'The Who Pays Report', url: 'https://example.com/wp' });
    await submitDialog(page);
    await expect(ed.locator('.ds-fnchip[data-fn-id="who-pays-report"]')).toHaveCount(1);
    const s = await page.evaluate(() => parseSources().find(r => r.id === 'who-pays-report'));
    expect(s.text).toBe('"The Who Pays Report."');
    expect(s.url).toBe('https://example.com/wp');
    // A second one with the same title gets its own id.
    expect(await page.evaluate(() => sourceIdFrom('The Who Pays Report'))).toBe('who-pays-report-2');
  });
});
