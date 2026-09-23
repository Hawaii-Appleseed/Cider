// Entrance animations (layout.py anim + edit.html's Animate submenu +
// replayAnims). Editor: set from the right-click menu on any element, preview
// plays immediately, presentation mode replays a slide's entrances on entry.
// Published: observer-triggered, script-applied hiding, reduced-motion and
// print always show content. Engine faces pinned in test_docsync.py. Local.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');
const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-anim';

// One worker, in order: the publish test snapshots and restores docsync.yml.
test.describe.configure({ mode: 'serial' });

/** Listen for animationstart on the report document; returns a counter id. */
const armListener = (page) => page.evaluate(() => {
  const d = document.getElementById('out').contentDocument;
  window.__animCount = 0;
  d.addEventListener('animationstart', e => {
    if (String(e.animationName).startsWith('ds-a-')) window.__animCount++;
  }, true);
});
const animCount = (page) => page.evaluate(() => window.__animCount || 0);

test.describe('entrance animations', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  test('the menu animates a ROTATED shape — store set, preview plays, rotation kept',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.click('#shape');
      await page.click('#shapepop .shp[data-k="rect"]');
      await frame.locator('[data-shape]').first().waitFor({ state: 'attached', timeout: 20000 });
      await page.waitForTimeout(800);
      const sid = await page.evaluate(async () => {
        pushHistory();
        layout.shapes[0].rot = 20;          // the collision case the keyframes avoid
        markDirty(); await render();
        return layout.shapes[0].id;
      });
      await page.waitForTimeout(1000);

      const el = frame.locator(`[data-shape="${sid}"]`);
      await el.click({ button: 'right' });
      await page.waitForTimeout(400);
      await frame.locator('.ds-menu button.ds-sub', { hasText: 'Animate' }).hover();
      await page.waitForTimeout(400);
      await frame.locator('.ds-submenu button', { hasText: 'Rise' }).click();
      await page.waitForTimeout(1500);

      const st = await page.evaluate(id =>
        layout.shapes.find(x => x.id === id), sid);
      expect(st.anim).toEqual({ kind: 'rise', duration: 0.6, delay: 0 });
      expect(st.rot).toBe(20);
      // the re-rendered node carries the attributes and the preview PLAYED
      // The preview's evidence is on the element itself: the picking click
      // re-renders (replacing the document — and any listener armed before
      // it), then replayAnims marks the NEW node and sets its timing.
      const dom = await page.evaluate(id => {
        const d = document.getElementById('out').contentDocument;
        const e = d.querySelector(`[data-shape="${id}"]`);
        return { anim: e.getAttribute('data-ds-anim'),
                 rot: e.getAttribute('transform'),
                 playing: e.classList.contains('ds-anim-in'),
                 dur: e.style.animationDuration };
      }, sid);
      expect(dom.anim).toBe('rise');
      expect(dom.rot).toContain('rotate(20');
      expect(dom.playing).toBe(true);
      expect(dom.dur).toBe('0.6s');
    });

  test('a designed element stores its animation in positions{}, like alpha does',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const h1 = frame.locator('[data-el="basics.h1"]');
      await h1.click({ button: 'right' });
      await page.waitForTimeout(400);
      await frame.locator('.ds-menu button.ds-sub', { hasText: 'Animate' }).hover();
      await page.waitForTimeout(400);
      await frame.locator('.ds-submenu button', { hasText: 'Fade in' }).click();
      await page.waitForTimeout(1500);

      const pos = await page.evaluate(() => layout.positions['basics.h1']);
      expect(pos.anim.kind).toBe('fade');
      const attr = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        return d.querySelector('[data-el="basics.h1"]').getAttribute('data-ds-anim');
      });
      expect(attr).toBe('fade');
      // clean up so later tests see the pristine fixture heading
      await page.evaluate(async () => {
        pushHistory();
        delete layout.positions['basics.h1'].anim;
        markDirty(); await render();
      });
      await page.waitForTimeout(1200);
    });

  // The editor keeps animated elements static, so the ONLY way to see an
  // entrance without publishing or presenting is to ask for it. Three ways
  // in, all one helper: picking a kind, releasing a timing slider, and the
  // toolbar's play button. A TEXT BOX on purpose — the kind of element
  // someone actually animates, and the one the first tests never covered.
  test('a text box plays once on pick, and the toolbar grows a play button',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const id = await page.evaluate(async () => {
        pushHistory();
        const tid = freeTId();
        boxes().push({ id: tid, page: visiblePageId(), x: 1, y: 2, w: 3,
                       md: 'Animate me' });
        markDirty(); await render();
        return 'text.' + tid;
      });
      await page.waitForTimeout(1200);

      // no animation yet: no play button on the floating mini bar. Selected
      // without typing — a click on a text box opens its words now, and the
      // floating bar stands down while they are open.
      await page.evaluate(k => docsync.api.select(k), id);
      await page.waitForTimeout(400);
      await expect(frame.locator('.ds-mini button[aria-label^="Play"]')).toHaveCount(0);

      // pick one from the menu — it plays once, on the box itself
      await frame.locator(`[data-el="${id}"]`).click({ button: 'right' });
      await page.waitForTimeout(400);
      await frame.locator('.ds-menu button.ds-sub', { hasText: 'Animate' }).hover();
      await page.waitForTimeout(400);
      await frame.locator('.ds-submenu button', { hasText: 'Rise' }).click();
      await page.waitForTimeout(1500);

      const played = await page.evaluate(k => {
        const d = document.getElementById('out').contentDocument;
        const e = d.querySelector(`[data-el="${k}"]`);
        return { on: e.classList.contains('ds-anim-in'),
                 dur: e.style.animationDuration };
      }, id);
      expect(played.on).toBe(true);
      expect(played.dur).toBe('0.6s');

      // and now the mini bar above it offers to play it again
      await page.evaluate(k => docsync.api.select(k), id);
      await page.waitForTimeout(400);
      const play = frame.locator('.ds-mini button[aria-label^="Play"]');
      await expect(play).toHaveCount(1);
      await expect(play).toHaveAttribute('aria-label', /rise/);

      // Pressing it RESTARTS an entrance that has already played and is
      // sitting finished with ds-anim-in still on it — the real replay case,
      // asserted through actual animationstart events rather than the class,
      // and twice over so a one-off cannot pass for a working button.
      const settled = await page.evaluate(k => {
        const d = document.getElementById('out').contentDocument;
        return d.querySelector(`[data-el="${k}"]`).classList.contains('ds-anim-in');
      }, id);
      expect(settled).toBe(true);
      await armListener(page);
      await play.click();
      await page.waitForTimeout(900);
      expect(await animCount(page)).toBeGreaterThanOrEqual(1);
      // and twice in a row, so it is repeatable rather than a one-off
      await play.click();
      await page.waitForTimeout(900);
      expect(await animCount(page)).toBeGreaterThanOrEqual(2);
    });

  test('changing the speed plays it again, at the new speed', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const id = await page.evaluate(async () => {
      pushHistory();
      const tid = freeTId();
      boxes().push({ id: tid, page: visiblePageId(), x: 1, y: 2, w: 3,
                     md: 'Timed', anim: { kind: 'fade', duration: 0.6, delay: 0 } });
      markDirty(); await render();
      return 'text.' + tid;
    });
    await page.waitForTimeout(1200);

    await frame.locator(`[data-el="${id}"]`).click({ button: 'right' });
    await page.waitForTimeout(400);
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Animate' }).hover();
    await page.waitForTimeout(400);
    // Drag the speed slider with a REAL mouse, left to right. Dispatching
    // input/change by hand passes even when the control is unusable: every
    // menu cancels mousedown to protect the editor's caret, and cancelling
    // it on a range also cancels the thumb-drag that IS the control — the
    // slider rendered, reported its value, and could not be moved at all.
    const slider = frame.locator('.ds-submenu .ds-menu-slider input').first();
    const sb = await slider.boundingBox();
    await page.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width * 0.85, sb.y + sb.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1800);

    // committed to the store, and played again at whatever the drag chose
    const out = await page.evaluate(k => {
      const d = document.getElementById('out').contentDocument;
      const e = d.querySelector(`[data-el="${k}"]`);
      const bx = boxes().find(b => 'text.' + b.id === k);
      return { stored: bx.anim.duration, on: e.classList.contains('ds-anim-in'),
               dur: e.style.animationDuration };
    }, id);
    expect(out.stored).toBeGreaterThan(0.6);      // it actually moved
    expect(out.on).toBe(true);
    expect(out.dur).toBe(`${out.stored}s`);       // and replayed at that speed
  });

  // A chart can animate its parts instead of itself: axes and labels stay
  // put, the bars grow out of the baseline one after the next.
  test('a bar chart is offered "Bars grow in", and its bars stagger',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const id = await page.evaluate(async () => {
        pushHistory();
        const sid = freeShapeId('chart');
        layout.shapes.push({ id: sid, page: visiblePageId(), kind: 'chart',
          x: 1, y: 2, w: 4, h: 2.6, z: 3, fill: 'none',
          chart: { type: 'bar', labels: ['A', 'B', 'C'],
                   series: [{ name: 'S', data: [12, 19, 8] }] } });
        markDirty(); await render();
        return sid;
      });
      await page.waitForTimeout(1500);

      await frame.locator(`[data-shape="${id}"]`).click({ button: 'right' });
      await page.waitForTimeout(400);
      await frame.locator('.ds-menu button.ds-sub', { hasText: 'Animate' }).hover();
      await page.waitForTimeout(400);
      const bars = frame.locator('.ds-submenu button', { hasText: 'Bars grow in' });
      await expect(bars).toHaveCount(1);
      await bars.click();
      await page.waitForTimeout(1500);

      expect(await page.evaluate(i => layout.shapes.find(s => s.id === i).anim, id))
        .toEqual({ kind: 'bars', duration: 0.6, delay: 0 });

      const seen = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const g = d.querySelector('[data-ds-anim="bars"]');
        // Scoped to the animated group, not the document: the report itself
        // draws bar charts (the income-quintile figure on this very page has
        // seven bars), so counting .ds-cbar across the draft tallied those too
        // and read 10 where the shape under test has 3.
        const bs = [...g.querySelectorAll('.ds-cbar')];
        return { playing: g.classList.contains('ds-anim-in'),
                 n: bs.length,
                 delays: bs.map(b => d.defaultView.getComputedStyle(b).animationDelay),
                 names: bs.map(b => d.defaultView.getComputedStyle(b).animationName) };
      });
      expect(seen.playing).toBe(true);         // previewed once on pick
      expect(seen.n).toBe(3);
      expect(seen.names).toEqual(['ds-a-bar', 'ds-a-bar', 'ds-a-bar']);
      // each starts after the one before it, so the row reads across
      expect(seen.delays).toEqual(['0s', '0.075s', '0.15s']);
    });

  test('a pie chart is not offered bars — it has none', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const id = await page.evaluate(async () => {
      pushHistory();
      const sid = freeShapeId('chart');
      layout.shapes.push({ id: sid, page: visiblePageId(), kind: 'chart',
        x: 1, y: 2, w: 3, h: 2.6, z: 3, fill: 'none',
        chart: { type: 'pie', labels: ['A', 'B'],
                 series: [{ name: 'S', data: [3, 7] }] } });
      markDirty(); await render();
      return sid;
    });
    await page.waitForTimeout(1500);
    await frame.locator(`[data-shape="${id}"]`).click({ button: 'right' });
    await page.waitForTimeout(400);
    await frame.locator('.ds-menu button.ds-sub', { hasText: 'Animate' }).hover();
    await page.waitForTimeout(400);
    await expect(frame.locator('.ds-submenu button', { hasText: 'Bars grow in' }))
      .toHaveCount(0);
    // the whole-element entrances are still all there
    await expect(frame.locator('.ds-submenu button', { hasText: 'Fade in' }))
      .toHaveCount(1);
  });

  test('presentation mode replays a slide’s entrances on entry, and again on return',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.evaluate(async () => {
        pushHistory();
        const id = freeTId();
        boxes().push({ id, page: visiblePageId(), x: 1, y: 2, w: 3,
                       md: 'Slides in on the slide', anim: { kind: 'slide-left',
                       duration: 0.3, delay: 0 } });
        markDirty(); await render();
      });
      await page.waitForTimeout(1500);
      await armListener(page);

      await page.click('#present');
      await page.waitForTimeout(900);
      const onEntry = await animCount(page);
      expect(onEntry).toBeGreaterThanOrEqual(1);

      // leave the slide and come back: it plays again
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(500);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(900);
      expect(await animCount(page)).toBeGreaterThan(onEntry);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    });
});

// Published, end to end: real disk build; on-screen element animates in, an
// off-screen one stays hidden until scrolled to, and a reduced-motion reader
// gets everything immediately with no animation at all.
test('the published page reveals on scroll, and respects reduced motion',
  async ({ page }) => {
    try {
      await page.goto('start.html');
      await page.waitForTimeout(600);
      await page.click('#new');
      await page.fill('#np-name', 'Anim Report');
      await page.fill('#np-slug', SLUG);
      await page.click('#np-create');
      await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
      await page.frameLocator('#out').locator('section.page[data-page="1"]')
        .waitFor({ state: 'visible', timeout: 75000 });

      const lj = path.join(REPO, 'projects', SLUG, 'layout.json');
      const d = JSON.parse(fs.readFileSync(lj, 'utf8'));
      d.boxes = [
        { id: 't1', page: 1, x: 1, y: 1, w: 3, md: 'Near the top',
          anim: { kind: 'fade', duration: 0.2 } },
        { id: 't2', page: 1, x: 1, y: 9.8, w: 3, md: 'Far below the fold',
          anim: { kind: 'rise', duration: 0.2 } },
      ];
      // A chart below the fold, animating its PARTS: the drawing stays
      // visible the whole time and only the bars are held back.
      d.shapes = [{ id: 'c1', page: 1, kind: 'chart', x: 1, y: 6, w: 4, h: 2.5,
                    fill: 'none', anim: { kind: 'bars', duration: 0.25 },
                    chart: { type: 'bar', labels: ['A', 'B', 'C'],
                             series: [{ name: 'S', data: [12, 19, 8] }] } }];
      fs.writeFileSync(lj, JSON.stringify(d, null, 2));
      execSync(`python3 ${JSON.stringify(path.join(REPO, 'projects', SLUG, 'render_report.py'))}`,
        { cwd: REPO });
      const html = fs.readFileSync(
        path.join(REPO, 'projects', SLUG, 'web', 'index.html'), 'utf8');

      const run = await page.evaluate(async raw => {
        const fr = document.createElement('iframe');
        fr.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:500px';
        document.body.appendChild(fr);
        fr.contentDocument.write(raw); fr.contentDocument.close();
        const w = fr.contentWindow, doc = fr.contentDocument;
        const t1 = doc.querySelector('[data-ds-anim="fade"]');
        const t2 = doc.querySelector('[data-ds-anim="rise"]');
        const state = el => ({
          wait: el.classList.contains('ds-anim-wait'),
          got: el.classList.contains('ds-anim-in'),
          shown: w.getComputedStyle(el).opacity !== '0',
        });
        // the chart, and the bars inside it
        const ch = doc.querySelector('[data-ds-anim="bars"]');
        const bar = doc.querySelector('.ds-cbar');
        const barState = () => ({
          chartShown: w.getComputedStyle(ch).opacity !== '0',
          barScale: w.getComputedStyle(bar).scale,
          barAnim: w.getComputedStyle(bar).animationName,
        });
        await new Promise(r => setTimeout(r, 600));      // observer settles
        const out = { top: state(t1), farBefore: state(t2),
                      chartBefore: barState() };
        t2.scrollIntoView();
        await new Promise(r => setTimeout(r, 700));
        out.farAfter = state(t2);
        ch.scrollIntoView();
        await new Promise(r => setTimeout(r, 900));
        out.chartAfter = barState();
        fr.remove();
        return out;
      }, html);
      // The chart never hides — a part animation holds back the BARS, and a
      // chart blanked to opacity 0 would read as a missing figure.
      expect(run.chartBefore.chartShown).toBe(true);
      expect(run.chartBefore.barScale).toBe('1 0');       // collapsed, waiting
      expect(run.chartAfter.chartShown).toBe(true);
      expect(run.chartAfter.barAnim).toBe('ds-a-bar');    // it really grows
      // near the top: observed immediately, animated in
      expect(run.top.got).toBe(true);
      expect(run.top.shown).toBe(true);
      // below the fold: script-hidden until scrolled to, then revealed
      expect(run.farBefore.wait).toBe(true);
      expect(run.farBefore.shown).toBe(false);
      expect(run.farAfter.got).toBe(true);
      expect(run.farAfter.shown).toBe(true);

      // A reduced-motion reader: nothing hides, nothing animates.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const calm = await page.evaluate(async raw => {
        const fr = document.createElement('iframe');
        fr.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:500px';
        document.body.appendChild(fr);
        fr.contentDocument.write(raw); fr.contentDocument.close();
        const w = fr.contentWindow, doc = fr.contentDocument;
        await new Promise(r => setTimeout(r, 500));
        const t2 = doc.querySelector('[data-ds-anim="rise"]');
        const out = { wait: t2.classList.contains('ds-anim-wait'),
                      shown: w.getComputedStyle(t2).opacity !== '0' };
        fr.remove();
        return out;
      }, html);
      expect(calm.wait).toBe(false);
      expect(calm.shown).toBe(true);
      await page.emulateMedia({ reducedMotion: null });
    } finally {
      // Our binding only — a whole-file restore was the scaffold race
      // (fixtures/host-state.js).
      removeYmlBindings(SLUG);
      for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
        execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
      }
    }
  });
