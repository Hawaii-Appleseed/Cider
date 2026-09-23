// Nested bullets (docsync/editor/edit.html's listItems/listsHtml/listToMd +
// indentListItem, mirrored by docsync/content.py's _list_items/_lists_html).
// Creating a bullet already worked; INDENTING one did not — nothing built
// nesting, htmlToMd flattened any that existed, and block_html stripped the
// leading spaces on the way back out. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

test.describe('nested bullets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('markdown -> html -> markdown keeps every level', async ({ page }) => {
    const r = await page.evaluate(() => {
      const md = '- top one\n- top two\n  - nested a\n  - nested b\n    - deeper\n- top three';
      const holder = document.createElement('div');
      holder.innerHTML = mdToHtml(md, { allowLists: true });
      return { html: holder.innerHTML, back: htmlToMd(holder, { allowLists: true }) };
    });
    // The sub-list is a CHILD of its parent <li>, which is what makes it nest.
    expect(r.html).toContain('<li>top two<ul><li>nested a</li>');
    expect(r.html).toContain('<li>nested b<ul><li>deeper</li></ul></li>');
    expect(r.back).toBe(
      '- top one\n- top two\n  - nested a\n  - nested b\n    - deeper\n- top three');
  });

  test('a numbered sub-list nests inside a bulleted parent', async ({ page }) => {
    const html = await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.innerHTML = mdToHtml('- alpha\n  1. one\n  2. two\n- beta', { allowLists: true });
      return holder.innerHTML;
    });
    expect(html).toContain('<li>alpha<ol><li>one</li><li>two</li></ol></li>');
  });

  test('Tab nests the item the caret is in; Shift-Tab lifts it back out', async ({ page }) => {
    const r = await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.innerHTML = mdToHtml('- one\n- two\n- three', { allowLists: true });
      document.body.appendChild(holder);
      holder.contentEditable = 'true';
      const caretInto = i => {
        const li = holder.querySelectorAll('li')[i];
        const range = document.createRange();
        range.setStart(li.firstChild, 1);
        range.collapse(true);
        const sel = document.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      };
      caretInto(1);
      indentListItem(document, 1);
      const afterIn = htmlToMd(holder, { allowLists: true });
      const caretIn = document.getSelection().anchorOffset;
      indentListItem(document, -1);
      const afterOut = htmlToMd(holder, { allowLists: true });
      caretInto(0);
      const swallowed = indentListItem(document, 1);
      holder.remove();
      return { afterIn, afterOut, caretIn, swallowed };
    });
    expect(r.afterIn).toBe('- one\n  - two\n- three');
    expect(r.afterOut).toBe('- one\n- two\n- three');
    // The <li> is MOVED, so the caret keeps its offset instead of jumping to
    // the end of the line — Tab has to be usable mid-word.
    expect(r.caretIn).toBe(1);
    // The first item of a list has nothing to nest under, but Tab is still
    // swallowed: letting it through moves focus out and commits the edit.
    expect(r.swallowed).toBe(true);
  });

  test('indenting a real list slot survives the save and the re-render',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      const slot = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const ul = [...d.querySelectorAll('ul[data-slot]')].find(u => u.children.length >= 2);
        return ul ? ul.dataset.slot : null;
      });
      expect(slot).not.toBeNull();

      const ul = frame.locator(`[data-slot="${slot}"]`);
      await ul.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await ul.dblclick();
      await page.waitForTimeout(700);
      await expect(frame.locator('.ds-edit')).toHaveCount(1);

      await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const li = d.querySelector('.ds-edit li:nth-child(2)');
        const r = d.createRange();
        r.setStart(li.firstChild, 1); r.collapse(true);
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      await frame.locator('.ds-edit').press('Tab');
      await page.waitForTimeout(300);
      await expect(frame.locator('.ds-edit li ul li')).toHaveCount(1);

      // Blur commits. Escape would DISCARD, which is a different test.
      await page.evaluate(() => document.getElementById('out').contentDocument
        .querySelector('.ds-edit')?.blur());
      await page.waitForTimeout(2500);

      // content.md carries Markdown's two-space indent...
      const md = await page.evaluate(s => readSlot(s), slot);
      expect(md).toMatch(/\n {2}- /);
      // ...and the Python renderer builds the sub-list back out of it.
      await expect(frame.locator(`[data-slot="${slot}"] li ul li`)).toHaveCount(1);
    });
});
