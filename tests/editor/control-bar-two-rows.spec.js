// The docked Control bar is TWO rows, --ctl-h (58px) tall: the same in every mode and with
// nothing selected, at every window width. It is laid out as InDesign's Control panel is:
// ALIGNED COLUMNS. Each column is a vertical pair, a primary field over a secondary one, the same
// width and left edge (font over style, size over leading, X over Y …); the columns are spread
// across the whole bar with a thin divider between them (ctlFit, CTL_COLS), so both rows end near
// the bar's right edge at every width. A window narrower than the columns scrolls the bar sideways
// as one piece: nothing wraps, grows or hides behind a menu. The nodes are laid in the columns, not
// copied, so a field there types, scrubs and answers a pilot verb exactly as it did in its strip.
// Pinned here: the height (equal across every mode); the pairs; that both rows reach the bar's right
// edge at 1280, 1397 and 1920 with no big hole between columns; that the bar covers neither ruler
// nor the rail (every control probed at its top edge, centre, sides and foot); that rulers, rail, dock
// and the comments/history panels start at the bar's foot (--ctl-bottom); that the canvas never moves
// when the selection changes; that a narrow window scrolls the bar rather than growing the page; that
// a field in the lower row works; that a pop-up from the bar opens whole, on top of the rulers; and
// that every control the bar can show has a place in CTL_COLS.
const { test, expect, gotoEditor, settled, barField } = require('./fixtures/editor-test');

async function addRect(page) {
  await page.evaluate(async () => {
    pushHistory();
    layout.shapes.push({ id: 'cb-rect', page: 3, kind: 'rect', x: 1, y: 1,
                         w: 2, h: 1, fill: '#6B9E78', stroke: 'none', sw: 0.02, z: 3 });
    markDirty();
    await render();
    setSel($('out').contentDocument, ['cb-rect']);
  });
  await settled(page);
}
async function addText(page) {
  return page.evaluate(async () =>
    (await docsync.api.addTextBox({ page: 3, x: 1, y: 6, w: 4, md: 'Words to set in the bar.' })).id);
}
async function pick(page, id) {
  await page.evaluate(i => setSel($('out').contentDocument, [i]), id);
  await settled(page);
}
const MODES = [['obj', 'rect'], ['frame', 'text'], ['char', 'text'], ['para', 'text']];
async function inMode(page, mode, ids) {
  await pick(page, mode === 'obj' ? ids.rect : ids.text);
  if (mode !== 'obj') await page.click(`#cb-mode [data-m="${mode}"]`);
  await settled(page);
}
const MODES_ALL = [...MODES, ['empty', null]];
async function inAnyMode(page, mode, ids) {
  if (mode === 'empty') { await page.evaluate(() => clearSel($('out').contentDocument)); await settled(page); }
  else await inMode(page, mode, ids);
}
const geometry = page => page.evaluate(() => {
  const bar = $('ctl').getBoundingClientRect();
  const top = id => $(id).getBoundingClientRect().top;
  // every control the bar draws, whole, inside the bar vertically (sideways the bar scrolls)
  const out = [...$('ctl').querySelectorAll('input, select, button, label')]
    .filter(e => e.offsetParent !== null && !e.closest('.pop') && !e.closest('#ctl-home'))
    .filter(e => { const b = e.getBoundingClientRect(); return b.bottom > bar.bottom + 1 || b.top < bar.top - 1; })
    .map(e => e.id || e.className);
  // the two cells of a column: the top one over the bottom one
  const cols = [...$('ctl-cols').children];
  const misfit = cols.filter(c => { const [t, b] = c.children; if (b.hidden) return false;
    const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.top < tr.bottom - 1; }).length;
  const misInfo = cols.map(c => [...c.children].map(x => { const r = x.getBoundingClientRect(); return [x.hidden, Math.round(r.top), Math.round(r.height)].join('/'); }).join(' ')).join(' | ');
  return { h: Math.round(bar.height), bottom: Math.round(bar.bottom), misfit, misInfo, cols: cols.length, out,
    dockTop: Math.round(top('dock-icons')), rulerT: Math.round(top('ruler-t')), rulerL: Math.round(top('ruler-l')),
    rail: Math.round(top('leftrail')), work: Math.round(top('work')),
    cssH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-h')),
    ctlBottom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-bottom')),
    pageW: document.documentElement.scrollWidth, winW: innerWidth, pageH: document.documentElement.scrollHeight, winH: innerHeight };
});
/** Which cell a control is in: 'top' or 'bot' (a control spanning both rows counts as top). */
const inRow = (page, id) => page.evaluate(i => { const c = $(i).closest('.ctl-cell'); return c ? (c.classList.contains('ctl-top') ? 'top' : 'bot') : null; }, id);

test.describe('control bar: two rows', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { if (!guidesOn) toggleGuides(); });      // the rulers
  });

  test('the same --ctl-h in every mode, and with nothing selected, from a phone to a wide window', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    const seen = new Set();
    for (const [w, h] of [[390, 780], [760, 800], [1280, 720], [1920, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [mode] of MODES_ALL) {
        await inAnyMode(page, mode, ids);
        const g = await geometry(page);
        seen.add(g.h);
        expect(g.h, `${w} ${mode}`).toBe(g.cssH);
        expect(g.cssH, `${w} ${mode} --ctl-h`).toBe(58);
        expect(g.misfit, `${w} ${mode}: a column whose cells are not one over the other: ${g.misInfo}`).toBe(0);
        expect(g.out, `${w} ${mode}`).toEqual([]);
        expect(g.pageW, `${w} ${mode}: the page grew sideways`).toBeLessThanOrEqual(g.winW);
        expect(g.pageH, `${w} ${mode}: the page grew taller`).toBeLessThanOrEqual(g.winH);
        expect(await page.evaluate(() => $('ctl').scrollWidth <= $('ctl').clientWidth + 1), `${w} ${mode}: the bar itself scrolls`).toBe(true);
        expect(await page.evaluate(() => $('ctl').scrollHeight <= $('ctl').clientHeight + 1), `${w} ${mode}: the bar overflows downward`).toBe(true);
      }
    }
    expect([...seen]).toEqual([58]);
  });

  test('compact: 58px, pills about 24px, text never under 12px, every control a 24px target', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const [mode] of MODES_ALL) {
      await inAnyMode(page, mode, ids);
      const r = await page.evaluate(() => {
        const bad = [], big = [];
        document.querySelectorAll('#ctl .ctl-cell > *').forEach(c => {
          if (getComputedStyle(c).display === 'none' || c.id === 'cb-empty') return;
          const b = c.getBoundingClientRect();
          if (b.height < 7) return;
          if (b.height > 27 && !c.matches('.cb-refgrid, .cb-grp')) big.push((c.id || c.className) + ':' + Math.round(b.height));
          // a click target: at least 24px tall, but for the reference grid, the P flag and the read-only chips
          if (!c.matches('.cb-refgrid, #cb-pflag, .ty-key, .ar-count') && b.height < 23.5) bad.push((c.id || c.className) + ' ' + Math.round(b.height) + 'px tall');
        });
        const small = [...document.querySelectorAll('#ctl .ctl-cell input, #ctl .ctl-cell select, #ctl .ctl-cell label, #ctl .ctl-cell button')]
          .filter(e => e.offsetParent !== null && !e.closest('.pop') && e.textContent.trim() + (e.value || '') !== '' && parseFloat(getComputedStyle(e).fontSize) < 12)
          .map(e => (e.id || e.className) + ' ' + getComputedStyle(e).fontSize);
        return { bad, big, small, h: Math.round($('ctl').getBoundingClientRect().height) };
      });
      expect(r.h, mode).toBe(58);
      expect(r.bad, `${mode}: controls under 24px`).toEqual([]);
      expect(r.big, `${mode}: controls over 27px`).toEqual([]);
      expect(r.small, `${mode}: text under 12px`).toEqual([]);
    }
  });

  test('each column is a pair: a primary field over a secondary one, the same width and left edge', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const pairs = {
      obj:   [['cb-x', 'cb-y'], ['cb-w', 'cb-h'], ['cb-sx', 'cb-sy'], ['cb-rot', 'cb-skew'], ['ar-fill', 'ar-border'], ['ar-alpha', 'ar-fxbtn'], ['ar-dup', 'ar-del']],
      frame: [['cb-x', 'cb-y'], ['cb-w', 'cb-h'], ['cb-sx', 'cb-sy'], ['cb-rot', 'cb-skew']],
      char:  [['ty-font', 'ty-weight'], ['cb-size', 'cb-lead'], ['cb-kern', 'cb-track'], ['cb-shift', 'cb-smcp'], ['ty-colorbtn', 'ty-spacebtn']],
      para:  [['cb-il', 'cb-ti'], ['cb-ir', 'cb-dcap'], ['cb-sb', 'cb-sa'], ['ty-alseg', 'cb-lmark']],
    };
    for (const [mode] of MODES) {
      await inMode(page, mode, ids);
      for (const [a, b] of pairs[mode]) {
        const g = await page.evaluate(([x, y]) => {
          const box = id => { const e = $(id); return (e.closest('.ty-step') || e.closest('label') || e).getBoundingClientRect(); };
          const A = box(x), B = box(y), ca = $(x).closest('.ctl-col'), cb = $(y).closest('.ctl-col');
          return { same: ca === cb, dl: Math.abs(A.left - B.left), above: A.bottom <= B.top + 1, w: [Math.round(A.width), Math.round(B.width)],
            field: $(x).matches('input, select') || !!$(x).closest('label') };
        }, [a, b]);
        expect(g.same, `${mode}: ${a} and ${b} share a column`).toBe(true);
        expect(g.above, `${mode}: ${a} over ${b}`).toBe(true);
        expect(g.dl, `${mode}: ${a} and ${b} share a left edge`).toBeLessThanOrEqual(1);
        // two fields of a pair are one width (a button cluster keeps its own)
        if (g.field && !['ar-alpha', 'ar-fxbtn', 'ar-dup', 'ar-del', 'ar-fill', 'ar-border', 'ty-colorbtn', 'ty-spacebtn'].includes(a))
          expect(Math.abs(g.w[0] - g.w[1]), `${mode}: ${a} ${g.w[0]}px, ${b} ${g.w[1]}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('both rows reach the edge of the bar\'s content area and the columns leave no big hole, at 1280, 1397 and 1920', async ({ page }) => {
    // The content area is at most 1500px and centred (control-bar-capped.spec.js); inside it the two rows
    // still run to its right edge, so this is measured against the area, not the window.
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const [w, h] of [[1280, 720], [1397, 719], [1920, 1000]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [mode] of MODES) {
        await inMode(page, mode, ids);
        const r = await page.evaluate(() => {
          const cs = [...$('ctl-cols').children].map(c => c.getBoundingClientRect()), out = { gap: 0 };
          const areaR = cs[cs.length - 1].right;
          for (const cls of ['ctl-top', 'ctl-bot']) {
            let m = 0;
            document.querySelectorAll('#ctl-cols .' + cls + ' > *').forEach(e => { if (e.offsetParent !== null) m = Math.max(m, e.getBoundingClientRect().right); });
            out[cls] = Math.round(areaR - m);
          }
          // the spaces between one column's right edge and the next one's left edge
          cs.forEach((c, i) => { if (i) out.gap = Math.max(out.gap, Math.round(c.left - cs[i - 1].right)); });
          out.scroll = $('ctl-cols').scrollWidth - $('ctl-cols').clientWidth;
          return out;
        });
        expect(r['ctl-top'], `${w} ${mode}: the top row ends ${r['ctl-top']}px short of the content area's edge`).toBeLessThanOrEqual(40);
        expect(r['ctl-bot'], `${w} ${mode}: the bottom row ends ${r['ctl-bot']}px short of the content area's edge`).toBeLessThanOrEqual(40);
        expect(r['ctl-top'], `${w} ${mode}: the top row runs off the area`).toBeGreaterThanOrEqual(0);
        expect(r.gap, `${w} ${mode}: a ${r.gap}px hole between two columns`).toBeLessThanOrEqual(110);
        expect(r.scroll, `${w} ${mode}: scrolls at a window this wide`).toBeLessThanOrEqual(0);
        expect((await geometry(page)).h, `${w} ${mode}`).toBe(58);
      }
    }
  });

  test('nothing selected shows one centred hint, and a page shows its columns centred', async ({ page }) => {
    for (const w of [1280, 1920]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.evaluate(() => clearSel($('out').contentDocument));
      await settled(page);
      const hint = await page.evaluate(() => { const b = $('cb-empty').getBoundingClientRect(), bar = $('ctl').getBoundingClientRect();
        return { mode: $('ctl').dataset.mode, hidden: $('cb-empty').hidden, arr: $('arrange').hidden, sel: selPage + '/' + selIds.size, parent: $('cb-empty').parentNode.className, visible: b.width > 0, left: b.left, right: bar.right - b.right, mid: (b.left + b.right) / 2, barMid: bar.width / 2 }; });
      expect(hint.visible, JSON.stringify(hint)).toBe(true);
      expect(Math.abs(hint.mid - hint.barMid), `${w}: the hint is centred`).toBeLessThanOrEqual(2);
      expect((await geometry(page)).h).toBe(58);
      await page.evaluate(() => setSelPage($('out').contentDocument, 3));
      await settled(page);
      const cols = await page.evaluate(() => { const c = [...$('ctl-cols').children].map(e => e.getBoundingClientRect()), bar = $('ctl').getBoundingClientRect();
        return { l: c[0].left, r: bar.right - c[c.length - 1].right }; });
      expect(Math.abs(cols.l - cols.r), `${w}: the page's columns are centred`).toBeLessThanOrEqual(8);
    }
  });

  test('the bar covers neither ruler nor the rail: every control probed at its edge, centre, sides and foot', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const [w, h] of [[760, 720], [1280, 720], [1440, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [mode] of MODES_ALL) {
        await inAnyMode(page, mode, ids);
        const g = await geometry(page);
        // the page's furniture starts exactly where the bar ends: nothing under it, no gap over it
        expect(g.work, `${w} ${mode} canvas`).toBe(g.bottom);
        expect(g.rail, `${w} ${mode} rail`).toBe(g.bottom);
        expect(g.rulerT, `${w} ${mode} top ruler`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.rulerL, `${w} ${mode} left ruler`).toBeGreaterThanOrEqual(g.bottom - 1);
        expect(g.dockTop, `${w} ${mode} dock`).toBeGreaterThanOrEqual(g.bottom - 1);
        // each control the bar draws answers a press at five points of itself: nothing covers it,
        // and it covers nothing (the probe is the topmost element there)
        const blocked = await page.evaluate(() => {
          const bad = [];
          document.querySelectorAll('#ctl .ctl-cell > *').forEach(el => {
            const cs = getComputedStyle(el); if (cs.display === 'none') return;
            const b = el.getBoundingClientRect(), row = $('ctl-cols').getBoundingClientRect();
            if (b.width < 4 || b.height < 4) return;
            for (const [fx, fy] of [[0.5, 0.08], [0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.92]]) {
              const x = b.left + b.width * fx, y = b.top + b.height * fy;
              // scrolled out of the bar (or on its very edge, where a bar that scrolls cuts a control: a
              // point on the window's last pixel answers null): not drawn
              if (x < row.left + 1 || x > row.right - 1) continue;
              const hit = document.elementFromPoint(x, y);
              if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) { bad.push(`${el.id || el.className} (${fx},${fy}) under ${hit && (hit.id || hit.className)}`); break; }
            }
          });
          // and the other way: the rulers and the rail are never what answers a press on the bar
          for (const id of ['ruler-t', 'ruler-l', 'ruler-c', 'leftrail']) {
            const e = $(id); if (!e || e.hidden || e.offsetParent === null) continue;
            const b = e.getBoundingClientRect(), c = $('ctl').getBoundingClientRect();
            if (b.top < c.bottom - 1 && b.bottom > c.top + 1) bad.push(id + ' overlaps the bar');
          }
          return bad;
        });
        expect(blocked, `${w}x${h} ${mode}`).toEqual([]);
      }
    }
  });

  test('rulers, rail, dock and the comments and history panels all start at --ctl-bottom', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    await page.evaluate(() => { const c = $('cpanel'), h = $('hpanel'); c.hidden = false; h.hidden = false; });
    const at = () => page.evaluate(() => {
      const top = id => Math.round($(id).getBoundingClientRect().top);
      return { bottom: Math.round($('ctl').getBoundingClientRect().bottom), v: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ctl-bottom')),
        c: top('cpanel'), h: top('hpanel'), rail: top('leftrail'), work: top('work') };
    });
    let g = await at();
    expect(g.v).toBe(g.bottom);
    expect(g.c).toBe(g.bottom);
    expect(g.h).toBe(g.bottom);
    expect(g.rail).toBe(g.bottom);
    expect(g.work).toBe(g.bottom);
    // the bar off: everything follows it up, to the menu bar's foot
    await page.evaluate(() => toggleCtlBar(false));
    await settled(page);
    g = await at();
    const barFoot = await page.evaluate(() => Math.round($('bar').getBoundingClientRect().bottom));
    expect(g.v).toBe(barFoot);
    expect(g.c).toBe(barFoot);
    expect(g.h).toBe(barFoot);
    expect(g.rail).toBe(barFoot);
    await page.evaluate(() => toggleCtlBar(true));
    await settled(page);
    g = await at();
    expect(g.c).toBe(g.bottom);
    expect(g.rail).toBe(g.bottom);
  });

  test('changing what is selected never moves the canvas or changes the bar', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    for (const w of [390, 900, 1280]) {
      await page.setViewportSize({ width: w, height: 800 });
      const seen = [];
      for (const [mode] of [...MODES, ['obj', 'rect'], ['empty', null]]) {
        await inAnyMode(page, mode, ids);
        const g = await geometry(page);
        seen.push([g.h, g.bottom, g.work, g.rulerT, g.rulerL, g.rail].join());
      }
      expect(new Set(seen).size, `${w}: ${seen.join(' | ')}`).toBe(1);
    }
  });

  test('a narrow window scrolls the bar inside itself, and the page does not grow', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    await page.setViewportSize({ width: 390, height: 780 });
    for (const [mode] of MODES) {
      await inMode(page, mode, ids);
      const r = await page.evaluate(() => { const e = $('ctl-cols');
        return { over: e.scrollWidth > e.clientWidth + 1, overflowX: getComputedStyle(e).overflowX, h: Math.round($('ctl').getBoundingClientRect().height),
          // no two columns draw over one another, however narrow the window
          overlap: [...e.children].some((c, i, a) => i && c.getBoundingClientRect().left < a[i - 1].getBoundingClientRect().right - 1) }; });
      expect(r.overflowX).toBe('auto');
      expect(r.over, `${mode}: something to scroll to at 390px`).toBe(true);
      expect(r.overlap, `${mode}: overlapping columns`).toBe(false);
      const g = await geometry(page);
      expect(g.h).toBe(58);
      expect(g.pageW).toBeLessThanOrEqual(g.winW);
    }
    // the bar scrolls with the pointer's wheel, and says so by shading its edge
    await inMode(page, 'char', ids);
    const bar = page.locator('#ctl-cols');
    await bar.evaluate(e => { e.scrollLeft = 120; e.dispatchEvent(new Event('scroll')); });
    await expect(bar).toHaveClass(/ctl-fade-l/);
    await expect(bar).toHaveClass(/ctl-fade-r/);
    expect((await geometry(page)).h).toBe(58);
    // a control that was scrolled out of sight is reachable: it scrolls into view and answers
    const kern = await barField(page, '#cb-kern');
    await kern.fill('25');
    await kern.press('Enter');
    await settled(page);
    expect(await page.evaluate(() => $('ctl').scrollTop)).toBe(0);
  });

  test('a field in the lower row works as it did in its strip: type, Enter, undo', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    expect(await inRow(page, 'cb-r')).toBe('top');
    expect(await inRow(page, 'cb-skew')).toBe('bot');
    const f = await barField(page, '#cb-skew');
    await expect(f).toBeVisible();
    const steps = await page.evaluate(() => past.length);
    await f.fill('20');
    await f.press('Enter');
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew)).toBe(20);
    expect(await page.evaluate(() => past.length)).toBe(steps + 1);
    await expect(f).toHaveValue('20');                                         // ctlPaint reads it back
    await page.evaluate(() => undo());
    await expect.poll(() => page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew || 0)).toBe(0);
    // and a lower-row colour button opens its panel
    await page.click('#ar-border');
    await expect(page.locator('#ar-borderpop')).toBeVisible();
  });

  test('a number scrubs from its icon, and names itself on hover', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    await barField(page, '#cb-skew');
    const lab = page.locator('#cb-skew').locator('xpath=..');
    await lab.hover({ position: { x: 4, y: 8 } });
    await expect(page.locator('#tt')).toBeVisible();
    await expect(page.locator('#tt')).toContainText('Shear');
    const box = await lab.boundingBox();
    const x0 = box.x + 4, y0 = box.y + box.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 40, y0, { steps: 6 });
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(() => layout.shapes.find(s => s.id === 'cb-rect').skew || 0)).not.toBe(0);
  });

  test('a pop-up from either row of the bar opens whole, below its button, on top of the rulers, inside the window', async ({ page }) => {
    const id = await addText(page);
    await pick(page, id);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.click('#cb-mode [data-m="char"]');
    await settled(page);
    // the bar must never mask, filter or transform what it holds: the pop-ups its controls open are its
    // fixed-position descendants, and any of these cuts them off from the pointer (the character-style
    // pop of B / I / U did exactly that under a mask)
    expect(await page.evaluate(() => ['ctl', 'ctl-cols'].map(i => { const c = getComputedStyle($(i));
      return [c.maskImage, c.webkitMaskImage, c.filter, c.transform, c.clipPath, c.contain].join('|'); })))
      .toEqual(Array(2).fill('none|none|none|none|none|none'));
    for (const [btn, pop] of [['#ty-colorbtn', '#ty-colorpop'], ['#ty-spacebtn', '#ty-spacepop'], ['#ty-style-more', '#ty-stylepop']]) {
      const opener = await barField(page, btn);
      await opener.click();
      await expect(page.locator(pop)).toBeVisible();
      const r = await page.evaluate(([b, p]) => {
        const pr = $(p.slice(1)).getBoundingClientRect(), br = $(b.slice(1)).getBoundingClientRect();
        // the pop-up's own top-left and centre answer a press: no ruler, rail or bar row is over it
        const probe = [[pr.left + 4, pr.top + 4], [pr.left + pr.width / 2, pr.top + 20]].map(([x, y]) => {
          const hit = document.elementFromPoint(x, y); return !!hit && $(p.slice(1)).contains(hit); });
        return { top: pr.top, btnBottom: br.bottom, left: pr.left, right: pr.right, bottom: pr.bottom, w: innerWidth, h: innerHeight, probe };
      }, [btn, pop]);
      expect(r.top, pop).toBeGreaterThanOrEqual(r.btnBottom);
      expect(r.left, pop).toBeGreaterThanOrEqual(0);
      expect(r.right, pop).toBeLessThanOrEqual(r.w);
      expect(r.bottom, pop).toBeLessThanOrEqual(r.h);
      expect(r.probe, `${pop} is under something`).toEqual([true, true]);
      await page.keyboard.press('Escape');
      await expect(page.locator(pop)).toBeHidden();
    }
  });

  test('every control the bar can show has a place in CTL_ROWS', async ({ page }) => {
    const ids = { rect: null, text: null };
    await addRect(page); ids.rect = 'cb-rect'; ids.text = await addText(page);
    const unplaced = [];
    for (const [mode] of MODES_ALL) {
      await inAnyMode(page, mode, ids);
      unplaced.push(...await page.evaluate(m => {
        // a control no list names lands in a last column of its own, whatever it is: say which
        return ctlU.filter(u => {
          const ctlMode = $('ctl').dataset.mode;
          const here = getComputedStyle(u.el).display !== 'none'
            && [...(function* () { for (let a = u.ph.parentNode; a && a.id !== 'ctl'; a = a.parentNode) yield a; })()]
              .every(a => getComputedStyle(a).display !== 'none');
          return here && u.at[ctlMode][0] === 999;
        }).map(u => `${m}: ${u.el.id || u.el.className}`);
      }, mode));
    }
    expect(unplaced).toEqual([]);
  });

  test('a page selected has its own columns, and the same height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => { setSelPage($('out').contentDocument, 3); });
    await settled(page);
    const g = await geometry(page);
    expect(g.h).toBe(58);
    expect(g.out).toEqual([]);
    expect(await inRow(page, 'ar-pagelabel')).toBe('top');
    expect(await inRow(page, 'ar-fill')).toBe('bot');
  });

  test('the bar turned off puts every control back in its strip, and on again lays the columns out', async ({ page }) => {
    await addRect(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settled(page);
    const laid = () => page.evaluate(() => [...document.querySelectorAll('#ctl-cols .ctl-cell > *')].filter(c => c.__cu).length);
    expect(await laid()).toBeGreaterThan(0);
    await page.evaluate(() => toggleCtlBar(false));
    expect(await laid()).toBe(0);
    await page.evaluate(() => toggleCtlBar(true));
    await settled(page);
    expect(await laid()).toBeGreaterThan(0);
    expect((await geometry(page)).h).toBe(58);
  });
});
