// A failure a person can see.
//
// The status line is one line, clipped to the toolbar and overwritten by the
// next drag frame. A Save that failed was said there once; a draft that would
// not build replaced the whole report with six lines of Python traceback; and
// "public site NOT updated" was hover text. Each is now a message in the band
// above the page that stays until it is no longer true (or is dismissed), in
// plain words, with the next step as a button.
const { test, expect, gotoEditor, PING, submitDialogIfPresent, settled } = require('./fixtures/editor-test');

const SAVE = /\/__save(\?|$)/, EXPORT = /\/__export(\?|$)/;
const flagOf = (page, key) => page.locator(`#notices .ds-flag[data-flag="${key}"]`);

test.describe('a save that failed', () => {
  test('stays said above the page until a save lands, and Try again saves', async ({ page, context }) => {
    await context.route(PING, r => r.fulfill({ json: { ok: true, v: 1, ahead: 0 } }));
    await gotoEditor(page);
    let fail = true;
    await context.route(SAVE, r => fail
      ? r.fulfill({ json: { ok: false, error: 'git commit failed:\nokina: fake ʻokina found\n  content.md:12' } })
      : r.fulfill({ json: { ok: true, message: 'saved locally', ahead: 1 } }));
    await page.evaluate(() => { source = original + '\nWords before Save.\n'; markDirty(); });
    page.click('#save').catch(() => {});
    await submitDialogIfPresent(page, 1500);
    const f = flagOf(page, 'save');
    await expect(f).toBeVisible();
    await expect(f.locator('.ds-flag-t')).toContainText('Not saved: git commit failed.');
    await expect(f.locator('details')).toContainText('content.md:12');   // the whole of it, a click away
    await expect(f.locator('.ds-note-x')).toHaveCount(0);            // not dismissible: it is still true
    // The status line moves on; the message does not.
    await page.evaluate(() => { $('stat').textContent = 'moved 0.25in'; });
    await expect(f).toBeVisible();
    fail = false;
    f.getByRole('button', { name: 'Try again' }).click().catch(() => {});
    await submitDialogIfPresent(page, 1500);
    await expect(page.locator('#stat')).toHaveText('saved locally', { timeout: 5000 });
    await expect(f).toHaveCount(0);
    await expect(page.locator('#notices')).toBeHidden();
  });

  test('undoing back to the saved state takes the message down', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => {
      source = original + '\nWords.\n'; markDirty();
      flag('save', 'Not saved: the hub did not answer.', { keep: true });
    });
    await expect(flagOf(page, 'save')).toBeVisible();
    await page.evaluate(() => { source = original; markDirty(); });
    await expect(flagOf(page, 'save')).toHaveCount(0);
  });
});

test.describe('a change that cannot be drawn', () => {
  test('keeps the last page on screen, says why in plain words, and Undo it brings the draft back', async ({ page }) => {
    await gotoEditor(page);
    const pages = () => page.frameLocator('#out').locator('section.page').count();
    const n = await pages();
    expect(n).toBeGreaterThan(3);
    await page.evaluate(async () => {
      pushHistory();
      source = source.replace(/\[\[sources\]\]/, '[[sources]]\nBROKEN LINE NO COLON');
      markDirty();
      await render();
    });
    expect(await page.evaluate(() => renderFailed)).toBe(true);
    await expect(page.locator('#stat')).toContainText('does not build');
    // The report is still there, not a page of red monospace.
    expect(await pages()).toBe(n);
    expect(await page.evaluate(() => /does not build|Traceback/.test($('out').contentDocument.body.textContent))).toBe(false);
    const f = flagOf(page, 'build');
    await expect(f).toBeVisible();
    const said = await f.locator('.ds-flag-t').evaluate(el => el.firstChild.textContent);
    expect(said).toMatch(/^The last change can’t be drawn: /);
    expect(said).toContain('The page below is from before it');
    expect(said).not.toMatch(/Traceback|File "|Error:/);          // the reason, not the stack
    await expect(f.locator('details pre')).not.toBeEmpty();        // which is one click away
    await f.getByRole('button', { name: 'Undo it' }).click();
    await expect.poll(() => page.evaluate(() => renderFailed)).toBe(false);
    await settled(page);
    await expect(f).toHaveCount(0);
    expect(await pages()).toBe(n);
    expect(await page.evaluate(() => /BROKEN LINE/.test(source))).toBe(false);
  });

  test('fixing the words by hand recovers too, onto the page that was kept', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(async () => {
      source = source.replace(/\[\[sources\]\]/, '[[sources]]\nBROKEN LINE NO COLON');
      await render();
    });
    await expect(flagOf(page, 'build')).toBeVisible();
    await page.evaluate(async () => {
      source = source.replace('\nBROKEN LINE NO COLON', '');
      writeSlot('basics.h1', 'A heading typed after the fix');
      await render();
    });
    await expect(flagOf(page, 'build')).toHaveCount(0);
    await expect(page.frameLocator('#out').locator('[data-slot="basics.h1"]').first()).toHaveText('A heading typed after the fix');
  });
});

test.describe('a result that used to be hover text', () => {
  test('the public site: publishing, then NOT updated stays with its reason; updated carries the link', async ({ page }) => {
    await gotoEditor(page);
    const run = site => page.evaluate(async site => {
      const realSite = window.docStoreSite, realTimeout = window.setTimeout;
      window.setTimeout = f => realTimeout(f, 0);
      let n = 0; const seen = [];
      window.docStoreSite = async () => {
        const f = document.querySelector('#notices .ds-flag[data-flag="site"]');
        seen.push(f ? f.className + ' | ' + f.querySelector('.ds-flag-t').textContent : null);
        return ++n < 2 ? null : site;
      };
      await docStoreAwaitSite('v2', 'published ✓ — Org/Repo@hub/p abc1234', false);
      // Read at once: good news takes itself down on a timer, and this
      // test's clock runs every timer immediately.
      const f = document.querySelector('#notices .ds-flag[data-flag="site"]'), a = f && f.querySelector('a');
      seen.end = f && { cls: f.className, text: f.querySelector('.ds-flag-t').textContent, href: a && a.getAttribute('href') };
      window.docStoreSite = realSite; window.setTimeout = realTimeout;
      return { seen, end: seen.end };
    }, site);
    const { seen } = await run({ version: 'v2', ok: false, message: 'SITE_PUBLISH_TOKEN is not set' });
    expect(seen[1]).toContain('ds-flag-info');
    expect(seen[1]).toContain('Public site: publishing');
    const f = flagOf(page, 'site');
    await expect(f).toHaveClass(/ds-flag-bad/);
    await expect(f.locator('.ds-flag-t')).toHaveText('Public site NOT updated: SITE_PUBLISH_TOKEN is not set');
    await f.locator('.ds-note-x').click();                           // a result is dismissible
    await expect(f).toHaveCount(0);
    const { end } = await run({ version: 'v2', ok: true, changed: true, url: 'https://example.github.io/Site/p/' });
    expect(end.cls).toContain('ds-flag-ok');
    expect(end.text).toContain('Public site updated ✓');
    expect(end.href).toBe('https://example.github.io/Site/p/');
    await expect(f).toHaveCount(0);                                  // and it went by itself
  });

  test('a PDF that was not made says so above the page, and the next try clears it', async ({ page, context }) => {
    await gotoEditor(page);
    let fail = true;
    await context.route(EXPORT, r => fail
      ? r.fulfill({ status: 500, json: { error: 'Chrome was not found on this Mac' } })
      : r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 stand-in' }));
    await page.evaluate(() => doExport('pdf'));
    const f = flagOf(page, 'export');
    await expect(f.locator('.ds-flag-t')).toHaveText('The PDF was not made: Chrome was not found on this Mac.');
    fail = false;
    await page.evaluate(() => { window.saveBlob = () => {}; return doExport('pdf'); });
    await expect(f).toHaveCount(0);
  });
});
