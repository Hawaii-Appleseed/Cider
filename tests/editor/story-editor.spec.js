// Story editor (INDESIGN_PARITY.md 63): every slot and text box as plain
// words in one column, page by page in reading order, written back as you go.
const { warmTest: test, expect, gotoEditor, openFileMenu } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

test.describe('63 story editor', () => {
  test('lists the words page by page, a page\'s reading order first', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    const pages = (await api(page, 'stories()')).pages;
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].items.length).toBeGreaterThan(0);
    // Every slot key appears once.
    const keys = pages.flatMap(p => p.items.map(i => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    // Putting a text box first in its page's reading order puts it first here.
    const pid = await page.evaluate(() => pageOrder()[0]);
    const r = await page.evaluate(p => docsync.api.addTextBox({ page: p, x: 1, y: 9, w: 3, md: 'Read me first' }), pid);
    await page.evaluate(([p, id]) => { pushHistory(); setReadingOrder(p, [id]); markDirty(); return render(); }, [pid, r.id]);
    const first = (await api(page, 'stories()')).pages[0].items[0];
    expect(first).toMatchObject({ key: r.id, kind: 'text box', md: 'Read me first' });
  });

  test('editing a piece writes the slot back, one undo step; a refused write is marked', async ({ page }) => {
    await gotoEditor(page, '?project=demo-report');
    await openFileMenu(page);
    await page.click('#file-story');
    await expect(page.locator('#story')).toBeVisible();
    const ta = page.locator('#story textarea').first();
    const key = await ta.getAttribute('data-key');
    const before = await ta.inputValue();
    await ta.fill(before + ' Added in the story editor.');
    await ta.evaluate(t => t.dispatchEvent(new Event('change')));
    await expect.poll(() => page.evaluate(k => k.startsWith('text.') ? boxOf(k).md : readSlot(k), key))
      .toContain('Added in the story editor.');
    // On the page too.
    await expect(page.frameLocator('#out').locator('body')).toContainText('Added in the story editor.');
    // A slot marker on a line of its own is refused, and says so.
    await ta.fill('[[sneaky.key]]');
    await ta.evaluate(t => t.dispatchEvent(new Event('change')));
    await expect(page.locator('#story .st-item.bad')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#story')).toHaveCount(0);
    await page.evaluate(() => undo());
    expect(await page.evaluate(k => k.startsWith('text.') ? boxOf(k).md : readSlot(k), key)).toBe(before);
  });
});
