// Resizable colored background sections (L.sec in the renderer, data-sec in
// edit mode). A band is NOT a movable: it stays in flow with its background
// glued to it, and the only adjustment is height — a grip on its bottom edge
// drags a min-height override into layout.sections. Dragging back down to
// the content's natural height clears the override, so an untouched page
// stays untouched. The primer fixture has no bands, so the spec plants one.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const ID = 'sec.test-band';

async function plantBand(page) {
  await page.evaluate(id => {
    const d = document.getElementById('out').contentDocument;
    const pg = d.querySelector('section.page');
    const band = d.createElement('section');
    band.dataset.sec = id;
    band.style.cssText = 'display:block;background:#354F52;height:2in';
    pg.prepend(band);
    wireSections(d);
  }, ID);
}

async function dragGrip(page, dy) {
  const grip = page.frameLocator('#out')
    .locator(`[data-sec="${ID}"] .ds-sec-grip`);
  const b = await grip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe('resizable background section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await plantBand(page);
  });

  test('a data-sec band gets a bottom-edge grip', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await expect(frame.locator(`[data-sec="${ID}"] .ds-sec-grip`)).toHaveCount(1);
  });

  test('dragging down stretches the band and records the override', async ({ page }) => {
    await dragGrip(page, 120);
    const st = await page.evaluate(id => ({
      h: (layout.sections || {})[id]?.h,
      minH: document.getElementById('out').contentDocument
        .querySelector(`[data-sec="${id}"]`).style.minHeight,
    }), ID);
    expect(st.h).toBeGreaterThan(2);
    expect(st.minH).toMatch(/in$/);
  });

  test('dragging back to natural height clears the override', async ({ page }) => {
    await dragGrip(page, 120);
    expect(await page.evaluate(id => id in (layout.sections || {}), ID)).toBe(true);
    await dragGrip(page, -400);
    const st = await page.evaluate(id => ({
      gone: !(id in (layout.sections || {})),
      minH: document.getElementById('out').contentDocument
        .querySelector(`[data-sec="${id}"]`).style.minHeight,
    }), ID);
    expect(st.gone).toBe(true);
    expect(st.minH).toBe('');
  });
});
