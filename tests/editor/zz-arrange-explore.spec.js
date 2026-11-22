// EXPLORATORY (not for commit): fuzz the arrange operations on real reports
// and print every invariant that breaks.
//   ARR_REPORTS=a,b  ARR_OPS=40  ARR_SEED=7
const { warmTest: test, gotoEditor } = require('./fixtures/editor-test');

const REPORTS = (process.env.ARR_REPORTS
  || 'uhero-trc-summary,tfc-2027-priorities,retitc,our-mission,staff-toolkit,demo-report,rxkids,dotax-itep,itep-act24-estimate,budget-primer')
  .split(',');
const OPS = +(process.env.ARR_OPS || 30);
const SEED = +(process.env.ARR_SEED || 7);

for (const rep of REPORTS) {
  test(`arrange fuzz: ${rep}`, async ({ page }) => {
    test.setTimeout(900_000);
    await gotoEditor(page, `?project=${rep}`);
    const out = await page.evaluate(async ([OPS, SEED]) => {
      let s = SEED >>> 0;
      const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const pick = a => a[Math.floor(rnd() * a.length)];
      const D = () => document.getElementById('out').contentDocument;
      const pagesOf = () => [...D().querySelectorAll('section.page')];
      const elOf = id => D().querySelector(`[data-el="${CSS.escape(id)}"], [data-shape="${CSS.escape(id)}"]`);
      const r3 = v => Math.round(v * 1000) / 1000;
      const boxOf_ = id => {
        const el = elOf(id); if (!el) return null;
        const pg = el.closest('section.page'); if (!pg) return null;
        const sh = el.dataset.shape ? shapeOf(id) : null;
        const b = sh && +sh.w > 0 && +sh.h > 0 ? { x: +sh.x, y: +sh.y, w: +sh.w, h: +sh.h } : inchBox(el, pg);
        return { x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h), pg: pagesOf().indexOf(pg) };
      };
      // What a click would take: wired objects (own objects or top level),
      // visible, not locked/hidden/grouped/endnotes/chevrons/master items.
      const objects = () => [...D().querySelectorAll('[data-el], [data-shape]')].filter(el => {
        if (el.classList.contains('ds-tgl-svg') || el.classList.contains('ds-part')) return false;
        if (!el.dataset.shape && !ownObject(el) && el.parentElement && el.parentElement.closest('[data-el]')) return false;
        const id = idOf(el);
        if (!id || id.startsWith('endnote.') || isLocked(id) || isHidden(id) || groupOf(id)) return false;
        if (typeof masterItemOf === 'function' && masterItemOf(id)) return false;
        const pg = el.closest('section.page'); if (!pg) return false;
        const b = inchBox(el, pg);
        return b.w > 0.05 && b.h > 0.05;
      });
      const snapshot = () => Object.fromEntries(objects().map(el => [idOf(el), boxOf_(idOf(el))]));
      const near = (a, b, tol = 0.025) => Math.abs(a - b) <= tol;
      const moved = (a, b, tol = 0.025) => !a || !b || a.pg !== b.pg || !near(a.x, b.x, tol)
        || !near(a.y, b.y, tol) || !near(a.w, b.w, tol) || !near(a.h, b.h, tol);
      const fmt = b => b ? `${b.x},${b.y} ${b.w}x${b.h} p${b.pg}` : 'gone';
      const anomalies = [];
      const note = (op, kind, detail) => anomalies.push({ op, kind, detail });

      const containedIn = (id, ids) => ids.some(o => o !== id && elOf(o) && elOf(id) && elOf(o).contains(elOf(id)));

      const placedBox = id => {
        const el = elOf(id); if (!el) return null;
        const pg = el.closest('section.page'); if (!pg) return null;
        const sh = el.dataset.shape ? shapeOf(id) : null;
        const b = sh && +sh.w > 0 && +sh.h > 0 ? { x: +sh.x, y: +sh.y, w: +sh.w, h: +sh.h } : placer(D(), el, pg).box;
        return { x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h), pg: pagesOf().indexOf(pg) };
      };
      const textTop = id => {
        const el = elOf(id); if (!el) return null;
        if (el.dataset.shape) { const q = boxOf_(id); return q && { x: q.x, y: q.y }; }
        const t = el.querySelector('[data-slot]') || el;
        const pg = el.closest('section.page'); const b = inchBox(t, pg);
        return { x: r3(b.x), y: r3(b.y) };
      };
      async function run(label, ids, act, expect, textDelta) {
        const S0 = snapshot();
        const sel0 = ids.map(placedBox);
        if (sel0.some(b => !b)) return;
        const T0 = ids.map(textTop);
        setSel(D(), ids);
        await act();
        const L = snapshot();
        await render();
        await new Promise(r => setTimeout(r, 60));
        const R = snapshot();
        for (const id of Object.keys(R)) {
          if (JITTER.has(id)) continue;
          if (L[id] && moved(L[id], R[id])) note(label, 'jump after render', `${id}: live ${fmt(L[id])} -> rendered ${fmt(R[id])}`);
        }
        for (const id of Object.keys(S0)) {
          if (JITTER.has(id) || ids.includes(id) || containedIn(id, ids)) continue;
          if (moved(S0[id], R[id])) note(label, 'bystander moved', `${id}: ${fmt(S0[id])} -> ${fmt(R[id])}`);
        }
        if (textDelta) {
          ids.forEach((id, i) => {
            const t1 = textTop(id), t0 = T0[i], b0 = sel0[i];
            if (!t1 || !t0 || !R[id]) return;
            const [dx, dy] = textDelta(b0, R[id]);
            if (!near(t1.x - t0.x, dx, 0.02) || !near(t1.y - t0.y, dy, 0.02))
              note(label, 'words moved wrong', `${id}: words moved ${r3(t1.x - t0.x)},${r3(t1.y - t0.y)}, box moved ${dx},${dy}`);
          });
        }
        if (expect) {
          const msg = expect(ids.map(i => R[i]), sel0);
          if (msg) note(label, 'wrong result', msg + ` | before ${sel0.map(fmt).join(' ; ')} | after ${ids.map(i => fmt(R[i])).join(' ; ')}`);
        }
        await undo();
        await render();
        await new Promise(r => setTimeout(r, 60));
        const U = snapshot();
        for (const id of Object.keys(S0)) {
          if (JITTER.has(id)) continue;
          if (moved(S0[id], U[id], 0.015)) note(label, 'undo did not restore', `${id}: ${fmt(S0[id])} -> ${fmt(U[id])}`);
        }
        clearSel(D());
      }

      const W = PAGE_W_IN, H = PAGE_H_IN;
      const fits = b => b.w <= W - 0.001 && b.h <= H - 0.001;
      const alignExpect = (mode, single) => (after, before) => {
        if (after.some(a => !a)) return 'an element vanished';
        for (let i = 0; i < after.length; i++)
          if (!near(after[i].w, before[i].w) || !near(after[i].h, before[i].h))
            return `size changed: ${fmt(before[i])} -> ${fmt(after[i])}`;
        if (!before.every(fits)) return null;
        let ref;
        if (single) {
          ref = { x: MARGIN_IN, y: TOP_IN, w: W - 2 * MARGIN_IN, h: H - TOP_IN - 0.9 };
          if (mode === 'hcenter') { ref.x = 0; ref.w = W; }
          if (mode === 'vcenter') { ref.y = 0; ref.h = H; }
        } else {
          const x1 = Math.min(...before.map(b => b.x)), y1 = Math.min(...before.map(b => b.y));
          const x2 = Math.max(...before.map(b => b.x + b.w)), y2 = Math.max(...before.map(b => b.y + b.h));
          ref = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
        for (const a of after) {
          let want = null, got = null;
          if (mode === 'left') { want = ref.x; got = a.x; }
          if (mode === 'right') { want = ref.x + ref.w; got = a.x + a.w; }
          if (mode === 'hcenter') { want = ref.x + ref.w / 2; got = a.x + a.w / 2; }
          if (mode === 'top') { want = ref.y; got = a.y; }
          if (mode === 'bottom') { want = ref.y + ref.h; got = a.y + a.h; }
          if (mode === 'vcenter') { want = ref.y + ref.h / 2; got = a.y + a.h / 2; }
          // unreachable inside the page: the clamp wins, fine
          const lo = ['left', 'right', 'hcenter'].includes(mode);
          const pos = mode === 'left' ? want : mode === 'right' ? want - a.w : mode === 'hcenter' ? want - a.w / 2
            : mode === 'top' ? want : mode === 'bottom' ? want - a.h : want - a.h / 2;
          const size = lo ? a.w : a.h, lim = lo ? W : H;
          if (pos < -0.001 || pos + size > lim + 0.001) continue;
          if (!near(want, got, 0.03)) return `${mode}: want ${r3(want)}, got ${r3(got)}`;
        }
        return null;
      };
      const distExpect = axis => (after, before) => {
        if (after.some(a => !a)) return 'an element vanished';
        const items = after.map((a, i) => ({ a, b: before[i] }))
          .sort((p, q) => axis === 'h' ? p.b.x - q.b.x : p.b.y - q.b.y);
        const gaps = [];
        for (let i = 1; i < items.length; i++) {
          const p = items[i - 1].a, q = items[i].a;
          gaps.push(axis === 'h' ? q.x - (p.x + p.w) : q.y - (p.y + p.h));
        }
        const clamped = after.some(a => a.x <= 0.001 || a.y <= 0.001 || a.x + a.w >= W - 0.001 || a.y + a.h >= H - 0.001);
        if (!clamped && Math.max(...gaps) - Math.min(...gaps) > 0.04) return `uneven gaps ${gaps.map(r3).join(', ')}`;
        return null;
      };
      const nudgeExpect = (dx, dy) => (after, before) => {
        for (let i = 0; i < after.length; i++) {
          const a = after[i], b = before[i];
          if (!a) return 'vanished';
          const wx = Math.min(Math.max(b.x + dx, 0), W - Math.min(b.w, W));
          const wy = Math.min(Math.max(b.y + dy, 0), H - Math.min(b.h, H));
          if (!near(a.x, wx, 0.03) || !near(a.y, wy, 0.03)) return `nudge want ${r3(wx)},${r3(wy)} got ${a.x},${a.y}`;
        }
        return null;
      };

      const JITTER = new Set();
      { const A = snapshot(); await render(); await new Promise(r => setTimeout(r, 60));
        const B = snapshot(); await render(); await new Promise(r => setTimeout(r, 60));
        const C = snapshot();
        for (const id of Object.keys(A)) if (moved(A[id], B[id]) || moved(B[id], C[id])) JITTER.add(id); }
      const S = snapshot();
      const ids = Object.keys(S);
      const byPage = {};
      for (const id of ids) (byPage[S[id].pg] = byPage[S[id].pg] || []).push(id);
      const pagesWith = n => Object.keys(byPage).filter(p => byPage[p].length >= n);
      const sample = (arr, n) => { const a = [...arr], o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return o; };
      // disjoint sets only: no member inside another
      const disjoint = set => set.every(i => !containedIn(i, set));

      const counts = { objects: ids.length, pages: Object.keys(byPage).length, ops: 0 };
      for (let k = 0; k < OPS; k++) {
        const kind = pick(['align1', 'alignN', 'alignN', 'dist', 'nudge', 'nudge']);
        try {
          if (kind === 'align1') {
            const p = pick(pagesWith(1)); const [id] = sample(byPage[p], 1);
            const mode = pick(['left', 'right', 'hcenter', 'top', 'bottom', 'vcenter']);
            await run(`align ${mode} [${id}]`, [id], async () => alignSel(D(), mode), alignExpect(mode, true));
          } else if (kind === 'alignN') {
            const ps = pagesWith(2); if (!ps.length) continue;
            const p = pick(ps); const set = sample(byPage[p], 2 + Math.floor(rnd() * 2));
            if (!disjoint(set)) continue;
            const mode = pick(['left', 'right', 'hcenter', 'top', 'bottom', 'vcenter']);
            await run(`align ${mode} [${set.join(', ')}]`, set, async () => alignSel(D(), mode), alignExpect(mode, false));
          } else if (kind === 'dist') {
            const ps = pagesWith(3); if (!ps.length) continue;
            const p = pick(ps); const set = sample(byPage[p], 3);
            if (!disjoint(set)) continue;
            const axis = pick(['h', 'v']);
            await run(`distribute ${axis} [${set.join(', ')}]`, set, async () => distributeSel(D(), axis), distExpect(axis));
          } else {
            const p = pick(pagesWith(1)); const set = sample(byPage[p], 1 + Math.floor(rnd() * 2));
            if (!disjoint(set)) continue;
            const dx = pick([0.1, -0.1, 0, 0.5]), dy = pick([0.1, -0.1, 0, 0.3]);
            await run(`nudge ${dx},${dy} [${set.join(', ')}]`, set, async () => nudgeSel(D(), [dx, dy]), nudgeExpect(dx, dy),
              (b0, b1) => [r3(b1.x - b0.x), r3(b1.y - b0.y)]);
          }
          counts.ops++;
        } catch (e) {
          note(kind, 'threw', String(e && e.stack || e).slice(0, 300));
        }
      }
      counts.jitter = JITTER.size;
      return { counts, anomalies };
    }, [OPS, SEED]);
    const groups = {};
    for (const a of out.anomalies) (groups[a.kind] = groups[a.kind] || []).push(a);
    console.log(`\n##### ${rep}: ${out.counts.objects} objects on ${out.counts.pages} pages (${out.counts.jitter} jitter by themselves), ${out.counts.ops} ops, ${out.anomalies.length} anomalies`);
    for (const [k, list] of Object.entries(groups)) {
      console.log(`  -- ${k} (${list.length})`);
      for (const a of list.slice(0, 12)) console.log(`     ${a.op}\n        ${a.detail}`);
    }
  });
}
