// POST /__pilot — driving the OPEN editor over HTTP instead of through a
// browser eval. The point is transport cost: the editor's own work is ~50ms,
// while a browser-extension eval is a full model round trip that also needs
// the tab open and fronted. The relay hands a verb to the tab already holding
// the live stream, so the same edit is a curl away.
//
// The guarantees this spec pins:
//   · the op runs through window.docsync.api — so pushHistory ran, one undo
//     reverses it, and render() validated it (NOT an out-of-band file write);
//   · exactly-once — the stream only ADVERTISES ops and a live tab CLAIMS them
//     with an atomic pop, so no two tabs can run the same op (and a closed
//     tab's lingering stream cannot swallow one);
//   · with no editor listening it says so, rather than hanging or pretending.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');

// The relay is real server state, so these must not run against each other.
test.describe.configure({ mode: 'serial' });

const PORT = process.env.PRIMER_TEST_PORT || 8199;
const pilot = (request, body) =>
  request.post(`http://localhost:${PORT}/__pilot`,
    { data: { project: 'budget-primer', ...body } }).then(r => r.json());

// The suite runs files in parallel, and every browser context elects its OWN
// leader — so an untargeted op for budget-primer can be claimed by another
// spec's editor tab, which runs it in a document this spec cannot see. Aiming
// each op at this page's own tab is what makes the assertions deterministic
// (and is the same mechanism a real caller uses to pick between two open
// browser profiles).
const tabOf = page => page.evaluate(() => docsync.api.status().tab);

test.describe('pilot relay', () => {
  test('a verb POSTed over HTTP runs in the open editor and answers with its JSON',
    async ({ page, request }) => {
      await gotoEditor(page);
      await page.waitForTimeout(1200);            // the leader takes the stream

      const r = await pilot(request, { verb: 'setSlot', args: ['basics.h1', 'RELAYED'],
                                       tab: await tabOf(page) });
      expect(r.ok).toBe(true);
      expect(r.result.ok).toBe(true);
      expect(r.result.dirty).toBe(true);

      // It landed in the DOCUMENT the editor holds, and on screen.
      await expect(page.frameLocator('#out').locator('[data-slot="basics.h1"]'))
        .toContainText('RELAYED');

      // And it is a normal history entry: one undo takes it back, exactly as
      // if a human had typed it. This is what "not an out-of-band write" means.
      await page.evaluate(() => docsync.api.undo());
      expect(await page.evaluate(() => docsync.api.getSlot('basics.h1').md))
        .not.toBe('RELAYED');
    });

  test('a read verb needs no browser round trip at all', async ({ page, request }) => {
    await gotoEditor(page);
    await settled(page);
    const r = await pilot(request, { verb: 'audit', tab: await tabOf(page) });
    expect(r.ok).toBe(true);
    expect(r.result.ok).toBe(true);
    expect(Array.isArray(r.result.issues)).toBe(true);
  });

  test('a refusal comes back as a refusal, not a hang or a lie', async ({ page, request }) => {
    await gotoEditor(page);
    await page.waitForTimeout(1200);

    const tab = await tabOf(page);
    const bad = await pilot(request, { verb: 'setSlot', args: ['no.such.slot', 'x'], tab });
    expect(bad.ok).toBe(true);                  // the RELAY worked...
    expect(bad.result.ok).toBe(false);          // ...the VERB refused
    expect(bad.result.error).toContain('no slot');

    const unknown = await pilot(request, { verb: 'notAVerb', args: [], tab });
    expect(unknown.result.ok).toBe(false);
    expect(unknown.result.error).toContain('unknown verb');
  });

  test('two open tabs run a relayed op exactly once', async ({ page, context, request }) => {
    await gotoEditor(page);
    const second = await context.newPage();
    await gotoEditor(second);
    await page.waitForTimeout(1500);            // both up; one holds the stream

    // Exactly one tab leads — the property that makes delivery exactly-once.
    const leaders = (await Promise.all(
      [page, second].map(p => p.evaluate(() => !!(window.__liveIsLeader && window.__liveIsLeader())))
    )).filter(Boolean).length;
    expect(leaders).toBe(1);

    const isLeader = p => p.evaluate(() => !!(window.__liveIsLeader && window.__liveIsLeader()));
    const leader = (await isLeader(page)) ? page : second;
    const follower = leader === page ? second : page;

    // addTextBox is the sharp instrument here: run twice, there would be two
    // boxes, and counting them cannot be fooled by an idempotent write.
    const beforeL = await leader.evaluate(() => (layout.boxes || []).length);
    const beforeF = await follower.evaluate(() => (layout.boxes || []).length);
    const r = await pilot(request, {
      verb: 'addTextBox', args: [{ page: 3, x: 1, y: 1, w: 2, md: 'relayed once' }],
      tab: await tabOf(leader),
    });
    expect(r.ok).toBe(true);
    await page.waitForTimeout(800);

    // ONE box in the tab that ran it — not two.
    expect(await leader.evaluate(() => (layout.boxes || []).length)).toBe(beforeL + 1);
    // And the follower is untouched, which is the coherence rule, not a bug:
    // each tab holds its OWN in-memory draft, so ops all go to one tab or
    // they would be editing two different documents.
    expect(await follower.evaluate(() => (layout.boxes || []).length)).toBe(beforeF);
    await second.close();
  });

  test('an op no editor claims names the problem instead of hanging',
    async ({ request }) => {
      // Aimed at a tab that does not exist, so no editor ANY other spec has
      // open can claim it — the deterministic way to test the unclaimed path
      // while the suite runs files in parallel.
      const r = await pilot(request, {
        verb: 'status', args: [], timeout: 2, tab: 'tab-nobody-has-this',
      });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('tab-nobody-has-this');
    });

  // "No editor is listening" was one sentence for every case, and an op that
  // named no project silently went to the default report's editor. The
  // refusal says where the op went.
  test('an unclaimed op that named no project says which project it went to',
    async ({ request }) => {
      const r = await request.post(`http://localhost:${PORT}/__pilot`, {
        data: { verb: 'status', args: [], timeout: 2, tab: 'tab-nobody-has-this' },
      }).then(x => x.json());
      expect(r.ok).toBe(false);
      expect(r.error).toContain('tab-nobody-has-this');
      expect(r.error).toContain('no project was named');
    });

  // 2026-11-09 (FINDINGS R9): the relay answered "no editor is listening"
  // twice with the editor open, and a direct eval in that same tab worked.
  // The browser calls a tab hidden for more than being in the background — a
  // Chrome window another window covers (macOS), the app's folded browser
  // pane — and a hidden tab never led, so nothing claimed the op.
  const hide = p => p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const show = p => p.evaluate(() => {
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const leads = p => p.evaluate(() => !!(window.__liveIsLeader && window.__liveIsLeader()));

  test('a hidden editor still runs relayed ops while no tab in view leads',
    async ({ page, request }) => {
      await gotoEditor(page);
      await expect.poll(() => leads(page)).toBe(true);
      const tab = await tabOf(page);
      await hide(page);
      // Two election beats: the old code had given the stream up by now.
      await page.waitForTimeout(4500);
      expect(await leads(page)).toBe(true);
      const r = await pilot(request, { verb: 'getSlot', args: ['basics.h1'], tab, timeout: 8 });
      expect(r.ok, r.error).toBe(true);
      expect(r.result.ok).toBe(true);
      await show(page);
    });

  test('a tab in view takes the stream over from a hidden one at once',
    async ({ page, context }) => {
      await gotoEditor(page);
      const second = await context.newPage();
      await gotoEditor(second);
      await expect.poll(async () => (await leads(page)) !== (await leads(second))).toBe(true);
      const leader = (await leads(page)) ? page : second;
      const other = leader === page ? second : page;
      await hide(leader);
      // Inside one beat or two — not the six seconds a lock takes to go stale.
      await expect.poll(() => leads(other), { timeout: 4500 }).toBe(true);
      await expect.poll(() => leads(leader), { timeout: 4500 }).toBe(false);
      await show(leader);
      await second.close();
    });

  // FINDINGS R9 again: /__export needed content and layout in the body, so
  // exporting the draft from outside took a one-shot receiver the page had to
  // post its own source and layout to. With neither, the open editor is asked
  // for its draft. (The suite's /__export answers a stand-in PDF, but which
  // draft it would have built, and that draft's digest, are real.)
  test('an export with neither content nor layout builds the open editor\'s unsaved draft',
    async ({ page, request }) => {
      await gotoEditor(page);
      await expect.poll(() => leads(page)).toBe(true);
      const tab = await tabOf(page);
      await page.evaluate(() => docsync.api.setSlot('basics.h1', 'UNSAVED, FOR THE EXPORT'));
      const want = await page.evaluate(async () => {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      });
      const r = await request.post(`http://localhost:${PORT}/__export`,
        { data: { project: 'budget-primer', fmt: 'pdf', tab } });
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toContain('application/pdf');
      expect(r.headers()['x-primer-draft']).toBe('editor');
      expect(r.headers()['x-primer-draft-sha']).toBe(want);

      // And the same pair as data, for a caller that wants the words.
      const d = await pilot(request, { verb: 'draft', tab });
      expect(d.result.ok).toBe(true);
      expect(d.result.content).toContain('UNSAVED, FOR THE EXPORT');
      expect(d.result.dirty).toBe(true);
      expect(JSON.parse(d.result.layout)).toBeTruthy();

      // saved: true is the files on disk, which do not have the words.
      const s = await request.post(`http://localhost:${PORT}/__export`,
        { data: { project: 'budget-primer', fmt: 'pdf', saved: true } });
      expect(s.status()).toBe(200);
      expect(s.headers()['x-primer-draft']).toBe('saved');
      expect(s.headers()['x-primer-draft-sha']).not.toBe(want);

      // One without the other is a mistake, said as one.
      const half = await request.post(`http://localhost:${PORT}/__export`,
        { data: { project: 'budget-primer', fmt: 'pdf', content: 'x' } });
      expect(half.status()).toBe(400);
      expect((await half.json()).error).toContain('together');
      await page.evaluate(() => docsync.api.undo());
    });
});
