/**
 * Boot a throwaway `wrangler dev` (Miniflare: real Durable Objects, real
 * websockets, real storage in a temp dir) for a test, and stop it after.
 * Shared by server.test.mjs, client.test.mjs and the editor's Playwright
 * collab specs.
 *
 *   const dev = await startDev({ port: 8788 });
 *   ...
 *   await dev.stop();
 *
 * Nothing it starts outlives the process that started it. wrangler spawns
 * workerd, so the relay is its own process group and is killed as one: on
 * stop(), when it fails to come up, and when this process exits with it
 * still running. That last case is a Playwright worker torn down in the
 * middle of a beforeAll — the hook timed out while wrangler was still coming
 * up, `relay` was never assigned, afterAll had nothing to stop — which is how
 * the 2026-10-19 test pass found a workerd from an earlier run still holding
 * 8793: a port that then reads as taken by nothing, on every later run,
 * until somebody finds the process by hand.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// This package's own wrangler, not `npx wrangler`: with collab/node_modules
// missing, npx fell through to fetching it from the registry and the boot
// died of a 90-second timeout instead of the one-line cause.
const WRANGLER = join(HERE, 'node_modules', '.bin', 'wrangler');

// The relays this process has started and not stopped, as group-killers.
const live = new Set();
const reap = () => { for (const kill of live) kill('SIGKILL'); live.clear(); };
process.once('exit', reap);
// A signal that ends the process never reaches 'exit' unless something
// handles it: reap, then let the signal go on to whatever else handles it —
// or, with nothing else listening, to what it was going to do.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(sig, () => {
    reap();
    if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
  });
}

/**
 * @param {object} o
 * @param {number} o.port
 * @param {Record<string,string>} [o.vars]   extra `--var` bindings (e.g. ALLOWED_ORIGINS)
 * @param {number} [o.timeoutMs]             default 90s
 * @param {string} [o.name]                  worker name (default: wrangler.jsonc's). Local dev
 *   wranglers register under it, and a `pages dev` binding `Class@name` finds
 *   the relay by it: two relays with one name (parallel workers, or another
 *   spec's relay) and the binding reaches whichever registered last.
 */
export async function startDev({ port, vars = {}, timeoutMs = 90_000, name = '' }) {
  if (!existsSync(WRANGLER)) {
    throw new Error(`${WRANGLER} is missing — collab/ is its own npm project: npm ci --prefix collab`);
  }
  const persistDir = mkdtempSync(join(tmpdir(), 'primer-collab-'));
  // The inspector port defaults to 9229 for every wrangler, and two test
  // files booting their own relay at once (node --test runs files in
  // parallel) collided on it — the second one died with EADDRINUSE and its
  // whole suite was cancelled. Derive it from the serving port instead.
  const args = ['dev', '--ip', '127.0.0.1', '--port', String(port),
                '--inspector-port', String(port + 1000),
                '--persist-to', persistDir, '--log-level', 'warn'];
  if (name) args.push('--name', name);
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  // Its own process group (detached), so wrangler and the workerd it spawns
  // go together: killing only the parent left workerd holding the port.
  const proc = spawn(WRANGLER, args, { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const kill = sig => { try { process.kill(-proc.pid, sig); } catch { /* already gone */ } };
  live.add(kill);

  const log = [];
  proc.stdout.on('data', d => log.push(String(d)));
  proc.stderr.on('data', d => log.push(String(d)));
  proc.on('error', e => log.push(`\n[wrangler could not start: ${e.message}]`));
  proc.on('exit', c => { if (c) log.push(`\n[wrangler exited ${c}]`); });

  const host = `127.0.0.1:${port}`;
  const down = async (why) => {
    kill('SIGTERM'); await sleep(400); kill('SIGKILL');
    live.delete(kill);
    rmSync(persistDir, { recursive: true, force: true });
    throw new Error(`${why}:\n${log.join('')}`);
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Dead already (the port taken, a bad flag): say so now, not in 90s.
    if (proc.exitCode !== null) await down(`wrangler dev on ${host} exited ${proc.exitCode} before it served`);
    if (Date.now() > deadline) await down(`wrangler dev on ${host} did not come up in ${timeoutMs / 1000}s`);
    try {
      // Bounded: a port something ELSE holds accepts the connection and never
      // answers, and an unbounded fetch then hangs here past every deadline.
      const r = await fetch(`http://${host}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(400);
  }

  return {
    host, port, proc, log,
    async stop() {
      live.delete(kill);
      kill('SIGTERM'); await sleep(500); kill('SIGKILL');
      rmSync(persistDir, { recursive: true, force: true });
    },
  };
}

// `node devserver.mjs [port]` — run one by hand and leave it up (Ctrl-C stops
// it), for driving a local editor with ?collab=http://127.0.0.1:<port>.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2] || 8787);
  const dev = await startDev({ port, vars: process.env.COLLAB_ALLOWED_ORIGINS
    ? { ALLOWED_ORIGINS: process.env.COLLAB_ALLOWED_ORIGINS } : {} });
  console.log(`primer-collab dev relay on http://${dev.host} (fresh storage; Ctrl-C to stop)`);
  process.on('SIGINT', async () => { await dev.stop(); process.exit(0); });
  await new Promise(() => {});
}
