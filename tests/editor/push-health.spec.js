// Two things you should not have to press Push to find out: whether it would
// work, and where it would land.
//
// Both were learned the hard way on one machine. A global Git LFS pre-push
// hook (core.hooksPath, naming a tool absent from a launchd-started server's
// minimal PATH) refused every push from this editor for SIX DAYS — the button
// looked perfectly ready, 45 commits piled up behind it, and nothing anywhere
// said a word. And that same Push publishes by fast-forwarding the DEPLOY
// branch to match HEAD, so on a feature branch one press would have shipped
// all 45 at once, looking exactly like shipping one.
//
// The server now answers both questions on its background poll and carries
// them in every ping/SSE beat; the editor wears the answer on the button and
// asks before publishing across branches.
const { test, expect, gotoEditor, PING, EVENTS } = require('./fixtures/editor-test');

/** Push state, faked where the editor reads it: the server's ping. The editor
 *  takes pushHealth and the ahead count from every /__ping and /__events beat
 *  (setPushState(d.ahead) on each), and the suite's server has nothing to
 *  push. Setting them in the page alone was undone by the next two-second
 *  heartbeat whenever one landed before the button was read: the title came
 *  back empty on CI. So each ping carries what the test set, the event stream
 *  is refused, and the page is told at once. Call before gotoEditor; the
 *  returned function sets the state. */
async function fakePushState(page) {
  let say = null;
  await page.route(PING, async route => {
    const r = await route.fetch();
    const j = await r.json();
    await route.fulfill({ response: r, json: say ? { ...j, ...say } : j });
  });
  await page.route(EVENTS, route => route.abort());
  return async (push, ahead) => {
    say = push === undefined ? { ahead } : { push, ahead };
    await page.evaluate(([p, a]) => { if (p !== undefined) pushHealth = p; setPushState(a); }, [push, ahead]);
  };
}

test.describe('push health, before the button is pressed', () => {
  test('the ping carries a push block the editor can act on', async ({ page }) => {
    await gotoEditor(page);
    const j = await (await page.request.get('/__ping?project=budget-primer')).json();
    expect(j.ok).toBe(true);
    // Present as a key even when empty — the editor reads it unconditionally,
    // and an absent key would be indistinguishable from "healthy".
    expect(j).toHaveProperty('push');
    expect(typeof j.push).toBe('object');
  });

  test('a Push the server knows would fail wears the warning, and stays clickable',
    async ({ page }) => {
      const setPush = await fakePushState(page);
      await gotoEditor(page);
      // The exact shape the LFS failure produces on the wire.
      await setPush({ ok: false, why: 'a Git LFS pre-push hook is refusing the push '
        + '— git-lfs is not on this server’s PATH.', branch: 'counties',
        deploy: 'main', deployAhead: 45 }, 3);
      const b = page.locator('#push');
      await expect(b).toHaveClass(/warn/);
      await expect(b).toContainText('⚠');
      // Clickable ON PURPOSE: this is a prediction from the last poll, and a
      // stale diagnosis must never be the thing that blocks a real push.
      await expect(b).toBeEnabled();
      expect(await b.getAttribute('title')).toContain('git-lfs');
      expect(await b.getAttribute('aria-label')).toContain('likely to fail');
    });

  test('with nothing to push there is nothing to warn about', async ({ page }) => {
    const setPush = await fakePushState(page);
    await gotoEditor(page);
    await setPush({ ok: false, why: 'stale news' }, 0);   // clean tree
    const b = page.locator('#push');
    await expect(b).toBeDisabled();
    await expect(b).not.toHaveClass(/warn/);
  });

  test('a healthy push says where it lands when that is another branch',
    async ({ page }) => {
      const setPush = await fakePushState(page);
      await gotoEditor(page);
      await setPush({ ok: true, why: '', branch: 'counties', deploy: 'main',
        deployAhead: 45 }, 3);
      const t = await page.locator('#push').getAttribute('title');
      // The number that mattered: not the 3 just saved, but the 45 that
      // publishing would carry.
      expect(t).toContain("'counties'");
      expect(t).toContain("'main'");
      expect(t).toContain('45');
      await expect(page.locator('#push')).not.toHaveClass(/warn/);
    });

  test('on the deploy branch itself it does not editorialise', async ({ page }) => {
    const setPush = await fakePushState(page);
    await gotoEditor(page);
    await setPush({ ok: true, why: '', branch: 'main', deploy: 'main', deployAhead: 2 }, 2);
    const t = await page.locator('#push').getAttribute('title');
    expect(t).not.toContain('fast-forward');
    expect(t).toContain('2 commits');
  });

  test('publishing across branches is asked, not assumed', async ({ page }) => {
    const setPush = await fakePushState(page);
    await gotoEditor(page);
    // The server refuses the first time with needsConfirm; the editor must
    // put the number in front of the person rather than pushing anyway.
    let calls = 0;
    await page.route('**/__push', async route => {
      calls++;
      const body = JSON.parse(route.request().postData() || '{}');
      if (!body.deploy) {
        return route.fulfill({ json: { ok: false, needsConfirm: true, ahead: 3,
          error: "this would publish 45 commits by fast-forwarding 'main' "
               + "(the branch that builds and deploys) to match 'counties'" } });
      }
      return route.fulfill({ json: { ok: true, ahead: 0,
        message: "pushed — 'main' now matches 'counties'" } });
    });

    // Cancelling publishes NOTHING — the second call never happens.
    await setPush(undefined, 3);
    await page.click('#push');
    const dlg = page.locator('dialog.dsdlg');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('45 commits');
    await expect(dlg).toContainText('main');
    await dlg.locator('button.dsdlg-cancel').click();
    await expect(page.locator('#stat')).toContainText('not pushed');
    expect(calls, 'cancelling must not publish').toBe(1);

    // Confirming sends the same request WITH consent, and it lands.
    await page.click('#push');
    await expect(dlg).toBeVisible();
    await dlg.locator('button.dsdlg-ok').click();
    await expect(page.locator('#stat')).toContainText('now matches');
    expect(calls).toBe(3);
  });
});
