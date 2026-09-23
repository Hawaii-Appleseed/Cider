// Incremental rendering (edit.html's patchPages + wire(roots)): an edit that
// redraws some pages of an otherwise unchanged document replaces just those
// sections in place, instead of reloading the whole report into the iframe.
//
// The document IDENTITY is the assertion throughout: a patch keeps the same
// contentDocument, a full swap makes a new one. That is the property the
// speed comes from (no teardown, parse, style and layout of twelve pages)
// and the one the reader feels — nothing reloads, so nothing jumps.
//
// The hazard being guarded is double-binding: patching keeps listeners on
// the sections it did NOT replace, so re-arming the whole document would
// leave those with two of everything. Two mousedown handlers is two
// startDrags, two pushHistorys, and an undo that needs pressing twice — so
// the tests count undo steps, which is where that would surface.
const { warmTest: test, expect, gotoEditor, selectWithoutTyping } = require('./fixtures/editor-test');

/** The report document's identity, as a token that changes when it reloads. */
const docToken = (page) => page.evaluate(() => {
  const d = document.getElementById('out').contentDocument;
  d.__tok = d.__tok || Math.random().toString(36).slice(2);
  return d.__tok;
});

/** Put a text box on the page in view and return its id. */
async function addBox(page, y = 2) {
  return page.evaluate(async (yy) => {
    pushHistory();
    const id = freeTId();
    boxes().push({ id, page: visiblePageId(), x: 1, y: yy, w: 3, md: 'Patch me' });
    markDirty(); await render();
    return id;
  }, y);
}

test.describe('incremental rendering', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.frameLocator('#out').locator('section.page').nth(3)
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  });

  test('an ordinary edit patches the page in place — the document never reloads',
    async ({ page }) => {
      const id = await addBox(page);
      await page.waitForTimeout(600);
      const before = await docToken(page);

      const moved = await page.evaluate(async (i) => {
        boxes().find(b => b.id === i).x = 2.4;
        markDirty(); await render();
        const d = document.getElementById('out').contentDocument;
        return d.querySelector(`[data-el="text.${i}"]`).style.left;
      }, id);

      expect(await docToken(page)).toBe(before);   // same document: patched
      expect(moved).toBe('2.4in');                 // and it really redrew
    });

  test('a change to the document\'s SHAPE still reloads — the fast path declines',
    async ({ page }) => {
      const before = await docToken(page);
      const was = await page.frameLocator('#out').locator('section.page').count();
      // A blank page changes the section count, which patchPages will not touch.
      await page.evaluate(async () => { await addBlankPage(); });
      await page.waitForTimeout(1200);
      expect(await docToken(page)).not.toBe(before);   // full swap, as designed
      await expect(page.frameLocator('#out').locator('section.page'))
        .toHaveCount(was + 1);
    });

  test('nothing is bound twice: a drag after several patches is ONE undo step',
    async ({ page }) => {
      const id = await addBox(page);
      // several patched renders over the same document
      for (const x of [1.4, 1.8, 2.2]) {
        await page.evaluate(async ([i, xx]) => {
          boxes().find(b => b.id === i).x = xx; markDirty(); await render();
        }, [id, x]);
      }
      await page.waitForTimeout(500);

      const frame = page.frameLocator('#out');
      const el = frame.locator(`[data-el="text.${id}"]`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const beforeDepth = await page.evaluate(() => past.length);
      const box = await el.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40,
        { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);

      // Exactly one: a doubled dragify would have pushed two.
      expect(await page.evaluate(() => past.length)).toBe(beforeDepth + 1);
      // and one Undo really puts it back where it was
      const movedX = await page.evaluate(i => boxes().find(b => b.id === i).x, id);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(800);
      const undoneX = await page.evaluate(i => {
        const b = boxes().find(x => x.id === i); return b ? b.x : null;
      }, id);
      expect(undoneX).not.toBe(movedX);
      expect(undoneX).toBe(2.2);
    });

  test('a page the patch never touched is still armed, and armed once',
    async ({ page }) => {
      // Patch one page repeatedly…
      const id = await addBox(page);
      for (const x of [1.5, 2.0]) {
        await page.evaluate(async ([i, xx]) => {
          boxes().find(b => b.id === i).x = xx; markDirty(); await render();
        }, [id, x]);
      }
      await page.waitForTimeout(500);

      // …then drag a designed element on a DIFFERENT page, which no patch
      // replaced: its listeners are the ones the first render gave it.
      const frame = page.frameLocator('#out');
      const h1 = frame.locator('[data-el="basics.h1"]');
      await h1.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const depth = await page.evaluate(() => past.length);
      const b = await h1.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 70, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);

      expect(await page.evaluate(() => past.length)).toBe(depth + 1);
      expect(await page.evaluate(() => layout.positions['basics.h1'])).toBeTruthy();
      // put it back so this spec leaves the fixture as it found it
      await page.evaluate(async () => {
        delete layout.positions['basics.h1']; markDirty(); await render();
      });
    });

  test('a patched page is fully alive: it selects, and its text still opens',
    async ({ page }) => {
      const id = await addBox(page);
      await page.evaluate(async (i) => {
        boxes().find(b => b.id === i).x = 1.6; markDirty(); await render();
      }, id);
      await page.waitForTimeout(600);

      const frame = page.frameLocator('#out');
      // selection works on the replaced section (without opening the box's
      // words, which the dblclick below would first have to commit)
      await selectWithoutTyping(page, frame.locator(`[data-el="text.${id}"]`));
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => [...selIds])).toEqual([`text.${id}`]);

      // and click-to-edit prose on that same page — the [data-slot] wiring
      // has to have landed on the section the patch inserted
      const slot = frame.locator('[data-slot]').first();
      await slot.scrollIntoViewIfNeeded();
      await slot.dblclick();
      await page.waitForTimeout(500);
      await expect(frame.locator('.ds-edit')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    });

  // The live DOM drifts from the last render by routes that write no data:
  // an inline editor swaps the slot for a contenteditable host, and a drag
  // paints the new position straight onto the node. Both can then produce a
  // render whose bytes are IDENTICAL to the last one — and a patch that
  // replaces nothing would leave the drift standing. These are the two ways
  // that actually bit, so both are pinned.
  test('cancelling an inline edit puts the real prose back', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const slot = frame.locator('[data-slot]').first();
    await slot.scrollIntoViewIfNeeded();
    const key = await slot.getAttribute('data-slot');
    await slot.dblclick();
    await page.waitForTimeout(500);
    await expect(frame.locator('.ds-edit')).toHaveCount(1);
    // Escape with nothing typed: the next render is byte-for-byte the last.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await expect(frame.locator('.ds-edit')).toHaveCount(0);
    await expect(frame.locator(`[data-slot="${key}"]`)).toHaveCount(1);
  });

  test('undo after a drag really moves the element back on screen',
    async ({ page }) => {
      const id = await addBox(page);
      await page.waitForTimeout(500);
      const frame = page.frameLocator('#out');
      const el = frame.locator(`[data-el="text.${id}"]`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const startLeft = await el.evaluate(n => n.style.left);

      const b = await el.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 90, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      expect(await el.evaluate(n => n.style.left)).not.toBe(startLeft);

      // A drag paints the node directly and does not re-render, so this undo
      // renders the state the page already displayed BEFORE the drag — the
      // same bytes. The element still has to go back where it was.
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(1200);
      expect(await frame.locator(`[data-el="text.${id}"]`)
        .evaluate(n => n.style.left)).toBe(startLeft);
    });

  test('the reader keeps their place — a patch scrolls nothing', async ({ page }) => {
    const id = await addBox(page);
    await page.waitForTimeout(500);
    const where = () => page.evaluate(() =>
      document.getElementById('out').contentDocument.scrollingElement.scrollTop);
    const before = await where();
    expect(before).toBeGreaterThan(200);
    await page.evaluate(async (i) => {
      boxes().find(b => b.id === i).x = 2.7; markDirty(); await render();
    }, id);
    await page.waitForTimeout(500);
    // Exactly, not approximately: nothing reloaded, so nothing had to be
    // restored — the old path re-applied a remembered scrollTop after a
    // reload, which is a different (and lossier) promise.
    expect(await where()).toBe(before);
  });
});
