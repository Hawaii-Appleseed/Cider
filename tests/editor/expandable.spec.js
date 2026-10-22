// Expandable sections: a toggle button box (act:'toggle') and the content box
// it reveals — rxkids' hand-built tfc-expand-btn pattern, as a native editor
// capability. Engine faces are pinned in docsync/test_docsync.py; here the
// editor lifecycle (insert as a wired grouped pair, delete-orphan cleanup,
// paste rewiring), the rxkids report as the working host, and the REAL disk
// build clicked open and closed. Local mode.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { removeYmlBindings } = require('./fixtures/host-state');
const REPO = path.resolve(__dirname, '..', '..');
const SLUG = 'zz-spec-expand';

// One worker, in order: the publish test snapshots and restores docsync.yml.
test.describe.configure({ mode: 'serial' });

async function addPair(page) {
  const frame = page.frameLocator('#out');
  await frame.locator('section.page').nth(3).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.click('#text');
  await page.click('#textpop .txtpreset[data-k="expand"]');
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const btn = boxes().find(b => b.act === 'toggle');
    return { btn, content: boxes().find(b => b.id === btn.target) };
  });
}

test.describe('expandable sections', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  // The pair is grouped so it travels as one — which also meant neither
  // piece could ever be RESIZED: handles only appear for a selection of
  // exactly one, and clicking a group always selects all of it. A second
  // click that does not move drills in, Canva-style.
  test('a second click gets inside the group, so the button can be resized',
    async ({ page }) => {
      const { btn } = await addPair(page);
      const frame = page.frameLocator('#out');
      const el = frame.locator(`[data-el="text.${btn.id}"]`);
      // insertion leaves the new pair selected; start from nothing so the
      // two-click sequence is the one being tested
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // first click: the whole pair — the group's own corners, no piece's handles
      await el.click();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => selIds.size)).toBe(2);
      await expect(frame.locator('.ds-handles:not(.ds-handles-group)')).toHaveCount(0);

      // second click, no movement: just this piece — and handles appear
      await el.click();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => [...selIds])).toEqual([`text.${btn.id}`]);
      await expect(frame.locator('.ds-handles')).toHaveCount(1);

      // and it really resizes: drag the east handle out, width follows
      const before = await page.evaluate(id =>
        boxes().find(b => b.id === id).w, btn.id);
      const h = frame.locator('.ds-handles .ds-h-e');
      const hb = await h.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 90, hb.y + hb.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const after = await page.evaluate(id =>
        boxes().find(b => b.id === id).w, btn.id);
      expect(after).toBeGreaterThan(before + 0.3);
    });

  // The gesture people actually use to mean "just this one". It fires a
  // mouseup AND a dblclick, so the drill-in and the text editor both wanted
  // the same burst: the drill narrowed the selection, then dblclick found a
  // solo box and opened the editor — landing in the words instead of on the
  // handles, which is exactly what "there are no size handles" looked like.
  test('double-clicking a grouped piece gets inside it, not into its words',
    async ({ page }) => {
      const { btn } = await addPair(page);
      const frame = page.frameLocator('#out');
      const el = frame.locator(`[data-el="text.${btn.id}"]`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await el.click();                       // the group
      await page.waitForTimeout(350);
      await el.dblclick();                    // get inside
      await page.waitForTimeout(600);

      expect(await page.evaluate(() => [...selIds])).toEqual([`text.${btn.id}`]);
      expect(await page.evaluate(() => !!editing)).toBe(false);
      await expect(frame.locator('.ds-handles')).toHaveCount(1);

      // editing the words is still reachable — one more double-click, once
      // the piece is already the selection on its own
      await page.waitForTimeout(900);         // past the just-drilled window
      await el.dblclick();
      await page.waitForTimeout(600);
      expect(await page.evaluate(() => !!editing)).toBe(true);
    });

  // The chevron is drawn art the person placing the button can restyle —
  // clicked directly, recoloured from the toolbar like any other artwork, and
  // deliberately NOT movable: it belongs inside its button.
  test('the arrow is selectable and recolours, but never leaves its button',
    async ({ page }) => {
      const { btn } = await addPair(page);
      const frame = page.frameLocator('#out');
      const arrow = frame.locator('svg.ds-tgl-svg');
      await expect(arrow).toHaveCount(1);
      await expect(arrow).toHaveAttribute('data-el', `tglarrow.${btn.id}`);

      await arrow.click();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => [...selIds]))
        .toEqual([`tglarrow.${btn.id}`]);
      // it is a colour target, and offers "Colour", not "Background"
      await expect(page.locator('#ar-fill')).toBeVisible();
      expect(await page.evaluate(id => fillTargets(id).label,
        `tglarrow.${btn.id}`)).toBe('Colour');
      // nothing to resize — its size comes from the button's type
      await expect(frame.locator('.ds-handles .ds-h')).toHaveCount(0);

      // recolour: stored under its own key, and it reaches the drawn stroke
      await page.evaluate(async id => {
        pushHistory(); fillTargets(id).set('#C0603F');
        markDirty(); await render();
      }, `tglarrow.${btn.id}`);
      await settled(page);
      expect(await page.evaluate(id => layout.fill[id], `tglarrow.${btn.id}`))
        .toBe('#C0603F');
      await expect(frame.locator('svg.ds-tgl-svg path'))
        .toHaveAttribute('stroke', '#C0603F');

      // dragging it must not pin it into positions{} — that would position it
      // absolutely and tear it out of the button it labels
      const ab = await frame.locator('svg.ds-tgl-svg').boundingBox();
      await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
      await page.mouse.down();
      await page.mouse.move(ab.x + 120, ab.y + 90, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      expect(await page.evaluate(id => layout.positions[id] || null,
        `tglarrow.${btn.id}`)).toBeNull();
    });

  test('the revealed content resizes on its own too, in both directions',
    async ({ page }) => {
      const { btn, content } = await addPair(page);
      const frame = page.frameLocator('#out');
      const el = frame.locator(`[data-el="text.${content.id}"]`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await el.click();                       // the group
      await page.waitForTimeout(300);
      await el.click();                       // drill in
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => [...selIds])).toEqual([`text.${content.id}`]);

      // the south handle sets a min-height floor (never clips the words)
      const h = frame.locator('.ds-handles .ds-h-s');
      const hb = await h.boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 80, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const box = await page.evaluate(id => boxes().find(b => b.id === id), content.id);
      expect(box.h).toBeGreaterThan(0.5);
      // the button was NOT dragged along with it
      const btnBox = await page.evaluate(id => boxes().find(b => b.id === id), btn.id);
      expect(btnBox.h == null || btnBox.h < box.h).toBe(true);
    });

  test('inserts as a wired pair — grouped, both visible, both movable',
    async ({ page }) => {
      const { btn, content } = await addPair(page);
      expect(btn.act).toBe('toggle');
      expect(content).toBeTruthy();
      // grouped, so it moves as one until the person ungroups it
      const grouped = await page.evaluate(([b, c]) =>
        (layout.groups || []).some(g =>
          g.includes('text.' + b) && g.includes('text.' + c)), [btn.id, content.id]);
      expect(grouped).toBe(true);
      // BOTH render on the artboard — the target is not collapsed here,
      // because collapsed content cannot be edited.
      const frame = page.frameLocator('#out');
      await expect(frame.locator(`[data-el="text.${btn.id}"]`)).toBeVisible();
      await expect(frame.locator(`[data-el="text.${content.id}"]`)).toBeVisible();
      await expect(frame.locator(`[data-el="text.${content.id}"]`))
        .toContainText('starts hidden');
      // and neither is a live control on the artboard
      const tags = await page.evaluate(([b, c]) => {
        const d = document.getElementById('out').contentDocument;
        return [d.querySelector(`[data-el="text.${b}"]`).tagName,
                d.querySelector(`[data-el="text.${c}"]`).tagName];
      }, [btn.id, content.id]);
      expect(tags).toEqual(['DIV', 'DIV']);
    });

  test('deleting the content demotes the button to a plain box instead of '
       + 'wedging the build', async ({ page }) => {
    const { btn, content } = await addPair(page);
    await page.evaluate(async cid => {
      const d = $('out').contentDocument;
      setSel(d, ['text.' + cid]);
      await deleteSel(d);
    }, content.id);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(id => boxes().find(b => b.id === id), btn.id);
    expect(after.act).toBeUndefined();
    expect(after.target).toBeUndefined();
    await expect(page.locator('#stat')).toContainText('plain text box now');
    // the draft still renders — the whole point of the demotion
    await expect(page.frameLocator('#out').locator(`[data-el="text.${btn.id}"]`))
      .toBeVisible();
  });

  test('duplicating the pair rewires the copy to its own content',
    async ({ page }) => {
      const { btn, content } = await addPair(page);
      await page.evaluate(async ([b, c]) => {
        const d = $('out').contentDocument;
        setSel(d, ['text.' + b, 'text.' + c]);
        copySel(d);
        await pasteClip(d);
      }, [btn.id, content.id]);
      await page.waitForTimeout(1500);
      const wiring = await page.evaluate(() => {
        const togglers = boxes().filter(b => b.act === 'toggle');
        return togglers.map(t => ({ id: t.id, target: t.target,
          targetExists: boxes().some(b => b.id === t.target) }));
      });
      expect(wiring).toHaveLength(2);
      // two buttons, two DIFFERENT targets, both real
      expect(new Set(wiring.map(w => w.target)).size).toBe(2);
      expect(wiring.every(w => w.targetExists)).toBe(true);
    });

  test('lives happily inside the rxkids report, beside its hand-built buttons',
    async ({ page }) => {
      await gotoEditor(page, '?project=rxkids');
      const frame = page.frameLocator('#out');
      await frame.locator('section.page').first()
        .waitFor({ state: 'visible', timeout: 75000 });
      await page.waitForTimeout(800);

      // rxkids' own bespoke expandables are intact in the editor preview —
      // however many it has; the invariant is that each keeps its handler.
      const bespoke = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        return [...d.querySelectorAll('.tfc-expand-btn')]
          .map(b => b.getAttribute('onclick') || '');
      });
      expect(bespoke.length).toBeGreaterThanOrEqual(1);
      expect(bespoke.every(h => /toggle/i.test(h))).toBe(true);

      // …and a NATIVE pair drops in beside it, in memory only (no save).
      const ids = await page.evaluate(async () => {
        pushHistory();
        const c = freeTId();
        boxes().push({ id: c, page: 1, x: 1, y: 3.4, w: 4,
                       md: 'Native expandable content, on rxkids.' });
        const b = freeTId();
        boxes().push({ id: b, page: 1, x: 1, y: 2.9, w: 2.6, md: 'Show more',
                       style: { color: '#FFFFFF', weight: 700 },
                       fill: '#52796F', act: 'toggle', target: c });
        markDirty(); await render();
        return { b, c };
      });
      await settled(page);
      await expect(frame.locator(`[data-el="text.${ids.b}"]`)).toBeVisible();
      await expect(frame.locator(`[data-el="text.${ids.c}"]`)).toBeVisible();
    });
});

// The increment: a toggle reveals shapes, tables and several things at once,
// wired through the button's own right-click menu.
test.describe('multi-kind targets', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
  });

  /** A pair plus a shape and a table on the same page, ids returned. */
  async function menagerie(page) {
    const { btn, content } = await addPair(page);
    const extra = await page.evaluate(async () => {
      pushHistory();
      const sid = freeShapeId ? freeShapeId('rect') : freeTId();
      layout.shapes.push({ id: sid, page: visiblePageId(), kind: 'rect',
                           x: 1, y: 4.2, w: 1.5, h: 0.8, fill: '#84A98C', z: 2 });
      const tid = freeTId();
      tables().push({ id: tid, page: visiblePageId(), x: 3, y: 4.2, w: 2.5,
                      rows: [['A', 'B']] });
      markDirty(); await render();
      return { sid, tid };
    });
    await settled(page);
    return { btn, content, ...extra };
  }

  test('right-click wires the button to the whole selection — box, shape, table',
    async ({ page }) => {
      const m = await menagerie(page);
      // select button + shape + table, then use the button's own menu
      await page.evaluate(ids => {
        setSel($('out').contentDocument, ids);
      }, ['text.' + m.btn.id, m.sid, 'table.' + m.tid]);
      await page.waitForTimeout(400);
      const frame = page.frameLocator('#out');
      await frame.locator(`[data-el="text.${m.btn.id}"]`).click({ button: 'right' });
      await page.waitForTimeout(400);
      await frame.locator('.ds-menu button', { hasText: 'Reveal the 2 selected' }).click();
      await page.waitForTimeout(1500);

      const t = await page.evaluate(id =>
        boxes().find(b => b.id === id).target, m.btn.id);
      expect([...t].sort()).toEqual([m.sid, m.tid].sort());
    });

  test('deleting one revealed element prunes the list; the last demotes',
    async ({ page }) => {
      const m = await menagerie(page);
      await page.evaluate(([bid, sid, tid]) => {
        pushHistory();
        boxes().find(b => b.id === bid).target = [sid, tid];
        markDirty();
      }, [m.btn.id, m.sid, m.tid]);
      // delete the shape: list prunes, button still a toggle
      await page.evaluate(async sid => {
        const d = $('out').contentDocument;
        setSel(d, [sid]);
        await deleteSel(d);
      }, m.sid);
      await page.waitForTimeout(1200);
      let bx = await page.evaluate(id => boxes().find(b => b.id === id), m.btn.id);
      expect(bx.act).toBe('toggle');
      expect(bx.target).toBe(m.tid);
      await expect(page.locator('#stat')).toContainText('still reveals the other');
      // delete the table too: nothing left, demoted
      await page.evaluate(async tid => {
        const d = $('out').contentDocument;
        setSel(d, ['table.' + tid]);
        await deleteSel(d);
      }, m.tid);
      await page.waitForTimeout(1200);
      bx = await page.evaluate(id => boxes().find(b => b.id === id), m.btn.id);
      expect(bx.act).toBeUndefined();
      expect(bx.target).toBeUndefined();
    });

  test('"Stop revealing" demotes on purpose too', async ({ page }) => {
    const { btn } = await addPair(page);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="text.${btn.id}"]`).click({ button: 'right' });
    await page.waitForTimeout(400);
    await frame.locator('.ds-menu button', { hasText: 'Stop revealing' }).click();
    await page.waitForTimeout(1500);
    const bx = await page.evaluate(id => boxes().find(b => b.id === id), btn.id);
    expect(bx.act).toBeUndefined();
    expect(bx.target).toBeUndefined();
  });
});

// The other face, end to end: a scaffolded project built by the REAL renderer
// on disk, its published page opened and the button actually clicked — closed,
// open, closed again, aria tracking all the way.
test('the published page expands and collapses for real', async ({ page }) => {
  try {
    await page.goto('start.html');
    await page.waitForTimeout(600);
    await page.click('#new');
    await page.fill('#np-name', 'Expand Report');
    await page.fill('#np-slug', SLUG);
    await page.click('#np-create');
    await page.waitForURL(`**/edit.html?project=${SLUG}`, { timeout: 30000 });
    await page.frameLocator('#out').locator('section.page[data-page="1"]')
      .waitFor({ state: 'visible', timeout: 75000 });

    const lj = path.join(REPO, 'projects', SLUG, 'layout.json');
    const d = JSON.parse(fs.readFileSync(lj, 'utf8'));
    d.boxes = [
      // tglSpeed pinned well above the .3s default: the test waits past it
      // to read the SETTLED state, and a slow, deliberately generous speed
      // makes that wait unambiguous rather than a race against a fast
      // transition on a loaded CI runner.
      { id: 't1', page: 1, x: 1, y: 1, w: 2.6, md: 'Show details',
        fill: '#52796F', style: { color: '#FFFFFF', weight: 700 },
        act: 'toggle', target: ['t2', 's9', 't8'], tglSpeed: 1.6 },
      { id: 't2', page: 1, x: 1, y: 1.6, w: 5, md: 'The hidden half.' },
    ];
    d.shapes = [{ id: 's9', page: 1, kind: 'rect', x: 1, y: 3.2, w: 2, h: 1,
                  fill: '#84A98C' }];
    d.tables = [{ id: 't8', page: 1, x: 1, y: 4.6, w: 3, rows: [['A', 'B']] }];
    fs.writeFileSync(lj, JSON.stringify(d, null, 2));
    execSync(`python3 ${JSON.stringify(path.join(REPO, 'projects', SLUG, 'render_report.py'))}`,
      { cwd: REPO });
    const html = fs.readFileSync(
      path.join(REPO, 'projects', SLUG, 'web', 'index.html'), 'utf8');

    const run = await page.evaluate(async raw => {
      // A BLOB URL, not document.write — and this spec's own subject is why.
      // The toggle is a real animation now, which means the published page
      // carries an inline <script> (__dsTgl) inside section.page, and
      // document.write's parser STOPS at a script: the button and everything
      // after it never entered the document. The page under test has to be
      // parsed the way a browser opening the file parses it.
      const w = window.open(
        URL.createObjectURL(new Blob([raw], { type: 'text/html' })), '_blank');
      const t0 = Date.now();
      let btn;
      while (!(btn = w.document && w.document.querySelector('.ds-tglbtn'))) {
        if (Date.now() - t0 > 5000) throw new Error('published page never loaded');
        await new Promise(r => setTimeout(r, 50));
      }
      const ts = ['ds-x-t2', 'ds-x-s9', 'ds-x-t8']
        .map(i => w.document.getElementById(i));
      // The published toggle is a REAL height transition now (__dsTgl,
      // JS-measured — see docsync.layout._anim_check et al.), not an instant
      // display:none flip, so "is it open" has two different honest answers
      // at two different moments. Right after the click it is CLASS state —
      // deterministic and synchronous, the one thing not still animating.
      // Once the transition has had time to finish, it is genuinely
      // rendered: opacity settled at 1, and a laid-out box's max-height at
      // 'none' (a shape's never moves — see layout.py's own comment on why
      // max-height is inert on SVG) rather than still clamped to 0.
      const cls = () => ts.map(e => e.classList.contains('ds-tgl-open'));
      const rendered = () => ts.map(e => {
        const cs = w.getComputedStyle(e);
        return e.tagName === 'rect' ? cs.opacity !== '0'
          : cs.opacity !== '0' && cs.maxHeight !== '0px';
      });
      const arrow = btn.querySelector('svg.ds-tgl-svg');
      const spin = () => arrow
        ? w.getComputedStyle(arrow).transform : 'none';
      const out = { kinds: ts.map(e => e && e.tagName),
                    startClosed: rendered().every(v => v === false),
                    aria0: btn.getAttribute('aria-expanded'),
                    hasArrow: !!arrow, shutSpin: spin() };
      btn.click();
      out.openClassImmediate = cls();     // true before any frame has painted
      out.aria1 = btn.getAttribute('aria-expanded');
      out.arrowTurned = btn.classList.contains('ds-tgl-on');
      // Real duration is 1.6s in this layout — wait past it, or a transition
      // still mid-flight would read as neither open nor closed.
      await new Promise(r => setTimeout(r, 1800));
      out.openRendered = rendered();
      out.openSpin = spin();
      btn.click();
      out.closedClassImmediate = cls();
      out.aria2 = btn.getAttribute('aria-expanded');
      await new Promise(r => setTimeout(r, 1800));
      out.closedRendered = rendered();
      w.close();
      return out;
    }, html);
    // a DIV, an SVG node and a TABLE — three kinds, one button
    expect(run.kinds).toEqual(['DIV', 'rect', 'TABLE']);
    expect(run.startClosed).toBe(true);
    expect(run.aria0).toBe('false');
    expect(run.openClassImmediate).toEqual([true, true, true]);
    expect(run.aria1).toBe('true');
    expect(run.openRendered).toEqual([true, true, true]);
    expect(run.arrowTurned).toBe(true);
    // The chevron is real drawn art, and it really turns: shut it is
    // untransformed, open it carries the 180° rotate that points it up.
    expect(run.hasArrow).toBe(true);
    expect(run.shutSpin === 'none' || run.shutSpin === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
    expect(run.openSpin).toContain('matrix(-1, 0, 0, -1');
    expect(run.closedClassImmediate).toEqual([false, false, false]);
    expect(run.aria2).toBe('false');
    expect(run.closedRendered).toEqual([false, false, false]);
  } finally {
    // Our binding only — a whole-file restore was the scaffold race
      // (fixtures/host-state.js).
      removeYmlBindings(SLUG);
    for (const dir of [`projects/${SLUG}`, `docs/${SLUG}`]) {
      execSync(`rm -rf ${JSON.stringify(path.join(REPO, dir))}`);
    }
  }
});
