// The MCP `pilot` tool and the single-page thumbnail — the two pieces that
// let an AI drive and SEE the editor without a browser eval or a full
// screenshot round trip.
//
// pilot is not the out-of-band write mcp_server.py refuses to have: it POSTs
// to /__pilot and the verb runs inside the open editor's own docsync.api.
// This spec pins exactly that — the edit shows up in the LIVE editor tab, and
// one undo there reverses it.
const { test, expect, gotoEditor, settled } = require('./fixtures/editor-test');
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = process.env.PRIMER_TEST_PORT || 8199;

test.describe.configure({ mode: 'serial' });

async function session() {
  const proc = spawn('python3', [path.join(REPO, 'docsync', 'mcp_server.py')], {
    cwd: REPO,
    env: { ...process.env, PRIMER_URL: `http://localhost:${PORT}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const waiters = [];
  proc.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line && waiters.length) waiters.shift()(JSON.parse(line));
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout on ${method}`)), 120000);
    waiters.push(v => { clearTimeout(t); resolve(v); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
  });
  await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '1' },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    return JSON.parse(r.result.content[0].text);
  };
  return { call, rpc, close: () => proc.kill() };
}

test.describe('pilot over MCP', () => {
  test('the tool is advertised with the verbs a pilot needs', async () => {
    const s = await session();
    const r = await s.rpc('tools/list', {});
    const t = r.result.tools.find(x => x.name === 'pilot');
    expect(t).toBeTruthy();
    expect(t.description).toContain('setSlot');
    expect(t.description).toContain('audit');
    expect(t.inputSchema.required).toEqual(['project', 'verb']);
    s.close();
  });

  test('a verb called over MCP lands in the OPEN editor and is one undo away',
    async ({ page }) => {
      await gotoEditor(page);
      await page.waitForTimeout(1200);
      const s = await session();

      const r = await s.call('pilot', {
        project: 'budget-primer', verb: 'setSlot',
        args: ['basics.h1', 'FROM MCP'],
        // Aim at THIS page's editor: the suite runs files in parallel and each
        // browser context elects its own leader, so an untargeted op could be
        // claimed by another spec's tab and run in a document not asserted on.
        tab: await page.evaluate(() => docsync.api.status().tab),
      });
      // The envelope is unwrapped: this IS the verb's own return value.
      expect(r.ok).toBe(true);
      expect(r.dirty).toBe(true);

      await expect(page.frameLocator('#out').locator('[data-slot="basics.h1"]'))
        .toContainText('FROM MCP');
      await page.evaluate(() => docsync.api.undo());
      expect(await page.evaluate(() => docsync.api.getSlot('basics.h1').md))
        .not.toBe('FROM MCP');
      s.close();
    });

  test('audit comes back as data — the screenshot a pilot does not have to take',
    async ({ page }) => {
      await gotoEditor(page);
      await settled(page);
      const s = await session();
      const r = await s.call('pilot', { project: 'budget-primer', verb: 'audit',
        tab: await page.evaluate(() => docsync.api.status().tab) });
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.issues)).toBe(true);
      expect(r.counts).toBeTruthy();
      s.close();
    });

  test('an unclaimable op says so rather than writing a file', async () => {
    const s = await session();
    const r = await s.call('pilot', {
      project: 'budget-primer', verb: 'status', args: [], timeout: 2,
      tab: 'tab-nobody-has-this',      // deterministic under parallel files
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('tab-nobody-has-this');
    s.close();
  });

  // The thumbnail's ARGUMENTS, not its pixels. A real /__export shells a full
  // render plus headless Chrome against the binding's own checkout — which for
  // budget-primer is /Users/…/BudgetPrimerFinal, a live repo, not this
  // fixture. That is precisely why the suite mocks /__export for the browser
  // (see fixtures/editor-test.js), and the `request` fixture goes AROUND that
  // mock: it is a separate context that page routes never touch. So this
  // exercises the validation that now runs BEFORE any of that happens, and
  // leaves the Chrome path to a human with a real report in front of them.
  test('a bad page or scale is refused up front, before any build runs',
    async ({ request }) => {
      const post = (extra) => request.post(`http://localhost:${PORT}/__export`, {
        data: { project: 'budget-primer', fmt: 'png',
                content: '', layout: '{}', ...extra },
      });

      for (const [args, why] of [
        [{ page: 'first' }, 'page must be a number'],
        [{ page: 0 }, 'page starts at 1'],
        [{ scale: 'big' }, 'scale must be a number'],
      ]) {
        const r = await post(args);
        expect(r.status(), JSON.stringify(args)).toBe(400);
        expect((await r.json()).error).toContain(why);
      }
    });
});
