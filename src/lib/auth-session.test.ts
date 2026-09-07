import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cover for TODO 24: a session-cache cookie captured before sign-out kept
 * authorizing until `cookieCache.maxAge`.
 *
 * `getSession` answers from the signed cache cookie without reading the
 * session store, so nothing on that path can see a revoked session. The fix is
 * better-auth's own split -- authoritative reads for access decisions,
 * cached reads for everything else -- so what these tests pin is that the two
 * helpers really do differ in the one query parameter that decides it, and
 * that each production call site picked the right one.
 */

const getSession = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

const { getAuthoritativeSession, getCachedSession, forceAuthoritativeSessionRead } =
  await import('@/lib/auth-session');

describe('getAuthoritativeSession', () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue(null);
  });

  it('bypasses the cookie cache so a revoked session cannot answer', async () => {
    const headers = new Headers({ cookie: 'better-auth.session_token=abc' });
    await getAuthoritativeSession(headers);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledWith({
      headers,
      query: { disableCookieCache: true },
    });
  });

  it('returns whatever the store says, including null for a revoked session', async () => {
    expect(await getAuthoritativeSession(new Headers())).toBeNull();

    const live = { user: { id: 'u1' }, session: { id: 's1' } };
    getSession.mockResolvedValue(live);
    expect(await getAuthoritativeSession(new Headers())).toBe(live);
  });
});

describe('getCachedSession', () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue(null);
  });

  it('leaves the cookie cache in play (item 14 optimisation intact)', async () => {
    const headers = new Headers();
    await getCachedSession(headers);

    expect(getSession).toHaveBeenCalledWith({ headers });
    // Explicit: passing `disableCookieCache: false` would also disable
    // nothing, but the absence of the query is what keeps this a cheap read.
    expect(getSession.mock.calls[0][0]).not.toHaveProperty('query');
  });
});

/**
 * Which call site gets which read is the actual security decision here, and it
 * is a one-token edit away from silently regressing. Assert it against the
 * real source so a future `auth.api.getSession(` sneaking back into an
 * authorization path fails the suite rather than the audit.
 */
describe('call sites use the right read', () => {
  const read = async (path: string) => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    return readFile(resolve(process.cwd(), path), 'utf8');
  };

  const authorizationPaths = [
    // The access boundary for every /demo route.
    'src/app/(demo)/layout.tsx',
    // Hands out live MP access / refresh / id tokens.
    'src/app/api/auth/session-tokens/route.ts',
    // Mints a widget JWT + opens an embed session with its own TTL.
    'src/app/api/embed/session/route.ts',
  ];

  for (const path of authorizationPaths) {
    it(`${path} reads the session authoritatively`, async () => {
      const source = await read(path);
      expect(source).toContain('getAuthoritativeSession');
      // The cached read must not reappear on an authorization path, whether
      // via the helper or by calling better-auth directly.
      expect(source).not.toContain('getCachedSession');
      expect(source).not.toContain('auth.api.getSession');
    });
  }

  const cachedPaths = [
    // Display name only; the layout above it already gated this render.
    'src/app/(demo)/demo/page.tsx',
    // De-escalation: reads an id_token in order to end the session.
    'src/app/api/auth/logout/route.ts',
  ];

  for (const path of cachedPaths) {
    it(`${path} keeps the cheap cached read`, async () => {
      const source = await read(path);
      expect(source).toContain('getCachedSession');
      expect(source).not.toContain('getAuthoritativeSession');
    });
  }

  it('the sign-in page agrees with the gate, or it loops', async () => {
    // /signin redirects away when it sees a session. If it trusted the cache
    // while /demo did not, a revoked-but-cached cookie would ping-pong between
    // the two until the cache expired.
    const source = await read('src/app/signin/page.tsx');
    expect(source).toMatch(
      /authClient\.getSession\(\s*\{\s*query:\s*\{\s*disableCookieCache:\s*true/,
    );
  });
});

describe('forceAuthoritativeSessionRead', () => {
  const rewrite = (url: string, init?: RequestInit) =>
    forceAuthoritativeSessionRead(new Request(url, init));

  it('forces the store read on GET /api/auth/get-session', () => {
    // Without this the endpoint answers a replayed pre-sign-out cookie with
    // 200 *and the MP access / refresh / id tokens*, because `customSession`
    // decorates it from the account cookie. Measured live; see TODO 24.
    const out = rewrite('http://localhost:3000/api/auth/get-session');
    expect(new URL(out.url).searchParams.get('disableCookieCache')).toBe('true');
    expect(out.method).toBe('GET');
  });

  it('preserves the caller headers and any other query params', () => {
    const out = rewrite(
      'http://localhost:3000/api/auth/get-session?disableRefresh=true',
      { headers: { cookie: 'better-auth.session_token=abc' } },
    );
    const url = new URL(out.url);
    expect(url.searchParams.get('disableRefresh')).toBe('true');
    expect(url.searchParams.get('disableCookieCache')).toBe('true');
    expect(out.headers.get('cookie')).toBe('better-auth.session_token=abc');
  });

  it('passes an already-authoritative request through untouched', () => {
    const req = new Request(
      'http://localhost:3000/api/auth/get-session?disableCookieCache=true',
    );
    expect(forceAuthoritativeSessionRead(req)).toBe(req);
  });

  it('leaves every other Better Auth endpoint alone', () => {
    for (const path of [
      '/api/auth/sign-out',
      '/api/auth/callback/ministryplatform',
      '/api/auth/get-session-like-but-not',
    ]) {
      const req = new Request(`http://localhost:3000${path}`);
      expect(forceAuthoritativeSessionRead(req)).toBe(req);
    }
  });

  it('is wired into the Better Auth catch-all route', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const source = await readFile(
      resolve(process.cwd(), 'src/app/api/auth/[...all]/route.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /handlers\.GET\(\s*forceAuthoritativeSessionRead\(request\)/,
    );
  });
});
