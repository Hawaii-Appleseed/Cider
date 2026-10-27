// Copy and paste with the REAL keyboard and clipboard, not synthetic events
// (reported 2026-10-27: "copy and paste doesn't seem to work"). Two causes:
//
//   * words copied from anywhere — this editor, a web page, a Doc — reach
//     the paste handler as a bare styled <span>. normaliseForeign unwraps the
//     span, htmlToMd read only ELEMENT children of the result, and a bare run
//     of text read as nothing: the paste was swallowed without a word.
//   * a click opens a box's words, so ⌘C right after one found nothing
//     selected and did nothing; only Escape first (box selected, words
//     closed) made object copy work, and nothing said so.
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const PROJ = '?project=uhero-trc-summary';
const addBox = (page, o) => page.evaluate(async o => (await docsync.api.addTextBox(o)).id, o);
const nBoxes = page => page.evaluate(() => layout.boxes.length);
const hostText = page => page.evaluate(() => { const h = $('out').contentDocument.querySelector('.ds-edit'); return h && h.innerText.trim(); });
async function clickBox(page, id) {
  await page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).scrollIntoView({ block: 'center' }), id);
  await page.waitForTimeout(150);                       // scroll settle
  const b = await page.frameLocator('#out').locator(`[data-el="${id}"]`).first().boundingBox();
  await page.mouse.click(b.x + b.width * 0.4, b.y + 8);
  await expect.poll(() => hostText(page)).not.toBeNull();
}

test('words copied from one box paste into another', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoEditor(page, PROJ);
  const a = await addBox(page, { page: 1, x: 1, y: 2, w: 3, md: 'Alpha words here' });
  const b = await addBox(page, { page: 1, x: 1, y: 4, w: 3, md: 'Beta' });
  await settled(page);
  await clickBox(page, a);
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Meta+c');
  await page.keyboard.press('Escape');
  await clickBox(page, b);
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Meta+v');
  await expect.poll(() => hostText(page)).toBe('Alpha words here');
});

test('⌘C right after a click copies the box, and ⌘V pastes it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoEditor(page, PROJ);
  const a = await addBox(page, { page: 1, x: 1, y: 2, w: 3, md: 'Copy me please' });
  await settled(page);
  const n0 = await nBoxes(page);
  await clickBox(page, a);                              // words open, nothing selected
  await page.keyboard.press('Meta+c');
  expect(await page.evaluate(() => !!clip)).toBe(true);
  expect(await page.evaluate(() => $('out').contentWindow.navigator.clipboard.readText())).toBe('Copy me please');
  await page.keyboard.press('Escape');                  // out of the words, box still selected
  await page.keyboard.press('Meta+v');
  await expect.poll(() => nBoxes(page)).toBe(n0 + 1);
  expect(await page.evaluate(() => layout.boxes[layout.boxes.length - 1].md)).toBe('Copy me please');
});
