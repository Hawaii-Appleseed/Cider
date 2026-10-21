// A report's own paragraph resizes from every edge and corner, as a text frame
// does in InDesign or Canva (Devin, 2026-10-21) — it used to take only the
// east and west edges. Its dragged height is a FLOOR (positions[].hmin), so
// the words are never cut off. Charts and tables keep their own handle sets.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const ID = 'para.groc.lead';
const ALL = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

async function selectPara(page) {
  await gotoEditor(page, '?project=uhero-trc-summary');
  await page.evaluate(id => {
    const d = $('out').contentDocument;
    d.querySelector(`[data-el="${id}"]`).scrollIntoView({ block: 'center' });
    setSel(d, [id]); paintSel(d);
  }, ID);
  await page.waitForTimeout(300);
}

/** Drag one handle of the selection by (dx, dy) screen pixels. */
async function dragHandle(page, dir, dx, dy) {
  const h = page.frameLocator('#out').locator(`.ds-handles .ds-h-${dir}`);
  // The press has to land on the handle itself: anything drawn over it (the
  // floating mini toolbar sits just above the top edge) would take the drag.
  const over = await h.evaluate(el => {
    const r = el.getBoundingClientRect();
    const t = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return t === el ? null : `${t.tagName}.${t.className}${t.closest('.ds-mini') ? ' (mini toolbar)' : ''}`;
  });
  expect(over, `the ${dir} handle is covered`).toBeNull();
  const b = await h.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}

const geometry = page => page.evaluate(id => {
  const el = $('out').contentDocument.querySelector(`[data-el="${id}"]`);
  const r = el.getBoundingClientRect();
  return { p: layout.positions[id] || null, w: r.width, h: r.height,
           clipped: el.scrollHeight > el.clientHeight + 1 };
}, ID);

test.describe('a paragraph resizes like a text frame', () => {
  test('it shows a handle on every edge and corner', async ({ page }) => {
    await selectPara(page);
    const frame = page.frameLocator('#out');
    for (const dir of ALL) await expect(frame.locator(`.ds-handles .ds-h-${dir}`)).toHaveCount(1);
  });

  test('a corner drag sets width and a height floor together', async ({ page }) => {
    await selectPara(page);
    const before = await geometry(page);
    await dragHandle(page, 'se', -60, 90);
    const after = await geometry(page);
    expect(after.p.hmin).toBe(true);
    expect(after.w).toBeLessThan(before.w - 30);         // narrower
    expect(after.h).toBeGreaterThan(before.h + 40);      // and taller
    expect(after.clipped).toBe(false);
  });

  test('dragging the bottom up past the words never cuts them off', async ({ page }) => {
    await selectPara(page);
    const before = await geometry(page);
    await dragHandle(page, 's', 0, -Math.round(before.h * 0.6));
    const after = await geometry(page);
    expect(after.clipped).toBe(false);
    expect(after.h).toBeGreaterThanOrEqual(before.h - 1);  // the words hold it open
  });

  test('the top edge moves the top and keeps the bottom where it was', async ({ page }) => {
    await selectPara(page);
    // Against the PAGE, not the window: the commit's re-render may restore
    // the scroll a few pixels off, which moves both edges on screen alike.
    const onPage = () => page.evaluate(id => {
      const el = $('out').contentDocument.querySelector(`[data-el="${id}"]`);
      const r = el.getBoundingClientRect(), p = el.closest('section.page').getBoundingClientRect();
      return { top: r.top - p.top, bottom: r.bottom - p.top };
    }, ID);
    const top0 = await onPage();
    await dragHandle(page, 'n', 0, -50);
    // The commit re-renders, and a cold runner can still be laying the page
    // out when the first measurement lands: CI read the bottom 39px off on
    // two runs and exactly in place on the next. What the drag promises is
    // where the paragraph settles, so wait for that.
    await expect.poll(async () => Math.round(Math.abs((await onPage()).bottom - top0.bottom)),
      { timeout: 5000 }).toBeLessThan(4);
    expect((await onPage()).top).toBeLessThan(top0.top - 30);
  });

  test('a table and a chart keep their own handles', async ({ page }) => {
    await gotoEditor(page, '?project=uhero-trc-summary');
    const frame = page.frameLocator('#out');
    const sel = id => page.evaluate(i => {
      const d = $('out').contentDocument; setSel(d, [i]); paintSel(d);
    }, id);
    // A table's rows set its height: width only.
    await sel('table.swaps');
    await expect(frame.locator('.ds-handles .ds-h-e')).toHaveCount(1);
    await expect(frame.locator('.ds-handles .ds-h-se')).toHaveCount(0);
    // A drawn chart scales as a whole, from its corners only.
    await sel('chart.decile');
    await expect(frame.locator('.ds-handles .ds-h-se')).toHaveCount(1);
    await expect(frame.locator('.ds-handles .ds-h-e')).toHaveCount(0);
  });
});
