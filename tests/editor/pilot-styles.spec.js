// The stylesheet, from a pilot. The editor's own panels grew four verbs for a
// named style — save, redefine, apply to matching, unlink — and docsync.api
// had none of them, which matters more than it sounds: driving the editor
// through the pilot is the DEFAULT way this thing is meant to be changed, so
// "make every pull-quote match" was a thing a person could do and an agent
// could not.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function addBox(page, opts = {}) {
  const r = await page.evaluate(o => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 2, md: 'style fixture', ...o }), opts);
  expect(r.ok).toBe(true);
  return r.id;
}

test.describe('pilot: styles', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('inventory reports both stylesheets, with how many wear each',
    async ({ page }) => {
      await api(page, `defineStyle({ scope: 'text', name: 'Body', size: 14 })`);
      await api(page, `setStyle('basics.h1', { use: 'Body' })`);
      const inv = await api(page, 'inventory()');
      // The first question anyone asks of a style is how much would move if
      // it changed, so the count travels with it.
      expect(inv.styles.text.Body).toMatchObject({ size: 14, wornBy: 1 });
      // And the slot says what it wears, so "already dressed" can be told
      // from "looks the same by hand" — the two want opposite next moves.
      const slot = inv.pages.flatMap(p => p.slots).find(x => x.key === 'basics.h1');
      expect(slot.textStyle).toBe('Body');
    });

  test('defineStyle then dress, and the object really wears it',
    async ({ page }) => {
      const id = await addBox(page);
      const d = await api(page, `defineStyle({ scope: 'object', kind: 'box',
        name: 'Pull quote', fill: '#F5F8F6', pad: 0.2 })`);
      expect(d.ok).toBe(true);
      const r = await api(page, `dress('${id}', 'Pull quote')`);
      expect(r.ok).toBe(true);
      expect(r.use).toBe('Pull quote');
      expect(await page.evaluate(i => boxOf(i).use, id))
        .toBe('Pull quote');
      // Wearing a style takes the object's own look keys off — an object that
      // kept them would ignore the style it had just been given.
      expect(await page.evaluate(i => boxOf(i).fill, id))
        .toBeUndefined();
      // Redefining moves it, because that is the whole point.
      await api(page, `defineStyle({ scope: 'object', kind: 'box',
        name: 'Pull quote', fill: '#FFEEDD', pad: 0.2 })`);
      await page.waitForTimeout(900);
      const bg = await page.frameLocator('#out').locator(`[data-el="${id}"]`)
        .evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).toBe('rgb(255, 238, 221)');
    });

  test('a style is written for one kind of thing, and says so', async ({ page }) => {
    const id = await addBox(page);
    await api(page, `defineStyle({ scope: 'object', kind: 'shape',
      name: 'Rule', fill: '#000000' })`);
    const r = await api(page, `dress('${id}', 'Rule')`);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('dresses a shape');
    // A key that is not a look at all is refused where the style is DEFINED,
    // not later on the first thing to wear it.
    const bad = await api(page, `defineStyle({ scope: 'object', kind: 'box',
      name: 'Nope', x: 3 })`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('not something a box style can set');
  });

  test('setStyle refuses a text style that does not exist', async ({ page }) => {
    // Refused here rather than at load: writing it would not set a style, it
    // would produce a document that will not open, several steps away from
    // the call that did it.
    const r = await api(page, `setStyle('basics.h1', { use: 'Ghost' })`);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no text style 'Ghost'");
  });

  test('dropStyle unlinks what wears it, keeping the look', async ({ page }) => {
    const id = await addBox(page);
    await api(page, `defineStyle({ scope: 'object', kind: 'box',
      name: 'Tint', fill: '#F5F8F6' })`);
    await api(page, `dress('${id}', 'Tint')`);
    const r = await api(page, `dropStyle('object', 'Tint')`);
    expect(r.ok).toBe(true);
    expect(r.unlinked).toBe(1);
    const b = await page.evaluate(i => boxOf(i), id);
    expect(b.use).toBeUndefined();
    expect(b.fill).toBe('#F5F8F6');       // the look survives the style
    expect(await page.evaluate(() => layout.objectStyles)).toBeUndefined();
  });

  test('a master item counts as a wearer, and a drop unlinks it', async ({ page }) => {
    // A master's items live in layout.masters, not in layout.boxes. A count
    // taken off the page stores alone under-reports — and a DROP that skipped
    // them would leave a `use` naming a style that no longer exists, which
    // the engine refuses at load. So the document would stop opening.
    const id = await addBox(page, { page: 3, md: 'running footer' });
    await api(page, `defineStyle({ scope: 'object', kind: 'box',
      name: 'Footer', fill: '#EDF4EE' })`);
    await api(page, `dress('${id}', 'Footer')`);
    const m = await api(page, `masterFrom('3', 'Base')`);
    expect(m.ok).toBe(true);
    // The box is a master item now, and still wearing the style.
    expect(await page.evaluate(() => Object.keys(masters()))).toContain('Base');
    expect(await api(page, 'styles()')).toMatchObject(
      { object: { Footer: { wornBy: 1 } } });

    const r = await api(page, `dropStyle('object', 'Footer')`);
    expect(r.ok).toBe(true);
    expect(r.unlinked).toBe(1);
    // Nothing anywhere still names the style, so the document still loads —
    // which is the whole point, and is what render() having succeeded says.
    const left = await page.evaluate(() =>
      JSON.stringify(layout).includes('"use":"Footer"'));
    expect(left).toBe(false);
    expect(await page.evaluate(() => $('stat').textContent))
      .not.toContain('does not build');
  });

  test('dressing a set is ONE batch and ONE undo', async ({ page }) => {
    const a = await addBox(page, { y: 1 });
    const b = await addBox(page, { y: 2 });
    const c = await addBox(page, { y: 3 });
    const r = await page.evaluate(ids => docsync.api.batch([
      { verb: 'defineStyle', args: [{ scope: 'object', kind: 'box',
        name: 'Note', fill: '#EDF4EE' }] },
      ...ids.map(i => ({ verb: 'dress', args: [i, 'Note'] })),
    ]), [a, b, c]);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(ids =>
      ids.map(i => boxOf(i).use), [a, b, c]))
      .toEqual(['Note', 'Note', 'Note']);
    // That is the argument for a stylesheet: one change, one undo.
    await page.evaluate(() => docsync.api.undo());
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => layout.objectStyles)).toBeUndefined();
    expect(await page.evaluate(ids =>
      ids.map(i => boxOf(i).use), [a, b, c]))
      .toEqual([undefined, undefined, undefined]);
  });
});
