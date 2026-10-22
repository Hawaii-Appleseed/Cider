// The local server answers only its own pages (2026-10-22). It binds to
// loopback, but every web page open in the browser is on this Mac too, and
// a POST from any of them used to be read as JSON and acted on — /__push
// publishes, /__quit stops the server, /__oauth/save stores a token. A POST
// that names a page (Origin) must name one of this server's; the Host must
// be this server (DNS rebinding forges it); a request with no Origin — curl,
// the MCP server, the pilot loop — is not a browser's and still works.
// affected-by: report2027/tools/serve.py
const { test, expect } = require('./fixtures/editor-test');

const PORT = process.env.PRIMER_TEST_PORT || 8199;
const OWN = `http://localhost:${PORT}`;
// /__hello is harmless (it only notes a tab id) and answers every caller the
// same way, so it shows the gate and nothing else.
const post = (request, headers, path = '/__hello') =>
  request.post(`${OWN}${path}`, { headers, data: 'probe' });

test('a page on another site is refused, on every endpoint', async ({ request }) => {
  for (const path of ['/__hello', '/__save', '/__push', '/__quit', '/__pilot', '/__oauth/save']) {
    const r = await post(request, { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, path);
    expect(r.status(), path).toBe(403);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/may not drive this editor/);
  }
});

test('a forged Host is refused, and so is a null origin', async ({ request }) => {
  let r = await post(request, { Host: `attacker.example:${PORT}`, Origin: `http://attacker.example:${PORT}` });
  expect(r.status()).toBe(403);
  expect((await r.json()).error).toMatch(/Host .* is not this server/);
  r = await post(request, { Origin: 'null' });
  expect(r.status()).toBe(403);
});

test("the editor's own pages, and a caller with no origin, still work", async ({ request }) => {
  for (const headers of [
    { Origin: OWN },                                   // the editor itself
    { Origin: `http://localhost:${PORT}` },
    {},                                                // curl, the MCP server, the pilot loop
  ]) {
    const r = await post(request, headers);
    expect(r.status(), JSON.stringify(headers)).toBe(200);
    expect((await r.json()).ok).toBe(true);
  }
});
