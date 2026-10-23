// The report/brief templates' cover photo is a full-bleed text box holding only
// a picture. A click on the cover that missed the title opened it for typing,
// so the first keystrokes landed beside `![Cover photo placeholder]`. A click
// now selects it (and moves/resizes it, as ever); a double-click edits; a click
// on the cover's words still types in them.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');
const { removeYmlBindings } = require('./fixtures/host-state');
const { execSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-cover-click';

test.describe.configure({ mode: 'serial' });

for (const template of ['appleseed-report', 'appleseed-brief']) {
  test.describe(template + ' cover', () => {
    test.afterEach(() => {
      removeYmlBindings(SLUG);
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, 'projects', SLUG))}`);
    });

    test('a click on the photo selects it without opening it; the title still types',
      async ({ page, request }) => {
      const j = await (await request.post('/__scaffold', { data: {
        name: 'Cover Click', slug: SLUG, template } })).json();
      expect(j.ok, j.error).toBe(true);
      await gotoEditor(page, `?project=${SLUG}`);
      const frame = page.frameLocator('#out');
      await expect(frame.locator('[data-el="text.tpl-title"]')).toBeVisible({ timeout: 30000 });

      const state = () => page.evaluate(() => ({
        sel: [...selIds], editing: !!editing,
        open: !!document.getElementById('out').contentDocument.querySelector('[contenteditable="true"]'),
      }));
      const photo = await frame.locator('[data-el="text.tpl-photo"]').boundingBox();
      const title = await frame.locator('[data-el="text.tpl-title"]').boundingBox();
      // A point on the photo clear of every other cover element: the strip
      // between the title and the bottom of the page, far left.
      const x = photo.x + photo.width * 0.9, y = photo.y + photo.height * 0.5;
      await page.mouse.click(x, y);
      expect(await state()).toEqual({ sel: ['text.tpl-photo'], editing: false, open: false });

      // Double-click still opens it.
      // Dispatched: the floating strip a selection brings up sits over the
      // pointer on a full-bleed box, so a real second press would hit it.
      await frame.locator('[data-el="text.tpl-photo"] img').dispatchEvent('dblclick');
      await expect.poll(async () => (await state()).editing).toBe(true);
      await page.keyboard.press('Escape');

      // And a single click on words types, as before.
      await page.keyboard.press('Escape');
      await frame.locator('[data-el="text.tpl-title"]').click();
      await expect.poll(async () => (await state()).editing).toBe(true);
    });
  });
}
