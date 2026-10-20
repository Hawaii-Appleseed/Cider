// GitHub App installation tokens for the export (src/githubApp.js), against a fake
// GitHub that checks the JWT's signature with a REAL RSA key. Pinned: a PKCS#1
// key (what GitHub hands out) and a PKCS#8 one both sign a valid RS256 JWT;
// the token asked for is scoped to the one repository; it is cached until near
// expiry; a repo the app is not installed on is named; and exportToken() prefers
// the app over a personal token.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { appJwt, installationToken, clearTokenCache, exportToken, pkcs1ToPkcs8, pemBody } from './src/githubApp.js';
import { exportRoom } from './src/export.js';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs1 = pair.privateKey.export({ type: 'pkcs1', format: 'pem' });
const pkcs8 = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const decode = s => JSON.parse(Buffer.from(s, 'base64url').toString());

function verifies(jwt) {
  const [h, p, sig] = jwt.split('.');
  return createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicPem, Buffer.from(sig, 'base64url'));
}

beforeEach(() => clearTokenCache());

test('a PKCS#1 key wraps to PKCS#8 exactly as openssl would', () => {
  const body = pemBody(pkcs1);
  assert.equal(body.label, 'RSA PRIVATE KEY');
  const wrapped = Buffer.from(pkcs1ToPkcs8(body.der));
  assert.equal(wrapped.toString('hex'), Buffer.from(pemBody(pkcs8).der).toString('hex'));
});

test('the JWT is a valid RS256 signature over iss/iat/exp, for either key format', async () => {
  const now = () => Date.UTC(2026, 9, 20, 12, 0, 0);
  for (const key of [pkcs1, pkcs8]) {
    const jwt = await appJwt({ appId: 5402715, privateKey: key, now });
    assert.ok(verifies(jwt), 'the signature verifies against the public key');
    const claims = decode(jwt.split('.')[1]);
    assert.equal(claims.iss, '5402715');
    assert.ok(claims.exp - claims.iat <= 600, 'inside GitHub\'s 10 minute ceiling');
    assert.equal(decode(jwt.split('.')[0]).alg, 'RS256');
  }
});

test('a key that is not a PEM block, and a missing app id, are named', async () => {
  await assert.rejects(() => appJwt({ appId: 1, privateKey: 'nope' }), /not a PEM block/);
  await assert.rejects(() => appJwt({ appId: '', privateKey: pkcs1 }), /GITHUB_APP_ID/);
});

function fakeApp({ installed = ['Hawaii-Appleseed/Cider'], expires = '2026-10-20T13:00:00Z' } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET';
    calls.push(`${m} ${u.pathname}`);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    const bearer = (init.headers.authorization || '').replace('Bearer ', '');
    if (!verifies(bearer)) return json({ message: 'bad jwt' }, 401);
    let x;
    if ((x = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/installation$/))) {
      return installed.includes(x[1]) ? json({ id: 99 }) : json({ message: 'Not Found' }, 404);
    }
    if (u.pathname === '/app/installations/99/access_tokens' && m === 'POST') {
      calls.push(`body ${init.body}`);
      return json({ token: `ghs_${calls.length}`, expires_at: expires }, 201);
    }
    return json({ message: 'unhandled' }, 500);
  };
  return { fetch, calls };
}

test('the installation token is scoped to the one repository, and cached until near expiry', async () => {
  const gh = fakeApp();
  let t = Date.UTC(2026, 9, 20, 12, 0, 0);
  const ask = () => installationToken({ appId: 1, privateKey: pkcs1, nwo: 'Hawaii-Appleseed/Cider',
                                        api: 'https://gh.test', fetch: gh.fetch, now: () => t });
  const first = await ask();
  assert.match(first, /^ghs_/);
  assert.ok(gh.calls.includes('body {"repositories":["Cider"],"permissions":{"contents":"write"}}'));
  assert.equal(await ask(), first, 'the second ask is served from the cache');
  assert.equal(gh.calls.filter(c => c.startsWith('POST')).length, 1);
  t = Date.UTC(2026, 9, 20, 12, 59, 30);          // inside the last minute: mint again
  assert.notEqual(await ask(), first);
});

test('a repository the app is not installed on is named, not a bare 404', async () => {
  const gh = fakeApp({ installed: [] });
  await assert.rejects(() => installationToken({ appId: 1, privateKey: pkcs1, nwo: 'Hawaii-Appleseed/Other',
                                                 api: 'https://gh.test', fetch: gh.fetch }),
                       /not installed on Hawaii-Appleseed\/Other/);
});

test('exportToken prefers the app, falls back to a personal token, else nothing', () => {
  assert.equal(typeof exportToken({ GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: pkcs1, GITHUB_EXPORT_TOKEN: 'pat' }), 'function');
  assert.equal(exportToken({ GITHUB_EXPORT_TOKEN: 'pat' }), 'pat');
  assert.equal(exportToken({ GITHUB_APP_ID: '1' }), null, 'an id without a key is not a credential');
  assert.equal(exportToken({}), null);
});

test('the export asks the app for a token for the room\'s repository, once, and commits with it', async () => {
  const seen = [];
  const bucketStore = new Map([
    ['docs/Hawaii-Appleseed~Cider~p/meta.json', JSON.stringify({ version: 'v1', paths: { content: 'projects/p/content.md', branch: 'main' } })],
    ['docs/Hawaii-Appleseed~Cider~p/content.md', '[[a]]\nx\n'],
  ]);
  const bucket = {
    get: async k => (bucketStore.has(k) ? { text: async () => bucketStore.get(k), json: async () => JSON.parse(bucketStore.get(k)) } : null),
    put: async (k, v) => { bucketStore.set(k, v); }, list: async () => ({ objects: [], truncated: false }),
  };
  const f = async (url, init = {}) => {
    const u = new URL(url);
    seen.push(`${init.method || 'GET'} ${u.pathname} ${(init.headers.authorization || '').slice(0, 10)}`);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.pathname.endsWith('/installation')) return json({ id: 99 });
    if (u.pathname.includes('/access_tokens')) return json({ token: 'ghs_minted', expires_at: '2099-01-01T00:00:00Z' }, 201);
    if (u.pathname.includes('/git/ref/heads/hub')) return json({}, 404);
    if (u.pathname.includes('/git/ref/heads/main')) return json({ object: { sha: 'c0' } });
    if (u.pathname.endsWith('/git/refs')) return json({ object: { sha: 'c0' } }, 201);
    if (u.pathname.includes('/git/commits/c0')) return json({ tree: { sha: 't0' } });
    if (u.pathname.endsWith('/git/trees')) return json({ sha: 't1' }, 201);
    if (u.pathname.endsWith('/git/commits')) return json({ sha: 'c1' }, 201);
    if (u.pathname.includes('/git/refs/heads/hub')) return json({}, 200);
    return json({ message: 'unhandled ' + u.pathname }, 500);
  };
  const token = exportToken({ GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: pkcs1 }, { fetch: f });
  const r = await exportRoom({ bucket, room: 'Hawaii-Appleseed~Cider~p', token, api: 'https://gh.test', fetch: f });
  assert.equal(r.status, 'exported');
  const gitCalls = seen.filter(c => c.includes('/git/'));
  assert.ok(gitCalls.length > 0 && gitCalls.every(c => c.endsWith('Bearer ghs')), 'every git call carries the minted token');
  assert.equal(seen.filter(c => c.includes('/access_tokens')).length, 1, 'one token for the whole export');
});
