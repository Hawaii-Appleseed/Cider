// Layering as the eye expects it (docsync/editor/edit.html: nextZ, placer, the
// .ds-lifted rule). A designed piece coming off the flow lands on TOP of its
// page's stack; the lift shows the layer the drop will keep; a new text box,
// shape, icon or chart goes above whatever already floats on that page; and a
// piece that has a place keeps its layer when it is merely moved. Before this
// each kind had a fixed tier (moved element 1, text box 2, shape 3), ties fell
// to DOM order, and the lift hoisted the thing in hand to 9999 — so a heading
// dragged over a text box rode over it all the way and vanished behind it on
// the drop, and which of two moved things covered the other depended on their
// order in the markup. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

// Page 3 (index 2) of the fixture report carries the BUDGET BASICS heading,
// the same in-flow element movable-headings.spec.js drags.
async function onBasics(page) {
  const frame = page.frameLocator('#out');
  await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const pid = await page.evaluate(() => {
    const d = document.getElementById('out').contentDocument;
    return d.querySelector('[data-el="basics.h1"]').closest('section.page').dataset.page;
  });
  return { frame, pid };
}

// Something already floating on that page, at the old shape tier (3) — down
// in the page's bottom corner, clear of the heading the tests pick up (a rect
// over the heading would be what the mouse lands on).
async function seedRect(page, pid) {
  await page.evaluate(async pid => {
    layout.shapes.push({ id: 'stack-rect', page: isNaN(+pid) ? pid : +pid, kind: 'rect',
                         x: 5.5, y: 9, w: 2, h: 1, fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
    markDirty();
    await render();
  }, pid);
  await page.waitForTimeout(400);
}

// A text object is selected by a click and moved by a drag on the selection,
// so click first, as a person would (and as movable-headings.spec.js does).
const dragBy = async (page, locator, dx, dy) => {
  await locator.click();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
};

test.describe('stacking', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('a designed piece dragged off the flow lands on top — in hand and on the drop',
    async ({ page }) => {
      const { frame, pid } = await onBasics(page);
      await seedRect(page, pid);
      expect(await page.evaluate(() => zOf('stack-rect'))).toBe(3);

      await dragBy(page, frame.locator('[data-el="basics.h1"]'), 60, 40);
      // In hand: its real layer — one above the rect — not a 9999 hoist. What
      // you see while dragging is what the drop keeps.
      const inHand = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const el = d.querySelector('[data-el="basics.h1"]');
        return { lifted: el.classList.contains('ds-lifted'),
                 z: d.defaultView.getComputedStyle(el).zIndex };
      });
      expect(inHand.lifted).toBe(true);
      expect(inHand.z).toBe('4');
      await page.mouse.up();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => layout.positions['basics.h1'].z)).toBe(4);
      expect(await page.evaluate(() => zOf('basics.h1'))).toBe(4);

      // Moving it AGAIN is not a layering decision: it keeps 4.
      await page.evaluate(() => docsync.api.place('basics.h1', { x: 1.5, y: 2.5 }));
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => layout.positions['basics.h1'].z)).toBe(4);
      // Nor is moving the rect: it keeps 3, under the heading now.
      await page.evaluate(() => docsync.api.place('stack-rect', { x: 2, y: 2 }));
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => zOf('stack-rect'))).toBe(3);

      // A new text box on that page goes above both; a new shape above that.
      const boxId = await page.evaluate(async pid =>
        (await docsync.api.addTextBox({ page: isNaN(+pid) ? pid : +pid, x: 1, y: 4, w: 2, md: 'above' })).id, pid);
      expect(await page.evaluate(id => zOf(id), boxId)).toBe(5);
      const shapeId = await page.evaluate(async pid =>
        (await docsync.api.addShape({ page: isNaN(+pid) ? pid : +pid, x: 1, y: 6 })).id, pid);
      expect(await page.evaluate(id => zOf(id), shapeId)).toBe(6);
      // …and the renderer paints those numbers, so the page agrees with the store.
      const painted = await page.evaluate(([a, b]) => {
        const d = document.getElementById('out').contentDocument;
        const z = sel => d.defaultView.getComputedStyle(d.querySelector(sel)).zIndex;
        return [z('[data-el="basics.h1"]'), z(`[data-el="${a}"]`)];
      }, [boxId, shapeId]);
      expect(painted).toEqual(['4', '5']);
    });

  test('an empty page hands out the numbers it always did',
    async ({ page }) => {
      // The fixture's cover has nothing floating on it: a first text box is 2,
      // a first shape 3, exactly the old tiers — so no saved layout moves.
      const zs = await page.evaluate(async () => {
        const pid = pageOrder()[0];
        const b = (await docsync.api.addTextBox({ page: pid, x: 1, y: 5, w: 2, md: 'first' })).id;
        const s = (await docsync.api.addShape({ page: pid, x: 1, y: 7 })).id;
        return [zOf(b), zOf(s)];
      });
      expect(zs).toEqual([2, 3]);
    });

  test('Backward on a piece still in the flow sends it behind the content, Forward one above it',
    async ({ page }) => {
      const { pid } = await onBasics(page);
      await seedRect(page, pid);
      // Two in-flow pieces on that page besides the heading.
      const ids = await page.evaluate(() => {
        const d = document.getElementById('out').contentDocument;
        const pg = d.querySelector('[data-el="basics.h1"]').closest('section.page');
        return [...pg.querySelectorAll('[data-el]')].map(idOf)
          .filter(i => i && i !== 'basics.h1' && !layout.positions[i] && !boxOf(i) && !shapeOf(i))
          .slice(0, 2);
      });
      expect(ids.length).toBe(2);
      const after = await page.evaluate(async ([a, b]) => {
        const d = document.getElementById('out').contentDocument;
        setSel(d, [a]);
        await layerStep(d, -1, false);        // ⌘[ — one step back from the content's level
        setSel(d, [b]);
        await layerStep(d, 1, false);         // ⌘] — one step up from it
        return [zOf(a), zOf(b), layout.positions[a].z, layout.positions[b].z];
      }, ids);
      // Not "one step from the top of the stack", which is where pinning
      // alone would have carried them: 0 is behind the page's content in the
      // Layers panel's terms, 2 one above it.
      expect(after).toEqual([0, 2, 0, 2]);
      // Bring to front still scans this page's whole stack.
      const front = await page.evaluate(async ([a]) => {
        const d = document.getElementById('out').contentDocument;
        setSel(d, [a]);
        await layerStep(d, 1, true);
        return zOf(a);
      }, ids);
      expect(front).toBe(4);                  // above the rect at 3
    });
});
