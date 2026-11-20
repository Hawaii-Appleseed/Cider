// An endnote edits where it is read, in a report whose Endnotes section the
// EDITOR placed (layout.json box with act: endnotes — the Wealth Tax Report's
// page 11). Each entry there is a glued part of the section's text box, so a
// click on it used to open the box's heading (or drill into its group) and the
// citation itself could not be reached; endnotes-page.spec.js covers the other
// shape, a renderer that builds its own list (report2027's page 12).
//
// Both directions run through the ONE [[sources]] line: page -> Sources panel,
// Sources panel -> page, the pilot's editSource -> both. ⌘Z takes an edit back
// as one step, and an emptied citation is refused rather than orphaning the
// [^id] tokens that cite it.
const { test, expect, gotoEditor, openSources, settled } = require('./fixtures/editor-test');

const Q = '?project=wealth-tax-report';
const enSel = id => `[data-el="endnote.${id}"]`;

async function firstEndnote(page) {
  return page.evaluate(() => {
    const d = document.querySelector('#out').contentDocument;
    const li = d.querySelector('.ds-endnotes-sec [data-el^="endnote."]');
    const id = li.dataset.el.slice('endnote.'.length);
    const s = parseSources().find(r => r.id === id);
    return { id, text: s.text, url: s.url, cites: citeCount(id) };
  });
}

const srcRow = (page, id) => page.locator('#srcpanel .srcrow',
  { has: page.locator('.srcid', { hasText: `[${id}]` }) });

test.describe('endnote edit in place (placed Endnotes section)', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, Q); });

  test('a click on an endnote opens its citation; the edit reaches Sources, and undo takes it back', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const en = await firstEndnote(page);
    expect(en.cites).toBeGreaterThan(0);
    await openSources(page);
    await expect(srcRow(page, en.id).locator('.srctext')).toHaveValue(en.text);

    // A double-click on the entry opens ITS form — citation text + url — not
    // the section box's heading, and not a drill into the section's group.
    const li = frame.locator(enSel(en.id));
    const form = frame.locator('.ds-endnote-edit');
    await expect(async () => {
      await li.scrollIntoViewIfNeeded();
      // Dispatched on the entry: the floating Sources panel may sit over it,
      // and a real pointer there would land on the panel.
      await li.dispatchEvent('dblclick');
      await form.waitFor({ state: 'visible', timeout: 2000 });
    }).toPass();
    expect(await page.evaluate(() => !!document.querySelector('#out').contentDocument.querySelector('.ds-edit'))).toBe(false);
    await expect(form.locator('.ds-en-text')).toHaveValue(en.text);
    await expect(form.locator('.ds-en-url')).toHaveValue(en.url);

    const before = await page.evaluate(() => readSlot('sources'));
    const edited = en.text + ' (revised on the page)';
    await form.locator('.ds-en-text').fill(edited);
    await form.locator('.ds-en-text').press('Enter');
    await expect(frame.locator(enSel(en.id))).toContainText('(revised on the page)');

    // One source of truth: the [[sources]] line, the Sources panel (open the
    // whole time) and the page all say the new words; the citation still
    // resolves (same count of [^id]) and keeps its number.
    expect(await page.evaluate(id => parseSources().find(r => r.id === id).text, en.id)).toBe(edited);
    await expect(srcRow(page, en.id).locator('.srctext')).toHaveValue(edited);
    expect(await page.evaluate(id => citeCount(id), en.id)).toBe(en.cites);
    expect(await frame.locator(enSel(en.id)).getAttribute('id')).toBe('en1');

    // ⌘Z: one step back to exactly what was there, on the page and in the panel.
    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(() => readSlot('sources'))).toBe(before);
    await expect(frame.locator(enSel(en.id))).not.toContainText('(revised on the page)');
    await expect(srcRow(page, en.id).locator('.srctext')).toHaveValue(en.text);
  });

  test('an edit in the Sources panel redraws the endnote on the page', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const en = await firstEndnote(page);
    await openSources(page);
    const row = srcRow(page, en.id);
    await row.locator('.srctext').fill('Edited in the Sources panel.');
    await row.locator('.srctext').evaluate(el => el.blur());
    await expect(frame.locator(enSel(en.id))).toContainText('Edited in the Sources panel.');
    await expect(frame.locator(enSel(en.id))).not.toContainText(en.text);
  });

  test('emptying an endnote is refused and says why; the citation stays', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const en = await firstEndnote(page);
    const before = await page.evaluate(() => readSlot('sources'));
    const li = frame.locator(enSel(en.id));
    const form = frame.locator('.ds-endnote-edit');
    await expect(async () => {
      await li.scrollIntoViewIfNeeded();
      // Dispatched on the entry: the floating Sources panel may sit over it,
      // and a real pointer there would land on the panel.
      await li.dispatchEvent('dblclick');
      await form.waitFor({ state: 'visible', timeout: 2000 });
    }).toPass();
    await form.locator('.ds-en-text').fill('');
    await form.locator('.ds-en-text').press('Enter');
    await expect(page.locator('#stat')).toContainText('needs its citation text');
    expect(await page.evaluate(() => readSlot('sources'))).toBe(before);
    await expect(frame.locator(enSel(en.id))).toContainText(en.text.slice(0, 30));
  });

  test('pilot editSource rewrites one source, the page and the panel follow, and it undoes', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const en = await firstEndnote(page);
    await openSources(page);
    const r = await page.evaluate(id => docsync.api.editSource(id, { url: 'https://example.org/new' }), en.id);
    expect(r.ok).not.toBe(false);
    expect(r.source).toEqual({ id: en.id, text: en.text, url: 'https://example.org/new' });
    await expect(frame.locator(enSel(en.id))).toContainText('https://example.org/new');
    await expect(srcRow(page, en.id).locator('input').nth(1)).toHaveValue('https://example.org/new');

    const bad = await page.evaluate(id => docsync.api.editSource(id, { text: '  ' }), en.id);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('needs its citation text');
    const none = await page.evaluate(() => docsync.api.editSource('no-such-source', { text: 'x' }));
    expect(none.ok).toBe(false);

    await page.evaluate(() => docsync.api.undo());
    await expect(srcRow(page, en.id).locator('input').nth(1)).toHaveValue(en.url);
    await expect(frame.locator(enSel(en.id))).not.toContainText('https://example.org/new');
  });

  // The section's box is grouped with its rule, so the general ladder (select
  // the group, drill in, type) took three clicks to reach one citation. And
  // the form used to REPLACE the <li>: the open note lost its number and every
  // note after it counted one lower; a three-line citation sat in a one-line
  // input that showed its tail.
  test('one click opens a note in place: its number stays, the whole citation shows, Cancel drops the edit', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const en = await firstEndnote(page);
    const li = frame.locator(enSel(en.id));
    await li.scrollIntoViewIfNeeded();
    const shape = () => page.evaluate(() => {
      const d = document.querySelector('#out').contentDocument;
      const ol = d.querySelector('.ds-endnotes-sec ol');
      return { items: ol.querySelectorAll(':scope > li').length,
               others: ol.querySelectorAll(':scope > :not(li)').length };
    });
    const rest = await shape();
    const drawnH = (await li.boundingBox()).height;
    const before = await page.evaluate(() => readSlot('sources'));

    // Pointing at a note marks THAT note.
    await li.hover({ position: { x: 120, y: 6 } });
    expect(await li.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

    // One real click, nothing selected beforehand.
    await li.click({ position: { x: 120, y: 6 } });
    const form = li.locator('.ds-endnote-edit');
    await expect(form).toBeVisible();
    const txt = form.locator('.ds-en-text');
    await expect(txt).toBeFocused();
    await expect(txt).toHaveValue(en.text);
    await expect(form.locator('.ds-en-url')).toHaveValue(en.url);
    // The note is the thing in hand, not the section's text box.
    expect(await page.evaluate(() => selIds.size)).toBe(0);
    // Still the same list: every entry an <li>, so the numbers do not move.
    expect(await shape()).toEqual(rest);
    expect(await li.getAttribute('id')).toBe('en1');
    // All of the citation is on show: the field holds its words without
    // scrolling, at about the height the note was drawn at.
    const box = await txt.evaluate(el => ({ h: el.clientHeight, sh: el.scrollHeight, tag: el.tagName }));
    expect(box.tag).toBe('TEXTAREA');
    expect(box.sh).toBeLessThanOrEqual(box.h + 1);
    expect(box.h).toBeGreaterThan(drawnH * 0.5);
    // The caret is where the click landed, not a select-all a keystroke wipes.
    const selr = await txt.evaluate(el => [el.selectionStart, el.selectionEnd]);
    expect(selr[0]).toBe(selr[1]);

    // Cancel: nothing written, the note back as it was drawn, no render.
    const renders = await page.locator('#out').getAttribute('data-ds-render');
    await txt.fill(en.text + ' (never kept)');
    await form.locator('.ds-en-cancel').click();
    await expect(form).toHaveCount(0);
    await expect(li).toContainText(en.text.slice(0, 30));
    await expect(li).not.toContainText('(never kept)');
    expect(await page.evaluate(() => readSlot('sources'))).toBe(before);
    expect(await page.locator('#out').getAttribute('data-ds-render')).toBe(renders);
    expect(await page.evaluate(() => editing)).toBe(false);

    // Done saves, as Enter does.
    await li.click({ position: { x: 120, y: 6 } });
    await expect(form).toBeVisible();
    await txt.fill(en.text + ' (kept)');
    await form.locator('.ds-en-done').click();
    await expect(frame.locator(enSel(en.id))).toContainText('(kept)');
    expect(await page.evaluate(id => parseSources().find(r => r.id === id).text, en.id)).toBe(en.text + ' (kept)');
  });

  test('a shift-click still selects the section, and a press that travels still moves it', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const en = await firstEndnote(page);
    const li = frame.locator(enSel(en.id));
    await li.scrollIntoViewIfNeeded();
    await li.click({ position: { x: 120, y: 6 }, modifiers: ['Shift'] });
    await expect(frame.locator('.ds-endnote-edit')).toHaveCount(0);
    expect(await page.evaluate(() => selIds.size)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');

    const sec = frame.locator('.ds-endnotes-sec').first();
    const y0 = (await sec.boundingBox()).y;
    const b = await li.boundingBox();
    await page.mouse.move(b.x + 120, b.y + 6);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + 46, { steps: 6 });
    await page.mouse.up();
    await settled(page);
    await expect(frame.locator('.ds-endnote-edit')).toHaveCount(0);
    expect(Math.abs((await frame.locator('.ds-endnotes-sec').first().boundingBox()).y - y0)).toBeGreaterThan(10);
  });
});
