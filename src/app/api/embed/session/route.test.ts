import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, OPTIONS } from './route';
import { auth } from '@/lib/auth';
import { verifyWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { __resetUserinfoCacheForTests } from '@/lib/embed/mp-oauth';
import { createEmbedSession, deleteEmbedSession, getEmbedSession } from '@/lib/embed/embed-session';

/**
 * POST /api/embed/session
 *
 * Covers the credential ladder in every auth mode: sid, mpUserToken (legacy v1 /
 * dual silent upgrade / hardened ignored), Better Auth same-origin, public;
 * plus origin gating and the per-IP rate limit.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com', 'https://other.example.org'],
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const ORIGIN = 'https://allowed.example.com';
const MP_USERINFO_URL = 'https://test-mp.example.com/oauth/connect/userinfo';
const getSessionMock = vi.mocked(auth.api.getSession);

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/session', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch stub: valid MP token "good-mp-token" → userinfo; anything else → 401. */
function stubUserinfoFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === MP_USERINFO_URL) {
      const authz = new Headers(init?.headers).get('authorization');
      if (authz === 'Bearer good-mp-token') {
        return jsonResponse({
          sub: 'user-guid-1',
          given_name: 'Ada',
          family_name: 'Lovelace',
          email: 'ada@example.com',
        });
      }
      return jsonResponse({ error: 'invalid_token' }, 401);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('POST /api/embed/session', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    __resetUserinfoCacheForTests();
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(null as never);
    vi.stubEnv('EMBED_AUTH_MODE', '');
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '');
    stubUserinfoFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubEnv('EMBED_AUTH_MODE', '');
    vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', '');
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  describe('request validation', () => {
    it('rejects invalid JSON with 400', async () => {
      const res = await POST(post('{not json'));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'invalid_body',
        message: 'Invalid or empty JSON body',
      });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    });

    it('rejects a missing wid with 400', async () => {
      const res = await POST(post({}));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'invalid_request',
        message: 'Missing required field: wid',
      });
    });

    it('rejects a disallowed origin with 403', async () => {
      const res = await POST(post({ wid: 'user-menu' }, { Origin: 'https://evil.example.net' }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/not allowed/);
    });

    it('answers OPTIONS preflight with 204 and CORS headers', async () => {
      const res = await OPTIONS(
        new NextRequest('http://localhost:3000/api/embed/session', {
          method: 'OPTIONS',
          headers: { Origin: ORIGIN },
        }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    });
  });

  describe('public token', () => {
    it.each(['legacy', 'dual', 'hardened'] as const)(
      'mints a v2 public token without sid in %s mode',
      async (mode) => {
        vi.stubEnv('EMBED_AUTH_MODE', mode);
        const res = await POST(post({ wid: 'full-calendar' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe(mode);
        expect(body.expiresIn).toBe(300);
        expect(body.sid).toBeUndefined();
        const claims = await verifyWidgetToken(body.token);
        expect(claims).toMatchObject({ sub: 'public', wid: 'full-calendar', origin: ORIGIN, ver: 2 });
        expect(claims.sid).toBeUndefined();
        expect(claims.mpAccessToken).toBeUndefined();
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
      },
    );

    it('defaults to legacy mode when EMBED_AUTH_MODE is unset', async () => {
      const res = await POST(post({ wid: 'user-menu' }));
      expect((await res.json()).mode).toBe('legacy');
    });
  });

  describe('mpUserToken (host page MP token)', () => {
    it('legacy: mints a v1 token carrying the MP access token', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'legacy');
      const res = await POST(post({ wid: 'user-menu', mpUserToken: 'good-mp-token' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe('legacy');
      expect(body.sid).toBeUndefined();
      const claims = await verifyWidgetToken(body.token);
      expect(claims).toMatchObject({
        sub: 'user-guid-1',
        wid: 'user-menu',
        origin: ORIGIN,
        ver: 1,
        mpAccessToken: 'good-mp-token',
      });
      expect(claims.sid).toBeUndefined();
      expect(getSessionMock).not.toHaveBeenCalled();
    });

    it('legacy: a stale MP token yields a public session, not an error', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'legacy');
      const res = await POST(post({ wid: 'user-menu', mpUserToken: 'expired-token' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      const claims = await verifyWidgetToken(body.token);
      expect(claims.sub).toBe('public');
      expect(claims.mpAccessToken).toBeUndefined();
      expect(body.sid).toBeUndefined();
    });

    it('dual: silently upgrades a valid MP token to a server-side session (v2 + sid)', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'dual');
      const res = await POST(post({ wid: 'user-menu', mpUserToken: 'good-mp-token' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe('dual');
      expect(typeof body.sid).toBe('string');
      expect(body.sid.length).toBeGreaterThan(20);

      const claims = await verifyWidgetToken(body.token);
      expect(claims).toMatchObject({ sub: 'user-guid-1', wid: 'user-menu', origin: ORIGIN, ver: 2, sid: body.sid });
      expect(claims.mpAccessToken).toBeUndefined();

      const record = await getEmbedSession(body.sid, ORIGIN);
      expect(record?.user).toEqual({
        userGuid: 'user-guid-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        imageGuid: null,
      });
      expect(record?.mpRefreshTokenEnc).toBeNull();
      // Default MP expiry when unknown is 3600s.
      expect(record!.mpExpiresAt - record!.createdAt).toBe(3600);
      // Sealed, never stored in the clear.
      expect(record?.mpAccessTokenEnc).not.toContain('good-mp-token');
    });

    it('dual: a stale MP token yields a public session', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'dual');
      const res = await POST(post({ wid: 'user-menu', mpUserToken: 'expired-token' }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sid).toBeUndefined();
      expect((await verifyWidgetToken(body.token)).sub).toBe('public');
    });

    it('hardened: ignores mpUserToken entirely and issues a public token', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'hardened');
      const fetchMock = stubUserinfoFetch();
      const res = await POST(post({ wid: 'user-menu', mpUserToken: 'good-mp-token' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe('hardened');
      expect(body.sid).toBeUndefined();
      const claims = await verifyWidgetToken(body.token);
      expect(claims.sub).toBe('public');
      expect(claims.mpAccessToken).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('honours a per-origin override (EMBED_AUTH_MODE_ORIGINS)', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'legacy');
      vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', `${ORIGIN}=hardened`);
      const res = await POST(post({ wid: 'user-menu', mpUserToken: 'good-mp-token' }));
      const body = await res.json();
      expect(body.mode).toBe('hardened');
      expect((await verifyWidgetToken(body.token)).sub).toBe('public');
    });
  });

  describe('sid (server-side session)', () => {
    async function seedSession() {
      const { sid } = await createEmbedSession({
        origin: ORIGIN,
        user: { userGuid: 'guid-42', firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
        mpAccessToken: 'mp-access',
        mpRefreshToken: 'mp-refresh',
      });
      return sid;
    }

    it.each(['legacy', 'dual', 'hardened'] as const)(
      'valid sid → v2 token bound to the session in %s mode',
      async (mode) => {
        vi.stubEnv('EMBED_AUTH_MODE', mode);
        const sid = await seedSession();
        const res = await POST(post({ wid: 'profile', sid }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe(mode);
        expect(body.expiresIn).toBe(300);
        // The response does not need to echo the sid the SDK already holds.
        const claims = await verifyWidgetToken(body.token);
        expect(claims).toMatchObject({ sub: 'guid-42', wid: 'profile', origin: ORIGIN, ver: 2, sid });
        expect(claims.mpAccessToken).toBeUndefined();
      },
    );

    it('unknown sid → 401 invalid_session with CORS headers', async () => {
      const res = await POST(post({ wid: 'profile', sid: 'not-a-real-sid' }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_session' });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    });

    it('deleted (logged out) sid → 401 invalid_session', async () => {
      const sid = await seedSession();
      await deleteEmbedSession(sid);
      const res = await POST(post({ wid: 'profile', sid }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_session' });
    });

    it('sid issued to a different origin → 401 invalid_session', async () => {
      const sid = await seedSession();
      const res = await POST(post({ wid: 'profile', sid }, { Origin: 'https://other.example.org' }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_session' });
    });

    it('sid takes precedence over a stale mpUserToken', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'dual');
      const sid = await seedSession();
      const res = await POST(post({ wid: 'profile', sid, mpUserToken: 'expired-token' }));
      expect(res.status).toBe(200);
      expect((await verifyWidgetToken((await res.json()).token)).sub).toBe('guid-42');
    });

    it('does not fall back to the MP token or public when the sid is invalid', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'dual');
      const res = await POST(post({ wid: 'profile', sid: 'bogus', mpUserToken: 'good-mp-token' }));
      expect(res.status).toBe(401);
    });
  });

  describe('Better Auth same-origin session', () => {
    const baSession = {
      user: {
        id: 'ba-1',
        userGuid: 'guid-ba',
        imageGuid: 'img-guid',
        firstName: 'Linus',
        lastName: 'Torvalds',
        email: 'linus@example.com',
      },
      session: {
        accessToken: 'ba-access',
        refreshToken: 'ba-refresh',
        idToken: 'ba-id',
        expiresAt: Math.floor(Date.now() / 1000) + 1800,
      },
    };

    it('legacy: mints a v1 token carrying the account access token', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'legacy');
      getSessionMock.mockResolvedValue(baSession as never);
      const res = await POST(post({ wid: 'user-menu' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sid).toBeUndefined();
      const claims = await verifyWidgetToken(body.token);
      expect(claims).toMatchObject({ sub: 'guid-ba', ver: 1, mpAccessToken: 'ba-access' });
      // TODO 24: this branch mints a widget JWT and (below) an embed session
      // with its own TTL, so the app session behind it must be read from the
      // store, not from a cache cookie a revoked caller could still present.
      expect(getSessionMock).toHaveBeenCalledWith({
        headers: expect.any(Headers),
        query: { disableCookieCache: true },
      });
    });

    it.each(['dual', 'hardened'] as const)(
      '%s: creates an embed session from the account tokens (refresh + id token kept)',
      async (mode) => {
        vi.stubEnv('EMBED_AUTH_MODE', mode);
        getSessionMock.mockResolvedValue(baSession as never);
        const res = await POST(post({ wid: 'user-menu' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.sid).toBe('string');
        const claims = await verifyWidgetToken(body.token);
        expect(claims).toMatchObject({ sub: 'guid-ba', ver: 2, sid: body.sid });
        expect(claims.mpAccessToken).toBeUndefined();

        const record = await getEmbedSession(body.sid, ORIGIN);
        expect(record?.user).toEqual({
          userGuid: 'guid-ba',
          firstName: 'Linus',
          lastName: 'Torvalds',
          email: 'linus@example.com',
          imageGuid: 'img-guid',
        });
        expect(record?.mpRefreshTokenEnc).toBeTruthy();
        expect(record?.mpIdTokenEnc).toBeTruthy();
        // expiresAt from the account is honoured (≈1800s, not the 3600 default).
        expect(record!.mpExpiresAt - record!.createdAt).toBeLessThanOrEqual(1800);
        expect(record!.mpExpiresAt - record!.createdAt).toBeGreaterThan(1700);
      },
    );

    it('falls back to public when there is no Better Auth session', async () => {
      vi.stubEnv('EMBED_AUTH_MODE', 'dual');
      getSessionMock.mockResolvedValue(null as never);
      const res = await POST(post({ wid: 'user-menu' }));
      const body = await res.json();
      expect(body.sid).toBeUndefined();
      expect((await verifyWidgetToken(body.token)).sub).toBe('public');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 with CORS headers once the per-IP limit is exceeded', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
      vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '2');
      const ip = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };

      expect((await POST(post({ wid: 'user-menu' }, ip))).status).toBe(200);
      expect((await POST(post({ wid: 'user-menu' }, ip))).status).toBe(200);
      const third = await POST(post({ wid: 'user-menu' }, ip));
      expect(third.status).toBe(429);
      expect(await third.json()).toEqual({
        error: 'rate_limited',
        message: 'Too many requests',
      });
      expect(third.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
      expect(third.headers.get('Retry-After')).toBe('60');

      // A different client IP is unaffected.
      const other = await POST(post({ wid: 'user-menu' }, { 'x-forwarded-for': '198.51.100.9' }));
      expect(other.status).toBe(200);
    });
  });
});
