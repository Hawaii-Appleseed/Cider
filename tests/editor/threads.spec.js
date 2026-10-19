// Threaded frames (INDESIGN_PARITY.md 4): a box says `next`, and its words
// continue there when they run out of room. The first frame holds the story;
// layout.THREAD_JS pours it through the frames after layout, splitting a
// paragraph at the first line that does not fit. Nothing is ever lost or
// doubled, and a story too long for its frames is marked overset, not
// hidden. Local mode.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

const SENT = 'The general excise tax falls hardest on the households with the least to spend, '
  + 'because nearly every dollar they have goes to taxable goods and services.';
const STORY = Array.from({ length: 10 }, (_, i) =>
  i === 3 ? `**${SENT} ${SENT} ${SENT}**` : `Part ${i + 1}: ${SENT} ${SENT}`).join('\n\n');
// Words only: textContent joins paragraphs with no space, and ** is markup.
const flat = s => s.replace(/\*\*/g, '').replace(/\s+/g, '');

async function twoFrames(page, md = STORY, h = 2.2) {
  const a = await page.evaluate(([m, hh]) => docsync.api.addTextBox(
    { page: 3, x: 1, y: 1, w: 3.2, h: hh, md: m }), [md, h]);
  const b = await page.evaluate(hh => docsync.api.addTextBox(
    { page: 4, x: 1, y: 1, w: 3.2, h: hh, md: 'placeholder' }), h);
  expect(a.ok && b.ok).toBe(true);
  // b's own words join the end of the story; clear them so STORY is exact.
  await page.evaluate(i => { boxOf(i).md = 'x'; }, b.id);
  return [a.id, b.id];
}

const frameText = (page, ids) => page.evaluate(list => list.map(i =>
  ($('out').contentDocument.querySelector(`[data-el="${i}"]`) || {}).textContent || ''), ids);

test.describe('threaded frames', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.waitForTimeout(600);
  });

  test('the story pours on, and every word lands exactly once', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    const r = await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    expect(r.ok).toBe(true);
    expect(await page.evaluate(i => boxOf(i).md, b)).toBe('');
    const [ta, tb] = await frameText(page, [a, b]);
    expect(tb.length).toBeGreaterThan(50);              // something moved on
    const story = await page.evaluate(i => boxOf(i).md, a);
    expect(flat(ta + tb)).toBe(flat(story));
    // The first frame holds nothing past its own bottom.
    const over = await page.evaluate(i => {
      const f = $('out').contentDocument.querySelector(`[data-el="${i}"]`);
      const lim = f.getBoundingClientRect().bottom;
      return [...f.children].some(c => c.getBoundingClientRect().bottom > lim + 1);
    }, a);
    expect(over).toBe(false);
  });

  test('a paragraph split across frames keeps its markup on both sides', async ({ page }) => {
    // One long bold paragraph that cannot fit in the first frame.
    const md = `**${Array(8).fill(SENT).join(' ')}**`;
    const [a, b] = await twoFrames(page, md, 1.4);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    const got = await page.evaluate(([x, y]) => {
      const d = $('out').contentDocument;
      const fa = d.querySelector(`[data-el="${x}"]`), fb = d.querySelector(`[data-el="${y}"]`);
      return { cont: !!fb.querySelector('p.ds-cont'), boldA: !!fa.querySelector('b'),
               boldB: !!fb.querySelector('p.ds-cont b'),
               indent: fb.querySelector('p.ds-cont') && getComputedStyle(fb.querySelector('p.ds-cont')).textIndent };
    }, [a, b]);
    expect(got).toEqual({ cont: true, boldA: true, boldB: true, indent: '0px' });
  });

  test('a numbered list keeps counting in the next frame', async ({ page }) => {
    const md = Array.from({ length: 14 }, (_, i) => `${i + 1}. item ${i + 1} ${SENT}`).join('\n');
    const [a, b] = await twoFrames(page, md, 1.6);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    const nums = await page.evaluate(([x, y]) => {
      const d = $('out').contentDocument;
      const na = d.querySelectorAll(`[data-el="${x}"] li`).length;
      const ol = d.querySelector(`[data-el="${y}"] ol`);
      return { na, start: ol && +ol.getAttribute('start') };
    }, [a, b]);
    expect(nums.na).toBeGreaterThan(0);
    expect(nums.start).toBe(nums.na + 1);
  });

  test('too little room is overset: marked, audited, nothing hidden', async ({ page }) => {
    const md = STORY.split('\n\n').slice(0, 4).join('\n\n');
    const [a, b] = await twoFrames(page, md, 0.9);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    const over = await page.evaluate(i => $('out').contentDocument
      .querySelector(`[data-el="${i}"]`).hasAttribute('data-overset'), b);
    expect(over).toBe(true);
    const issues = (await api(page, 'audit()')).issues.filter(i => i.kind === 'overset');
    expect(issues.length).toBe(1);
    const [ta, tb] = await frameText(page, [a, b]);
    expect(flat(ta + tb)).toBe(flat(await page.evaluate(i => boxOf(i).md, a)));
    // A taller first frame takes words back, and the overset clears.
    await page.evaluate(i => docsync.api.place(i, { h: 9 }), a);
    expect(await page.evaluate(i => boxOf(i).h, a)).toBe(9);
    await expect.poll(() => page.evaluate(i => $('out').contentDocument
      .querySelector(`[data-el="${i}"]`).hasAttribute('data-overset'), b)).toBe(false);
  });

  test('a click in any frame opens the whole story in the first', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    await page.evaluate(i => editBox($('out').contentDocument,
      $('out').contentDocument.querySelector(`[data-el="${i}"]`)), b);
    const open = await page.evaluate(() => {
      const h = $('out').contentDocument.querySelector('.ds-edit');
      return h && { el: h.dataset.el, text: h.textContent };
    });
    expect(open.el).toBe(a.replace(/^text\./, ''));
    expect(flat(open.text)).toBe(flat(await page.evaluate(i => boxOf(i).md, a)));
  });

  test('removing a frame keeps the thread whole', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    const c = (await page.evaluate(() => docsync.api.addTextBox(
      { page: 5, x: 1, y: 1, w: 3.2, h: 2.2, md: 'x' }))).id;
    await page.evaluate(i => { boxOf(i).md = 'x'; }, c);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    await page.evaluate(([y, z]) => docsync.api.thread(y, z), [b, c]);
    const story = await page.evaluate(i => boxOf(i).md, a);
    // The middle frame goes: the first now continues into the last.
    expect((await page.evaluate(i => docsync.api.remove(i), b)).ok).toBe(true);
    expect(await page.evaluate(i => boxOf(i).next, a)).toBe(c.replace(/^text\./, ''));
    // The first frame goes: the last inherits the story.
    expect((await page.evaluate(i => docsync.api.remove(i), a)).ok).toBe(true);
    expect(await page.evaluate(i => boxOf(i).md, c)).toBe(story);
  });

  test('a duplicated frame stands alone, carrying the whole story', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    const r = await page.evaluate(i => docsync.api.duplicate(i), b);
    expect(r.ok).toBe(true);
    const copy = await page.evaluate(([x, y]) => boxes().find(q => q.id !== x.replace(/^text\./, '')
      && q.id !== y.replace(/^text\./, '') && q.md === boxOf(x).md), [a, b]);
    expect(copy).toBeTruthy();
    expect(copy.next).toBeUndefined();
    expect(await page.evaluate(i => boxOf(i).next, a)).toBe(b.replace(/^text\./, ''));
  });

  test('unthread removes the empty frames after the break', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    const r = await page.evaluate(i => docsync.api.unthread(i), a);
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(1);
    expect(await page.evaluate(i => !!boxOf(i), b)).toBe(false);
    expect(await page.evaluate(i => boxOf(i).next, a)).toBeUndefined();
  });

  test('thread refuses a loop, a frame already continued, and itself', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    expect((await page.evaluate(i => docsync.api.thread(i, i), a)).ok).toBe(false);
    await page.evaluate(([x, y]) => docsync.api.thread(x, y), [a, b]);
    expect((await page.evaluate(([x, y]) => docsync.api.thread(y, x), [a, b])).error).toMatch(/loop|already/);
    const c = (await page.evaluate(() => docsync.api.addTextBox(
      { page: 5, x: 1, y: 1, w: 2, md: 'other' }))).id;
    expect((await page.evaluate(([z, y]) => docsync.api.thread(z, y), [c, b])).error)
      .toMatch(/already continues another/);
  });

  test('the box menu threads by a click on the next box', async ({ page }) => {
    const [a, b] = await twoFrames(page);
    const frame = page.frameLocator('#out');
    await frame.locator(`[data-el="${a}"]`).click({ button: 'right' });
    await frame.locator('.ds-menu button', { hasText: 'Thread text into' }).click();
    await frame.locator(`[data-el="${b}"]`).scrollIntoViewIfNeeded();
    await frame.locator(`[data-el="${b}"]`).click();
    await expect.poll(() => page.evaluate(i => boxOf(i).next, a)).toBe(b.replace(/^text\./, ''));
    await frame.locator(`[data-el="${a}"]`).click({ button: 'right' });
    await expect(frame.locator('.ds-menu button', { hasText: 'Break thread after this frame' })).toBeVisible();
  });
});
