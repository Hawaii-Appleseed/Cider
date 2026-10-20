/**
 * GitHub App installation tokens, for the Worker's export (step 05).
 *
 * The export commits to a repository, and until now that needed a long-lived
 * personal token (GITHUB_EXPORT_TOKEN) somebody had to create and, when it
 * expired, renew. A GitHub App replaces it: the Worker holds the app's id and
 * private key, and for each export asks GitHub for a token that works for THAT
 * repository alone and dies in an hour. Nothing to renew, nothing broader than
 * the one repo in hand, and any repository the app is installed on works
 * without further setup.
 *
 *   GITHUB_APP_ID           the app's numeric id (public)
 *   GITHUB_APP_PRIVATE_KEY  the .pem GitHub generated, exactly as downloaded
 *
 * GitHub gives the key as PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto only reads
 * PKCS#8, so the key is wrapped here rather than asking anyone to convert it
 * with openssl. PKCS#8 ("BEGIN PRIVATE KEY") is accepted too.
 *
 * Pure with respect to its inputs: `fetch` and `now` are passed in, so the tests
 * run against a fake GitHub with a real key.
 */
const b64url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = new TextEncoder();

/** The bytes inside a PEM block, whatever its label. */
export function pemBody(pem) {
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(String(pem || '').replace(/\\n/g, '\n'));
  if (!m) throw new Error('the GitHub App private key is not a PEM block');
  const bin = atob(m[2].replace(/\s+/g, ''));
  return { label: m[1], der: Uint8Array.from(bin, c => c.charCodeAt(0)) };
}

function derLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}
const der = (tag, ...parts) => {
  const body = parts.flatMap(p => [...p]);
  return Uint8Array.from([tag, ...derLength(body.length), ...body]);
};

/** A PKCS#1 RSA private key wrapped as PKCS#8 (RFC 5208), which WebCrypto reads. */
export function pkcs1ToPkcs8(pkcs1) {
  const algorithm = der(0x30,
    der(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),   // rsaEncryption
    der(0x05, []));                                                      // NULL
  return der(0x30, der(0x02, [0x00]), algorithm, der(0x04, pkcs1));
}

async function importKey(pem) {
  const { label, der: bytes } = pemBody(pem);
  const pkcs8 = label === 'RSA PRIVATE KEY' ? pkcs1ToPkcs8(bytes) : bytes;
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** The app's own short-lived JWT (RS256), what GitHub wants for app-level calls. */
export async function appJwt({ appId, privateKey, now = () => Date.now() }) {
  if (!appId) throw new Error('no GitHub App id (GITHUB_APP_ID)');
  const t = Math.floor(now() / 1000);
  // 60 s back for clock drift, and well inside GitHub's 10 minute ceiling.
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(privateKey), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const cache = new Map();   // nwo -> { token, expires }

/**
 * A token for one repository. Cached for the life of the isolate until a minute
 * before it expires, so a sweep over many rooms in one repository asks once.
 */
export async function installationToken({ appId, privateKey, nwo, api = 'https://api.github.com',
                                          fetch: f = globalThis.fetch, now = () => Date.now() }) {
  const hit = cache.get(`${appId}:${nwo}`);
  if (hit && hit.expires - 60_000 > now()) return hit.token;

  const jwt = await appJwt({ appId, privateKey, now });
  const call = async (path, init = {}) => {
    const r = await f(`${api}${path}`, { ...init, headers: {
      authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': 'primer-collab export',
      ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`GitHub ${r.status} on ${init.method || 'GET'} ${path}: ${t.slice(0, 160)}`);
    }
    return r.json();
  };
  const [owner, name] = nwo.split('/');
  const inst = await call(`/repos/${owner}/${name}/installation`)
    .catch(e => { throw new Error(`the GitHub App is not installed on ${nwo} (${e.message})`); });
  const out = await call(`/app/installations/${inst.id}/access_tokens`, {
    method: 'POST', body: JSON.stringify({ repositories: [name], permissions: { contents: 'write' } }) });
  cache.set(`${appId}:${nwo}`, { token: out.token, expires: Date.parse(out.expires_at) || now() + 3_600_000 });
  return out.token;
}

/** Forget cached tokens (tests). */
export const clearTokenCache = () => cache.clear();

/**
 * What the export should authenticate with, from the Worker's env: a function
 * (nwo -> token) when the app is configured, else the personal token it used to
 * hold, else null. The app wins when both are present.
 */
export function exportToken(env, { fetch: f = globalThis.fetch } = {}) {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    return nwo => installationToken({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY,
                                      nwo, api: env.GITHUB_API || undefined, fetch: f });
  }
  return env.GITHUB_EXPORT_TOKEN || null;
}
