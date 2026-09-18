// Named text styles: layout.styles is the catalogue, a slot's or box's style
// says { style: 'Body' } to wear one, and redefining 'Body' moves every
// element wearing it. Through the pilot API (the contract) and the Type
// strip's Style menu (the UI). Local mode.
const { test, expect, gotoEditor, fillDialog, submitDialog } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);
const fontSizeOf = (page, sel) => page.evaluate(s => parseFloat(getComputedStyle(
  $('out').contentDocument.querySelector(s)).fontSize), sel);
const colorOf = (page, sel) => page.evaluate(s => getComputedStyle(
  $('out').contentDocument.querySelector(s)).color, sel);

async function addBox(page, opts = {}) {
  const r = await page.evaluate(o => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 2, md: 'style fixture', ...o }), opts);
  expect(r.ok).toBe(true);
  return r.id;
}

test.describe('named text styles', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('defineStyle + setStyle({style}) dress a slot and a box; redefining moves both',
    async ({ page }) => {
      let r = await api(page, `defineStyle('Callout', { size: 22, color: '#E23B3B' })`);
      expect(r.ok).toBe(true);
      expect(r.redefined).toBe(false);
      const id = await addBox(page);
      r = await api(page, `setStyle('basics.h1', { style: 'Callout' })`);
      expect(r.ok).toBe(true);
      expect(r.style).toEqual({ style: 'Callout' });          // the reference, not a copy
      expect(r.effective).toMatchObject({ size: 22, color: '#E23B3B' });
      r = await page.evaluate(i => docsync.api.setStyle(i, { style: 'Callout' }), id);
      expect(r.ok).toBe(true);
      expect(await fontSizeOf(page, '[data-slot="basics.h1"]')).toBeCloseTo(22, 0);
      expect(await fontSizeOf(page, `[data-el="${id}"]`)).toBeCloseTo(22, 0);
      // One redefinition, two elements move — the whole point.
      r = await api(page, `defineStyle('Callout', { size: 31 })`);
      expect(r.redefined).toBe(true);
      expect(r.users.sort()).toEqual(['basics.h1', id].sort());
      expect(await fontSizeOf(page, '[data-slot="basics.h1"]')).toBeCloseTo(31, 0);
      expect(await fontSizeOf(page, `[data-el="${id}"]`)).toBeCloseTo(31, 0);
      // The catalogue is in the inventory, with its wearers.
      const inv = await api(page, 'inventory()');
      expect(inv.styles.Callout.users.sort()).toEqual(['basics.h1', id].sort());
      // Save writes it into layout.json as "styles".
      const saved = JSON.parse(await page.evaluate(() => JSON.stringify(layout)));
      expect(saved.styles.Callout).toEqual({ size: 31 });
      expect(saved.text['basics.h1']).toEqual({ style: 'Callout' });
    });

  test('a local override rides on top of the named base and survives a redefine',
    async ({ page }) => {
      await api(page, `defineStyle('Body', { size: 14, color: '#112233' })`);
      await api(page, `setStyle('basics.h1', { style: 'Body' })`);
      let r = await api(page, `setStyle('basics.h1', { size: 40 })`);
      expect(r.style).toEqual({ style: 'Body', size: 40 });
      expect(r.effective).toEqual({ size: 40, color: '#112233' });
      await api(page, `defineStyle('Body', { size: 14, color: '#445566' })`);
      expect(await fontSizeOf(page, '[data-slot="basics.h1"]')).toBeCloseTo(40, 0);
      expect(await colorOf(page, '[data-slot="basics.h1"]')).toBe('rgb(68, 85, 102)');
      // Wearing a style again REPLACES local formatting.
      r = await api(page, `setStyle('basics.h1', { style: 'Body' })`);
      expect(r.style).toEqual({ style: 'Body' });
    });

  test('removeStyle keeps every wearer\'s look; renameStyle re-points them; undo walks it all back',
    async ({ page }) => {
      await api(page, `defineStyle('Note', { size: 24, italic: true })`);
      await api(page, `setStyle('basics.h1', { style: 'Note', color: '#0000FF' })`);
      let r = await api(page, `renameStyle('Note', 'Aside')`);
      expect(r.ok).toBe(true);
      expect(await page.evaluate(() => layout.text['basics.h1'].style)).toBe('Aside');
      expect(await page.evaluate(() => Object.keys(layout.styles))).toEqual(['Aside']);
      r = await api(page, `removeStyle('Aside')`);
      expect(r.inlined).toEqual(['basics.h1']);
      expect(await page.evaluate(() => layout.text['basics.h1']))
        .toEqual({ size: 24, italic: true, color: '#0000FF' });
      expect(await page.evaluate(() => layout.styles)).toBeUndefined();
      expect(await fontSizeOf(page, '[data-slot="basics.h1"]')).toBeCloseTo(24, 0);
      await api(page, 'undo()');
      expect(await page.evaluate(() => layout.text['basics.h1'].style)).toBe('Aside');
      await api(page, 'undo()');
      expect(await page.evaluate(() => layout.text['basics.h1'].style)).toBe('Note');
    });

  test('detaching through setStyle({style:null}) keeps the look inline, as the menu does',
    async ({ page }) => {
      await api(page, `defineStyle('Body', { size: 17 })`);
      await api(page, `setStyle('basics.h1', { style: 'Body' })`);
      const r = await api(page, `setStyle('basics.h1', { style: null })`);
      expect(r.style).toEqual({ size: 17 });
    });

  test('refusals: unknown name, a base a load would refuse, chaining, bad names, in a batch too',
    async ({ page }) => {
      expect((await api(page, `setStyle('basics.h1', { style: 'Ghost' })`)).ok).toBe(false);
      expect((await api(page, `defineStyle('Tiny', { size: 4 })`)).error).toContain('legibility floor');
      expect((await api(page, `defineStyle('Fake', { font: 'Barlow', weight: 350 })`)).error)
        .toContain('no weight 350');
      expect((await api(page, `defineStyle('A', { style: 'B' })`)).ok).toBe(false);
      expect((await api(page, `defineStyle(' lead', { size: 12 })`)).ok).toBe(false);
      expect((await api(page, `defineStyle('', { size: 12 })`)).ok).toBe(false);
      expect((await api(page, `removeStyle('Ghost')`)).ok).toBe(false);
      expect((await api(page, `renameStyle('Ghost', 'X')`)).ok).toBe(false);
      // Nothing above touched the document.
      expect(await page.evaluate(() => layout.styles)).toBeUndefined();
      // batch(): define then wear in one undo step; a bad op refuses the lot.
      let r = await api(page, `batch([
        { verb: 'defineStyle', args: ['Body', { size: 15 }] },
        { verb: 'setStyle', args: ['basics.h1', { style: 'Body' }] },
      ])`);
      expect(r.ok).toBe(true);
      expect(await page.evaluate(() => layout.text['basics.h1'])).toEqual({ style: 'Body' });
      r = await api(page, `batch([
        { verb: 'defineStyle', args: ['Head', { size: 30 }] },
        { verb: 'defineStyle', args: ['Bad', { size: 2 }] },
      ])`);
      expect(r.ok).toBe(false);
      expect(await page.evaluate(() => Object.keys(layout.styles))).toEqual(['Body']);
      await api(page, 'undo()');
      expect(await page.evaluate(() => layout.styles)).toBeUndefined();
    });

  test('the Style menu: save this text as a style, apply it to another, update it, delete it',
    async ({ page }) => {
      // Give the heading a look worth keeping, then select it.
      await api(page, `setStyle('basics.h1', { size: 27, color: '#E23B3B' })`);
      await api(page, `select('basics.h1')`);
      await expect(page.locator('#type')).toBeVisible();
      await expect(page.locator('#ty-stylename')).toHaveText('Style');
      await page.click('#ty-stylebtn');
      await expect(page.locator('#ty-stylepop')).toBeVisible();
      await expect(page.locator('#ty-stylenone')).toBeVisible();
      await page.click('#ty-style-new');
      await fillDialog(page, { name: 'Big red' });
      await submitDialog(page);
      await expect(page.locator('#ty-stylename')).toHaveText('Big red');
      expect(await page.evaluate(() => layout.styles['Big red'])).toEqual({ size: 27, color: '#E23B3B' });
      expect(await page.evaluate(() => layout.text['basics.h1'])).toEqual({ style: 'Big red' });

      // Apply it to a box from the list.
      const id = await addBox(page);
      await page.evaluate(i => docsync.api.select(i), id);
      await page.click('#ty-stylebtn');
      await page.click('#ty-stylelist .shp[data-style="Big red"]');
      await expect(page.locator('#ty-stylename')).toHaveText('Big red');
      expect(await fontSizeOf(page, `[data-el="${id}"]`)).toBeCloseTo(27, 0);

      // A local change shows as "+", and Update pushes it into the style.
      await page.fill('#ty-size', '33');
      await page.dispatchEvent('#ty-size', 'change');
      await expect(page.locator('#ty-stylebtn')).toHaveClass(/plus/);
      await page.click('#ty-stylebtn');
      await expect(page.locator('#ty-style-update')).toBeVisible();
      await page.click('#ty-style-update');
      await expect(page.locator('#ty-stylebtn')).not.toHaveClass(/plus/);
      expect(await fontSizeOf(page, '[data-slot="basics.h1"]')).toBeCloseTo(33, 0);

      // Delete: both keep the look, neither follows any more.
      await page.click('#ty-stylebtn');
      await page.click('#ty-style-delete');
      await submitDialog(page);
      await expect(page.locator('#ty-stylename')).toHaveText('Style');
      expect(await page.evaluate(() => layout.styles)).toBeUndefined();
      expect(await page.evaluate(() => layout.text['basics.h1'])).toEqual({ size: 33, color: '#E23B3B' });
      expect(await fontSizeOf(page, `[data-el="${id}"]`)).toBeCloseTo(33, 0);
    });

  test('a report that already carries styles renders them, and the strip reads through them',
    async ({ page }) => {
      await page.evaluate(() => {
        layout.styles = { Body: { size: 19, tracking: 1.5 } };
        layout.text = { ...(layout.text || {}), 'basics.h1': { style: 'Body' } };
      });
      await page.evaluate(() => render());
      expect(await fontSizeOf(page, '[data-slot="basics.h1"]')).toBeCloseTo(19, 0);
      await api(page, `select('basics.h1')`);
      // The stepper shows the EFFECTIVE size, not a blank.
      await expect(page.locator('#ty-size')).toHaveValue('19');
      await expect(page.locator('#ty-track')).toHaveValue('1.5');
    });
});
