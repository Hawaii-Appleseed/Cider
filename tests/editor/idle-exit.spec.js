// The server must STOP when its last editor window is gone.
//
// The launcher nohups serve.py and exits; closing the window killed nothing,
// so the server outlived it by days — running ever-staler code (the
// serverStale banner names that state) and holding the port. Windows now
// hello on load and goodbye on pagehide, and the server exits PRIMER_LINGER
// seconds after the last goodbye.
//
// This spec spawns ITS OWN serve.py on its own port with a 2-second linger —
// the suite's shared webServer runs with PRIMER_LINGER=0 precisely so spec
// traffic can never reap it, which also means it cannot be used to test the
// reaper. No browser needed: hello/bye are plain POSTs.
//
// It drives no editor code, so tools/affected.mjs cannot see what it runs:
// affected-by: report2027/tools/serve.py
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
// One port PER WORKER: the suite is fullyParallel, so both tests in this file
// can run at once — on a shared port the second spawn loses the bind and the
// tests silently talk to each other's servers.
const portFor = info => 8360 + info.parallelIndex;

test.describe('idle exit', () => {
  let proc, BASE;
  const ping = async request => {
    try { return (await request.get(`${BASE}/__ping`, { timeout: 2000 })).ok(); }
    catch (e) { return false; }
  };
  const post = (request, p, body) =>
    request.post(`${BASE}${p}`, { data: body, timeout: 4000 });
  test.beforeEach(async ({ request }) => {
    const port = portFor(test.info());
    BASE = `http://localhost:${port}`;
    proc = spawn('python3', ['report2027/tools/serve.py'], {
      cwd: REPO,
      env: { ...process.env, PRIMER_PORT: String(port), PRIMER_OPEN: '0',
             PRIMER_LINGER: '2', PRIMER_PUSH_PROBE: '0' },
      stdio: 'ignore',
    });
    await expect.poll(() => ping(request), { timeout: 30000 }).toBe(true);
  });
  test.afterEach(() => { try { proc.kill('SIGKILL'); } catch (e) {} });

  test('exits after the last window says goodbye — and not before', async ({ request }) => {
    await post(request, '/__hello', 'tab-a');

    // A live window pins it: idle far past LINGER changes nothing.
    await new Promise(r => setTimeout(r, 4000));
    expect(await ping(request),
      'reaped while a window was still registered').toBe(true);

    await post(request, '/__bye', 'tab-a');
    await expect.poll(() => ping(request), {
      timeout: 20000,
      message: 'last window said goodbye and the server is still running — '
        + 'the zombie the reaper exists to prevent',
    }).toBe(false);
    await expect.poll(() => proc.exitCode !== null, { timeout: 10000 }).toBe(true);
  });

  test('a server nobody opened a window on is left alone', async ({ request }) => {
    // make-live before the browser starts: exit is armed by presence,
    // never by absence alone.
    await new Promise(r => setTimeout(r, 4000));
    expect(await ping(request)).toBe(true);
  });
});
