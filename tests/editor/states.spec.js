// Tabs and slides (INDESIGN_PARITY.md 84). The published behaviour is the
// engine's own markup, CSS and runtime, taken from the editor's Pyodide and
// set in a blank page: tabs switch on click and arrow keys, slides step,
// print shows every state. The editor half: every state stacked, each
// marker a chip, and the words typed like any box's.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const published = (page, md, kind) => page.evaluate(([md, kind]) => {
  py.globals.set('MD84', md); py.globals.set('K84', kind);
  return py.runPython(`
from docsync.layout import states_html, STATES_CSS, STATES_JS
from docsync.content import split_states
i, s = split_states(MD84)
"<style>" + STATES_CSS + "</style><div id='box'>" + states_html("t", K84, i, s) + "</div><script>" + STATES_JS + "</script>"`);
}, [md, kind]);
const MD = '{state:Home}\nThe home tab.\n\n{state:Evidence}\nThe evidence tab.\n\n{state:The bill}\nThe bill tab.';

test.describe('84 tabs and slides', () => {
  test('published tabs switch by click and arrow keys, and print every state', async ({ page, context }) => {
    await gotoEditor(page);
    const html = await published(page, MD, 'tabs');
    const p2 = await context.newPage();
    await p2.setContent(`<!doctype html><body>${html}</body>`);
    const shown = () => p2.evaluate(() => [...document.querySelectorAll('.ds-st-panel')]
      .filter(p => getComputedStyle(p).display !== 'none').map(p => p.innerText.replace(/\s+/g, ' ').trim()));
    expect(await shown()).toEqual(['The home tab.']);
    await p2.getByRole('tab', { name: 'Evidence' }).click();
    expect(await shown()).toEqual(['The evidence tab.']);
    await p2.keyboard.press('ArrowRight');
    expect(await shown()).toEqual(['The bill tab.']);
    await expect(p2.getByRole('tab', { name: 'The bill' })).toBeFocused();
    await p2.keyboard.press('Home');
    expect(await shown()).toEqual(['The home tab.']);
    await p2.emulateMedia({ media: 'print' });
    const all = await p2.evaluate(() => [...document.querySelectorAll('.ds-st-panel')]
      .filter(p => getComputedStyle(p).display !== 'none').map(p => p.innerText.replace(/\s+/g, ' ').trim()));
    expect(all).toEqual(['Home The home tab.', 'Evidence The evidence tab.', 'The bill The bill tab.']);
    expect(await p2.evaluate(() => getComputedStyle(document.querySelector('.ds-st-bar')).display)).toBe('none');
    await p2.close();
  });

  test('slides step forward and back, wrapping round', async ({ page, context }) => {
    await gotoEditor(page);
    const p2 = await context.newPage();
    await p2.setContent(`<!doctype html><body>${await published(page, MD, 'slides')}</body>`);
    const at = () => p2.evaluate(() => [...document.querySelectorAll('.ds-st-panel')].findIndex(p => !p.hidden));
    await p2.getByRole('button', { name: 'Next' }).click();
    expect(await at()).toBe(1);
    await p2.getByRole('button', { name: 'Previous' }).click();
    await p2.getByRole('button', { name: 'Previous' }).click();
    expect(await at()).toBe(2);
    await p2.close();
  });

  test('in the editor every state shows, each marker a chip that writes its token back', async ({ page }) => {
    await gotoEditor(page);
    const r = await page.evaluate(md => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 4, md }), MD);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const marks = await page.evaluate(id => [...$('out').contentDocument
      .querySelectorAll(`[data-el="${CSS.escape(id)}"] .ds-statemark`)].map(m => m.textContent), r.id);
    expect(marks).toEqual(['Home', 'Evidence', 'The bill']);
    const md = await page.evaluate(() => {
      const host = document.createElement('div');
      host.append(makeVarChip(document, 'state:Evidence'));
      return [host.firstChild.textContent, nodeToMdInline(host)];
    });
    expect(md).toEqual(['⇥ tab: Evidence', '{state:Evidence}']);
  });
});
