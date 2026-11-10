// A report living in its OWN repo going stale, and being caught up.
// tools/selfupdate.py keeps the editor current; this is the same contract for
// the report's content — check in the background, tell the person, never apply
// anything on its own. Real git repos in a scratch dir (an origin, a clone
// behind it), a real /__adopt to mount them, and the real /__pull to catch up.
const { test, expect } = require('./fixtures/editor-test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-stale';

let scratch, origin, clone;
const git = (cwd, cmd) => execSync(`git -C ${JSON.stringify(cwd)} ${cmd}`,
  { stdio: 'pipe' }).toString();
const { removeRegistryKeys } = require('./fixtures/host-state');

// Serial: shares the host registry, which the hooks snapshot and restore.
test.describe.configure({ mode: 'serial' });

test.describe('report content updates', () => {
  // The suite blocks /__pull for every spec, because it fetches and
  // fast-forwards a REAL repo. This file is the exception: it only ever aims
  // at scratch clones it built itself, so it lets the endpoint through.
  //
  // The opt-out is a HEADER now, not a bare route.continue(). The block used
  // to be a browser route the fixture registered, so overriding it at page
  // level was enough; it since moved server-side (PRIMER_TEST_SAFE, see
  // serve.py's do_POST) where no browser route can reach it, and this spec
  // silently started getting "blocked in tests — no real repo is updated
  // here" for a pull it is the only test of.
  test.beforeEach(async ({ page }) => {
    await page.route('**/__pull', route => route.continue({
      headers: { ...route.request().headers(), 'x-primer-test-pull': '1' },
    }));
  });

  test.beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-'));
    origin = path.join(scratch, 'origin');

    // A real docsync repo with one blank project, committed.
    fs.mkdirSync(origin);
    execSync(`cp -R ${JSON.stringify(path.join(REPO, 'docsync'))} ${JSON.stringify(origin)}`);
    execSync(`rm -rf ${JSON.stringify(path.join(origin, 'docsync', '__pycache__'))}`);
    // A seed binding: load_registry refuses an empty list, and docsync.new
    // reads the registry to see which ids are taken. It has no editor block,
    // so /__adopt rightly skips it.
    fs.writeFileSync(path.join(origin, 'docsync.yml'),
      'bindings:\n  - id: seed\n    content: projects/seed/content.md\n');
    fs.mkdirSync(path.join(origin, 'projects'));
    execSync('python3 -', { input: [
      `import sys`,
      `sys.path.insert(0, ${JSON.stringify(REPO)})`,
      `from pathlib import Path`,
      `from docsync.new import create`,
      `create(${JSON.stringify(SLUG)}, "Stale Spec Report", root=Path(${JSON.stringify(origin)}))`,
    ].join('\n') });
    // create() spec-loads origin's own docsync/registry.py, which writes
    // __pycache__ INSIDE origin — and `add -A` then commits the .pyc files.
    // The clone's rebuilds regenerate them with different bytes, a tracked
    // modification, and /__pull rightly refuses a "dirty" repo whose only
    // dirt is bytecode. Ignore the cache like every real repo does.
    execSync(`find ${JSON.stringify(origin)} -name __pycache__ -type d -exec rm -rf {} +`);
    fs.writeFileSync(path.join(origin, '.gitignore'), '__pycache__/\nweb/\ndocs/\n');
    git(origin, 'init -q -b main');
    git(origin, '-c user.email=s@x -c user.name=S add -A');
    git(origin, '-c user.email=s@x -c user.name=S commit -q -m "first"');

    // The colleague's clone — level with origin at this point.
    clone = path.join(scratch, 'clone');
    execSync(`git clone -q ${JSON.stringify(origin)} ${JSON.stringify(clone)}`);
  });

  test.afterAll(() => {
    // OUR key only, under the cross-process lock — a blanket snapshot
    // restore here stomped concurrent workers' registry entries (the same
    // lost-update race as the docsync.yml scaffold one; see
    // fixtures/host-state.js) and could resurrect a previous run's residue.
    removeRegistryKeys(SLUG);
    execSync(`rm -rf ${JSON.stringify(scratch)}`);
  });

  test('a clone that falls behind is offered the newer content, and takes it',
    async ({ page }) => {
      // Adopt the CLONE, so the server is serving it. The form only writes
      // through the server once the page has found it (start.html's
      // detectLocal): wait for that, not for a clock that load outruns.
      await page.goto('start.html');
      await page.waitForFunction(() => LOCAL === true);
      await page.click('#adopt');
      await page.fill('#np-root', clone);
      await page.click('#np-create');
      await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
      await page.frameLocator('#out').locator('section.page[data-page="1"]')
        .waitFor({ state: 'visible', timeout: 75000 });

      // Level with origin: nothing to offer.
      let c = await page.evaluate(() =>
        fetch('/__ping?project=' + M.id).then(r => r.json()).then(j => j.content));
      expect(c.behind || 0).toBe(0);
      await expect(page.locator('#cupd')).toBeHidden();

      // Someone else pushes a change to the report.
      const md = path.join(origin, 'projects', SLUG, 'content.md');
      fs.writeFileSync(md, fs.readFileSync(md, 'utf8')
        .replace('Stale Spec Report', 'Stale Spec Report REVISED'));
      git(origin, '-c user.email=s@x -c user.name=S commit -aqm "revise the title"');

      // The server notices on its next check. Ask for one rather than waiting
      // out CONTENT_POLL — the polling loop itself is not what this asserts.
      const pull = await page.evaluate(() =>
        fetch('/__pull', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: M.id }) }).then(r => r.json()));
      // This failed once (2026-11-09, a full affected run) on the message,
      // with ok true: the answer was not "1 change", and nothing said what it
      // was. It now says, with where both repos stood.
      const where = () => `pull answered ${JSON.stringify(pull)}; clone: `
        + git(clone, 'log --oneline -3').trim().replace(/\n/g, ' | ')
        + '; origin: ' + git(origin, 'log --oneline -3').trim().replace(/\n/g, ' | ');
      expect(pull.ok, where()).toBe(true);
      expect(pull.message, where()).toMatch(/1 change/);

      // The clone really moved, and the rebuilt page carries the new words.
      expect(git(clone, 'log --format=%s -1').trim()).toBe('revise the title');
      expect(fs.readFileSync(path.join(clone, 'projects', SLUG, 'content.md'), 'utf8'))
        .toContain('REVISED');
    });

  // A check that could not be made is not "up to date". With the remote out
  // of reach the fetch fails, and /__pull used to answer ok, "already up to
  // date", over a repo nobody had looked at.
  test('a remote out of reach is said, not answered as "already up to date"',
    async ({ page }) => {
      await page.goto('start.html');   // any page, so a relative fetch resolves
      const away = origin + '-away';
      fs.renameSync(origin, away);
      try {
        const out = await page.evaluate(s2 =>
          fetch('/__pull', { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: s2 }) }).then(r => r.json()), SLUG);
        expect(out.ok, JSON.stringify(out)).toBe(false);
        expect(out.error).toMatch(/could not check for newer content/);
      } finally {
        fs.renameSync(away, origin);
      }
    });

  test('unpushed work of your own blocks the update instead of being merged over',
    async ({ page }) => {
      // The settle loop + boot + one reload fallback can honestly need more
      // than the default 90s under load.
      test.setTimeout(180000);
      // KNOWN-INTERMITTENT (~1 in 3 in tight serial loops, rare in full runs,
      // and OLDER than the features this file tests): booting the editor on a
      // freshly adopted external project right after a commit lands sometimes
      // hangs before first render — server healthy (__ping ok, no build
      // error), detectLocal completed (#stat shows the live message), then
      // nothing, and a reload does not recover it. The failure dump below
      // prints the evidence when it happens. Root cause still unfound; if you
      // are here chasing it, start at boot()'s engine-file fetch loop.
      // A local commit the colleague has not pushed: a real merge, which is a
      // decision — not something a button called "update" should make for them.
      fs.appendFileSync(path.join(clone, 'projects', SLUG, 'content.md'),
        '\nLocal work.\n');
      git(clone, '-c user.email=c@x -c user.name=C commit -aqm "my own edit"');
      const md = path.join(origin, 'projects', SLUG, 'content.md');
      fs.appendFileSync(md, '\nMore from upstream.\n');
      git(origin, '-c user.email=s@x -c user.name=S commit -aqm "upstream again"');

      // The commits above just triggered the watcher's rebuild of the adopted
      // project; booting the editor WHILE its staged engine is being re-copied
      // can catch the manifest half-written. Let the build settle (version
      // stable across two polls), then boot — with one reload as the fallback,
      // which is exactly what the editor itself offers a person.
      await page.waitForTimeout(500);
      let v0 = -1;
      for (let i = 0; i < 20; i++) {
        const j = await page.evaluate(async s2 =>
          fetch(`/__ping?project=${s2}`).then(r => r.json()).catch(() => null), SLUG);
        if (j && j.v === v0 && !j.error) break;
        v0 = j ? j.v : -1;
        await page.waitForTimeout(700);
      }
      await page.goto(`edit.html?project=${SLUG}`);
      try {
        await page.frameLocator('#out').locator('section.page[data-page="1"]')
          .waitFor({ state: 'visible', timeout: 30000 });
      } catch (e) {
        await page.reload();
        try {
          await page.frameLocator('#out').locator('section.page[data-page="1"]')
            .waitFor({ state: 'visible', timeout: 60000 });
        } catch (e2) {
          const stat = await page.locator('#stat').textContent().catch(() => '?');
          const ping = await page.evaluate(async s2 =>
            fetch(`/__ping?project=${s2}`).then(r => r.json()).catch(x => String(x)), SLUG);
          console.log('STUCK stat:', stat, '| ping:', JSON.stringify(ping).slice(0, 400));
          throw e2;
        }
      }

      const out = await page.evaluate(() =>
        fetch('/__pull', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: M.id }) }).then(r => r.json()));
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/not pushed yet/);
      // and their commit is still theirs — nothing was merged over it
      expect(git(clone, 'log --format=%s -1').trim()).toBe('my own edit');
    });

  test('the editor’s own repo is not offered this — the version chip owns it',
    async ({ page }) => {
      const { gotoEditor } = require('./fixtures/editor-test');
      await gotoEditor(page);          // any page, so a relative fetch resolves
      // rxkids lives in THIS repo whether or not the machine has a
      // projects.json — budget-primer does not: a dev checkout points it at
      // a separate clone via local_root, so it proved nothing here.
      const out = await page.evaluate(() =>
        fetch('/__pull', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: 'rxkids' }) }).then(r => r.json()));
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/editor's own repo/);
    });
});
