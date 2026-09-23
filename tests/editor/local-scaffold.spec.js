// "+ New report" against a LOCAL server (start.html -> serve.py /__scaffold ->
// docsync/new.py): a blank project lands on disk with no GitHub, no token and
// no repo access, and the editor opens straight into it. These tests hit the
// REAL endpoint, so they write real files into this checkout — everything is
// snapshotted before and restored after, pass or fail.
const { warmTest: test, expect } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { removeYmlBindings, YML } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-blank';

// One worker, in order: these tests share a socket (the GitHub stand-in) or
// on-disk state their before/after hooks snapshot and restore — fullyParallel
// would run each test's hooks in its OWN worker, and the second worker's
// setup/teardown lands mid-flight under the first (EADDRINUSE on the mock,
// a registry restored while the other test is still writing it).
test.describe.configure({ mode: 'serial' });

test.describe('local scaffold', () => {
  test.afterEach(() => {
    // Remove OUR binding and nothing else — a whole-file snapshot restore
    // here was the docsync.yml scaffold race: it resurrected residue and
    // stomped concurrent workers' bindings (see fixtures/host-state.js).
    // rm -rf on a fixed literal, never a variable that could be empty.
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('the start page creates a blank report and opens it', async ({ page }) => {
    await page.goto('start.html');
    await page.waitForTimeout(600);
    // Local mode: no repo is configured for it, and it must not need one.
    await expect(page.locator('#new')).toBeEnabled();
    await page.click('#new');
    // The repo/branch fields belong to the hosted flow and stay out of sight.
    await expect(page.locator('#np-repo-l')).toBeHidden();
    await page.fill('#np-name', 'Spec Blank Report');
    await expect(page.locator('#np-slug')).toHaveValue('spec-blank-report');
    await page.fill('#np-slug', SLUG);
    await page.click('#np-create');

    // Landing in the editor on the new project IS the assertion: the files
    // exist, the binding read back, the first build passed, the running
    // server mounted it — any of those failing never gets here.
    await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
    await page.frameLocator('#out').locator('section.page[data-page="1"]')
      .waitFor({ state: 'visible', timeout: 75000 });

    // The scaffold is really on disk, and registered.
    expect(fs.existsSync(path.join(REPO, 'projects', SLUG, 'content.md'))).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'projects', SLUG, 'render_report.py'))).toBe(true);
    expect(fs.readFileSync(YML, 'utf8')).toContain(`id: ${SLUG}`);

    // And it is a WORKING canvas: place a text box through the editor's own
    // tools — the whole point of the blank placed-renderer template.
    await page.click('#text');
    await page.click('#textpop .txtpreset[data-k="body"]');
    await page.frameLocator('#out').locator('.ds-textbox')
      .waitFor({ state: 'attached', timeout: 20000 });
  });

  test('a taken id is refused with a reason, not a wreck', async ({ page }) => {
    await page.goto('start.html');
    await page.waitForTimeout(600);
    await page.click('#new');
    await page.fill('#np-name', 'Anything');
    await page.fill('#np-slug', 'budget-primer');       // the fixture's own id
    await page.click('#np-create');
    await expect(page.locator('#np-err')).toContainText('already exists');
    // still on the start page, modal still open — nothing half-created.
    // Asserted about OUR OWN slug and the refused one, not byte-identity of
    // the whole file — a parallel worker may legitimately append its own
    // binding between snapshot and here.
    expect(page.url()).toContain('start.html');
    const yml = fs.readFileSync(YML, 'utf8');
    expect(yml).not.toContain('id: Anything');
    expect(yml.match(/- id: budget-primer\b/g)).toHaveLength(1);   // no half-write
  });
});
