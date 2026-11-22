// The keymap (2026-11-21): every shortcut is a keymap.bind() row, one listener
// pair per document. These pin the shape of the table and the conflicts it
// fixed: a mode that has a key (an armed anchor, an armed thread) takes it
// alone, where Escape used to cancel the mode AND drop the selection.
const { sharedTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

const PROJ = '?project=uhero-trc-summary';
const addBox = (page, o) => page.evaluate(async o => (await docsync.api.addTextBox(o)).id, o);

test.describe('one keymap', () => {
  test('the table names every shortcut that used to be its own listener', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const rows = await page.evaluate(() => window.__dsKeymap());
    const names = rows.map(r => r.name);
    for (const n of ['close menus', 'save', 'space up', 'page keys', 'chrome keys', 'zoom, space', 'quick apply',
      'quick apply (page)', 'pen: finish', 'anchor: cancel', 'thread: cancel', 'find', 'present',
      'stop following', 'comment', 'comment (page)', 'measure off'])
      expect(names, n).toContain(n);
    // popup scope runs first
    const firstGlobal = rows.findIndex(r => r.scope === 'global');
    expect(rows.slice(firstGlobal).some(r => r.scope === 'popup')).toBe(false);
    // the chrome's object keys never run while a key goes into a field
    expect(rows.find(r => r.name === 'chrome keys').inText).toBe(false);
  });

  for (const where of ['chrome', 'page']) {
    test(`from the ${where}: Escape disarms the anchor and keeps the selection`, async ({ page }) => {
      await gotoEditor(page, PROJ);
      const a = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
      await page.evaluate(id => docsync.api.select(id), a); await settled(page);
      await page.evaluate(id => { anchorArm = id; }, a);
      if (where === 'page') await page.evaluate(() => $('out').contentWindow.focus());
      else await page.evaluate(() => { const x = document.activeElement; if (x && x.blur) x.blur(); });
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => anchorArm)).toBe(null);
      expect(await page.evaluate(() => [...selIds])).toEqual([a]);
      // and a second Escape is the ordinary one again
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => selIds.size)).toBe(0);
    });
  }

  test('a key typed into a field never reaches the object keys', async ({ page }) => {
    await gotoEditor(page, PROJ);
    const a = await addBox(page, { page: 2, x: 1, y: 1, w: 2, md: 'A' });
    await page.evaluate(id => docsync.api.select(id), a); await settled(page);
    const n = await page.evaluate(() => layout.boxes.length);
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'km-probe'; document.body.append(i); i.focus(); });
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Meta+d');
    expect(await page.evaluate(() => layout.boxes.length)).toBe(n);
    await page.evaluate(() => document.getElementById('km-probe').remove());
  });
});
