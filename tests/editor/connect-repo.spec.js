// Connect a repo (docs/primer/start.html). A project can be scaffolded into
// ANY repo the token can write, not just the one the editor happened to load —
// this is what lets projects live in their own repos, set up from the editor.
// The modal collects repo + deploy branch; createProject validates access and
// the branch's existence up front, then records both in the registry.
const { warmTest: test, expect } = require('./fixtures/editor-test');

test.describe('connect a repo', () => {
  test.beforeEach(async ({ page }) => {
    // These specs are about the HOSTED flow. A live local server now flips
    // start.html into local mode (folder-path adoption, no Connect button),
    // so hosted-ness is pinned rather than inherited from the test machine.
    await page.route(/\/__oauth\/status(\?|$)/, r =>
      r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await page.goto('start.html');
    await page.waitForFunction(() => typeof createProject === 'function');
  });

  test('the Connect button opens the modal aimed at a fresh repo', async ({ page }) => {
    await page.click('#connect');
    await expect(page.locator('#modal-bg')).toHaveClass(/open/);
    await expect(page.locator('#np-title')).toHaveText('Connect a repo');
    // Empty + focused: the point is to name somewhere new.
    await expect(page.locator('#np-repo')).toHaveValue('');
    await expect(page.locator('#np-repo')).toBeFocused();
    await expect(page.locator('#np-branch')).toHaveValue('main');
  });

  test('+ New report prefills the repo already in use', async ({ page }) => {
    await page.evaluate(() => { window.currentRepo = () => 'me/usual'; });
    await page.click('#new');
    await expect(page.locator('#np-title')).toHaveText('New report');
    await expect(page.locator('#np-repo')).toHaveValue('me/usual');
  });

  test('createProject scaffolds into an explicit repo and records repo + branch', async ({ page }) => {
    const reg = await page.evaluate(async () => {
      const seen = { tree: null };
      window.gh = async (repo, path, opts) => {
        if (path === '') return { permissions: { push: true } };
        if (path === 'git/ref/heads/release') return { object: { sha: 'base' } };
        if (path.startsWith('git/commits/')) return { tree: { sha: 't0' } };
        if (path === 'git/trees') { seen.tree = JSON.parse(opts.body).tree; return { sha: 't1' }; }
        if (path === 'git/commits') return { sha: 'c1' };
        return {};
      };
      // Same repo as the editor host, so it stays one atomic commit with the
      // registry inside it. (The cross-repo split is covered in adopt-project.)
      window.currentRepo = () => 'other/housing-repo';
      window.askToken = async () => true;
      await createProject('Housing', 'housing', 'letter', 'release', 'other/housing-repo');
      const pj = seen.tree.find(t => t.path === 'docs/primer/projects.json');
      const manifest = seen.tree.find(t => t.path.endsWith('/engine/manifest.json'));
      return { registry: JSON.parse(pj.content).housing,
               manifest: JSON.parse(manifest.content) };
    });
    // The project points at the repo you named, on the branch you named —
    // independent of whatever repo the editor was already using.
    expect(reg.registry.repo).toBe('other/housing-repo');
    expect(reg.registry.branch).toBe('release');
    expect(reg.manifest.repo).toBe('other/housing-repo');
    expect(reg.manifest.branch).toBe('release');
  });

  test('a repo the token cannot write is refused before anything is committed', async ({ page }) => {
    const result = await page.evaluate(async () => {
      let committed = false;
      window.gh = async (repo, path, opts) => {
        if (path === '') return { permissions: { push: false } };   // read-only
        if (path === 'git/trees' || path === 'git/commits') committed = true;
        return {};
      };
      window.currentRepo = () => '';
      window.askToken = async () => true;
      let msg = null;
      try { await createProject('X', 'x', 'letter', 'main', 'other/readonly'); }
      catch (e) { msg = e.message; }
      return { msg, committed };
    });
    expect(result.msg).toMatch(/not write|Contents: write/);
    expect(result.committed).toBe(false);
  });

  test('a missing deploy branch is refused with a clear message', async ({ page }) => {
    const result = await page.evaluate(async () => {
      let committed = false;
      window.gh = async (repo, path, opts) => {
        if (path === '') return { permissions: { push: true } };
        if (path === 'git/ref/heads/nope') throw new Error('GitHub 404: Not Found');
        if (path === 'git/trees' || path === 'git/commits') committed = true;
        return {};
      };
      window.currentRepo = () => '';
      window.askToken = async () => true;
      let msg = null;
      try { await createProject('X', 'x', 'letter', 'nope', 'other/repo'); }
      catch (e) { msg = e.message; }
      return { msg, committed };
    });
    expect(result.msg).toMatch(/branch "nope" does not exist/);
    expect(result.committed).toBe(false);
  });
});
