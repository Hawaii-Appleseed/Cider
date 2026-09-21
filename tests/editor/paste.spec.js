// Paste sanitizing (docsync/editor/edit.html pasteClean). Pasting from Word
// or Google Docs used to drop their whole markup into the page; none of it
// survived htmlToMd at commit, so the structure vanished silently minutes
// later. Now the clipboard is normalized through the report's OWN grammar on
// the way in, so what lands on the page is what will render. Local mode.
const { test, expect, gotoEditor, fillDialog, submitDialog, clickAddSection } = require('./fixtures/editor-test');

let counter = 0;

/** A +Section overflow slot: block_html's grammar, so lists and headings are
 *  real there — the richest paste target the report has. */
async function openSection(page) {
  await clickAddSection(page);
  await fillDialog(page, { page: 'basics', slug: 'paste-' + (++counter) });
  await submitDialog(page);
  const ta = page.frameLocator('#out').locator('.ds-edit');
  await ta.waitFor({ state: 'visible' });
  return ta;
}

/** Fire a real paste through the editor's own handler. Playwright cannot
 *  populate the OS clipboard with text/html, and a synthetic ClipboardEvent
 *  is untrusted so it never triggers the browser's own paste — but it does
 *  reach an explicit listener, which is exactly the code under test. */
async function pasteHtml(page, html, selectAll = false) {
  await page.evaluate(({ html, selectAll }) => {
    const d = document.querySelector('#out').contentDocument;
    const host = d.querySelector('.ds-edit');
    host.focus();
    const r = d.createRange();
    r.selectNodeContents(host);
    if (!selectAll) r.collapse(false);          // caret at the end
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', html.replace(/<[^>]+>/g, ''));
    // Not passed through the constructor: Gecko accepts the option but hands
    // the event a NEUTERED clipboardData whose getData returns "" — every
    // paste spec then failed on Firefox with an empty host while real user
    // pastes (trusted events, real clipboard) work fine. An own property
    // shadows the getter in every engine, so the handler under test reads
    // the actual payload everywhere.
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    host.dispatchEvent(ev);
  }, { html, selectAll });
  await page.waitForTimeout(150);
}

const md = page => page.evaluate(() => {
  const host = document.querySelector('#out').contentDocument.querySelector('.ds-edit');
  return htmlToMd(host, { allowLists: true });
});

test.describe('paste', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('keeps the formatting the report supports', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p></p>'; });
    await pasteHtml(page, '<p>plain <b>bold</b> and <i>ital</i> and ' +
      '<a href="https://example.com/x">a link</a></p>', true);

    expect(await md(page)).toBe('plain **bold** and *ital* and [a link](https://example.com/x)');
  });

  test('strips styling the report cannot render, keeping the words', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p></p>'; });
    // The shape Word and Google Docs actually paste: nested style carriers.
    await pasteHtml(page,
      '<p class="MsoNormal"><span style="font-family:Calibri;color:#FF0000;font-size:14pt">' +
      'red <b>and bold</b></span></p>', true);

    const out = await md(page);
    expect(out).toContain('red');
    expect(out).toContain('**and bold**');   // supported formatting survives
    expect(out).not.toContain('style');      // the rest does not
    expect(out).not.toContain('span');
  });

  test('a Google Doc pastes as its own paragraphs, with its bold and italic',
    async ({ page }) => {
      const ta = await openSection(page);
      await ta.evaluate(el => { el.innerHTML = '<p></p>'; });
      // What Google Docs actually puts on the clipboard: the whole copied
      // range inside a <b style="font-weight:normal"> marker, every paragraph
      // nested in it, and weight/slant written on <span style> rather than as
      // <b>/<i>. Taken literally that was one paragraph, entirely bold, with
      // no emphasis of its own.
      const DOC =
        '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1">' +
        '<p dir="ltr"><span style="font-weight:400;font-style:normal;' +
        'text-decoration:none">Plain then </span>' +
        '<span style="font-weight:700;text-decoration:none">bold</span>' +
        '<span style="font-weight:400;font-style:italic">, then slanted</span></p>' +
        '<p dir="ltr"><span style="font-weight:400;text-decoration:underline">' +
        'A second paragraph</span></p></b>';
      await pasteHtml(page, DOC, true);

      expect(await md(page)).toBe(
        'Plain then **bold***, then slanted*\n\n__A second paragraph__');
    });

  test('a pasted list stays a list, and a pasted heading stays a heading', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p></p>'; });
    await pasteHtml(page, '<h2>A heading</h2><ul><li>one</li><li>two</li></ul>', true);

    expect(await md(page)).toBe('## A heading\n\n- one\n- two');
  });

  test('structure the renderer has no grammar for flattens on the way IN, not silently at commit', async ({ page }) => {
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p></p>'; });
    // A table and a nested list: content.py can render neither.
    await pasteHtml(page,
      '<table><tr><td>cell A</td><td>cell B</td></tr></table>' +
      '<ul><li>outer<ul><li>inner</li></ul></li></ul>', true);

    const shown = await ta.evaluate(el => el.innerHTML);
    expect(shown).not.toContain('<table');
    // What the editor SHOWS already equals what a commit would keep — the
    // whole point: no structure disappears later.
    const committed = await md(page);
    const reshown = await page.evaluate(m => {
      const div = document.createElement('div');
      div.innerHTML = mdToHtml(m, { allowLists: true });
      return htmlToMd(div, { allowLists: true });
    }, committed);
    expect(reshown).toBe(committed);
    expect(committed).toContain('cell A');
    expect(committed).toContain('inner');
  });

  // Pasting INTO a paragraph, rather than into an emptied editor. Every test
  // above either selects all first or drops the caret at the very end of an
  // empty block, so none of them ever put the caret inside live prose — which
  // is where this broke: mdToHtml wraps everything in a block, even one word,
  // so the paste arrived as <p>WORD</p> INSIDE the caret's own <p>. That is
  // not valid HTML and the browser lays the inner one out as its own block,
  // so the pasted word jumped to the next line. htmlToMd flattened it again
  // at commit, so nothing was ever lost and the next render quietly put it
  // back — which is exactly why it read as happening only "sometimes".
  test('a word pasted mid-paragraph joins the line instead of breaking it',
    async ({ page }) => {
      const ta = await openSection(page);
      await ta.evaluate(el => { el.innerHTML = '<p>Alpha beta gamma delta.</p>'; });

      await page.evaluate(() => {
        const d = document.querySelector('#out').contentDocument;
        const host = d.querySelector('.ds-edit');
        host.focus();
        const tn = d.createTreeWalker(host, NodeFilter.SHOW_TEXT).nextNode();
        const r = d.createRange();
        r.setStart(tn, 11); r.collapse(true);       // "Alpha beta |gamma…"
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
        const dt = new DataTransfer();
        dt.setData('text/plain', 'WORD');
        // Same Gecko shim as pasteHtml: the constructor neuters the payload.
        const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', { value: dt });
        host.dispatchEvent(ev);
      });
      await page.waitForTimeout(200);

      // One paragraph, and no block nested inside it.
      expect(await ta.evaluate(el => el.querySelectorAll('p').length)).toBe(1);
      expect(await ta.evaluate(el => el.innerHTML)).toBe('<p>Alpha beta WORDgamma delta.</p>');
      expect(await md(page)).toBe('Alpha beta WORDgamma delta.');
    });

  test('several pasted paragraphs are still several paragraphs', async ({ page }) => {
    // The other side of the rule above: a real multi-block paste must not be
    // flattened into the caret's paragraph just because one block is.
    const ta = await openSection(page);
    await ta.evaluate(el => { el.innerHTML = '<p></p>'; });
    await pasteHtml(page, '<p>first para</p><p>second para</p>', true);
    expect(await md(page)).toBe('first para\n\nsecond para');
  });

  test('a plain-text slot takes the text literally — pasted stars stay stars', async ({ page }) => {
    const frame = page.frameLocator('#out');
    // cover.title is not run through md_inline, so it gets no markdown.
    await frame.locator('[data-slot="cover.title"]').dblclick({ force: true });
    await frame.locator('.ds-edit').waitFor({ state: 'visible' });
    await pasteHtml(page, '<p>**not bold**</p>', true);

    const text = await frame.locator('.ds-edit').evaluate(el => el.textContent);
    expect(text).toContain('**not bold**');
    expect(await frame.locator('.ds-edit b').count()).toBe(0);
  });
});
