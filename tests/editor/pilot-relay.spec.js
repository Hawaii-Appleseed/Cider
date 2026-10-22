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
});
