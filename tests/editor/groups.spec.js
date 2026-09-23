// Groups (layout.json `groups`) — the contract behind "Claude composes new
// visuals from SEPARATE primitives, grouped": a shape + a text box authored
// directly in layout.json, joined by a groups entry, must behave as one object
// until the user Ungroups — then come apart into independent movables. This is
// what lets a user detach text from the shape it sits on. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const SHAPE = 'demo.note.bg';
const BOX = 'text.demo.note';

// Inject the primitives the way Claude authors them (same object shapes as
// layout.json), then re-render — the fixture file itself stays pristine for
// every other spec.
async function seedGroup(page) {
  await page.evaluate(async () => {
    layout.shapes = layout.shapes || [];
    layout.boxes = layout.boxes || [];
    layout.shapes.push({ id: 'demo.note.bg', page: 8, kind: 'rect',
      x: 1.0, y: 7.2, w: 3.2, h: 1.1, fill: '#E8EDE6', r: 0.12 });
    layout.boxes.push({ id: 'demo.note', page: 8, x: 1.15, y: 7.35, w: 2.9,
      md: '**Note:** special funds are earmarked.', style: { size: 11 } });
    layout.groups = [['demo.note.bg', 'text.demo.note']];
    await render();
  });
  // render() is single-flight with a TRAILING rerun: our render can queue one
  // behind the page's own, and that trailing pass lands after our click and
  // clears the selection — the strip empties mid-test. Wait until the box
  // exists and no render is in flight, then a beat for any trailing pass.
  await page.waitForFunction(() => {
    const d = document.getElementById('out').contentDocument;
    return d && d.querySelector('[data-el="text.demo.note"]')
      && !document.getElementById('stat').textContent.includes('rendering');
  });
  await page.waitForTimeout(700);
  const frame = page.frameLocator('#out');
  await frame.locator(`[data-el="${BOX}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}

test.describe('shape + text box groups', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await seedGroup(page);
  });

  test('clicking either member selects the WHOLE group', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${BOX}"]`).click();
    expect((await page.evaluate(() => [...selIds])).sort())
      .toEqual([SHAPE, BOX].sort());
    // and the toolbar reads it as a group
    await expect(page.locator('#ar-count')).toHaveText(/group of 2/);
  });

  test('dragging the group moves BOTH members together', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const box = frame.locator(`[data-el="${BOX}"]`);
    await box.click();
    const b = await box.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2 + 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const moved = await page.evaluate(() => ({
      shape: layout.shapes.find(s => s.id === 'demo.note.bg'),
      box: layout.boxes.find(b => b.id === 'demo.note'),
    }));
    expect(moved.shape.x).toBeGreaterThan(1.0);   // both advanced from their seeds
    expect(moved.box.x).toBeGreaterThan(1.15);
  });

  test('Ungroup detaches the text from the shape', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${BOX}"]`).click();
    await expect(page.locator('#ar-ungroup')).toBeEnabled();
    await page.locator('#ar-ungroup').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => layout.groups || null)).toBeFalsy();
    // now a click selects ONLY the text box — detached
    await page.keyboard.press('Escape');
    await frame.locator(`[data-el="${BOX}"]`).click();
    expect(await page.evaluate(() => [...selIds])).toEqual([BOX]);
  });
});
