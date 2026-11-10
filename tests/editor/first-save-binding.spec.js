// A project's FIRST Save commits its own docsync.yml binding, and only that.
//
// The whole file used to go in. On 2026-11-09 Devin's checkout held another
// new project's binding (work in progress, its folder not in git) when the
// Wealth Tax report was saved for the first time: commit c3efe83 carried both
// bindings, and every branch cut from it had a binding whose files it lacked.
//
// A real repo in a scratch dir, adopted by the real server, saved through the
// real /__save (the suite's block is lifted by a header; see serve.py).
// affected-by: report2027/tools/serve.py docsync/new.py
const { test, expect } = require('./fixtures/editor-test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { removeRegistryKeys } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const git = (cwd, cmd) => execSync(`git -C ${JSON.stringify(cwd)} ${cmd}`, { stdio: 'pipe' }).toString();

/** A throwaway Cider-shaped checkout: the engine and a committed seed binding,
 *  then `slugs` made through docsync.new, in that order, left uncommitted. */
function scratchRepo(prefix, slugs) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const clone = path.join(scratch, 'clone');
  fs.mkdirSync(clone);
  execSync(`cp -R ${JSON.stringify(path.join(REPO, 'docsync'))} ${JSON.stringify(clone)}`);
  execSync(`find ${JSON.stringify(clone)} -name __pycache__ -type d -exec rm -rf {} +`);
  fs.writeFileSync(path.join(clone, 'docsync.yml'),
    'bindings:\n  - id: seed\n    content: projects/seed/content.md\n');
  // The generated editor files, ignored as Cider's own .gitignore ignores them.
  fs.writeFileSync(path.join(clone, '.gitignore'), ['__pycache__/', 'docs/*/edit.html',
    'docs/*/engine/', 'docs/*/assets/', 'docs/*/collab-client.js', 'docs/*/sw.js', ''].join('\n'));
  git(clone, 'init -q -b main');
  // The repo's own (empty) hooks dir, so no machine-wide hook decides this.
  git(clone, 'config core.hooksPath .git/hooks');
  git(clone, '-c user.email=s@x -c user.name=S add -A');
  git(clone, '-c user.email=s@x -c user.name=S commit -q -m first');
  fs.mkdirSync(path.join(clone, 'projects'));
  execSync('python3 -', { input: [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(REPO)})`,
    'from pathlib import Path',
    'from docsync.new import create',
    ...slugs.map(s => `create(${JSON.stringify(s)}, ${JSON.stringify('Spec ' + s)}, root=Path(${JSON.stringify(clone)}))`),
  ].join('\n') });
  execSync(`find ${JSON.stringify(clone)} -name __pycache__ -type d -exec rm -rf {} +`);
  git(clone, 'config user.email s@x');
  git(clone, 'config user.name S');
  return { scratch, clone };
}

async function firstSave(request, clone, slug) {
  const ad = await (await request.post('/__adopt', { data: { root: clone } })).json();
  expect(ad.ok, JSON.stringify(ad)).toBe(true);
  const md = path.join(clone, 'projects', slug, 'content.md');
  return (await request.post('/__save', {
    headers: { 'X-Primer-Test-Save': '1' },
    data: { project: slug, content: fs.readFileSync(md, 'utf8') + '\n<!-- first save -->\n' },
  })).json();
}

test.describe.configure({ mode: 'serial' });

test.describe("a project's first Save", () => {
  const SLUG = 'zz-spec-fsb-mine';
  const OTHER = 'zz-spec-fsb-theirs';
  const ALONE = 'zz-spec-fsb-alone';
  const FIRST = 'zz-spec-fsb-first';
  const AFTER = 'zz-spec-fsb-after';
  const made = [];
  test.afterAll(() => {
    removeRegistryKeys(SLUG, OTHER, ALONE, FIRST, AFTER);
    for (const d of made) execSync(`rm -rf ${JSON.stringify(d)}`);
  });

  test("commits its own binding, and leaves another project's on disk, uncommitted",
    async ({ request }) => {
    // Somebody else's new project first, then this one: both bindings sit in
    // docsync.yml, neither committed, neither project's folder in git.
    const { scratch, clone } = scratchRepo('fsb-two-', [OTHER, SLUG]);
    made.push(scratch);
    const ymlBefore = fs.readFileSync(path.join(clone, 'docsync.yml'), 'utf8');
    expect(ymlBefore).toContain(`- id: ${OTHER}`);

    const j = await firstSave(request, clone, SLUG);
    expect(j.ok, j.error).toBe(true);

    // The commit: this project and its binding, nothing of the other's.
    const committed = git(clone, 'show HEAD:docsync.yml');
    expect(committed).toContain(`- id: ${SLUG}`);
    expect(committed).not.toContain(OTHER);
    const files = git(clone, 'show --name-only --format= HEAD').trim().split('\n');
    expect(files).toContain(`projects/${SLUG}/content.md`);
    expect(files).toContain(`projects/${SLUG}/render_report.py`);
    expect(files).toContain('docsync.yml');
    expect(files.filter(f => f.includes(OTHER))).toEqual([]);

    // The disk is untouched, and the other binding is still there, uncommitted.
    expect(fs.readFileSync(path.join(clone, 'docsync.yml'), 'utf8')).toBe(ymlBefore);
    const added = git(clone, 'diff HEAD -- docsync.yml').split('\n')
      .filter(l => /^\+[^+]/.test(l)).join('\n');
    expect(added).toContain(`- id: ${OTHER}`);
    expect(added).not.toContain(SLUG);
    // Nothing staged: the index says HEAD's docsync.yml, not a staged undo of the binding.
    expect(git(clone, 'diff --cached --name-only').trim()).toBe('');
    expect(git(clone, 'status --porcelain -- docsync.yml').trim()).toBe('M docsync.yml');
    expect(git(clone, `status --porcelain -- projects/${OTHER}`).trim())
      .toBe(`?? projects/${OTHER}/`);
  });

  test('takes its block alone when another binding follows it and a committed one was edited',
    async ({ request }) => {
    // This project first, somebody else's after it, and an uncommitted edit
    // to a binding HEAD already has.
    const { scratch, clone } = scratchRepo('fsb-mixed-', [FIRST, AFTER]);
    made.push(scratch);
    const yml = path.join(clone, 'docsync.yml');
    fs.writeFileSync(yml, fs.readFileSync(yml, 'utf8')
      .replace('content: projects/seed/content.md', 'content: projects/seed/edited.md'));
    const before = fs.readFileSync(yml, 'utf8');

    const j = await firstSave(request, clone, FIRST);
    expect(j.ok, j.error).toBe(true);
    const committed = git(clone, 'show HEAD:docsync.yml');
    expect(committed).toContain(`- id: ${FIRST}`);
    expect(committed).not.toContain(AFTER);
    expect(committed).toContain('content: projects/seed/content.md');
    expect(committed).not.toContain('edited.md');
    // Both other changes are still on disk, still uncommitted.
    expect(fs.readFileSync(yml, 'utf8')).toBe(before);
    const changed = git(clone, 'diff HEAD -- docsync.yml').split('\n')
      .filter(l => /^[+-](?![+-])/.test(l)).join('\n');
    expect(changed).toContain(`+  - id: ${AFTER}`);
    expect(changed).toContain('+    content: projects/seed/edited.md');
    expect(changed).not.toContain(FIRST);
  });

  test('with no other change in docsync.yml, takes the file as it stands', async ({ request }) => {
    const { scratch, clone } = scratchRepo('fsb-one-', [ALONE]);
    made.push(scratch);
    const j = await firstSave(request, clone, ALONE);
    expect(j.ok, j.error).toBe(true);
    expect(git(clone, 'show HEAD:docsync.yml'))
      .toBe(fs.readFileSync(path.join(clone, 'docsync.yml'), 'utf8'));
    expect(git(clone, 'status --porcelain -- docsync.yml projects').trim()).toBe('');
  });
});
