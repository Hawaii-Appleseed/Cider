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
});
