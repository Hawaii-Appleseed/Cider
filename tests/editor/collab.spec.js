// Real-time collaboration, end to end through the editor (Phases 2–4 of
// collab/README.md): two browser contexts open the same project against a
// real `wrangler dev` relay and edit at once — including the same paragraph,
// in two open inline editors. The branch side of Phase 4 (the shared draft
// branch, a commit landing outside the session) is collab-drafts.spec.js.
//
// The relay is booted HERE, per spec file, rather than as a second entry in
// playwright.config's webServer: only this spec needs it, and a ~10s Worker
// boot on every one of the other ~120 files would be paid for nothing. It
// gets its own port (8792) and inspector port so it never collides with
// collab/'s own test relays (8788/8789).
//
// Local mode throughout: the editor talks to the relay with a `dev:<login>`
// token, which the Worker accepts only under its development secret (see
// collab/src/index.js handleAuth). `?collab=` and `?collabroom=` are honoured
// by a LOCAL editor only, and the room tag keeps every run in a fresh room.
const { test, expect, gotoEditor } = require('./fixtures/editor-test');

const RELAY_PORT = 8792;
const EDITOR_PORT = process.env.PRIMER_TEST_PORT || 8199;
const SLOT = 'whopays.p1';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let relay = null;
let ctxA, ctxB, a, b;
const room = `pw-${Date.now()}`;

const status = page => page.evaluate('docsync.api.status().collab');
const slot = page => page.evaluate(`readSlot(${JSON.stringify(SLOT)})`);
const api = (page, expr) => page.evaluate(`docsync.api.${expr}`);

async function waitLive(page) {
  await expect.poll(async () => {
    const s = await status(page);
    if (s.status === 'error') throw new Error('collab error: ' + s.error);
    return s.status;
  }, { timeout: 60_000, message: 'the editor never joined the room' }).toBe('live');
}

/** edit() opens a paragraph with all of it selected; put the caret at one
 *  end instead, so typing adds words rather than replacing them. */
// The caret to the start or the end of the open words. Explicitly: opening
// used to select every word, so collapsing that selection was enough — a
// click now puts the caret where it landed (caretAt), and a double-click's
// second click selects the word under it.
const collapse = (page, where) => page.evaluate(w => {
  const d = document.getElementById('out').contentDocument;
  const host = d.querySelector('.ds-edit');
  const r = d.createRange();
  r.selectNodeContents(host);
  r.collapse(w !== 'end');
  const sel = d.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}, where);

async function open(browser, as) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await gotoEditor(page, `?collab=http://127.0.0.1:${RELAY_PORT}&collabroom=${room}&collabas=${as}`);
  await waitLive(page);
  return { ctx, page };
}

test.beforeAll(async ({ browser }) => {
  const { startDev } = await import('../../collab/devserver.mjs');
  relay = await startDev({
    port: RELAY_PORT,
    vars: { ALLOWED_ORIGINS: `http://localhost:${EDITOR_PORT},http://127.0.0.1:${EDITOR_PORT}` },
  });
  ({ ctx: ctxA, page: a } = await open(browser, 'ada'));
  ({ ctx: ctxB, page: b } = await open(browser, 'grace'));
});

test.afterAll(async () => {
  for (const c of [ctxA, ctxB]) { try { await c.close(); } catch (e) { /* gone */ } }
  if (relay) await relay.stop();
});

test('both editors are live in one room and see each other', async () => {
  const sa = await status(a), sb = await status(b);
  expect(sa.on).toBe(true);
  expect(sa.peers).toBe(2);
  expect(sb.peers).toBe(2);
  await expect(a.locator('#collab')).toHaveText(/live · 2/);
  await expect(b.locator('#collab')).toHaveText(/live · 2/);
  // The first one in seeded from its files; the second adopted the room and
  // holds the same bytes — including the prose it did not type.
  expect(await slot(a)).toBe(await slot(b));
  expect(await a.evaluate('source')).toBe(await b.evaluate('source'));
});

test('a slot edit in A appears in B, rendered', async () => {
  const before = await slot(b);
  const text = 'Shared from A at ' + Date.now() + '.';
  const r = await api(a, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(text)})`);
  expect(r.ok).toBe(true);
  await expect.poll(() => slot(b), { timeout: 20_000 }).toBe(text);
  await expect(b.frameLocator('#out').locator(`[data-slot="${SLOT}"]`)).toContainText('Shared from A');
  expect(before).not.toBe(text);
  // B did nothing, so B has nothing to undo; A's edit is A's to undo.
  await expect(b.locator('#undo')).toBeDisabled();
  await expect(a.locator('#undo')).toBeEnabled();
});

test('concurrent edits to the SAME slot merge instead of one winning', async () => {
  const base = 'Base sentence for the merge test.';
  await api(a, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(base)})`);
  await expect.poll(() => slot(b), { timeout: 20_000 }).toBe(base);

  // Both edit from the same base: A prepends, B appends. B is BUSY (a pointer
  // held down — the same hold a drag or an open inline editor gets) so A's
  // change waits at B's door; B's own edit is therefore diffed against the
  // base, exactly as a sentence typed while A's change was in flight would
  // be, and the two land as concurrent CRDT operations. Without the hold this
  // is a race between the network and the next evaluate: whichever of A's
  // adoption or B's setSlot runs second in B simply wins the whole slot —
  // correct for a verb that says "set the slot to X", but not this test.
  await b.evaluate('collabPointerAt = Date.now()');
  await api(a, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify('A says: ' + base)})`);
  await expect.poll(() => a.evaluate(`docsync.api.status().collab.status`)).toBe('live');
  await b.waitForTimeout(800);                    // A's update has reached B and is being held
  expect(await slot(b)).toBe(base);
  await api(b, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(base + ' (B agrees)')})`);
  await b.evaluate('collabPointerAt = 0');        // release: the held update drains and merges
  const merged = 'A says: ' + base + ' (B agrees)';
  await expect.poll(() => slot(a), { timeout: 20_000 }).toBe(merged);
  await expect.poll(() => slot(b), { timeout: 20_000 }).toBe(merged);
});

test('undo in B removes only B\'s part; A\'s stays', async () => {
  await api(b, 'undo()');
  const base = 'Base sentence for the merge test.';
  await expect.poll(() => slot(b), { timeout: 20_000 }).toBe('A says: ' + base);
  await expect.poll(() => slot(a), { timeout: 20_000 }).toBe('A says: ' + base);
  await api(b, 'redo()');
  await expect.poll(() => slot(a), { timeout: 20_000 }).toBe('A says: ' + base + ' (B agrees)');
});

test('a move in A lands in B\'s layout and geometry', async () => {
  const r = await api(a, `place('cover.logo', { x: 1.25, y: 4 })`);
  expect(r.ok).toBe(true);
  await expect.poll(async () => {
    const l = await b.evaluate('layout.positions["cover.logo"]');
    return l && l.x;
  }, { timeout: 20_000 }).toBeCloseTo(1.25, 1);
  // The DRAWING, not just the data. B adopts the layout and THEN renders, so
  // the measured box catches up about a quarter-second behind — and this read
  // it once, immediately, which measured the render BEFORE this one: the logo
  // still at the 0.62in layout.json puts it at. Polled, like every other
  // assertion in this file, so it waits for the thing it is actually claiming.
  await expect.poll(async () => {
    const inv = await api(b, 'inventory()');
    const logo = inv.pages[0].elements.find(e => e.id === 'cover.logo');
    return logo && logo.box && logo.box.x;
  }, { timeout: 20_000 }).toBeCloseTo(1.25, 1);
});

test('a remote edit to ANOTHER slot lands in B\'s source while B\'s paragraph editor is open, and paints when it closes', async () => {
  // Open B's inline editor on a DIFFERENT slot — on another page, clear of
  // the logo the previous test parked over the cover — and leave it open.
  const inv = await api(b, 'inventory()');
  const other = inv.pages.slice(1).flatMap(p => p.slots).find(s => s.key !== SLOT && s.text).key;
  const el = b.frameLocator('#out').locator(`[data-slot="${other}"]`).first();
  await el.scrollIntoViewIfNeeded();
  await el.dblclick();
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(true);

  const text = 'Landed while B was typing elsewhere.';
  await api(a, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(text)})`);
  // Phase 4: an open PARAGRAPH is not busy. The change is in B's source at
  // once, the editor undisturbed — and not on B's page, which nothing
  // re-renders under an open editor.
  await expect.poll(() => slot(b), { timeout: 10_000 }).toBe(text);
  expect(await b.evaluate('editing')).toBe(true);
  expect(await b.evaluate('collabEditTarget()')).toBe(other);
  await expect(b.frameLocator('#out').locator(`[data-slot="${SLOT}"]`)).not.toContainText('Landed while');

  await b.keyboard.press('Escape');               // close the editor, keep nothing
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(false);
  // Leaving the words keeps the box selected (a click opened them, and the
  // box is the selection); a second Escape lets go of it, so B holds no
  // selection for the presence tests below to find as a ring in A.
  await b.keyboard.press('Escape');
  await expect.poll(() => b.evaluate('selIds.size'), { timeout: 10_000 }).toBe(0);
  await expect(b.frameLocator('#out').locator(`[data-slot="${SLOT}"]`)).toContainText('Landed while', { timeout: 20_000 });
  expect(await slot(b)).toBe(text);
});

test('a third editor arriving late adopts the room, not its own files', async ({ browser }) => {
  const { ctx, page: c } = await open(browser, 'linus');
  try {
    expect(await slot(c)).toBe(await slot(a));
    expect(await c.evaluate('layout.positions["cover.logo"].x')).toBeCloseTo(1.25, 1);
    await expect(c.locator('#collab')).toHaveText(/live · 3/);
    expect((await status(c)).peers).toBe(3);
    // Presence: a newcomer sees who is here and in what colour, immediately.
    const s = await status(c);
    expect(s.peerList.map(p => p.login).sort()).toEqual(['ada', 'grace']);
    await expect(c.locator('#collab i')).toHaveCount(2);
  } finally {
    await ctx.close();
  }
  await expect.poll(async () => (await status(a)).peers, { timeout: 10_000 }).toBe(2);
});

test('presence: A\'s selection shows in B as a ring with A\'s name; it clears when A deselects', async () => {
  await a.evaluate(`setSel(document.getElementById('out').contentDocument, ['cover.logo'])`);
  const ring = b.frameLocator('#out').locator('[data-el="cover.logo"].ds-peer');
  await expect(ring).toHaveCount(1, { timeout: 10_000 });
  await expect(ring).toHaveAttribute('data-peer', 'ada');
  const color = await ring.evaluate(el => el.style.getPropertyValue('--peer'));
  expect(color).toMatch(/^#[0-9A-F]{6}$/i);
  // The dot in B's chip for ada is the same colour as the ring.
  const dot = b.locator('#collab i[title^="ada"]');
  await expect(dot).toHaveCount(1);
  expect((await dot.evaluate(el => el.style.background)).toLowerCase())
    .toBe((await ring.evaluate((el, c) => { el.style.background = c; const v = el.style.background; el.style.background = ''; return v; }, color)).toLowerCase());
  // A's own view carries no peer ring for its own selection.
  await expect(a.frameLocator('#out').locator('.ds-peer')).toHaveCount(0);

  await a.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
  await expect(b.frameLocator('#out').locator('.ds-peer')).toHaveCount(0, { timeout: 10_000 });
});

test('presence: the paragraph B is typing in is tagged in A, and A is told when opening it', async () => {
  const inv = await api(b, 'inventory()');
  const key = inv.pages.slice(1).flatMap(p => p.slots).find(s => s.key !== SLOT && s.text).key;
  const el = b.frameLocator('#out').locator(`[data-slot="${key}"]`).first();
  await el.scrollIntoViewIfNeeded();
  await el.dblclick();
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  expect(await b.evaluate('collabEditTarget()')).toBe(key);

  const tag = a.frameLocator('#out').locator(`[data-slot="${key}"].ds-peer-typing`);
  await expect(tag).toHaveCount(1, { timeout: 10_000 });
  await expect(tag).toHaveAttribute('data-peer', 'grace · typing');
  await expect(a.locator('#collab i[title^="grace · typing"]')).toHaveCount(1);   // …and where, and what a click does

  // A opens the same paragraph: told, not blocked.
  const elA = a.frameLocator('#out').locator(`[data-slot="${key}"]`).first();
  await elA.scrollIntoViewIfNeeded();
  await elA.dblclick();
  await expect.poll(() => a.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  await expect(a.locator('#stat')).toHaveText(/grace is also editing this paragraph/);

  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(false);
  await expect(a.frameLocator('#out').locator('.ds-peer-typing')).toHaveCount(0, { timeout: 10_000 });
});

test('presence survives a re-render: B\'s ring for A is back after B edits', async () => {
  await a.evaluate(`setSel(document.getElementById('out').contentDocument, ['cover.logo'])`);
  await expect(b.frameLocator('#out').locator('[data-el="cover.logo"].ds-peer')).toHaveCount(1, { timeout: 10_000 });
  await api(b, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify('B re-rendered at ' + Date.now())})`);
  await expect(b.frameLocator('#out').locator('[data-el="cover.logo"].ds-peer')).toHaveCount(1, { timeout: 10_000 });
  await a.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
});

test('presence: a shape A has in hand is boxed in B, in her colour, with her name; it goes when she lets go', async () => {
  // A shape is an SVG child, where a CSS outline would ring the whole page:
  // the room draws an overlay box at its inch box instead, as paintSel does
  // for one's own selection. Before this a collaborator resizing a chart was
  // invisible except for the chart moving on its own.
  const id = await a.evaluate(`(async () => {
    const d = document.getElementById('out').contentDocument;
    pushHistory();
    const id = freeShapeId('rect');
    layout.shapes.push({ id, page: visiblePageId(), kind: 'rect', x: 1, y: 1, w: 2, h: 1, z: 3, fill: '#D9622B' });
    markDirty(); await render();
    setSel(document.getElementById('out').contentDocument, [id]);
    return id; })()`);
  const box = b.frameLocator('#out').locator(`.ds-peer-box[data-for="${id}"]`);
  await expect(box).toHaveCount(1, { timeout: 10_000 });
  await expect(box).toHaveAttribute('data-peer', 'ada');
  const color = await box.evaluate(el => el.style.getPropertyValue('--peer'));
  expect(color).toMatch(/^#[0-9A-F]{6}$/i);
  // Sized to the shape: two inches by one, where it was put.
  expect(await box.evaluate(el => [el.style.left, el.style.top, el.style.width, el.style.height])).toEqual(['1in', '1in', '2in', '1in']);
  // And the bar can say where she is, and go there - a shape is a place.
  await expect(b.locator('#collab i[title^="ada"]')).toHaveAttribute('title', /on page \d+\. Click to go there/, { timeout: 10_000 });
  await a.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
  await expect(b.frameLocator('#out').locator('.ds-peer-box')).toHaveCount(0, { timeout: 10_000 });
  // The shape itself goes too, so the tests after this one see the fixture
  // they were written against.
  await a.evaluate(`(async () => { layout.shapes = layout.shapes.filter(s => s.id !== ${JSON.stringify(id)}); markDirty(); await render(); })()`);
});

test('presence: a person with nothing in hand is still somewhere - the page they are reading, and a click goes there', async () => {
  // Nothing selected, scrolled to the last page: B's avatar used to say
  // "ada" and nothing else, with nowhere to go. Presence now carries the
  // page in the middle of her window.
  await a.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
  const pages = await a.evaluate(`document.getElementById('out').contentDocument.querySelectorAll('section.page').length`);
  test.skip(pages < 2, 'this project has one page');
  await a.evaluate(`(() => { const d = document.getElementById('out').contentDocument;
    d.defaultView.scrollTo(0, d.documentElement.scrollHeight); })()`);
  await expect.poll(() => a.evaluate("collabViewPage(document.getElementById('out').contentDocument)"), { timeout: 5_000 }).toBe(pages);
  const av = b.locator('#collab i[title^="ada"]');
  await expect(av).toHaveAttribute('title', new RegExp(`^ada · reading page ${pages}\\. Click to go there`), { timeout: 10_000 });
  await b.evaluate('document.getElementById("out").contentWindow.scrollTo(0, 0)');
  // #stat is the one status line the whole editor shares, and any render
  // that lands after the click (the last test's shape removal reaching B, a
  // collaborator's update) puts "unsaved changes" back over the sentence,
  // which is what it is for. Sampling it afterwards raced that render: it
  // lost about 1 run in 5. Record every value it takes from the click on,
  // and ask whether the click said it.
  await b.evaluate(() => {
    const stat = document.getElementById('stat');
    window.__statSaid = [stat.textContent];
    new MutationObserver(() => window.__statSaid.push(stat.textContent))
      .observe(stat, { childList: true, characterData: true, subtree: true });
  });
  await av.click();
  await expect.poll(() => b.evaluate(() => window.__statSaid.join('\n')), { timeout: 10_000 })
    .toMatch(new RegExp(`ada is reading on page ${pages}`));
  await expect.poll(() => b.evaluate('document.getElementById("out").contentWindow.scrollY'), { timeout: 10_000 }).toBeGreaterThan(0);
  // Back at the top with something in hand, the sentence changes with her.
  await a.evaluate(`(() => { const d = document.getElementById('out').contentDocument; d.defaultView.scrollTo(0, 0);
    setSel(d, ['cover.logo']); })()`);
  await expect(av).toHaveAttribute('title', /^ada on page 1\. Click to go there/, { timeout: 10_000 });
  await a.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
});

test('presence: the words A has selected are a band in her colour in B; a caret alone when she collapses it', async () => {
  await a.evaluate(`edit(document.getElementById('out').contentDocument, ${JSON.stringify(SLOT)})`);
  await expect.poll(() => a.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  // edit() opens with everything selected: one band (or several, one per
  // line) in B, and a caret at the focus end.
  const bands = b.frameLocator('#out').locator(`.ds-peer-range[data-slot="${SLOT}"]`);
  await expect.poll(() => bands.count(), { timeout: 10_000 }).toBeGreaterThan(0);
  const first = await bands.first().evaluate(el => ({ peer: el.dataset.peer, color: el.style.getPropertyValue('--peer'), w: parseFloat(el.style.width), h: parseFloat(el.style.height) }));
  expect(first.peer).toBe('ada');
  expect(first.color).toMatch(/^#[0-9A-F]{6}$/i);
  expect(first.w).toBeGreaterThan(0.1);
  expect(first.h).toBeGreaterThan(0.05);
  await expect(b.frameLocator('#out').locator(`.ds-peer-caret[data-slot="${SLOT}"]`)).toHaveCount(1);
  // Collapsed to a caret: the band goes, the caret stays.
  await collapse(a, 'end');
  await expect(bands).toHaveCount(0, { timeout: 10_000 });
  await expect(b.frameLocator('#out').locator(`.ds-peer-caret[data-slot="${SLOT}"]`)).toHaveCount(1);
  await a.keyboard.press('Escape');
  await expect.poll(() => a.evaluate('editing'), { timeout: 10_000 }).toBe(false);
  await expect(b.frameLocator('#out').locator('.ds-peer-caret')).toHaveCount(0, { timeout: 10_000 });
});

test('presence: while A moves something, B sees it where A has it - not where the document still has it', async () => {
  // The document does not change until the drop (renderOnce flushes it), so
  // before this a two-second drag was two seconds of nothing at the other end
  // followed by a jump. Presence carries the live geometry instead.
  const id = await a.evaluate(`(async () => {
    const d = document.getElementById('out').contentDocument;
    pushHistory();
    const id = freeShapeId('rect');
    layout.shapes.push({ id, page: visiblePageId(), kind: 'rect', x: 1, y: 1.5, w: 2, h: 1, z: 3, fill: '#D9622B' });
    markDirty(); await render();
    setSel(document.getElementById('out').contentDocument, [id]);
    return id; })()`);
  const box = b.frameLocator('#out').locator(`.ds-peer-box[data-for="${id}"]`);
  await expect(box).toHaveCount(1, { timeout: 10_000 });
  // A takes hold and moves it, as startDrag does: inches into layout, painted
  // as it goes, nothing committed.
  await a.evaluate(`(() => { const d = document.getElementById('out').contentDocument;
    collabPointerAt = Date.now();
    const sh = layout.shapes.find(s => s.id === ${JSON.stringify(id)});
    sh.x = 3.5; sh.y = 2.5; paintShape(d, ${JSON.stringify(id)}); })()`);
  await expect(box).toHaveAttribute('data-peer', /· moving$/, { timeout: 10_000 });
  await expect.poll(() => box.evaluate(el => [el.style.left, el.style.top]), { timeout: 10_000 })
    .toEqual(['3.5in', '2.5in']);
  // B's own copy of the document has NOT moved: that is the point.
  expect(await b.evaluate(`(layout.shapes.find(s => s.id === ${JSON.stringify(id)}) || {}).x`)).toBe(1);
  // B reaching for the same thing is told what a move means, since it cannot merge.
  await b.evaluate(`(() => { const d = document.getElementById('out').contentDocument;
    setSel(d, [${JSON.stringify(id)}]); collabWarnHeld(${JSON.stringify(id)}); })()`);
  await expect(b.locator('#stat')).toHaveText(/ada has this selected too — a move is not merged/);
  // The drop, as the real one ends: commit() writes the inches and calls
  // markDirty() - no render. That has to be enough to reach the room; it
  // once was not, and the move lived in A's tab alone until the next render,
  // where a collaborator's update arriving first put the piece back.
  await a.evaluate(`(() => { collabPointerAt = 0; markDirty(); })()`);
  await expect.poll(() => b.evaluate(`(layout.shapes.find(s => s.id === ${JSON.stringify(id)}) || {}).x`), { timeout: 10_000 }).toBe(3.5);
  await a.evaluate('render()');
  await expect(box).toHaveAttribute('data-peer', 'ada', { timeout: 10_000 });
  await a.evaluate(`(async () => { layout.shapes = layout.shapes.filter(s => s.id !== ${JSON.stringify(id)});
    clearSel(document.getElementById('out').contentDocument); markDirty(); await render(); })()`);
  await b.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
});

test('a commit waiting on a busy render is not lost to a collaborator\'s update landing first', async () => {
  // A cell or a box committed while a render is still running sits in
  // `layout` until the queued render flushes it. A remote update in that
  // window used to replace `layout` wholesale - the edit gone, its undo step
  // already taken. beforeRemote now flushes everything this editor holds, so
  // the two are concurrent edits and both survive.
  const id = await a.evaluate(`(async () => {
    pushHistory();
    const id = freeShapeId('rect');
    layout.shapes.push({ id, page: visiblePageId(), kind: 'rect', x: 1, y: 1, w: 1, h: 1, z: 3, fill: '#333' });
    markDirty(); await render(); return id; })()`);
  await expect.poll(() => b.evaluate(`(layout.shapes.find(s => s.id === ${JSON.stringify(id)}) || {}).x`), { timeout: 10_000 }).toBe(1);
  // B's commit: the value is in `layout`, the render that would flush it has
  // not run (as when it is queued behind one in flight).
  await b.evaluate(`layout.shapes.find(s => s.id === ${JSON.stringify(id)}).x = 6`);
  // A's edit arrives at B meanwhile.
  const before = await slot(a);
  await a.evaluate(`(async () => { writeSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(before + ' Landed first.')}); markDirty(); await render(); })()`);
  await expect.poll(() => slot(b), { timeout: 10_000 }).toBe(before + ' Landed first.');
  // B's commit survived the landing, on both sides.
  expect(await b.evaluate(`layout.shapes.find(s => s.id === ${JSON.stringify(id)}).x`)).toBe(6);
  await expect.poll(() => a.evaluate(`(layout.shapes.find(s => s.id === ${JSON.stringify(id)}) || {}).x`), { timeout: 10_000 }).toBe(6);
  await a.evaluate(`(async () => { writeSlot(${JSON.stringify(SLOT)}, ${JSON.stringify(before)});
    layout.shapes = layout.shapes.filter(s => s.id !== ${JSON.stringify(id)}); markDirty(); await render(); })()`);
  await expect.poll(() => slot(b), { timeout: 10_000 }).toBe(before);
});

test('presence: a tab nobody has touched goes away - dimmed, named as idle, and out of the count', async () => {
  await a.evaluate(`setSel(document.getElementById('out').contentDocument, ['cover.logo'])`);
  const av = b.locator('#collab i[title^="ada"]');
  await expect(av).toHaveCount(1, { timeout: 10_000 });
  await expect(b.locator('#collab')).toHaveText(/● live · 2/, { timeout: 10_000 });
  // Five minutes without a key, a pointer or a wheel. Reached by moving the
  // clock this editor keeps, which is what those events set.
  await a.evaluate('collabActiveAt = Date.now() - COLLAB_IDLE_MS - 1000');
  await expect(av).toHaveClass(/idle/, { timeout: 10_000 });
  await expect(av).toHaveAttribute('title', /^ada · away/);
  // The count is of people who are AT it; the title still says the tab is open.
  await expect(b.locator('#collab')).toHaveText(/● live · 1/);
  await expect(b.locator('#collab')).toHaveAttribute('title', /ada has it open, with no input for five minutes/);
  // Their ring is still there - "ada has this open" is worth knowing - and dimmed.
  await expect(b.frameLocator('#out').locator('[data-el="cover.logo"].ds-peer.ds-peer-idle')).toHaveCount(1);
  await expect(b.frameLocator('#out').locator('[data-el="cover.logo"].ds-peer')).toHaveAttribute('data-peer', 'ada · away');
  // A keystroke brings them back.
  await a.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))");
  await expect(av).not.toHaveClass(/idle/, { timeout: 10_000 });
  await expect(b.locator('#collab')).toHaveText(/● live · 2/);
  await a.evaluate(`clearSel(document.getElementById('out').contentDocument)`);
});

test('a text box two people edited at once is settled by a person, not by whoever saved last', async () => {
  // A paragraph merges character by character. A text box's words are a whole
  // string in layout.json, and the editor holds a collaborator's change back
  // while such an editor is open (collabBusy) — so B's commit used to write
  // over words B had never been shown. It cannot merge, so it is asked.
  const id = await a.evaluate(`(async () => {
    const d = document.getElementById('out').contentDocument;
    const b = { id: 'ct' + Date.now().toString(36).slice(-4), page: visiblePageId(),
                x: 1, y: 4, w: 3, z: 2, md: 'Words we both mean to change' };
    (layout.boxes = layout.boxes || []).push(b);
    markDirty(); await render();
    return b.id; })()`);
  const boxOf = page => page.evaluate(`((layout.boxes || []).find(x => x.id === ${JSON.stringify(id)}) || {}).md`);
  await expect.poll(() => boxOf(b), { timeout: 10_000 }).toBe('Words we both mean to change');
  // ...and wait for B to have DRAWN it. The line above waits on the data; B
  // renders a couple of hundred milliseconds behind that, and editBox() reads
  // el.dataset off whatever querySelector returns — null, here, which threw.
  await expect(b.frameLocator('#out').locator(`[data-el="text.${id}"]`))
    .toHaveCount(1, { timeout: 10_000 });

  // B opens it and types. While that editor is open B is `busy`: nothing
  // remote lands.
  await b.evaluate(`(() => { const d = document.getElementById('out').contentDocument;
    editBox(d, d.querySelector('[data-el="text.${id}"]')); })()`);
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  await b.keyboard.press('ControlOrMeta+a');
  await b.keyboard.type('B rewrote this');
  // A changes the same box and saves it into the document.
  await a.evaluate(`(async () => {
    (layout.boxes || []).find(x => x.id === ${JSON.stringify(id)}).md = 'A rewrote this';
    markDirty(); await render(); })()`);
  // A's words are in the room, and B has not seen them: that is the trap.
  await expect.poll(() => b.evaluate(`(collab.netFiles().layout.boxes.find(x => x.id === ${JSON.stringify(id)}) || {}).md`),
                    { timeout: 10_000 }).toBe('A rewrote this');
  expect(await boxOf(b)).toBe('Words we both mean to change');

  // B commits. The question names the other version instead of overwriting it.
  await b.evaluate("document.getElementById('out').contentDocument.querySelector('.ds-edit').blur()");
  const dlg = b.locator('.dsdlg-msg');
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  await expect(dlg).toHaveText(/changed this text box while you had it open/);
  await expect(dlg).toHaveText(/A rewrote this/);
  await expect(dlg).toHaveText(/B rewrote this/);
  // Keep theirs: B's words are dropped and A's stand, in both editors.
  await b.locator('.dsdlg-cancel').click();
  await expect(b.locator('#stat')).toHaveText(/your version was not saved/, { timeout: 10_000 });
  await expect.poll(() => boxOf(b), { timeout: 15_000 }).toBe('A rewrote this');
  await expect.poll(() => boxOf(a), { timeout: 15_000 }).toBe('A rewrote this');

  // And the other way: B wins when B says so.
  await b.evaluate(`(() => { const d = document.getElementById('out').contentDocument;
    editBox(d, d.querySelector('[data-el="text.${id}"]')); })()`);
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  await b.keyboard.press('ControlOrMeta+a');
  await b.keyboard.type('B insisted');
  await a.evaluate(`(async () => {
    (layout.boxes || []).find(x => x.id === ${JSON.stringify(id)}).md = 'A moved again';
    markDirty(); await render(); })()`);
  await expect.poll(() => b.evaluate(`(collab.netFiles().layout.boxes.find(x => x.id === ${JSON.stringify(id)}) || {}).md`),
                    { timeout: 10_000 }).toBe('A moved again');
  await b.evaluate("document.getElementById('out').contentDocument.querySelector('.ds-edit').blur()");
  await expect(b.locator('.dsdlg-msg')).toBeVisible({ timeout: 10_000 });
  await b.locator('.dsdlg-ok').click();
  await expect.poll(() => boxOf(a), { timeout: 15_000 }).toBe('B insisted');

  // A box nobody else touched is committed without a question at all.
  await b.evaluate(`(() => { const d = document.getElementById('out').contentDocument;
    editBox(d, d.querySelector('[data-el="text.${id}"]')); })()`);
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  await b.keyboard.press('ControlOrMeta+a');
  await b.keyboard.type('Nobody else was here');
  await b.evaluate("document.getElementById('out').contentDocument.querySelector('.ds-edit').blur()");
  await expect.poll(() => boxOf(b), { timeout: 10_000 }).toBe('Nobody else was here');
  await expect(b.locator('.dsdlg-msg')).toHaveCount(0);

  await a.evaluate(`(async () => { layout.boxes = (layout.boxes || []).filter(x => x.id !== ${JSON.stringify(id)});
    markDirty(); await render(); })()`);
  // ...and wait for B to have DRAWN the deletion, not just adopted it. The
  // comment above is only true when both sides are done: the next test grabs
  // a [data-slot] node in B, and B's adopt-render was still in flight, so the
  // node detached between resolving it and acting on it ("Element is not
  // attached to the DOM", ~2 runs in 3).
  await expect(b.frameLocator('#out').locator(`[data-el="text.${id}"]`))
    .toHaveCount(0, { timeout: 10_000 });
});

test('typing in a paragraph reaches A while B\'s editor is still open, with B\'s caret; Escape takes it back', async () => {
  const before = await slot(b);
  const el = b.frameLocator('#out').locator(`[data-slot="${SLOT}"]`).first();
  await el.scrollIntoViewIfNeeded();
  await el.dblclick();
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(true);
  await collapse(b, 'end');
  await b.keyboard.type(' LIVE');
  // A has the words before B has committed anything: B's editor is still open.
  await expect.poll(() => slot(a), { timeout: 10_000 }).toBe(before + ' LIVE');
  expect(await b.evaluate('editing')).toBe(true);
  expect(await slot(b)).toBe(before);   // B's own source waits for the commit, as ever
  // B's caret — a relative position into the shared paragraph — is drawn in
  // A at the end of the words, in B's colour.
  const caret = a.frameLocator('#out').locator('.ds-peer-caret[data-peer="grace"]');
  await expect(caret).toHaveCount(1, { timeout: 10_000 });
  await expect(caret).toHaveAttribute('data-slot', SLOT);
  await expect.poll(async () => {
    const g = (await status(a)).peerList.find(p => p.login === 'grace');
    return g && g.cursor && `${g.cursor.slot}@${g.cursor.index}`;
  }, { timeout: 10_000 }).toBe(`${SLOT}@${(before + ' LIVE').length}`);

  await b.keyboard.press('Escape');                  // keep nothing — including what the room already saw
  await expect.poll(() => b.evaluate('editing'), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => slot(b), { timeout: 10_000 }).toBe(before);
  await expect.poll(() => slot(a), { timeout: 10_000 }).toBe(before);
  await expect(a.frameLocator('#out').locator('.ds-peer-caret')).toHaveCount(0, { timeout: 10_000 });
});

test('both editors type in the SAME paragraph at once, each sees the other\'s words land around its caret, and both keep theirs', async () => {
  const base = await slot(a);
  for (const [pg, where, text] of [[a, 'end', ' says Ada'], [b, 'start', 'Grace says ']]) {
    // B opens once A's words have LANDED in B: a remote change arriving
    // between B's double-click and the caret placement below rebuilds the
    // host with the caret at the end, and then "start" is the end.
    if (pg === b) await expect.poll(() => slot(b), { timeout: 10_000 }).toBe(base + ' says Ada');
    const el = pg.frameLocator('#out').locator(`[data-slot="${SLOT}"]`).first();
    await el.scrollIntoViewIfNeeded();
    await el.dblclick();
    await expect.poll(() => pg.evaluate('editing'), { timeout: 10_000 }).toBe(true);
    await collapse(pg, where);
    await pg.keyboard.type(text);
  }
  const merged = 'Grace says ' + base + ' says Ada';
  // Each OPEN editor shows both, merged, before either has committed — and
  // each shows the other's caret inside its own editing surface.
  for (const [pg, other] of [[a, 'grace'], [b, 'ada']]) {
    await expect.poll(() => pg.evaluate('collabHostMd()'), { timeout: 10_000 }).toBe(merged);
    expect(await pg.evaluate('editing')).toBe(true);
    await expect(pg.frameLocator('#out').locator(`.ds-peer-caret[data-peer="${other}"]`)).toHaveCount(1, { timeout: 10_000 });
  }
  // A's caret stayed at the end of ITS words as Grace's arrived in front.
  const idx = await a.evaluate('collabHostCaretIndex()');
  expect(idx).toBe(merged.length);
  // A blur is a commit, in both; the document agrees everywhere.
  for (const pg of [a, b]) {
    await pg.evaluate(`document.getElementById('out').contentDocument.activeElement.blur()`);
    await expect.poll(() => pg.evaluate('editing'), { timeout: 10_000 }).toBe(false);
  }
  await expect.poll(() => slot(a), { timeout: 10_000 }).toBe(merged);
  await expect.poll(() => slot(b), { timeout: 10_000 }).toBe(merged);
});

test('an automated edit in B is shown to A as Claude at work, via grace, and clears when it is done', async () => {
  const text = 'Claude wrote this through the pilot at ' + Date.now() + '.';
  // A pilot op is what an AI's edit looks like to an editor: the same verbs
  // the tests call, arriving through /__pilot. Run one in B directly.
  await b.evaluate(`runPilotOps([{ id: 'test-op', verb: 'setSlot', args: [${JSON.stringify(SLOT)}, ${JSON.stringify(text)}] }])`);
  // B says so itself…
  await expect(b.locator('#agentlive')).toBeVisible();
  await expect(b.locator('#agentlive')).toHaveText(/Claude is editing/);
  expect((await b.evaluate('docsync.api.status().agent')).target).toBe(SLOT);
  // …and A hears it from B, with the words, the attribution and a tag on the paragraph.
  await expect.poll(() => slot(a), { timeout: 10_000 }).toBe(text);
  await expect(a.locator('#agentlive')).toHaveText(/Claude is editing · via grace/, { timeout: 10_000 });
  const tag = a.frameLocator('#out').locator(`[data-slot="${SLOT}"].ds-agent`);
  await expect(tag).toHaveCount(1, { timeout: 10_000 });
  await expect(tag).toHaveAttribute('data-peer', /Claude · editing/);
  const st = await status(a);
  expect(st.peerList.find(p => p.login === 'grace').agent.target).toBe(SLOT);
  // A few quiet seconds later it is over, everywhere.
  await expect(b.locator('#agentlive')).toBeHidden({ timeout: 10_000 });
  await expect(a.locator('#agentlive')).toBeHidden({ timeout: 10_000 });
  await expect(a.frameLocator('#out').locator('.ds-agent')).toHaveCount(0, { timeout: 10_000 });
  // A person's own edit says nothing of the kind.
  await api(a, `setSlot(${JSON.stringify(SLOT)}, ${JSON.stringify('A person wrote this.')})`);
  await expect.poll(() => slot(b), { timeout: 10_000 }).toBe('A person wrote this.');
  await expect(b.locator('#agentlive')).toBeHidden();
});

test('offline is said above the page, and what was done offline is shared when the session is back', async () => {
  // A dropped connection, as the provider sees one: its socket's close event
  // (see client.test.mjs for why not disconnect() alone). disconnect() first,
  // so the provider does not reconnect on its own before the band is seen.
  await a.evaluate(`(() => { const p = collab.provider; const ws = p.ws; p.disconnect();
    if (ws) { ws.dispatchEvent(new Event('close')); try { ws.close(); } catch (e) { /* closing */ } } })()`);
  await expect(a.locator('#collab')).toHaveText(/offline/, { timeout: 10_000 });
  await expect(a.locator('#notices .ds-offline')).toBeVisible();
  await expect(a.locator('#notices .ds-offline')).toHaveText(/Working offline — your edits are kept here and shared when the session is back/);
  await expect(b.locator('#notices .ds-offline')).toHaveCount(0);   // B is fine
  // An edit made offline stays here for now.
  await api(a, `setSlot(${JSON.stringify(SLOT)}, "Typed while offline.")`);
  await a.waitForTimeout(800);
  expect(await slot(b)).not.toBe('Typed while offline.');
  // Back: the band goes, the status line says so, and B gets the words.
  await a.evaluate('collab.provider.connect()');
  await waitLive(a);
  await expect(a.locator('#notices .ds-offline')).toHaveCount(0);
  await expect(a.locator('#stat')).toHaveText(/back in the session — what you did offline is shared now/);
  await expect.poll(() => slot(b), { timeout: 15_000 }).toBe('Typed while offline.');
});

test('an unshared project shows no chip and keeps the snapshot undo stack', async ({ page }) => {
  await gotoEditor(page, '?collab=0');
  const s = await status(page);
  expect(s.on).toBe(false);
  await expect(page.locator('#collab')).toBeHidden();
  expect(await page.evaluate('collab')).toBe(null);
});
