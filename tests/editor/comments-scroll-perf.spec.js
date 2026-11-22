// Comments in the margin must keep up with the page.
//
// Reported: scrolling with a comment active lags (the leader line to its
// anchor trails), and the comments panel feels slow. This is the harness for
// that: 60 comments across real words of the report, the margin open, one
// thread in hand (so the leader line is drawn), the report scrolled in steps.
// It times what the cards cost on each scrolled frame (hubMarginLayout PLUS
// the style/layout it leaves dirty - a write that forces layout later shows
// up here, not in the function's own time), the page's frames, and a click on
// a card (hubCommentFocus -> hubCommentsRender -> layout).
//
// The budgets are deliberately loose (CI machines are slow and noisy); the
// numbers themselves are printed, which is what a change to this is judged
// on. Hub comments only exist on the hub, so the store is stood in for here:
// docStoreBase points at a path the spec answers itself.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const N = Number(process.env.CMT_PERF_N || 60);

async function openMargin(page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await gotoEditor(page);
  const comments = await page.evaluate(n => {
    const d = document.getElementById('out').contentDocument;
    // Real words: slots with a run of text, taken at even spacing down the report.
    const hosts = [...d.querySelectorAll('[data-slot]')].filter(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return t.length >= 30 && el.getBoundingClientRect().height > 8;
    });
    const step = Math.max(1, Math.floor(hosts.length / n));
    const out = [];
    // Round after round over the hosts (the end of the words on a second pass), until there are n.
    for (let k = 0; out.length < n && k < hosts.length * 3; k++) {
      const el = hosts[(k * step) % hosts.length], pass = Math.floor((k * step) / hosts.length);
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      const quote = pass % 2 ? t.slice(-20) : t.slice(0, 24);
      if (out.some(c => c.anchor === el.getAttribute('data-slot') && c.quote === quote)) continue;
      out.push({
        id: 'perf-' + out.length, anchor: el.getAttribute('data-slot'), quote,
        by: 'ada', at: '2026-11-01T10:00:00Z', text: 'Comment number ' + out.length + ' about these words.',
        replies: out.length % 3 === 0 ? [{ id: 'r' + out.length, by: 'bo', at: '2026-11-02T10:00:00Z', text: 'A reply.' }] : [],
        resolved: false,
      });
    }
    return out;
  }, N);
  expect(comments.length).toBeGreaterThan(Math.min(N, 20));
  // The hub's store, as far as the comments panel can tell.
  await page.route('**/api/docs/perf/comments', route => route.fulfill({ json: comments }));
  await page.route('**/api/docs/perf', route => route.fulfill({ json: {} }));
  await page.evaluate(() => {
    docStoreBase = '/api/docs/perf';
    $('comments').hidden = false;
    hubCommentsToggle(true, { load: false });
  });
  await page.evaluate(() => hubCommentsLoad());
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('#cpanel-list > .cmt').length)).toBeGreaterThan(Math.min(N, 20) - 1);
  // Margin mode needs the gutter; it is a wide window.
  expect(await page.evaluate(() => $('cpanel').classList.contains('margin'))).toBe(true);
  return comments;
}

/** Wrap hubMarginLayout / hubCommentsRender so every call is timed (the layout
 *  with the style and layout it leaves behind, forced by a read at its end). */
async function instrument(page) {
  await page.evaluate(() => {
    window.__perf = { layout: [], render: [], paint: [], frames: [], leaderWrites: 0 };
    const L = hubMarginLayout, R = hubCommentsRender, P = hubCommentsPaint;
    hubMarginLayout = function (...a) {
      const t0 = performance.now();
      const r = L.apply(this, a);
      // A layout that was not asked to glide must leave the cards unable to (the scrolled frame).
      if (!a[0] && document.getElementById('cpanel-list').classList.contains('anim')) window.__perf.glideOnScroll = (window.__perf.glideOnScroll || 0) + 1;
      void document.getElementById('cpanel').offsetHeight;     // pay for whatever the writes dirtied
      void document.getElementById('cmt-leader').getBoundingClientRect();
      window.__perf.layout.push(performance.now() - t0);
      return r;
    };
    hubCommentsRender = function (...a) {
      const t0 = performance.now();
      const r = R.apply(this, a);
      void document.getElementById('cpanel').offsetHeight;
      window.__perf.render.push(performance.now() - t0);
      return r;
    };
    hubCommentsPaint = function (...a) {
      const t0 = performance.now();
      const r = P.apply(this, a);
      window.__perf.paint.push(performance.now() - t0);
      return r;
    };
    // Long animation frames, where the browser has them.
    window.__perf.loaf = [];
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.loaf.push(e.duration); })
        .observe({ type: 'long-animation-frame', buffered: false });
    } catch (e) { /* not in this Chrome */ }
  });
}

/** Scroll the report from startY in 12px steps, one frame each; the frame intervals and how
 *  often the leader line was showing. Clears the layout timings first, so they are this scroll's. */
async function scrollSteps(page, startY) {
  return page.evaluate(async startY => {
    const w = document.getElementById('out').contentWindow;
    const se = w.document.scrollingElement;
    const max = se.scrollHeight - w.innerHeight;
    const frames = [], led = [];
    let y = startY;
    w.scrollTo(0, y);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__perf.layout.length = 0;
    let last = performance.now();
    const stepPx = 12;
    for (let i = 0; i < 160 && y < max; i++) {
      y = Math.min(max, y + stepPx);
      w.scrollTo(0, y);
      await new Promise(r => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last); last = now;
      const led1 = document.getElementById('cmt-leader');
      led.push(led1.hidden ? 0 : 1);
    }
    return { frames, ledShown: led.reduce((a, b) => a + b, 0), steps: frames.length };
  }, startY);
}

const stats = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const q = p => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
  return { n: s.length, mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +(s[s.length - 1] || 0).toFixed(2) };
};

test.describe('comments margin performance', () => {
  test('scrolling with a thread in hand', async ({ page }) => {
    test.setTimeout(120_000);
    const comments = await openMargin(page);
    await instrument(page);
    const mid = comments[Math.floor(comments.length / 2)].id;
    await page.evaluate(id => hubCommentFocus(id), mid);
    // Take the page to the thread's words, so the card in hand and its leader are on screen
    // (a click on a card does this itself; the smooth scroll it starts is not waited for here).
    const startY = await page.evaluate(id => {
      const w = $('out').contentWindow, c = hubComments.find(x => x.id === id);
      const r = hubCommentRanges.find(h => h.id === id).range.getBoundingClientRect();
      const y = Math.max(0, r.top + w.scrollY - 700);
      w.scrollTo({ top: y, behavior: 'instant' });
      return y;
    }, mid);
    await expect(page.locator('#cmt-leader')).toBeVisible();
    // Scroll the report in steps, a frame each; record the frame times.
    const res = await scrollSteps(page, startY);
    const perf = await page.evaluate(() => window.__perf);
    // The same scroll with the comments closed: what a frame costs on THIS machine with no
    // cards to place. A GitHub runner paces frames at 22-28ms on its own (the cards' layout
    // is 2-5ms of that), so a fixed budget on the frame failed on slow runners for every
    // branch; the frame is judged against this baseline instead.
    await page.evaluate(() => { hubCommentsToggle(false); });
    await expect(page.locator('#cmt-leader')).toBeHidden();
    const baseRes = await scrollSteps(page, startY);
    await page.evaluate(() => { hubCommentsToggle(true, { load: false }); });
    const out = { comments: comments.length, steps: res.steps, ledShown: res.ledShown,
      layout: stats(perf.layout), frame: stats(res.frames), baseFrame: stats(baseRes.frames), loaf: stats(perf.loaf || []) };
    console.log('SCROLL-PERF ' + JSON.stringify(out));
    expect(res.steps).toBeGreaterThan(30);
    expect(perf.layout.length).toBeGreaterThan(10);   // the layout ran on scrolled frames
    expect(out.layout.p95).toBeLessThan(8);            // ~1.5ms on a laptop; loose for CI
    // A frame with the cards may be slow only where the machine is slow too: it fails when it
    // is over 40ms AND more than 12ms over the same scroll without them (a card layout that
    // regressed by a frame's worth fails on any machine).
    if (out.frame.p95 >= 40) expect(out.frame.p95).toBeLessThan(out.baseFrame.p95 + 12);
    // The leader still points somewhere on the way.
    expect(res.ledShown).toBeGreaterThan(0);
    // ...and is moved by transform alone: no left/top/width to lay the page out for.
    const led = await page.evaluate(() => { const s = document.getElementById('cmt-leader').style; return { l: s.left, t: s.top, w: s.width, tf: s.transform }; });
    expect(led).toMatchObject({ l: '', t: '', w: '' });
    expect(led.tf).toContain('translate');
    // The glide class is never on for a scrolled frame, even when a card's height change asked
    // for one in the same frame (the ResizeObserver's request) - the scroll's wins.
    expect(perf.glideOnScroll || 0).toBe(0);
    const glided = await page.evaluate(async () => {
      hubMarginQueue(true); hubMarginQueue(false);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.getElementById('cpanel-list').classList.contains('anim');
    });
    expect(glided).toBe(false);
  });

  test('a card click and the panel render', async ({ page }) => {
    test.setTimeout(120_000);
    const comments = await openMargin(page);
    await instrument(page);
    const click = [], renders0 = () => page.evaluate(() => window.__perf.render.length);
    for (let i = 0; i < 12; i++) {
      const id = comments[(i * 5) % comments.length].id;
      const ms = await page.evaluate(async id => {
        const el = document.querySelector(`#cpanel-list > .cmt[data-id="${id}"]`);
        const t0 = performance.now();
        el.click();
        await new Promise(r => requestAnimationFrame(r));
        return performance.now() - t0;
      }, id);
      click.push(ms);
      expect(await page.evaluate(() => hubCommentActive)).toBe(id);
    }
    // A full render with nothing changed (what a poll that found nothing does).
    for (let i = 0; i < 10; i++) await page.evaluate(() => hubCommentsRender());
    const perf = await page.evaluate(() => window.__perf);
    const out = { comments: comments.length, click: stats(click), render: stats(perf.render), paint: stats(perf.paint), layout: stats(perf.layout) };
    console.log('CLICK-PERF ' + JSON.stringify(out));
    expect(await renders0()).toBeGreaterThan(5);
    // The typical render, not the near-maximum: with 22 samples the p95 is the second-slowest
    // one, which a slow runner put at 38-40ms on clean branches (p50 there: 11-17ms).
    expect(out.render.p50).toBeLessThan(25);
    expect(out.render.p95).toBeLessThan(60);
    expect(out.click.p95).toBeLessThan(120);
  });
});
