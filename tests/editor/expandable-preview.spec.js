// The expandable section's real animation (docsync/layout.py's __dsTgl) and
// its editor-side preview (edit.html's previewToggle + the mini toolbar's
// Preview/Expand-speed buttons, docsync/editor/edit.html).
//
// Published behaviour — a real max-height/opacity transition, JS-measured so
// short content doesn't snap open almost instantly — is pinned in
// test_docsync.py, where the raw HTML string is cheap to assert against.
// This file covers what only a live iframe can show: the button and its
// target select and control together, the preview plays and cleans up after
// itself without leaving inline styles behind, and the speed control is
// reachable exactly where the user asked for it — the mini toolbar, when the
// group is selected.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

async function addExpandableSection(page) {
  return page.evaluate(async () => {
    await addExpandable();
    const tb = boxes().find(b => b.act === 'toggle');
    return tb.id;
  });
}

const miniBtn = (page, label) => page.evaluate((l) => {
  const bar = document.getElementById('out').contentDocument.querySelector('.ds-mini');
  const b = bar && [...bar.querySelectorAll('button')]
    .find(x => x.getAttribute('aria-label') === l);
  if (b) b.click();
  return !!b;
}, label);

test.describe('expandable section: preview and speed', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.frameLocator('#out').locator('section.page').nth(3)
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  test('selecting the button also selects its content, and the mini toolbar '
    + 'offers Preview and Expand speed', async ({ page }) => {
    const btnId = await addExpandableSection(page);
    await page.waitForTimeout(400);
    const frame = page.frameLocator('#out');
    // addExpandable() leaves the pair selected as a group — click a page
    // clicking the SAME already-fully-selected group is a documented "drill
    // in" (see startDrag's mouseup / the dblclick handler), narrowing to just
    // the piece under the pointer so it can be resized on its own. A single
    // FRESH click — the group not already the whole selection — is what
    // selects the group; deselect first so this click is that fresh one.
    await frame.locator('[data-el="basics.h1"]').click();
    await page.waitForTimeout(200);
    await frame.locator(`[data-el="text.${btnId}"]`).click();
    await page.waitForTimeout(300);

    const state = await page.evaluate((id) => {
      const tb = boxes().find(b => b.id === id);
      const tid = Array.isArray(tb.target) ? tb.target[0] : tb.target;
      return { selIds: [...selIds].sort(), targetSelected: selIds.has(`text.${tid}`) };
    }, btnId);
    expect(state.targetSelected).toBe(true);
    expect(state.selIds.length).toBe(2);            // button + its one target

    const labels = await page.evaluate(() => {
      const bar = document.getElementById('out').contentDocument.querySelector('.ds-mini');
      return [...bar.querySelectorAll('button')].map(b => b.getAttribute('aria-label'));
    });
    expect(labels).toContain('Preview the expand animation');
    expect(labels).toContain('Expand speed…');
  });

  test('a plain text box (no toggle) gets neither button', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator('[data-el="basics.h1"]').click();
    await page.waitForTimeout(300);
    const labels = await page.evaluate(() => {
      const bar = document.getElementById('out').contentDocument.querySelector('.ds-mini');
      return bar ? [...bar.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) : [];
    });
    expect(labels).not.toContain('Preview the expand animation');
    expect(labels).not.toContain('Expand speed…');
  });

  test('Preview plays the real transition, then leaves nothing behind',
    async ({ page }) => {
      const btnId = await addExpandableSection(page);
      await page.waitForTimeout(400);
      await page.frameLocator('#out').locator(`[data-el="text.${btnId}"]`).click();
      await page.waitForTimeout(300);

      await miniBtn(page, 'Preview the expand animation');
      await page.waitForTimeout(100);
      const mid = await page.evaluate((id) => {
        const d = document.getElementById('out').contentDocument;
        const tb = boxes().find(b => b.id === id);
        const tid = Array.isArray(tb.target) ? tb.target[0] : tb.target;
        const el = d.querySelector(`[data-el="text.${tid}"]`);
        return { maxHeight: el.style.maxHeight, opacity: el.style.opacity };
      }, btnId);
      // Mid-flight: a real inline max-height was set (the transition target),
      // not left at the CSS default — proof this actually measured and moved
      // something, not a no-op.
      expect(mid.maxHeight).not.toBe('');
      expect(mid.opacity).toBe('1');

      await page.waitForTimeout(600);           // past the default .3s + cleanup delay
      const after = await page.evaluate((id) => {
        const d = document.getElementById('out').contentDocument;
        const tb = boxes().find(b => b.id === id);
        const tid = Array.isArray(tb.target) ? tb.target[0] : tb.target;
        const el = d.querySelector(`[data-el="text.${tid}"]`);
        return { maxHeight: el.style.maxHeight, opacity: el.style.opacity,
                 stillEditable: el.isContentEditable !== undefined };
      }, btnId);
      // Every inline style the preview touched is gone — the target reverted
      // to whatever the editor's own always-visible CSS renders, which is
      // the state everything else (drag, click-to-edit, a later render)
      // expects to find it in.
      expect(after.maxHeight).toBe('');
      expect(after.opacity).toBe('');

      // And it is still genuinely editable after the preview — the whole
      // point of leaving nothing behind. The target is grouped with its
      // button (they travel together), and a grouped element's FIRST
      // double-click only drills in to select it on its own (see the
      // dblclick handler's `justDrilled`/group check) — a SECOND
      // double-click is what actually opens the text editor. Unrelated to
      // the preview; every grouped box works this way.
      const frame = page.frameLocator('#out');
      const tb2 = await page.evaluate(id => {
        const b = boxes().find(x => x.id === id);
        return Array.isArray(b.target) ? b.target[0] : b.target;
      }, btnId);
      // The 700ms window (lastDrill/justDrilled) exists so ONE physical
      // double-click's own mousedown/mouseup pair does not ALSO count as a
      // second, edit-opening double-click — so the follow-up here has to
      // clear it, or it just drills in again and this assertion would be
      // testing that same suppression instead of the real behaviour.
      const target = frame.locator(`[data-el="text.${tb2}"]`);
      await target.dblclick();               // drills in
      await page.waitForTimeout(900);
      await target.dblclick();               // now edits
      await page.waitForTimeout(400);
      await expect(frame.locator('.ds-edit')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    });

  test('Expand speed writes tglSpeed and the published button carries it',
    async ({ page }) => {
      const btnId = await addExpandableSection(page);
      await page.waitForTimeout(400);
      await page.frameLocator('#out').locator(`[data-el="text.${btnId}"]`).click();
      await page.waitForTimeout(300);
      await miniBtn(page, 'Expand speed…');
      await page.waitForTimeout(300);

      const before = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const r = d.querySelector('.ds-menu input[type=range]');
        return r ? r.value : null;
      });
      expect(before).toBe('0.3');               // the documented default

      await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const r = d.querySelector('.ds-menu input[type=range]');
        r.value = '0.9';
        r.dispatchEvent(new Event('input', { bubbles: true }));
        r.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(800);
      expect(await page.evaluate(id => boxes().find(b => b.id === id).tglSpeed, btnId))
        .toBe(0.9);

      const published = await page.evaluate(async () => await renderClean());
      expect(published).toContain('0.9');
      expect(published).toContain('--ds-tgl-d:0.9s');
    });

  test('the shared __dsTgl driver ships once even with two expandable '
    + 'sections on the page', async ({ page }) => {
      await addExpandableSection(page);
      await page.waitForTimeout(400);
      await page.evaluate(async () => { await addExpandable(); });
      await page.waitForTimeout(400);
      const published = await page.evaluate(async () => await renderClean());
      const count = (published.match(/function __dsTgl/g) || []).length;
      expect(count).toBe(1);
    });

  // The mousedown/outside-click listeners contextify() binds on the document
  // (not on any one element) must bind exactly once — the same double-bind
  // hazard incremental.spec.js pins for other document-level listeners, and
  // the exact bug this feature's own popover surfaced: those two bindings
  // sat OUTSIDE the roots-scoped loop, so every incremental patch re-added
  // them. Idempotent in effect (closing an already-closed menu is a no-op),
  // so nothing user-visible broke — but it is the class of bug the rest of
  // wire() guards against, and this popover is what exposed it.
  test('closeMenu fires once per outside click, even after several patches',
    async ({ page }) => {
      const btnId = await addExpandableSection(page);
      await page.waitForTimeout(400);
      // several incremental patches over the same document
      for (const y of [2.1, 2.4, 2.7]) {
        await page.evaluate(([id, yy]) => {
          const tb = boxes().find(b => b.id === id);
          tb.y = yy; markDirty();
        }, [btnId, y]);
        await page.evaluate(async () => { await render(); });
      }
      await page.waitForTimeout(400);

      await page.frameLocator('#out').locator(`[data-el="text.${btnId}"]`).click();
      await page.waitForTimeout(300);
      await miniBtn(page, 'Expand speed…');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() =>
        !!document.getElementById('out').contentDocument.querySelector('.ds-menu')))
        .toBe(true);

      const calls = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        window.__closeCalls = 0;
        const real = window.closeMenu;
        window.closeMenu = function (doc) { window.__closeCalls++; return real(doc); };
        return true;
      });
      expect(calls).toBe(true);

      // One outside click on the canvas.
      const pg = page.frameLocator('#out').locator('section.page').nth(3);
      await pg.click({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(200);

      expect(await page.evaluate(() => window.__closeCalls)).toBe(1);
      expect(await page.evaluate(() =>
        !!document.getElementById('out').contentDocument.querySelector('.ds-menu')))
        .toBe(false);
    });
});
