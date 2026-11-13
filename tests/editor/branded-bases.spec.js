// The four BRANDED starting points the hub's new_report offers (2026-11-12):
// "One-page fact sheet", "Report", "Testimony" and "Deck, branded (widescreen)".
// Unlike the blank sizes they are designed: placed boxes, shapes, a real chart
// and real tables on the blank renderer, set in the brand guide's Manrope
// (headings) and Poppins (body). Their words are stand-ins that say what goes
// there. What these specs hold them to:
//   * their pages, at the sheet size, with ZERO Preflight findings;
//   * the brand fonts actually requested and used (an earlier deck came out in a
//     default sans because its renderer never asked for them);
//   * every object movable (the audit's immovable-text list is empty);
//   * addPage / removePage, Present and PDF behave, as on the blank bases;
//   * type sized from the canvas (the deck's floors are Devin's slide rule scaled
//     from the 960px canvas to 1280px).
const { test, expect, gotoEditor, clickTool } = require('./fixtures/editor-test');

const api = (page, fn, arg) => page.evaluate(fn, arg);

const BASES = [
  { id: 'fact-sheet', sheets: 1, size: [816, 1056] },
  { id: 'report', sheets: 6, size: [816, 1056] },
  { id: 'testimony', sheets: 1, size: [816, 1056] },          // a second page waits, hidden
  { id: 'deck-branded', sheets: 6, size: [1280, 720] },
];

for (const { id, sheets, size } of BASES) {
  test.describe(`branded base: ${id}`, () => {
    test('opens as its pages at the right size, in the brand fonts, with nothing for Preflight to say', async ({ page }) => {
      await gotoEditor(page, `?project=${id}`);
      const frame = page.frameLocator('#out');
      await expect(frame.locator('section.page')).toHaveCount(sheets);
      const boxes = await frame.locator('section.page').evaluateAll(els =>
        els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      for (const b of boxes) expect(b).toEqual(size);

      // Zero findings of any severity, not merely zero errors: a starting point
      // that opens with warnings teaches people to ignore them.
      const pf = await api(page, () => docsync.api.preflight());
      expect(pf.issues, JSON.stringify(pf.issues)).toEqual([]);
      expect(pf.errors).toBe(0);
      const au = await api(page, () => docsync.api.audit());
      expect((au.issues || []).filter(i => i.kind === 'immovable-text'), 'every word can be moved').toEqual([]);

      // Brand fonts: the page's own head asks for Manrope and Poppins at the
      // weights the boxes use, and the text really is set in them.
      const fonts = await frame.locator('body').evaluate(async body => {
        const d = body.ownerDocument;
        await d.fonts.ready;
        const link = [...d.querySelectorAll('link[href*="fonts.googleapis"]')].map(l => l.href).join(' ');
        return { link, loaded: [...d.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
      });
      expect(fonts.link).toMatch(/family=Manrope:wght@[\d;]*800/);
      expect(fonts.link).toMatch(/family=Poppins:wght@[\d;]*400/);
      expect(fonts.loaded).toEqual(expect.arrayContaining(['Manrope', 'Poppins']));
      const used = await frame.locator('.ds-textbox').evaluateAll(els =>
        [...new Set(els.map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()))]);
      expect(used.sort()).toEqual(expect.arrayContaining(['Manrope', 'Poppins']));
      for (const f of used) expect(['Manrope', 'Poppins'], `only brand fonts, found ${f}`).toContain(f);
    });

    test('addPage and removePage work, Present and the PDF count what is left', async ({ page }) => {
      test.setTimeout(120000);
      await gotoEditor(page, `?project=${id}`);
      const frame = page.frameLocator('#out');
      const a = await api(page, () => docsync.api.addPage());
      expect(a.ok, a.error).not.toBe(false);
      // The added page takes objects at once.
      const t = await api(page, P => docsync.api.addTextBox({ page: P, x: 0.9, y: 0.9, w: 4, md: 'Added page' }), a.id);
      expect(t.ok, t.error).not.toBe(false);
      await expect(frame.locator('section.page')).toHaveCount(sheets + 1);
      const r = await api(page, () => docsync.api.removePage(1));
      expect(r.ok, r.error).not.toBe(false);
      await expect(frame.locator('section.page')).toHaveCount(sheets);
      await expect(frame.locator('section.page[data-page="1"]')).toHaveCount(0);
      const pf = await api(page, () => docsync.api.preflight());
      expect(pf.errors, JSON.stringify(pf.issues)).toBe(0);
      await clickTool(page, 'present');
      await expect(page.locator('#present-n')).toHaveText(`1 / ${sheets}`);
      await page.keyboard.press('Escape');
      await expect(page.locator('body')).not.toHaveClass(/ds-present/);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        api(page, () => exportPdfInBrowser(null, '')),
      ]);
      const txt = require('fs').readFileSync(await download.path()).toString('latin1');
      const media = [...txt.matchAll(/\/Type \/Page \/Parent[^\n]*?\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [+m[1], +m[2]]);
      expect(media.length).toBe(sheets);
      for (const m of media) {
        expect(m[0]).toBeCloseTo(size[0] * 0.75, 0);
        expect(m[1]).toBeCloseTo(size[1] * 0.75, 0);
      }
    });
  });
}

test.describe('testimony: one page that grows to two', () => {
  test('page 2 waits hidden; showing it lets a long testimony pour on, with no errors', async ({ page }) => {
    await gotoEditor(page, '?project=testimony');
    const frame = page.frameLocator('#out');
    await expect(frame.locator('section.page')).toHaveCount(1);
    // The house header block, as the skill gives it (the position is in the title line).
    const text = await frame.locator('section.page').first().innerText();
    expect(text).toContain('Testimony of the Hawai');
    expect(text).toMatch(/Support for HB 0000\s*–\s*Relating to \[Subject\]/);
    expect(text).toContain('Dear Chair [Name], Vice Chair [Name], and Members of the Committee:');
    expect(text).toContain('Mahalo for the opportunity to testify.');
    // A long testimony runs past page 1; page 2 is brought back and takes the rest.
    const long = Array.from({ length: 14 }, (_, i) =>
      `Paragraph ${i + 1} of a testimony that is longer than a single page, with a second sentence so each one takes two lines on the sheet.`).join('\n\n');
    const r = await api(page, md => docsync.api.setBoxText('ty-body', md), long);
    expect(r.ok, r.error).not.toBe(false);
    const s = await api(page, () => docsync.api.showPage(2));
    expect(s.ok, s.error).not.toBe(false);
    await expect(frame.locator('section.page')).toHaveCount(2);
    // The rest of the story is on page 2, in the continuation frame.
    await expect(frame.locator('section.page[data-page="2"] [data-thread-i="1"]')).toContainText('Paragraph 14');
    const pf = await api(page, () => docsync.api.preflight());
    expect(pf.errors, JSON.stringify(pf.issues)).toBe(0);
  });
});

test.describe('report: structure and endnotes', () => {
  test('cover, summary, two sections, recommendations and a numbered endnotes page', async ({ page }) => {
    await gotoEditor(page, '?project=report');
    const frame = page.frameLocator('#out');
    const sheetsText = await frame.locator('section.page').evaluateAll(els => els.map(e => e.innerText));
    expect(sheetsText[1]).toContain('EXECUTIVE SUMMARY');
    expect(sheetsText[4]).toContain('RECOMMENDATIONS');
    expect(sheetsText[5]).toContain('ENDNOTES');
    // Numbered endnotes, each one cited from the prose, so none is an uncited source.
    await expect(frame.locator('.ds-endnotes-sec li')).toHaveCount(3);
    // A real chart object and a real table, not drawn divs.
    await expect(frame.locator('section.page[data-page="3"] g[data-shape]')).not.toHaveCount(0);
    await expect(frame.locator('section.page[data-page="4"] table')).toHaveCount(1);
  });
});

test.describe('deck: type sized from the canvas', () => {
  test('1280px slides: titles 53px+, body 32px+, hero number 80px+, nothing under 18px', async ({ page }) => {
    await gotoEditor(page, '?project=deck-branded');
    const frame = page.frameLocator('#out');
    const sizes = await frame.locator('.ds-textbox').evaluateAll(els =>
      els.map(e => ({ id: e.getAttribute('data-el') || e.id || '', px: parseFloat(getComputedStyle(e).fontSize) })));
    expect(sizes.length).toBeGreaterThan(15);
    for (const s of sizes) expect(s.px, `${s.id} is ${s.px}px`).toBeGreaterThanOrEqual(18);
    const px = id => (sizes.find(s => s.id.endsWith(id)) || {}).px;
    for (const t of ['dk-1-title', 'dk-2-title', 'dk-3-title', 'dk-5-title']) expect(px(t), t).toBeGreaterThanOrEqual(53);
    for (const b of ['dk-3-b1', 'dk-3-b2', 'dk-3-b3', 'dk-1-sub', 'dk-4-sub']) expect(px(b), b).toBeGreaterThanOrEqual(32);
    expect(px('dk-4-num'), 'the hero number').toBeGreaterThanOrEqual(80);
    expect(px('dk-5-cap'), 'the chart caption').toBeGreaterThanOrEqual(27);
  });
});
