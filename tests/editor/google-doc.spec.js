// Linking a report to a Google Doc, and bringing that doc's text in.
//
// The matching itself (which section lands in which slot) is Python, covered
// by docsync/test_docsync.py. What is only testable here is the half a person
// touches: the File-menu rows appear when they should, the link is recorded
// server-side rather than in this browser, the review list defaults guesses to
// Skip, and an approved import lands as ONE undo step through the pilot's
// batch — which is the whole reason it goes through batch rather than a loop
// of setSlot calls.
const { test, expect, gotoEditor, openFileMenu, dialog, fillDialog,
        submitDialog, PING, EVENTS } = require('./fixtures/editor-test');

const FAKE_DOC = 'FAKEDOCID_0123456789';

/** The server's word on which doc is linked, faked where the editor reads it.
 *  The editor takes DOC from every /__ping and /__events payload (the server
 *  is the truth, so a doc linked in one tab shows in all of them), and the
 *  suite's server has none linked. Setting DOC in the page alone was undone by
 *  the next heartbeat whenever one landed before the menu was read: "Google
 *  Doc…" where "Google Doc: linked" was due, a flake on CI. So each ping says
 *  what the test has linked, and the event stream is refused, leaving the
 *  editor's own poll as its one source. Installed before the editor boots. */
async function fakeServerDoc(page) {
  let linked = '';
  await page.route(PING, async route => {
    const r = await route.fetch();
    const j = await r.json();
    await route.fulfill({ response: r, json: linked ? { ...j, doc: linked } : j });
  });
  await page.route(EVENTS, route => route.abort());
  return { link: id => { linked = id; } };
}

/** Pretend a doc is linked, without writing one into this repo's docsync.yml:
 *  the server says so from now on, and the page is told at once. */
const linkDoc = async (page, server, id = FAKE_DOC) => {
  server.link(id);
  await page.evaluate(v => { DOC = v; }, id);
};

/** A slot with enough words in it to be worth replacing, read from the report
 *  itself so this spec does not pin the fixture's key names. */
const aSlotKey = (page) => page.evaluate(() =>
  docsync.api.inventory().pages
    .flatMap(p => p.slots).find(s => (s.text || '').length > 30).key);

test.describe('Google Doc link', () => {
  let server;
  test.beforeEach(async ({ page }) => { server = await fakeServerDoc(page); await gotoEditor(page); });

  test('the link row is offered, and Import only once a doc is linked', async ({ page }) => {
    await openFileMenu(page);
    await expect(page.locator('#file-doc')).toBeVisible();
    await expect(page.locator('#file-doc .shp-t')).toHaveText('Google Doc…');
    // Nothing to import from yet — a row that could only refuse is not shown.
    await expect(page.locator('#file-docimport')).toBeHidden();
    // Close it the way the toolbar does — Escape belongs to the canvas, not
    // to the menu, and leaves the popover standing.
    await page.click('#file');
    await expect(page.locator('#filepop')).toBeHidden();

    await linkDoc(page, server);
    await openFileMenu(page);
    await expect(page.locator('#file-doc .shp-t')).toHaveText('Google Doc: linked');
    await expect(page.locator('#file-docimport')).toBeVisible();
  });

  test('the pasted link goes to the server, not to this browser', async ({ page }) => {
    let sent = null;
    await page.route(/\/__doc(\?|$)/, route => {
      sent = route.request().postDataJSON();
      server.link(FAKE_DOC);          // as the real one would, from here on
      return route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({ ok: true, doc: FAKE_DOC }) });
    });
    await openFileMenu(page);
    await page.click('#file-doc');
    await fillDialog(page, { url: `https://docs.google.com/document/d/${FAKE_DOC}/edit` });
    await submitDialog(page);
    expect(sent.url).toContain(FAKE_DOC);
    expect(sent.project).toBeTruthy();
    // And the menu now knows, without a reload.
    await openFileMenu(page);
    await expect(page.locator('#file-doc .shp-t')).toHaveText('Google Doc: linked');
  });

  test('the server refusing a bad link is reported, and nothing is linked', async ({ page }) => {
    await page.route(/\/__doc(\?|$)/, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'that does not look like a Google Doc link' }) }));
    await openFileMenu(page);
    await page.click('#file-doc');
    await fillDialog(page, { url: 'my report' });
    await submitDialog(page);
    await expect(page.locator('#stat')).toContainText('does not look like');
    await openFileMenu(page);
    await expect(page.locator('#file-docimport')).toBeHidden();
  });
});

test.describe('importing the doc’s text', () => {
  let server;
  test.beforeEach(async ({ page }) => { server = await fakeServerDoc(page); await gotoEditor(page); });

  /** Answer /__doc/import with proposals aimed at a real slot of this report. */
  async function stubImport(page, rows, extra = {}) {
    await page.route(/\/__doc\/import(\?|$)/, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, doc: FAKE_DOC, mode: 'prose',
                             unknown: [], slots: rows.map(r => r.key).filter(Boolean),
                             rows, ...extra }) }));
    await linkDoc(page, server);
  }

  test('an approved import lands, and is ONE undo step', async ({ page }) => {
    const key = await aSlotKey(page);
    const before = await page.evaluate(k => docsync.api.getSlot(k).md, key);
    await stubImport(page, [
      { key, md: 'Imported from the Google Doc.', how: 'heading', score: 1,
        was: before, note: '' },
    ]);
    await openFileMenu(page);
    await page.click('#file-docimport');
    const d = await dialog(page);
    await expect(d.locator('.dsimp-row')).toHaveCount(1);
    // A confident match arrives ticked — the person confirms, not re-does.
    await expect(d.locator('.dsimp-row input[type=checkbox]')).toBeChecked();
    await submitDialog(page);
    await expect.poll(() => page.evaluate(k => docsync.api.getSlot(k).md, key))
      .toBe('Imported from the Google Doc.');
    await expect(page.locator('#stat')).toContainText('imported 1 section');

    // One batch means one history entry: a single undo puts the whole import
    // back, however many slots it wrote.
    await page.evaluate(() => docsync.api.undo());
    await expect.poll(() => page.evaluate(k => docsync.api.getSlot(k).md, key))
      .toBe(before);
  });

  test('guesses and unmatched sections start unticked and are left alone', async ({ page }) => {
    const key = await aSlotKey(page);
    const before = await page.evaluate(k => docsync.api.getSlot(k).md, key);
    await stubImport(page, [
      { key, md: 'A positional guess.', how: 'position', score: 0, was: before,
        note: 'matched by position only' },
      { key: '', md: 'Orphan section text.', how: 'none', score: 0, was: '',
        note: 'no slot matched this section' },
    ], { slots: [key] });
    await openFileMenu(page);
    await page.click('#file-docimport');
    const d = await dialog(page);
    await expect(d.locator('.dsimp-row')).toHaveCount(2);
    const boxes = d.locator('.dsimp-row input[type=checkbox]');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    // Nothing ticked is refused rather than silently doing nothing.
    await d.locator('.dsdlg-ok').click();
    await expect(d.locator('.dsdlg-err')).toContainText('Nothing is ticked');
    // Ticking the guess imports exactly it, and only it.
    await boxes.nth(0).check();
    await submitDialog(page);
    await expect.poll(() => page.evaluate(k => docsync.api.getSlot(k).md, key))
      .toBe('A positional guess.');
  });

  test('choosing a slot for an unmatched section ticks it', async ({ page }) => {
    const key = await aSlotKey(page);
    await stubImport(page, [
      { key: '', md: 'Orphan section text.', how: 'none', score: 0, was: '', note: '' },
    ], { slots: [key] });
    await openFileMenu(page);
    await page.click('#file-docimport');
    const d = await dialog(page);
    await d.locator('.dsimp-row select').selectOption(key);
    await expect(d.locator('.dsimp-row input[type=checkbox]')).toBeChecked();
    await submitDialog(page);
    await expect.poll(() => page.evaluate(k => docsync.api.getSlot(k).md, key))
      .toBe('Orphan section text.');
  });

  test('two sections aimed at one slot are refused, not silently merged', async ({ page }) => {
    const key = await aSlotKey(page);
    await stubImport(page, [
      { key, md: 'First.', how: 'heading', score: 1, was: '', note: '' },
      { key, md: 'Second.', how: 'heading', score: 1, was: '', note: '' },
    ], { slots: [key] });
    await openFileMenu(page);
    await page.click('#file-docimport');
    const d = await dialog(page);
    await d.locator('.dsdlg-ok').click();
    await expect(d.locator('.dsdlg-err')).toContainText('Two sections are aimed at');
    await expect(d).toBeVisible();
  });

  test('a doc that matched nothing says so instead of opening an empty list', async ({ page }) => {
    await page.route(/\/__doc\/import(\?|$)/, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, doc: FAKE_DOC, mode: 'prose',
                             unknown: [], slots: [], rows: [] }) }));
    await linkDoc(page, server);
    await openFileMenu(page);
    await page.click('#file-docimport');
    const d = await dialog(page);
    await expect(d.locator('.dsdlg-msg')).toContainText('Nothing in that doc matched');
  });

  test('a doc the server cannot read is reported without opening a dialog', async ({ page }) => {
    await page.route(/\/__doc\/import(\?|$)/, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Google would not hand over that doc.' }) }));
    await linkDoc(page, server);
    await openFileMenu(page);
    await page.click('#file-docimport');
    await expect(page.locator('#stat')).toContainText('Google would not hand over');
    await expect(page.locator('dialog.dsdlg')).toHaveCount(0);
  });
});

// The server half, exercised for real against the suite's own dev server.
// Both of these are harmless through the `request` fixture: the refusal path
// answers before writing anything, and the import path only READS content.md
// (its `md` opt-in exists so the matcher can run without reaching Google).
test.describe('the server endpoints', () => {
  const post = (request, path, body) =>
    request.post(`http://localhost:${process.env.PRIMER_TEST_PORT || 8199}${path}`,
                 { data: body }).then(r => r.json());

  test('a link that is not a Google Doc URL is refused before anything is written',
    async ({ request }) => {
      const j = await post(request, '/__doc',
                           { project: 'budget-primer', url: 'my report' });
      expect(j.ok).toBe(false);
      expect(j.error).toMatch(/does not look like a Google Doc link/);
    });

  test('an import proposes real slots of this report', async ({ request }) => {
    const j = await post(request, '/__doc/import', {
      project: 'budget-primer', doc: FAKE_DOC,
      md: '[[cover.title]]\nA doc-written title\n',
    });
    expect(j.ok).toBe(true);
    expect(j.mode).toBe('markers');
    expect(j.rows).toContainEqual(expect.objectContaining(
      { key: 'cover.title', md: 'A doc-written title', how: 'marker' }));
    // Every key of the report comes back, so the review dialog can offer any
    // of them as a target for a section that matched nothing.
    expect(j.slots.length).toBeGreaterThan(5);
  });

  test('an import against an unknown project is refused', async ({ request }) => {
    const j = await post(request, '/__doc/import', { project: 'no-such', md: 'x' });
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/unknown project/);
  });
});
