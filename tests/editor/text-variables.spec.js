// Text variables, a generated contents list and page references
// (INDESIGN_PARITY.md 18-19). A token in braces becomes a span that
// layout.VARS_JS fills after layout, because only the laid-out document knows
// which page a thing landed on. The editor runs that same string after each
// render. While typing, a token is an atomic chip, so an edit hands back the
// token and never the number it currently shows. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

async function addBox(page, md, pg = 3) {
  const r = await page.evaluate(([m, p]) => docsync.api.addTextBox(
    { page: p, x: 1, y: 1, w: 4, md: m }), [md, pg]);
  expect(r.ok).toBe(true);
  return r.id;
}
const boxText = (page, id) => page.evaluate(i =>
  ($('out').contentDocument.querySelector(`[data-el="${i}"]`) || {}).textContent || '', id);

test.describe('text variables', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('{page} and {pages} are this sheet\'s place and the sheet count', async ({ page }) => {
    const id = await addBox(page, 'Page {page} of {pages}', 3);
    const want = await page.evaluate(i => {
      const d = $('out').contentDocument;
      const P = [...d.querySelectorAll('section.page')];
      const el = d.querySelector(`[data-el="${i}"]`);
      return `Page ${P.indexOf(el.closest('section.page')) + 1} of ${P.length}`;
    }, id);
    await expect.poll(() => boxText(page, id)).toBe(want);
  });

  test('{section} is the last heading on or before this page', async ({ page }) => {
    const id = await addBox(page, '{section}', 5);
    const want = await page.evaluate(i => {
      const d = $('out').contentDocument;
      const P = [...d.querySelectorAll('section.page')];
      const n = P.indexOf(d.querySelector(`[data-el="${i}"]`).closest('section.page')) + 1;
      const H = [...d.querySelectorAll('section.page h1, section.page h2')]
        .filter(h => !h.closest('.ds-var') && h.textContent.trim()
          && P.indexOf(h.closest('section.page')) + 1 <= n);
      return H.length ? H[H.length - 1].textContent.replace(/\s+/g, ' ').trim() : '';
    }, id);
    expect(want).not.toBe('');
    await expect.poll(() => boxText(page, id)).toBe(want);
  });

  test('{pageof:slot} is the page that slot is on, and follows it', async ({ page }) => {
    const id = await addBox(page, 'see page {pageof:basics.h1}', 2);
    const want = await page.evaluate(() => {
      const d = $('out').contentDocument;
      const P = [...d.querySelectorAll('section.page')];
      return String(P.indexOf(d.querySelector('[data-slot="basics.h1"]').closest('section.page')) + 1);
    });
    await expect.poll(() => boxText(page, id)).toBe(`see page ${want}`);
    // A key nothing carries says so with a question mark, not a wrong number.
    const bad = await addBox(page, 'p. {pageof:no.such.slot}', 2);
    await expect.poll(() => boxText(page, bad)).toBe('p. ?');
  });

  test('{contents} lists every heading after its page, with page numbers and links',
    async ({ page }) => {
      const id = await addBox(page, '{contents}', 2);
      await expect.poll(() => page.evaluate(i =>
        $('out').contentDocument.querySelectorAll(`[data-el="${i}"] .ds-toc li`).length, id))
        .toBeGreaterThan(3);
      const rows = await page.evaluate(i => {
        const d = $('out').contentDocument;
        const P = [...d.querySelectorAll('section.page')];
        return [...d.querySelectorAll(`[data-el="${i}"] .ds-toc a`)].slice(0, 5).map(a => {
          const h = d.getElementById(a.getAttribute('href').slice(1));
          return { said: +a.querySelector('.ds-toc-n').textContent,
                   is: h ? P.indexOf(h.closest('section.page')) + 1 : -1,
                   title: a.querySelector('.ds-toc-t').textContent === h.textContent.replace(/\s+/g, ' ').trim() };
        });
      }, id);
      for (const r of rows) { expect(r.said).toBe(r.is); expect(r.said).toBeGreaterThan(2); expect(r.title).toBe(true); }
    });

  test('a token round-trips through the text editor as a chip', async ({ page }) => {
    const md = 'Page {page} · see {pageof:basics.h1} · {date}';
    const back = await page.evaluate(m => {
      const el = document.createElement('div');
      el.innerHTML = mdToHtml(m, { inline: true });
      const chips = el.querySelectorAll('.ds-varchip').length;
      return { chips, md: htmlToMd(el, { inline: true }) };
    }, md);
    expect(back.chips).toBe(3);
    expect(back.md).toBe(md);
  });

  test('the text menu offers Insert and a page reference', async ({ page }) => {
    const id = await addBox(page, 'words to click in', 3);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${id}"]`).click();
    await page.waitForTimeout(400);
    await frame.locator(`[data-el="${id}"]`).click({ button: 'right' });
    await page.waitForTimeout(300);
    const labels = await page.evaluate(() => [...$('out').contentDocument
      .querySelectorAll('.ds-menu button')].map(b => b.textContent.trim()));
    expect(labels).toContain('Insert ▸');
    expect(labels).toContain('Page reference ▸');
  });
});
