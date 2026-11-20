// Working down the endnotes page: the keyboard moves from note to note with
// one render at the end rather than one per note, Escape backs out, a note
// says where it is cited and can be deleted from where it is read, a web
// address typed into the citation's words is offered a move to Link, and the
// Sources panel lists the sources as the page numbers them.
//
// The Wealth Tax Report: an Endnotes section the editor placed, every citation
// in a text box (so content.md alone knows none of the numbers).
const { test, expect, gotoEditor, openSources, settled } = require('./fixtures/editor-test');

const Q = '?project=wealth-tax-report';
const enSel = id => `[data-el="endnote.${id}"]`;
const renders = page => page.locator('#out').getAttribute('data-ds-render');

/** The notes as the page lists them: [{ id, num, text, url, cites }]. */
async function notes(page) {
  return page.evaluate(() => {
    const d = document.querySelector('#out').contentDocument;
    return [...d.querySelectorAll('.ds-endnotes-sec [data-el^="endnote."]')].map(li => {
      const id = li.dataset.el.slice('endnote.'.length);
      const s = parseSources().find(r => r.id === id);
      return { id, num: li.id.replace(/^en/, ''), text: s.text, url: s.url, cites: citeCount(id) };
    });
  });
}

async function open(page, id) {
  const li = page.frameLocator('#out').locator(enSel(id));
  await li.scrollIntoViewIfNeeded();
  await li.click({ position: { x: 120, y: 6 } });
  await expect(li.locator('.ds-endnote-edit')).toBeVisible();
  return li;
}

test.describe('endnotes: working down the list', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, Q); });

  test('Tab saves a note and opens the next with no render between; leaving renders once', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const [a, b] = await notes(page);
    const li = await open(page, a.id);
    const r0 = await renders(page);
    await li.locator('.ds-en-text').fill(a.text + ' (first)');
    await li.locator('.ds-en-text').press('Tab');           // citation -> link
    await expect(li.locator('.ds-en-url')).toBeFocused();
    await li.locator('.ds-en-url').press('Tab');            // link -> the next note
    const next = frame.locator(enSel(b.id));
    await expect(next.locator('.ds-en-text')).toBeFocused();
    await expect(next.locator('.ds-en-text')).toHaveValue(b.text);
    // Saved at once, shown at once, and not one render spent on it.
    expect(await page.evaluate(id => parseSources().find(r => r.id === id).text, a.id)).toBe(a.text + ' (first)');
    await expect(frame.locator(enSel(a.id))).toContainText('(first)');
    await expect(frame.locator('.ds-endnote-edit')).toHaveCount(1);
    expect(await renders(page)).toBe(r0);
    await expect(page.locator('#stat')).toContainText(`editing endnote ${b.num}`);

    // Shift+Tab goes back up; the arrows do the same from a field's end.
    await next.locator('.ds-en-text').press('Shift+Tab');
    await expect(frame.locator(enSel(a.id)).locator('.ds-en-text')).toHaveValue(a.text + ' (first)');
    await frame.locator(enSel(a.id)).locator('.ds-en-url').press('ArrowDown');
    await expect(next.locator('.ds-en-text')).toBeFocused();
    expect(await renders(page)).toBe(r0);

    // Leaving the list with nothing more typed still draws what was saved.
    await next.locator('.ds-en-text').press('Enter');
    await expect(frame.locator('.ds-endnote-edit')).toHaveCount(0);
    await settled(page);
    expect(+(await renders(page))).toBe(+r0 + 1);
    await expect(frame.locator(enSel(a.id))).toContainText('(first)');

    await page.evaluate(() => docsync.api.undo());
    expect(await page.evaluate(id => parseSources().find(r => r.id === id).text, a.id)).toBe(a.text);
  });

  test('Escape drops what was typed; an emptied note will not let Tab leave it', async ({ page }) => {
    const [a] = await notes(page);
    const before = await page.evaluate(() => readSlot('sources'));
    let li = await open(page, a.id);
    await li.locator('.ds-en-text').fill('thrown away');
    await li.locator('.ds-en-text').press('Escape');
    await expect(li.locator('.ds-endnote-edit')).toHaveCount(0);
    await expect(li).toContainText(a.text.slice(0, 30));
    expect(await page.evaluate(() => readSlot('sources'))).toBe(before);

    li = await open(page, a.id);
    await li.locator('.ds-en-text').fill('');
    await li.locator('.ds-en-url').press('Tab');
    await expect(page.locator('#stat')).toContainText('needs its citation text');
    await expect(li.locator('.ds-endnote-edit')).toBeVisible();
    await li.locator('.ds-en-cancel').click();
    expect(await page.evaluate(() => readSlot('sources'))).toBe(before);
  });

  test('a web address in the citation text is offered a move to Link', async ({ page }) => {
    const [a] = await notes(page);
    await page.evaluate(id => docsync.api.editSource(id, {
      text: 'Agency, “A Report,” Table 2, https://example.org/a/b/. Filers reported more.', url: '' }), a.id);
    await settled(page);
    const li = await open(page, a.id);
    const hint = li.locator('.ds-en-hint');
    await expect(hint).toBeVisible();
    await hint.locator('.ds-en-lift').click();
    await expect(li.locator('.ds-en-url')).toHaveValue('https://example.org/a/b/');
    await expect(li.locator('.ds-en-text')).toHaveValue('Agency, “A Report,” Table 2. Filers reported more.');
    await expect(hint).toBeHidden();
    await li.locator('.ds-en-done').click();
    await expect(page.frameLocator('#out').locator(enSel(a.id)).locator('a[href="https://example.org/a/b/"]')).toHaveCount(1);
    // A note that already has a link, or no address in its words, is not nagged.
    const li2 = await open(page, a.id);
    await expect(li2.locator('.ds-en-hint')).toBeHidden();
  });

  test('a note says where it is cited and goes there; Delete takes its citations with it', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const all = await notes(page);
    const a = all[0];
    const li = await open(page, a.id);
    const go = li.locator('.ds-en-goto');
    await expect(go).toHaveCount(a.cites);
    await expect(go.first()).toHaveText(/^p\. \d+$/);
    await go.first().click();
    await expect(page.locator('#stat')).toContainText(`endnote ${a.num} is cited here`);
    await expect(frame.locator('.ds-endnote-edit')).toHaveCount(0);
    const marker = frame.locator(`section.page a[href="#en${a.num}"]`).first();
    await expect(marker).toBeInViewport();

    const li2 = await open(page, a.id);
    await li2.locator('.ds-en-del').click();
    await expect(page.locator('dialog[open]')).toContainText(`Delete endnote ${a.num}`);
    await page.locator('dialog[open] button.dsdlg-ok').click();
    await expect(frame.locator(enSel(a.id))).toHaveCount(0);
    expect(await page.evaluate(id => citeCount(id), a.id)).toBe(0);
    expect(await page.evaluate(id => parseSources().some(r => r.id === id), a.id)).toBe(false);
    // The list closed up: what was note 2 is note 1.
    expect(await frame.locator(enSel(all[1].id)).getAttribute('id')).toBe('en1');

    await page.evaluate(() => docsync.api.undo());
    await settled(page);
    expect(await page.evaluate(id => citeCount(id), a.id)).toBe(a.cites);
    expect(await frame.locator(enSel(a.id)).getAttribute('id')).toBe('en1');
  });

  test('the Sources panel lists sources as the page numbers them, and the two point at each other', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const all = await notes(page);
    await openSources(page);
    const rows = page.locator('#srcpanel .srcrow');
    // In endnote order, each row led by its number.
    const shown = await rows.evaluateAll(rs => rs.map(r => [r.dataset.sid, r.querySelector('.srcnum').textContent]));
    expect(shown.slice(0, all.length)).toEqual(all.map(n => [n.id, n.num]));
    await expect(page.locator('#src-bynum')).toHaveClass(/on/);
    await expect(rows.first().locator('.srcren', { hasText: '↑' })).toHaveCount(0);
    // A number in the search box is that endnote.
    await page.locator('#src-q').fill(all[2].num);
    await expect(rows).toHaveCount(1);
    expect(await rows.first().getAttribute('data-sid')).toBe(all[2].id);
    await page.locator('#src-q').fill('');
    // A row's number shows its note on the page.
    const last = all[all.length - 1];
    await page.locator(`#srcpanel .srcrow[data-sid="${last.id}"] .srcnum`).click();
    await expect(frame.locator(enSel(last.id))).toBeInViewport();
    // Opening a note marks its row. Dispatched: the panel floats over the page.
    await frame.locator(enSel(all[1].id)).dispatchEvent('dblclick');
    await expect(frame.locator('.ds-endnote-edit')).toBeVisible();
    await expect(page.locator(`#srcpanel .srcrow[data-sid="${all[1].id}"]`)).toHaveClass(/on/);
    await frame.locator('.ds-en-cancel').click();
    // Declared order brings the arrows back.
    await page.locator('#src-bynum').click();
    await expect(rows.first().locator('.srcren', { hasText: '↓' })).toHaveCount(1);
  });
});
