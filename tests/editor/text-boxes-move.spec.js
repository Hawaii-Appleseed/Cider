// Every text box moves and resizes — in every bound report, in the editor.
//
// The standing rule this pins: a person can always pick up any text on the
// page and move it or give it a width, not only type into it. It was broken
// quietly for a whole class of report — every field of tfc-2027-priorities
// (141 of 141) and of our-mission (64 of 64) could be typed into and not one
// could be moved, because docsync.propose wired each as a slot (data-slot)
// and never as an object (data-el). rxkids, tax-testimony and rxkids-fiscal
// had 144 more between them. Nothing said so anywhere.
//
// Three nets now, and this is the one that runs the real editor:
//   * docsync.check's IMMOVABLE TEXT fails a strict binding's build;
//   * the editor says so itself — the amber #immov chip, and audit()'s
//     immovable-text issues (checkImmovable, immovableSlots);
//   * this spec opens every report docsync.yml binds and holds every strict
//     one to zero — and then actually DRAGS a field on it, because a hook in
//     the markup is not the same thing as a box that moves.
//
// Reports are discovered from docsync.yml, as text-legibility.spec.js does,
// so a report is covered the day it is bound.
const fs = require('fs');
const path = require('path');
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const REPO = path.resolve(__dirname, '../..');

const discover = () => {
  const yml = fs.readFileSync(path.join(REPO, 'docsync.yml'), 'utf8');
  const ids = [...yml.matchAll(/^ {2}- id: (\S+)$/gm)];
  return ids.map((m, i) => {
    const block = yml.slice(m.index, i + 1 < ids.length ? ids[i + 1].index : undefined);
    const lvl = (block.match(/^ {4}editability: (\S+)/m) || [, 'warn'])[1];
    const built = block.match(/^ {6}out: (\S+)$/m);
    return { id: m[1], strict: lvl === 'strict',
             built: !!built && fs.existsSync(path.join(REPO, built[1])) };
  }).filter(r => r.built);
};
const REPORTS = discover();

test('every bound report was discovered', () => {
  expect(REPORTS.length, REPORTS.map(r => r.id).join(', ')).toBeGreaterThan(5);
  expect(REPORTS.filter(r => r.strict).length).toBeGreaterThan(3);
});

/** A visible, unlocked text box on the page, and a point on it as a top-level
 *  point — something a person could grab. A field in the flow first (the
 *  kind that had no handle); a report whose words all live in placed text
 *  boxes (my-report, the eviction guide) has only those to offer. */
const grabbable = page => page.evaluate(() => {
  const fr = document.getElementById('out');
  const d = fr.contentDocument;
  const flow = [...d.querySelectorAll('section.page [data-slot]')]
    .filter(s => !s.closest('svg') && !s.closest('.ds-textbox'));
  const cands = [...flow, ...d.querySelectorAll('section.page .ds-textbox[data-el]')];
  for (const s of cands) {
    const el = s.closest('[data-el]');
    const box = el && boxOf(el.dataset.el);
    if (!el || isLocked(el.dataset.el) || (layout.positions || {})[el.dataset.el]) continue;
    // An object nested in another is a part of it; grab the outermost.
    if (el.parentElement && el.parentElement.closest('[data-el]')) continue;
    const cs = d.defaultView.getComputedStyle(el);
    if (!box && (cs.position === 'absolute' || cs.position === 'fixed')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 8) continue;
    // A box the size of the sheet (a cover's texture) has nowhere to go: a
    // drag clamps it to the page it already fills.
    const pr = el.closest('section.page').getBoundingClientRect();
    if (r.width > pr.width * 0.9 && r.height > pr.height * 0.5) continue;
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect(), fb = fr.getBoundingClientRect();
    const k = fb.width / fr.offsetWidth;
    // The point must hit this object and not whatever overlaps it.
    const px = b.left + Math.min(b.width / 2, 24), py = b.top + b.height / 2;
    const hit = d.elementFromPoint(px, py);
    if (!hit || hit.closest('[data-el]') !== el) continue;
    return { id: el.dataset.el, x: fb.left + px * k, y: fb.top + py * k,
             was: box ? { x: box.x, y: box.y } : null };
  }
  return null;
});

/** Did it move: a field gains a position; a text box's own inches change. */
const moved = (page, g) => page.evaluate(({ id, was }) => {
  if (!was) return !!(layout.positions || {})[id];
  const b = boxOf(id);
  return !!b && (b.x !== was.x || b.y !== was.y);
}, g);

for (const rep of REPORTS) {
  test(`${rep.id}: every text box can be moved and resized`, async ({ page }) => {
    await gotoEditor(page, rep.id === 'budget-primer' ? '' : `?project=${rep.id}`);
    await page.waitForTimeout(500);
    const stuck = await page.evaluate(() =>
      immovableSlots(document.getElementById('out').contentDocument).map(s => s.key));
    const chip = await page.evaluate(() => !$('immov').hidden);
    const audit = await page.evaluate(() =>
      docsync.api.audit().issues.filter(i => i.kind === 'immovable-text'));
    // The editor's own net says exactly what the page holds — no more, no
    // fewer — whatever the binding's level.
    expect(chip, 'the chip stands exactly when something cannot move').toBe(stuck.length > 0);
    expect(audit.flatMap(i => i.ids).sort()).toEqual([...stuck].sort());
    if (!rep.strict) return;    // warn/wip bindings: said, not yet required
    expect(stuck, 'strict: no text that types but cannot move').toEqual([]);

    // And a hook is not a move: pick a field up and put it down.
    const g = await grabbable(page);
    expect(g, 'a field to grab').toBeTruthy();
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + 12, g.y + 18, { steps: 4 });
    await page.mouse.move(g.x + 30, g.y + 45, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => moved(page, g), `${g.id} moved`).toBe(true);
  });
}
