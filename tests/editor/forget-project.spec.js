// Zero projects must be reachable: File > Open can forget a report (the server
// keeps a tombstone in projects.json; nothing on disk is touched), and an
// editor opened over an EMPTY registry goes to start.html instead of booting
// whatever engine happens to sit next to it. Local mode.
const fs = require('fs');
const { test, expect, gotoEditor, openFileMenu, submitDialog } = require('./fixtures/editor-test');
const { withHostLock, removeRegistryKeys, REGISTRY } = require('./fixtures/host-state');

const TWO = {
  'budget-primer': { name: 'Budget Primer', base: '' },
  'zz-other': { name: 'Other Report', base: '' },
};

test.describe('forgetting a project', () => {
  test('File > Open offers a forget control per report, and it posts /__forget', async ({ page, context }) => {
    await context.route('**/projects.json*', r => r.fulfill({ json: TWO }));
    const posted = [];
    await context.route('**/__forget', route => {
      posted.push(JSON.parse(route.request().postData()));
      route.fulfill({ json: { ok: true, forgot: posted[0].project } });
    });
    await gotoEditor(page);
    await openFileMenu(page);
    await page.click('#file-open');
    const row = page.locator('#open-list .open-forget');
    await expect(row).toHaveCount(2);
    await page.locator('#open-list .open-forget[data-forget="zz-other"]').click();
    await submitDialog(page);
    await expect(page.locator('#open-list [data-open="zz-other"]')).toHaveCount(0);
    expect(posted).toEqual([{ project: 'zz-other' }]);
    await expect(page.locator('#open-list [data-open="budget-primer"]')).toHaveCount(1);
  });

  test('an empty registry routes to start.html rather than booting the default engine', async ({ page, context }) => {
    await context.route('**/projects.json*', r => r.fulfill({ json: {} }));
    await page.goto('/primer/edit.html');
    await page.waitForURL(/start\.html/);
    await expect(page.locator('#empty')).toBeVisible();
  });
});

test.describe('server: /__forget', () => {
  const SLUG = 'zz-forget-spec';
  test.afterEach(() => removeRegistryKeys(SLUG));

  test('a forgotten project drops out of projects.json and its entry is kept as a tombstone', async ({ request }) => {
    withHostLock(() => {
      const reg = fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : {};
      reg[SLUG] = { name: 'Forget Spec', base: '.' };
      fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
    });
    expect(Object.keys(await (await request.get('/primer/projects.json')).json())).toContain(SLUG);
    const r = await (await request.post('/__forget', { data: { project: SLUG } })).json();
    expect(r.ok).toBe(true);
    expect(Object.keys(await (await request.get('/primer/projects.json')).json())).not.toContain(SLUG);
    expect(JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))[SLUG].forgotten).toBe(true);
  });

  test('an id nobody has is refused', async ({ request }) => {
    const r = await (await request.post('/__forget', { data: { project: 'zz-no-such-report' } })).json();
    expect(r.ok).toBe(false);
  });
});
