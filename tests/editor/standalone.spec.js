// Standalone installable shell (docs/primer/STANDALONE.md, piece B): the app
// manifest, service worker, and start.html landing page that turn the editor
// from "a link into one report" into something with its own front door.
const { test, expect } = require('./fixtures/editor-test');

// The ONE file that needs a real worker: the config blocks service workers
// suite-wide (see playwright.config.js), and these tests assert registration.
test.use({ serviceWorkers: 'allow' });

test.describe('installable shell', () => {
  test('manifest.webmanifest is valid and linked from both app pages', async ({ page }) => {
    const res = await page.request.get('manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('./start.html');
    expect(m.icons.length).toBeGreaterThan(0);

    for (const url of ['start.html', 'edit.html']) {
      await page.goto(url);
      const href = await page.locator('link[rel="manifest"]').getAttribute('href');
      expect(href).toBe('manifest.webmanifest');
    }
  });

  test('the service worker registers on start.html and edit.html', async ({ page }) => {
    for (const url of ['start.html', 'edit.html']) {
      await page.goto(url);
      const state = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return 'unsupported';
        const reg = await navigator.serviceWorker.ready;
        if (!reg.active) return 'no-active-worker';
        // `ready` can resolve a beat before the worker's own state string
        // catches up from 'activating' to 'activated' — wait for the real
        // terminal state instead of racing it.
        if (reg.active.state === 'activated') return 'activated';
        return new Promise(resolve => {
          reg.active.addEventListener('statechange', () => {
            if (reg.active.state === 'activated') resolve('activated');
          });
        });
      });
      expect(state).toBe('activated');
    }
  });

  test('the published report (index.html) is excluded from the shell cache', async ({ page }) => {
    const swSource = await (await page.request.get('sw.js')).text();
    // The whole point of excluding it (per STANDALONE.md): a reader who never
    // opened the editor must never be affected by this cache, and one who did
    // must never see a stale copy of the report they came to read.
    // This only says the rule exists, and an earlier form of it passed the
    // whole time the hub's report pages (/primer/<id>/) came from the cache:
    // that rule named one path. sw-report-pages.spec.js serves a report the
    // way Pages does and checks what the browser actually gets (2026-10-28).
    expect(swSource).toMatch(/isPublishedPage/);
    expect(swSource).not.toMatch(/primer-shell-v8'/);
  });

  test('the editor page itself is network-first, never served one build stale', async ({ page }) => {
    const swSource = await (await page.request.get('sw.js')).text();
    // Stale-while-revalidate on edit.html meant every visit ran the PREVIOUS
    // build — shipped fixes looked absent until the visit after next. The
    // pages now wait for the network and use the cache only as the offline
    // fallback; the version bump evicts every existing stale shell.
    expect(swSource).toMatch(/isShellPage/);
    // Both spellings: Pages answers /primer/edit.html with a 301 to /primer/edit,
    // and the redirect is a second request through the worker.
    expect(swSource).toMatch(/\(edit\|start\)\(\\\.html\)\?/);
    expect(swSource).not.toMatch(/primer-shell-v1/);
  });

  test('the hub API is never answered from the shell cache', async ({ page }) => {
    const swSource = await (await page.request.get('sw.js')).text();
    // /api/docs/<room>/comments fell through to the generic same-origin branch
    // and was served cache-first: every poll answered with the poll before it,
    // so a suggestion reached the other editors a poll late and a thread
    // resolved a moment ago came back open until the next poll. /api/ is
    // network-only, and so is any request that says {cache:'no-store'} — the
    // page knows which of its reads are liveness signals; the worker does not.
    expect(swSource).toMatch(/\^\\\/api\\\//);
    expect(swSource).toMatch(/req\.cache === 'no-store'/);
    expect(swSource).not.toMatch(/primer-shell-v7'/);
  });

  test('start.html renders a project card per registry entry, linking into the editor', async ({ page }) => {
    await page.goto('start.html');
    const registry = await (await page.request.get('projects.json')).json();
    const ids = Object.keys(registry);

    const cards = page.locator('#grid .card');
    await expect(cards).toHaveCount(ids.length);
    for (const id of ids) {
      // Anchored at the END of the href, and built the way renderGrid() builds
      // it. A substring match reads "project=rxkids" inside the card for
      // rxkids-fiscal too, so this counted two cards for one id and failed on
      // a registry that had done nothing wrong — any id that is a prefix of
      // another id would do it again.
      const card = page.locator(
        `#grid .card[href$="project=${encodeURIComponent(id)}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.locator('.name')).toHaveText(registry[id].name || id);
    }

    await cards.first().click();
    await expect(page).toHaveURL(/edit\.html\?project=/);
  });

  test('"+ New report" opens the creation modal with a page-size choice', async ({ page }) => {
    await page.goto('start.html');
    await page.click('#new');
    await expect(page.locator('#modal-bg')).toHaveClass(/open/);
    await expect(page.locator('#np-create')).toBeVisible();

    await page.click('#np-cancel');
    await expect(page.locator('#modal-bg')).not.toHaveClass(/open/);
  });
});
