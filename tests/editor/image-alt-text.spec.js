// An image's alt text, for images that came in through markdown — Insert
// image's box, or a picture in a paragraph. Insert image can only write the
// file name there (`![signing.jpg](assets/signing.jpg)`), and a screen reader
// then reads "signing dot jpg" out loud. The words live in the markdown, so
// that is what the menu and describeImage() rewrite; audit() names every image
// still described by its file name. A designed figure's description (data-desc)
// is context-menus.spec.js. Local mode.
const { test, expect, gotoEditor, dialog, fillDialog, submitDialog,
        } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addImageBox(page, md = '![signing.jpg](assets/signing.jpg)') {
  const r = await page.evaluate(m => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 3, md: m }), md);
  expect(r.ok).toBe(true);
  return r.id;
}

const altOn = (page, id) => page.evaluate(i => {
  const im = $('out').contentDocument.querySelector(`[data-el="${i}"] img`);
  return im ? im.getAttribute('alt') : null;
}, id);

test.describe('image alt text', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('describeImage rewrites the markdown, the page carries it, and one undo restores',
    async ({ page }) => {
      const id = await addImageBox(page);
      const flagged = async () => ((await api(page, 'audit()')).issues || [])
        .filter(i => i.kind === 'alt-is-filename' && i.ids.includes(id));
      expect((await flagged()).length).toBe(1);

      const r = await page.evaluate(i =>
        docsync.api.describeImage(i, 'Governor Green signs [HB 2296]\ninto law'), id);
      expect(r.ok).toBe(true);
      // Brackets would end the alt and a newline the image, so neither lands.
      expect(r.alt).toBe('Governor Green signs HB 2296 into law');
      expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).md, id))
        .toBe('![Governor Green signs HB 2296 into law](assets/signing.jpg)');
      await expect.poll(() => altOn(page, id)).toBe('Governor Green signs HB 2296 into law');
      expect((await flagged()).length).toBe(0);

      await api(page, 'undo()');
      expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).md, id))
        .toBe('![signing.jpg](assets/signing.jpg)');
    });

  test('describeImage refuses what it cannot place, naming the way out',
    async ({ page }) => {
      const two = await addImageBox(page,
        '![a.jpg](assets/signing.jpg) and ![b.jpg](assets/branch-2.jpg)');
      const r = await page.evaluate(i => docsync.api.describeImage(i, 'x'), two);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('assets/branch-2.jpg');           // lists the srcs
      const ok = await page.evaluate(i =>
        docsync.api.describeImage(i, 'Branch two', 'assets/branch-2.jpg'), two);
      expect(ok.ok).toBe(true);
      expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).md, two))
        .toBe('![a.jpg](assets/signing.jpg) and ![Branch two](assets/branch-2.jpg)');

      const plain = (await page.evaluate(() => docsync.api.addTextBox(
        { page: 3, x: 1, y: 4, w: 2, md: 'no picture here' }))).id;
      const none = await page.evaluate(i => docsync.api.describeImage(i, 'x'), plain);
      expect(none.ok).toBe(false);
      expect(none.error).toContain('no markdown image');
      expect((await api(page, `describeImage('text.nope', 'x')`)).ok).toBe(false);
    });

  test('the image\'s menu offers it, starts empty over a file name, and saves to the page',
    async ({ page }) => {
      const id = await addImageBox(page);
      const frame = page.frameLocator('#out');
      const box = frame.locator(`[data-el="${id}"]`);
      await box.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await box.click({ button: 'right' });
      await page.locator('#out').contentFrame()
        .getByRole('button', { name: 'Description (for screen readers)…' }).click();
      const d = await dialog(page);
      // The file name is shown as what it is, not offered as words to keep.
      await expect(d.locator('[name="words"]')).toHaveValue('');
      await expect(d.locator('.dsdlg-field span')).toContainText('signing.jpg');
      await fillDialog(page, { words: 'Lawmakers at the bill signing' });
      await submitDialog(page);
      await expect.poll(() => altOn(page, id)).toBe('Lawmakers at the bill signing');
    });

  test('an empty description marks the image as decoration, which is not flagged',
    async ({ page }) => {
      const id = await addImageBox(page);
      await page.locator('#out').contentFrame().locator(`[data-el="${id}"]`)
        .click({ button: 'right' });
      await page.locator('#out').contentFrame()
        .getByRole('button', { name: 'Description (for screen readers)…' }).click();
      await fillDialog(page, { words: '' });
      await submitDialog(page);
      await expect.poll(() => altOn(page, id)).toBe('');
      expect(((await api(page, 'audit()')).issues || [])
        .filter(i => i.kind === 'alt-is-filename').length).toBe(0);
    });

  test('a box with no image offers no image description', async ({ page }) => {
    const id = (await page.evaluate(() => docsync.api.addTextBox(
      { page: 3, x: 1, y: 1, w: 2, md: 'just words' }))).id;
    await page.locator('#out').contentFrame().locator(`[data-el="${id}"]`)
      .click({ button: 'right' });
    await page.waitForTimeout(300);
    const l = await page.evaluate(() => [...$('out').contentDocument
      .querySelectorAll('.ds-menu button')].map(b => b.textContent.trim()));
    expect(l).not.toContain('Description (for screen readers)…');
  });
});
