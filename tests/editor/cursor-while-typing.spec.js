// While the words of a movable text box are open for typing, the pointer is
// a text caret over the WHOLE box — not the grab hand a movable object shows
// at rest (reported 2026-10-27: "even when editing text, it gives the fist
// drag icon"). Only the grip under the box moves it then.
const { warmTest: test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

test('a box whose words are open shows the text caret, not the grab hand', async ({ page }) => {
  await gotoEditor(page);
  // The first movable object with a slot inside it, clicked at its words.
  const pt = await page.evaluate(() => {
    const fr = document.getElementById('out');
    const d = fr.contentDocument;
    const slot = [...d.querySelectorAll('[data-el] [data-slot], [data-el][data-slot]')]
      .find(s => s.textContent.trim().length > 8 && !s.closest('svg'));
    if (!slot) return null;
    slot.scrollIntoView({ block: 'center' });
    const b = slot.getBoundingClientRect(), fb = fr.getBoundingClientRect();
    const s = fb.width / fr.offsetWidth;
    return { x: fb.left + (b.left + 6) * s, y: fb.top + (b.top + b.height / 2) * s };
  });
  expect(pt).toBeTruthy();
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('out').contentDocument.querySelector('.ds-edit')),
    { timeout: 6000 }).toBe(true);
  const cursors = await page.evaluate(() => {
    const d = document.getElementById('out').contentDocument;
    const host = d.querySelector('.ds-edit');
    const box = host.closest('[data-el]') || host;
    const cs = el => d.defaultView.getComputedStyle(el).cursor;
    return { host: cs(host), box: cs(box) };
  });
  expect(cursors).toEqual({ host: 'text', box: 'text' });
});
