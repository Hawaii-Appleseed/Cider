// Right-clicking prose opens a real menu, not a single endnote row, and the
// endnote choice sits behind ONE row with the citation list in a submenu —
// the common case ("a new source") was buried under a dozen existing ones.
// Local mode.
const { test, expect, gotoEditor, dialog, fillDialog, submitDialog,
        cancelDialog, selectWithoutTyping } = require('./fixtures/editor-test');

const labels = (page, sel) => page.evaluate(s => {
  const d = document.getElementById('out').contentDocument;
  return [...d.querySelectorAll(s)].map(b => b.textContent.trim());
}, sel);

test.describe('text context menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');
    const p = frame.locator('[data-slot="basics.p1"]').first();
    await p.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await p.dblclick();
    await page.waitForTimeout(700);
    await expect(frame.locator('.ds-edit')).toHaveCount(1);
    await frame.locator('.ds-edit').click({ button: 'right' });
    await page.waitForTimeout(400);
  });

  test('offers formatting as well as endnotes', async ({ page }) => {
    const l = await labels(page, '.ds-menu button');
    expect(l).toContain('Bold');
    expect(l).toContain('Italic');
    expect(l).toContain('Link…');
    expect(l).toContain('New endnote…');
    // one row, not the whole citation list flattened into the parent
    expect(l.filter(x => x.startsWith('['))).toHaveLength(0);
  });

  test('the existing-endnote row opens the list in a submenu', async ({ page }) => {
    const frame = page.frameLocator('#out');
    await expect(frame.locator('.ds-submenu')).toHaveCount(0);
    await frame.locator('.ds-menu button.ds-sub').hover();
    await page.waitForTimeout(400);
    await expect(frame.locator('.ds-submenu')).toHaveCount(1);
    // Numbered in READING order, with the citation beside it — the number is
    // the only handle most people have on an endnote, and a list that jumped
    // 3, 16, 15 had to be searched rather than read.
    const nums = await page.evaluate(() => {
      const d = document.getElementById('out').contentDocument;
      return [...d.querySelectorAll('.ds-submenu .ds-note-n')].map(n => n.textContent.trim());
    });
    expect(nums.length).toBeGreaterThan(3);
    expect(nums.slice(0, 3)).toEqual(['1', '2', '3']);
    const l = await labels(page, '.ds-submenu button');
    expect(l.length).toBe(nums.length);
    // and the list is bounded, so a document's worth of citations stays reachable
    const scrolls = await page.evaluate(() => {
      const s = document.getElementById('out').contentDocument.querySelector('.ds-submenu');
      return { bounded: s.scrollHeight > s.clientHeight, h: s.clientHeight };
    });
    expect(scrolls.h).toBeLessThan(500);
    expect(scrolls.bounded).toBe(true);
  });
});

// A designed section heading is a text box the renderer happened to place: it
// takes the same eight handles, and its height is a FLOOR so dragging it can
// never clip the words (docsync/layout.py's "hmin").
test.describe('headings behave like text boxes', () => {
  test('eight handles, and a vertical drag writes a min-height', async ({ page }) => {
    await gotoEditor(page);
    const frame = page.frameLocator('#out');
    await frame.locator('section.page').nth(2).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    // Select it WITHOUT opening its words: a render never swaps over an open
    // editor, and on a CI run that failed (twice, the retry too) the trace had
    // the inline editor open after a plain click, and the render after the
    // drag sitting in the hidden twin frame while the heading on screen kept
    // the drag's preview style.
    await selectWithoutTyping(page, frame.locator('[data-el="basics.h1"]'));
    await page.waitForTimeout(600);
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      await expect(frame.locator(`.ds-handles .ds-h-${dir}`)).toHaveCount(1);
    }

    const b = await frame.locator('.ds-handles .ds-h-s').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const pos = await page.evaluate(() => layout.positions['basics.h1']);
    expect(pos.h).toBeGreaterThan(0);
    expect(pos.hmin).toBe(true);

    await page.evaluate(() => render());
    // Wait for the render to be what is ON SCREEN, rather than reading once
    // after a fixed sleep: until the swap, #out is still the dragged document,
    // whose inline style is the preview's (a height, no floor).
    const css = () => page.evaluate(() => document.getElementById('out')
      .contentDocument.querySelector('[data-el="basics.h1"]').getAttribute('style'));
    // a floor, not a clip
    await expect.poll(css, { timeout: 15_000 }).toContain('min-height:');
    expect(await css()).not.toMatch(/(^|;)height:/);
  });
});

// A figure's DESCRIPTION — the words a screen reader is given instead of the
// drawing (blocks.describe, data-desc). It lives in an attribute, so unlike a
// chart label there is no glyph run to float a field over: it edits from the
// graphic's context menu. The fixture's demo graphic on page 8 carries one.
// Local mode.
const GID = 'onetime.demo.graphic';

test.describe('a figure description', () => {
  const openMenu = async page => {
    const frame = page.frameLocator('#out');
    const g = frame.locator(`[data-el="${GID}"]`);
    await g.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await g.click({ button: 'right' });
    await page.waitForTimeout(400);
    return frame;
  };

  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('the graphic offers it, and opens with the words already on the page',
    async ({ page }) => {
      await openMenu(page);
      const l = await labels(page, '.ds-menu button');
      expect(l).toContain('Description (for screen readers)…');
      await page.locator('#out').contentFrame()
        .getByRole('button', { name: 'Description (for screen readers)…' }).click();
      const d = await dialog(page);
      // Seeded from the RENDERER's wording — the document has no such slot
      // yet, which is the whole point of reading it through C.text_or.
      await expect(d.locator('[name="words"]')).toHaveValue('demo graphic');
      await expect(d.locator('.dsdlg-field span')).toHaveText(`${GID}.desc`);
      await cancelDialog(page);
    });

  test('editing it rewrites the aria-label the drawing carries',
    async ({ page }) => {
      const frame = await openMenu(page);
      await page.locator('#out').contentFrame()
        .getByRole('button', { name: 'Description (for screen readers)…' }).click();
      await fillDialog(page, { words: 'A tick mark rising over a circle' });
      await submitDialog(page);
      await page.waitForTimeout(1200);
      await expect(frame.locator(`[data-el="${GID}"] svg`))
        .toHaveAttribute('aria-label', 'A tick mark rising over a circle');
    });

  test('an empty description is refused, and the dialog stays open',
    async ({ page }) => {
      await openMenu(page);
      await page.locator('#out').contentFrame()
        .getByRole('button', { name: 'Description (for screen readers)…' }).click();
      await fillDialog(page, { words: '   ' });
      const d = await dialog(page);
      await d.locator('.dsdlg-ok').click();
      await expect(d).toBeVisible();
      await expect(d.locator('.dsdlg-err')).toContainText('announced as nothing at all');
      await cancelDialog(page);
    });
});

// The context menu, reachable without knowing right-click exists. Nineteen
// actions lived only behind that gesture — including editing a figure's
// description — and nothing on screen said so. Local mode.
test.describe('a way into the menu that is not right-click', () => {
  const selectLogo = page =>
    page.evaluate(() => setSel($('out').contentDocument, ['cover.logo']));

  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('the strip button opens the same menu, and its tooltip teaches the gesture',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      await selectLogo(page);
      await expect(page.locator('#ar-more')).toBeVisible();
      await expect(page.locator('#ar-more'))
        .toHaveAttribute('aria-label', /right-click/);
      await expect(frame.locator('.ds-menu')).toHaveCount(0);
      await page.click('#ar-more');
      await page.waitForTimeout(400);
      await expect(frame.locator('.ds-menu')).toHaveCount(1);
      const l = await labels(page, '.ds-menu button');
      expect(l).toContain('Lock');
      expect(l).toContain('Bring to front');
    });

  // Regression: pageBar hides the object-only controls by id, and nothing put
  // them back — select a page once and Position, Group, Ungroup, Duplicate,
  // Lock and Delete were gone from the strip until a reload.
  test('the object controls come back after a page has been selected',
    async ({ page }) => {
      const hidden = () => page.evaluate(() =>
        ['ar-pos', 'ar-group', 'ar-ungroup', 'ar-dup', 'ar-lock', 'ar-del', 'ar-more']
          .filter(id => $(id).hidden));
      await selectLogo(page);
      expect(await hidden()).toEqual([]);
      await page.evaluate(() => { const d = $('out').contentDocument;
        setSel(d, []); setSelPage(d, pageOrder()[0]); });
      await page.waitForTimeout(400);
      await selectLogo(page);
      await page.waitForTimeout(400);
      expect(await hidden()).toEqual([]);
    });
});

// The type strip says WHAT is selected, not the slot key — the rule the
// arrange strip (ar-count) already followed for objects. The key stays on the
// title, where anything that needs it still reads it.
test.describe('the type strip names the thing', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('a heading reads as a heading, with its key one hover away',
    async ({ page }) => {
      const frame = page.frameLocator('#out');
      const h = frame.locator('[data-el="basics.h1"]');
      await h.scrollIntoViewIfNeeded();
      await h.click();
      await expect(page.locator('#ty-key')).toHaveText('heading');
      await expect(page.locator('#ty-key')).toHaveAttribute('title', 'basics.h1');
    });

  // Selected, not being typed in: while the inline editor is open the slot's
  // element IS the editor's own <div>, so the strip says the honest "text".
  test('a paragraph reads as a paragraph', async ({ page }) => {
    const frame = page.frameLocator('#out');
    const p = frame.locator('[data-el="para.basics.p1"]');
    await p.scrollIntoViewIfNeeded();
    await p.click();
    await expect(page.locator('#ty-key')).toHaveText('paragraph');
    await expect(page.locator('#ty-key')).toHaveAttribute('title', 'basics.p1');
  });
});
