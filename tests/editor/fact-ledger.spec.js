// The fact ledger (docsync/ledger.py, parts/facts.js): a {fact:<id>} token is
// the ledger's number on the page, a chip while typing, offered by issue area
// in Insert fact, and checked by Preflight. Local mode, the fixture report.
const { sharedTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const addBox = async (page, md) => {
  const r = await page.evaluate(m => docsync.api.addTextBox({ page: 3, x: 1, y: 1, w: 4, md: m }), md);
  expect(r.ok).toBe(true);
  return r.id;
};
const text = (page, id) => page.evaluate(i => $('out').contentDocument.querySelector(`[data-el="${i}"]`).textContent.trim(), id);
const kinds = page => page.evaluate(() => factIssues().map(i => i.kind).sort());

test.describe('fact ledger', () => {
  test('a token is the ledger number on the page, and a chip while typing', async ({ page }) => {
    await gotoEditor(page);
    // The packaged ledger reached the editor, grouped by the hub's issue areas.
    const led = await page.evaluate(() => ({ n: Object.keys(LEDGER.facts).length,
      area: LEDGER.facts['capgains-share-over-400k'] && LEDGER.facts['capgains-share-over-400k'].area }));
    expect(led.n).toBeGreaterThanOrEqual(4);
    expect(led.area).toBe('tax-and-budget');

    const id = await addBox(page,
      'Over {fact:capgains-share-over-400k} of gains; top rate {fact:top-income-tax-rate|pct}, '
      + 'in 2026 {fact:top-income-tax-rate@2026-05|pct}; {fact:wfc-eitc-loss-2028|$M}.');
    expect(await text(page, id)).toBe('Over 77 percent of gains; top rate 13%, in 2026 11%; $42M.');

    // The text editor shows the number and gives the token back unchanged.
    const chip = await page.evaluate(() => {
      const t = document.createElement('div');
      t.innerHTML = mdInlineToHtml('a {fact:top-income-tax-rate@2026-05|pct} b');
      const c = t.querySelector('.ds-varchip');
      return [c.textContent, nodeToMdInline(t), /11 percent|Pinned/.test(c.title)];
    });
    expect(chip).toEqual(['ⓕ 11% · 2026-05', 'a {fact:top-income-tax-rate@2026-05|pct} b', true]);
  });

  test('Preflight names an unknown fact, a proposed one, and one the ledger moved', async ({ page }) => {
    await gotoEditor(page);
    await addBox(page, 'A {fact:no-such-fact} and {fact:capgains-share-over-400k}.');
    expect(await kinds(page)).toEqual(['fact-unknown']);
    // The report last agreed the fact said 70; the ledger now says 77.
    await page.evaluate(async () => { await changeDoc(() => { layout.factsSeen = { 'capgains-share-over-400k': 70 }; }); });
    const changed = await page.evaluate(() => factIssues().find(i => i.kind === 'fact-changed'));
    expect(changed.note).toContain('70 percent → 77 percent');
    await page.evaluate(() => factsSeenRecord(['capgains-share-over-400k']));
    expect(await kinds(page)).toEqual(['fact-unknown']);
    // A proposed fact is a warning, never an error.
    await page.evaluate(() => { LEDGER.facts['capgains-share-over-400k'].status = 'proposed'; });
    expect(await kinds(page)).toEqual(['fact-proposed', 'fact-unknown']);
    const sev = await page.evaluate(() => preflightIssues().filter(i => i.kind.startsWith('fact-'))
      .map(i => [i.kind, i.severity]).sort());
    expect(sev).toEqual([['fact-proposed', 'warning'], ['fact-unknown', 'error']]);
  });

  test('Insert fact lists the ledger by issue area and puts a chip in', async ({ page }) => {
    await gotoEditor(page);
    const id = await addBox(page, 'Start here.');
    const rows = await page.evaluate(() => {
      const d = document, m = d.createElement('div');
      d.body.appendChild(m);
      buildFactRows(d, m, null, null);
      m.querySelector('.ds-sub').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      m.querySelector('.ds-sub').click();
      const sub = d.querySelector('.ds-submenu');
      const out = sub ? [...sub.children].map(x => x.className === 'ds-menu-head' ? '# ' + x.textContent : x.dataset.fact) : [];
      d.querySelectorAll('.ds-submenu').forEach(x => x.remove());
      m.remove();
      return out;
    });
    expect(rows[0]).toBe('# Taxes & Budget');
    expect(rows).toContain('capgains-share-over-400k');
    expect(await text(page, id)).toBe('Start here.');
  });

  test('a token that goes in any way records its baseline, so a later ledger change is flagged', async ({ page }) => {
    await gotoEditor(page);
    // Opening a report writes nothing.
    expect(await page.evaluate(() => layout.factsSeen || null)).toBeNull();
    // A pilot verb (what the hub connector relays), not the Insert fact menu.
    const id = await addBox(page, 'Rate {fact:top-income-tax-rate}, then {fact:capgains-share-over-400k@2025-01}, and {fact:no-such-fact}.');
    expect(await page.evaluate(() => layout.factsSeen)).toEqual({ 'top-income-tax-rate': 13 });
    // Undo takes the baseline with the edit, and does not write one back.
    await page.evaluate(() => undo());
    expect(await page.evaluate(() => (layout.factsSeen || {})['top-income-tax-rate'])).toBeUndefined();
    await page.evaluate(() => redo());
    // A batch setSlot on a real slot, as edit_report sends it.
    const slot = 'whopays.p1';
    const r = await page.evaluate(k => docsync.api.batch([{ verb: 'setSlot', args: [k, 'About {fact:millionaires-count} millionaires.'] }]), slot);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(() => layout.factsSeen['millionaires-count'])).toBe(81814);
    // The ledger moves: the report says so, naming the number it last agreed to.
    await page.evaluate(() => { LEDGER.facts['millionaires-count'].value = 90000; LEDGER.facts['millionaires-count'].shown = '90,000'; });
    const changed = await page.evaluate(() => factIssues().filter(i => i.kind === 'fact-changed').map(i => i.fact));
    expect(changed).toEqual(['millionaires-count']);
    // A baseline already recorded is kept by later edits.
    await addBox(page, 'Again {fact:millionaires-count}.');
    expect(await page.evaluate(() => layout.factsSeen['millionaires-count'])).toBe(81814);
    expect(id).toBeTruthy();
  });

  test('Preflight finds a ledger figure typed as words and links it, and leaves quotes alone', async ({ page }) => {
    await gotoEditor(page);
    const typed = () => page.evaluate(() => factTypedIssues().map(i => `${i.fact}:${i.typed}:${i.agrees}`).sort());
    const id = await addBox(page, 'The top rate will rise to 13 percent next year.');
    const other = await addBox(page, 'Once the top rate was 11 percent.');
    await addBox(page, '“The top rate is 13 percent,” she said. - The top rate is 13 percent. — [Someone, a bill](https://e.org/x)');
    expect(await typed()).toEqual(['top-income-tax-rate:11 percent:false', 'top-income-tax-rate:13 percent:true']);
    const off = await page.evaluate(() => factTypedIssues().find(i => !i.agrees));
    expect(off.note).toContain('the ledger says 13 percent (11 percent was its value for tax years 2009-2026)');
    // In the Preflight list, only the one that agrees offers Link.
    const btns = await page.evaluate(() => {
      preflightRender();
      return [...document.querySelectorAll('#pf-list .pf-row[data-kind="fact-typed"] .pf-act')].map(b => b.textContent);
    });
    expect(btns).toEqual(['Link to ledger']);
    // Link: the same words on the page, the token in the document, a baseline, one undo step.
    const ok = await page.evaluate(() => factLink(factTypedIssues().find(i => i.agrees)));
    expect(ok).toBe(true);
    const box = await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).md, id);
    expect(box).toBe('The top rate will rise to {fact:top-income-tax-rate} next year.');
    expect(await text(page, id)).toBe('The top rate will rise to 13 percent next year.');
    expect(await page.evaluate(() => layout.factsSeen['top-income-tax-rate'])).toBe(13);
    expect(await typed()).toEqual(['top-income-tax-rate:11 percent:false']);
    await page.evaluate(() => undo());
    expect(await page.evaluate(i => layout.boxes.find(b => 'text.' + b.id === i).md, id)).toBe('The top rate will rise to 13 percent next year.');
    expect(other).toBeTruthy();

    // A slot in content.md, and testimony's pin to today.
    expect((await page.evaluate(() => docsync.api.setSlot('whopays.p1', 'Hawaiʻi has 81,814 millionaires now.'))).ok).toBe(true);
    const pinned = await page.evaluate(async () => {
      const was = M.name;
      M.name = 'Tax testimony';
      try { await factLink(factTypedIssues().find(i => i.slot === 'whopays.p1')); } finally { M.name = was; }
      const t = source.split('[[whopays.p1]]')[1].split('[[')[0].trim();
      return t;
    });
    expect(pinned).toBe(`Hawaiʻi has {fact:millionaires-count@${new Date().toISOString().slice(0, 10)}} millionaires now.`);
    // Words that moved since Preflight read them: nothing changes.
    const stale = await page.evaluate(() => factLink({ fact: 'top-income-tax-rate', slot: 'whopays.p1', typed: '13 percent', sentence: 'gone' }));
    expect(stale).toBe(false);
  });

  test('the Insert palette lists the ledger under Facts and places a box that follows it', async ({ page }) => {
    await gotoEditor(page);
    const rows = await page.evaluate(() => {
      openPalette();
      const all = palShown.filter(r => r.cat === 'Fact').length;
      palCat = 'Fact'; palFilter();
      const facts = palShown.map(r => r.id);
      closePalette();
      return { all, facts };
    });
    expect(rows.all).toBe(0);
    expect(rows.facts).toContain('fact:wfc-eitc-loss-2028');
    const before = await page.evaluate(() => (layout.boxes || []).length);
    await page.evaluate(() => palRows().find(r => r.id === 'fact:wfc-eitc-loss-2028').run());
    const md = await page.evaluate(() => layout.boxes[layout.boxes.length - 1].md);
    expect(await page.evaluate(() => layout.boxes.length)).toBe(before + 1);
    expect(md).toBe('{fact:wfc-eitc-loss-2028}');
  });

  test('the chip writes every format exactly as the engine does', async ({ page }) => {
    // The chip is a preview; the engine (docsync/ledger.py) writes the published
    // words. They disagreed on an exact half: Python rounds it to even, JS up,
    // so a chip said "1,235" over a page that printed "1,234".
    const values = [0, 7, 7.25, 13, 77, 99.5, 1234.5, 2.5, 0.5, 81814, 999999, 2500000, 3500000,
      41250000, 41700000, 41750000, 132000000, 250000000, 2550000000, 2645700000, 1e9];
    const py = require('child_process').spawnSync('python3', ['-B', '-c', `
import json, sys
from docsync import ledger as L
vals = json.loads(sys.argv[1])
print(json.dumps({k: [L.FORMATS[k](float(v)) for v in vals] for k in L.FORMATS}))
`, JSON.stringify(values)], { cwd: require('path').resolve(__dirname, '../..'), encoding: 'utf8' });
    expect(py.status, py.stderr).toBe(0);
    const want = JSON.parse(py.stdout);
    await gotoEditor(page);
    const got = await page.evaluate(vs => Object.fromEntries(Object.entries(FACT_FORMATS).map(([k, [f]]) => [k, vs.map(f)])), values);
    expect(got).toEqual(want);
  });
});
