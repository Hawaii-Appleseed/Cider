// PowerPoint dimensions as first-class page sizes: Slide 16:9 (13.333x7.5,
// PowerPoint's own numbers) and Slide 4:3 (10x7.5) in both File > Resize and
// the start page's "+ New report". These write real files, so everything is
// snapshotted and restored — same discipline as local-scaffold.spec.js.
const { test, expect, gotoEditor, openFileMenu, settled, clickTool } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { removeYmlBindings } = require('./fixtures/host-state');

const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-deck';

// Serial: both tests scaffold and clean the same slug, and fullyParallel
// would run each test's hooks in its own worker.
test.describe.configure({ mode: 'serial' });

test.describe('slide sizes', () => {
  test.afterEach(() => {
    // Our binding only — a whole-file restore was the scaffold race
    // (fixtures/host-state.js).
    removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  });

  test('File > Resize to Slide 4:3 really renders a 10x7.5 landscape sheet',
    async ({ page }) => {
      await gotoEditor(page);
      await openFileMenu(page);
      await page.click('#file-resize');
      await page.click('#size-list button[data-size="slide43"]');
      await page.waitForTimeout(2500);

      // The rendered sheet as the browser computes it — not what was stored.
      const g = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const r = d.querySelector('section.page').getBoundingClientRect();
        return { w: r.width, h: r.height, pw: PAGE_W_IN, ph: PAGE_H_IN };
      });
      expect(g.pw).toBeCloseTo(10, 2);       // the drag/clamp geometry followed
      expect(g.ph).toBeCloseTo(7.5, 2);
      expect(g.w).toBeGreaterThan(g.h);      // genuinely landscape on screen
      expect(g.w / g.h).toBeCloseTo(10 / 7.5, 1);
      // No stored size survives the test: the fixture must stay Letter.
      await page.evaluate(async () => {
        delete layout.page; syncPageSize(); await render();
      });
      await settled(page);
    });

  test('a new report created at Slide 16:9 comes out slide-shaped, and presents edge to edge',
    async ({ page }) => {
      await page.goto('start.html');
      await page.waitForTimeout(600);
      await page.click('#new');
      await page.fill('#np-name', 'Spec Deck');
      await page.fill('#np-slug', SLUG);
      await page.selectOption('#np-size', 'slide169');
      await page.click('#np-create');
      await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
      const frame = page.frameLocator('#out');
      await frame.locator('section.page[data-page="1"]')
        .waitFor({ state: 'visible', timeout: 75000 });
      await page.waitForTimeout(800);

      const g = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const r = d.querySelector('section.page').getBoundingClientRect();
        return { ratio: r.width / r.height, pw: PAGE_W_IN, ph: PAGE_H_IN };
      });
      expect(g.pw).toBeCloseTo(13.333, 2);
      expect(g.ph).toBeCloseTo(7.5, 2);
      expect(g.ratio).toBeCloseTo(16 / 9, 1);

      // A 16:9 page in presentation mode on a 16:9-ish window fills it almost
      // edge to edge — the whole reason a deck author picks this size.
      await clickTool(page, 'present');
      await page.waitForTimeout(700);
      const fit = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const r = d.querySelector('section.page.ds-present-on').getBoundingClientRect();
        return { w: r.width * curScale, h: r.height * curScale,
                 winW: window.innerWidth, winH: window.innerHeight };
      });
      expect(fit.h).toBeLessThanOrEqual(fit.winH + 2);
      expect(fit.w).toBeLessThanOrEqual(fit.winW + 2);
      // and at least one axis is essentially full-bleed
      const slackW = fit.winW - fit.w, slackH = fit.winH - fit.h;
      expect(Math.min(slackW, slackH)).toBeLessThan(30);
      await page.keyboard.press('Escape');
    });
});
