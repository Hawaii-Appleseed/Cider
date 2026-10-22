// Ports for the servers a spec boots for itself — the collab relays, the hub
// and the identity proxies in front of it. They were fixed numbers (8792,
// 8793, 8794, 8798–8800), and a fixed number is only free on the machine
// that chose it: on the Mac mini 8799 is agent-room, 8794 a Python service
// and 8792 Claude Voice, and a relay an earlier run failed to stop holds its
// port too — the 2026-10-19 test pass had to shift them all by hand before
// the collab specs would run there at all. So a spec CLAIMS its ports in its
// beforeAll: the environment may name one (PRIMER_COLLAB_PORT=…), else it
// takes the first free number at or above the default, probed by binding to
// it. The probe steps by TEN: each spec's default has its own last digit, so
// two specs claiming at once (the three collab files run in separate
// workers) walk their own residue classes and never into each other's
// defaults. A wrangler also takes port+1000 for its inspector
// (collab/devserver.mjs, collab/hub-check.mjs), so a relay's port is free
// only when both are: `span` lists the offsets that must be free together.
const net = require('net');

const STEP = 10, TRIES = 50;
const claimed = new Set();     // this worker's own claims, so they never overlap

function bindable(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.unref();
    s.once('error', () => resolve(false));
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => s.close(() => resolve(true)));
  });
}

/**
 * The port for `name`: PRIMER_<NAME>_PORT if the environment names one, else
 * the first free one at or above `from`, stepping by 10. `span` lists the
 * offsets that must be free with it (a wrangler: [0, 1000]).
 */
async function claimPort(name, from, { span = [0] } = {}) {
  const env = `PRIMER_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PORT`;
  const named = Number(process.env[env]);
  if (named) {
    span.forEach(o => claimed.add(named + o));
    return named;
  }
  for (let p = from, i = 0; i < TRIES; p += STEP, i++) {
    if (span.some(o => claimed.has(p + o))) continue;
    let ok = true;
    for (const o of span) if (!(await bindable(p + o))) { ok = false; break; }
    if (!ok) continue;
    span.forEach(o => claimed.add(p + o));
    return p;
  }
  throw new Error(`no free port for ${name} between ${from} and ${from + STEP * TRIES} (every ${STEP}th); name one: ${env}=<port>`);
}

module.exports = { claimPort };
