// Find & Change across Hawaiian words and refused writes, and the first-run
// "+ New report" path (docsync/editor/edit.html findRe / writeSlot /
// findReplaceAll / slugifyReport / sayIdle; docsync/templates; serve.py
// _scaffold). Found by the 2026-10-22 second audit pass
// (WEAK-POINTS-2026-10-22.md). Each test fails on the editor before its fix.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');

test.describe('Find & Change', () => {
  test('"Whole words" knows Hawaiian letters and a $ figure', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => {
      const hits = (needle, text) => (text.match(findRe(needle, { whole: true })) || []).length;
      return {
        okina: hits('ʻāina', 'ka ʻāina, the ʻāina'),
        la: hits('lā', 'lā and lāhui and lā'),         // not lāhui
        dollar: hits('$419', 'costs $419, not $4190'),
        ascii: hits('budget', 'budget budgets budgeting budget'),
      };
    });
    expect(r.okina).toBe(2);
    expect(r.la).toBe(2);
    expect(r.dollar).toBe(1);
    expect(r.ascii).toBe(2);
  });

  test('a Change all the slot refuses is reported as refused, not as changed', async ({ page }) => {
    await gotoEditor(page);
    const key = await page.evaluate(async () => {
      const k = 'whopays.p1';
      await docsync.api.setSlot(k, 'alpha line\nbeta line\ngamma line');
      return k;
    });
    await settled(page);
    await page.keyboard.press('Meta+f');
    await page.waitForTimeout(600);
    await page.locator('#find-needle').fill('beta line');
    // A replacement that would make the line a slot marker, which writeSlot
    // refuses — it used to say so and then "changed 1 hit in 1 place" over it.
    await page.locator('#find-repl').fill('[[zz]]');
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => findState.hits.length)).toBe(1);
    await page.click('#find-all');
    await page.waitForTimeout(1500);
    const stat = page.locator('#stat');
    await expect(stat).toContainText('refused the change');
    await expect(stat).not.toContainText('changed 1 hit');
    expect(await page.evaluate(k => readSlot(k), key)).toBe('alpha line\nbeta line\ngamma line');
  });
});

test.describe('+ New report', () => {
  test('a Hawaiian title keeps its letters in the short id', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(() => ({
      olelo: slugifyReport('Probe ʻŌlelo Hawaiʻi'),
      plain: slugifyReport('  My Report: 2027! '),
      apos: slugifyReport("Keiki’s Ride"),
    }));
    expect(r.olelo).toBe('probe-olelo-hawaii');
    expect(r.plain).toBe('my-report-2027');
    expect(r.apos).toBe('keikis-ride');
  });

  test('a link to a report this server has not got says so', async ({ page }) => {
    await gotoEditor(page, '?project=probe-nope');
    const stat = page.locator('#stat');
    await expect(stat).toContainText('no report called "probe-nope"');
    await expect(stat).toContainText('File ▸ Open');
  });

  test.describe('the one-pager template', () => {
    const SLUG = 'zz-spec-onepager';
    test.afterEach(() => {
      removeYmlBindings(SLUG);
      for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
        execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
      }
    });
    // affected-by: docsync/templates/__init__.py report2027/tools/serve.py
    test('can be created: its first build passes the legibility floor', async ({ request }) => {
      const j = await (await request.post('/__scaffold', { data: {
        name: 'Spec One-Pager', slug: SLUG, template: 'appleseed-onepager',
      } })).json();
      expect(j.ok, j.error).toBe(true);
      expect(fs.existsSync(path.join(REPO, 'projects', SLUG, 'layout.json'))).toBe(true);
    });
  });

  test.describe('a report from pasted text', () => {
    const SLUG = 'zz-spec-from-text';
    test.afterEach(() => {
      removeYmlBindings(SLUG);
      for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
        execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
      }
    });
    // affected-by: docsync/compose.py docsync/new.py docsync/templates/__init__.py report2027/tools/serve.py
    test('lays the sections out on the template and builds', async ({ request }) => {
      const text = '# Spec From Text\nDate: March 2027\n\nThe summary paragraph.\n\n'
        + '## First section\n\nBody of the first.[^src]\n\n### A subheading\n\n- one\n- two\n\n'
        + '## Second section\n\nBody of the second.\n\n[^src]: A source — https://example.org/';
      const j = await (await request.post('/__scaffold', { data: {
        slug: SLUG, template: 'appleseed-report', scheme: 'teal', text,
      } })).json();
      expect(j.ok, j.error).toBe(true);
      const lay = JSON.parse(fs.readFileSync(path.join(REPO, 'projects', SLUG, 'layout.json'), 'utf8'));
      const heads = lay.boxes.filter(b => b.id.startsWith('txt-h-')).map(b => [b.page, b.md]);
      expect(heads).toEqual([[4, 'First section'], [5, 'Second section']]);
      expect(lay.boxes.find(b => b.id === 'tpl-title').md).toBe('Spec From Text');
      expect(lay.boxes.find(b => b.id === 'tpl-date').md).toBe('MARCH 2027');
      const content = fs.readFileSync(path.join(REPO, 'projects', SLUG, 'content.md'), 'utf8');
      expect(content).toContain('[src]: A source — https://example.org/');
      expect(fs.readFileSync(path.join(REPO, 'docsync.yml'), 'utf8')).toContain('name: "Spec From Text"');
    });
  });
});
