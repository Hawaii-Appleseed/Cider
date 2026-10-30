// A freshly scaffolded project — "+ New report", never touched by hand —
// must stay fully usable with zero GitHub interaction: edit, add elements,
// Save to disk. Only Push and Publish touch git, and they use the machine's
// own git credentials through the local server, never the browser. The editor
// has no GitHub API client at all; local Save posts straight to /__save.
// Pinned here so a later change cannot route local editing through a remote.
const { test, expect } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-norepo';

test.describe.configure({ mode: 'serial' });

test.describe('a freshly scaffolded project, before anyone touches GitHub', () => {
  test.afterEach(() => {
    // Our binding only — a whole-file restore was the scaffold race
    // (fixtures/host-state.js).
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('scaffolds, edits, adds an element, and Saves — with no GitHub call ever made',
    async ({ page }) => {
      // Any request to the GitHub API during this test is the bug: it means
      // some local-mode action went to GitHub instead of the local server.
      const ghCalls = [];
      await page.route('https://api.github.com/**', route => {
        ghCalls.push(route.request().url());
        route.abort();
      });

      await page.goto('start.html');
      await page.waitForTimeout(600);
      await page.click('#new');
      await page.fill('#np-name', 'Spec No Repo');
      await page.fill('#np-slug', SLUG);
      await page.click('#np-create');
      await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
      await page.frameLocator('#out').locator('section.page[data-page="1"]')
        .waitFor({ state: 'visible', timeout: 75000 });

      // The File menu's repo row (added by the "connecting a report" commit)
      // must exist and say SOMETHING truthful. This fixture's scaffolds land
      // inside primer-editor's own checkout, which already has an origin, so
      // REPO here reads as that shared repo rather than empty — the "Repo:
      // not connected" case only shows on a checkout with no origin at all,
      // which this fixture can't represent. What this test protects is that
      // local editing never asks GitHub anything, whichever state REPO is in.
      await page.click('#file');
      await expect(page.locator('#file-repo')).toBeVisible();
      await expect(page.locator('#file-repo')).toHaveText(/^Repo: /);
      await page.evaluate(() => { $('filepop').hidden = true; });

      // "+ New report" gives a blank canvas (docsync/new.py: content.md holds
      // only title + sources — "the blank-slate the editor's own tools
      // fill") — so a real session's first act is adding something through
      // the editor's own tools, the way this test does too.
      await page.click('#text');
      await page.click('#textpop .txtpreset[data-k="body"]');
      const box = page.frameLocator('#out').locator('.ds-textbox').first();
      await box.waitFor({ state: 'attached', timeout: 20000 });

      // Edit it through the real click-to-edit path, not a direct mutation.
      await box.dblclick();
      const editor = page.frameLocator('#out').locator('.ds-edit');
      await editor.waitFor({ state: 'visible', timeout: 5000 });
      await page.keyboard.press('Control+A');
      await page.keyboard.type('edited with no repo');
      await page.evaluate(() => richHost.blur());   // finish(true), as Escape now is too
      await page.waitForTimeout(500);

      // Local Save posts straight to /__save — no token, no repo needed
      // first. The fixture's own safety net (editor-test.js) mocks that
      // endpoint everywhere so no spec can accidentally commit into this
      // real checkout; reaching its canned response IS the proof that Save
      // went straight there with no GitHub round-trip ahead of it.
      await expect(page.locator('#save')).toBeEnabled();
      await page.click('#save');
      await expect(page.locator('#stat'))
        .toContainText('blocked in tests', { timeout: 15000 });

      expect(ghCalls, `unexpected GitHub API calls: ${ghCalls.join(', ')}`).toEqual([]);
    });
});
