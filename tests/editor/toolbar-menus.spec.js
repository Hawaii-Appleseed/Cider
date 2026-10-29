// The top bar fits a laptop window (Devin, 2026-10-28). On the hub it held 23
// controls in a row that never wraps: exactly full at 1440px, 80px past a
// 1280px window and 260px past 1100px, so seven tools were off-screen with no
// scrollbar to say so. The tools you open now and then went into View ▾ and
// Check ▾ (same ids, same handlers), the print warning became Check's first
// row and its badge, the zoom slider went behind a "100% ▾", the idle status
// sentence became "● Live", and Share came back to the bar. Local mode, with
// the hub's own controls switched on where the test is about the hub's width.
const { warmTest: test, expect, gotoEditor } = require('./fixtures/editor-test');

/** What docStoreDecide() and the room show on the hub, on top of local's set. */
const asHub = page => page.evaluate(() => {
  for (const id of ['mode', 'comments', 'history', 'share', 'publish']) {
    $(id).hidden = false; $(id).disabled = false;
  }
  $('push').hidden = true;
  const c = $('collab');
  c.hidden = false; c.className = 'live';
  c.innerHTML = '<i style="background:#6B5CA5">DT</i><i style="background:#C2703A">KL</i>'
              + '<i style="background:#2E7D4F">MN</i>';
});

/** Bar controls whose right edge is past the window — off-screen, unreachable. */
const offScreen = page => page.evaluate(() => {
  const bar = $('bar'), w = bar.clientWidth;
  return [...bar.children].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && !el.classList.contains('pop') && r.right > w + 0.5;
  }).map(el => el.id || el.className);
});

test.describe('the top bar', () => {
  test('nothing on the hub bar is off-screen in a 1100px window', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 760 });
    await gotoEditor(page);
    await asHub(page);
    expect(await offScreen(page)).toEqual([]);
    expect(await page.evaluate(() => $('bar').scrollWidth <= $('bar').clientWidth)).toBe(true);
    await expect(page.locator('#history')).toHaveText('Versions');
    // Share is a bar button again, not a File menu row.
    await expect(page.locator('#bar > #share')).toBeVisible();
    await expect(page.locator('#filepop #share')).toHaveCount(0);
  });

  test('View and Check hold the tools, and each opens its panel under its menu', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#view');
    for (const id of ['guides', 'hiddenchars', 'layers', 'steps', 'present', 'reload'])
      await expect(page.locator(`#viewpop #${id}`)).toBeVisible();
    await page.click('#layers');
    await expect(page.locator('#viewpop')).toBeHidden();
    await expect(page.locator('#layerspop')).toBeVisible();
    const under = (pop, btn) => page.evaluate(([p, b]) => {
      const pr = $(p).getBoundingClientRect(), br = $(b).getBoundingClientRect();
      return { dx: Math.abs(pr.left - br.left), dy: Math.abs(pr.top - (br.bottom + 6)) };
    }, [pop, btn]);
    // A hidden row measures 0,0: before togglePop looked past it to the menu's
    // button, the panel landed over the bar's top-left corner.
    let g = await under('layerspop', 'view');
    expect(g.dx).toBeLessThan(2);
    expect(g.dy).toBeLessThan(2);

    await page.click('#check');
    await expect(page.locator('#layerspop')).toBeHidden();
    for (const id of ['preflight', 'hyperlinks', 'links', 'colours', 'notes'])
      await expect(page.locator(`#checkpop #${id}`)).toBeVisible();
    await page.click('#preflight');
    await expect(page.locator('#preflightpop')).toBeVisible();
    g = await under('preflightpop', 'check');
    expect(g.dx).toBeLessThan(2);
    expect(g.dy).toBeLessThan(2);
  });

  test('a switch in View ticks and closes the menu', async ({ page }) => {
    await gotoEditor(page);
    const was = await page.evaluate(() => guidesOn);
    await page.click('#view');
    await page.click('#guides');
    await expect(page.locator('#viewpop')).toBeHidden();
    expect(await page.evaluate(() => guidesOn)).toBe(!was);
    await page.click('#view');
    await expect(page.locator('#guides')).toBeVisible();
    const ticked = await page.locator('#guides').evaluate(el => el.classList.contains('on'));
    expect(ticked).toBe(!was);
  });

  test('the print warning is Check\'s first row and its badge; a click goes to it', async ({ page }) => {
    await gotoEditor(page);
    const id = 'toc.logo';
    // Scaled past the right edge: the case fit-edges.spec.js makes.
    await page.evaluate(async id => {
      pushHistory();
      layout.positions[id] = { x: 6, y: 1, w: 2, scale: 2 };
      markDirty(); await render();
    }, id);
    await expect(page.locator('#check-count')).toBeVisible();
    await expect(page.locator('#check-count')).not.toHaveText('');
    await page.click('#check');
    await expect(page.locator('#fit')).toBeVisible();
    await expect(page.locator('#fit')).toHaveText(/cut in print/);
    await page.click('#fit');
    await expect(page.locator('#checkpop')).toBeHidden();
    await expect.poll(() => page.evaluate(() => [...selIds])).toEqual([id]);
  });

  test('the idle status reads "Live", with the sentence kept for hover and screen readers', async ({ page }) => {
    await gotoEditor(page);
    const idle = await page.evaluate(() => IDLE_STAT);
    await expect(page.locator('#stat')).toHaveText(idle);
    const look = () => page.evaluate(() => {
      const s = $('stat');
      return { cls: s.classList.contains('live-idle'), tip: s.dataset.tip || null,
               size: getComputedStyle(s).fontSize, after: getComputedStyle(s, '::after').content };
    });
    expect(await look()).toEqual({ cls: true, tip: idle, size: '0px', after: '"Live"' });
    // Any other message is said in full.
    await page.evaluate(() => { $('stat').textContent = 'page 3 copied'; });
    const busy = await look();
    expect(busy.cls).toBe(false);
    expect(busy.tip).toBe(null);
    expect(busy.size).not.toBe('0px');
  });

  test('zoom: the bar shows the scale, a size sets it, and − / + keep the menu open', async ({ page }) => {
    await gotoEditor(page);
    await page.click('#zoombtn');
    await page.click('#zoompop [data-zset="1.5"]');
    await expect(page.locator('#zoompop')).toBeHidden();
    expect(await page.evaluate(() => curScale)).toBeCloseTo(1.5, 3);
    await expect(page.locator('#zoombtn')).toContainText('150%');
    await page.click('#zoombtn');
    await expect(page.locator('#zoompop [data-zset="1.5"]')).toHaveClass(/\bon\b/);
    await page.click('#zb-out');
    await expect(page.locator('#zoompop')).toBeVisible();
    expect(await page.evaluate(() => curScale)).toBeLessThan(1.5);
    await expect(page.locator('#zoombtn')).toContainText('125%');
  });
});
