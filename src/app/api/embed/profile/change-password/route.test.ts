import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { createEmbedSession } from '@/lib/embed/embed-session';
import { createWidgetToken } from '@/lib/embed/jwt';

/**
 * POST /api/embed/profile/change-password — the MP token now comes from
 * getMpUserAccessToken(claims): v1 tokens carry it, v2 tokens resolve it from
 * the server-side session; an unusable session is a 401.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const ORIGIN = 'https://allowed.example.com';
const CHANGE_PW_URL = 'https://test-mp.example.com/oauth/account/change-password';
const VALID_BODY = { oldPassword: 'OldPassw0rd!', newPassword: 'NewPassw0rd!!', confirmPassword: 'NewPassw0rd!!' };

function post(token: string, body: unknown = VALID_BODY): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/profile/change-password', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** fetch stub that records the Authorization header sent to MP. */
function stubMpFetch() {
  const authHeaders: (string | null)[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === CHANGE_PW_URL) {
      authHeaders.push(new Headers(init?.headers).get("authorization"));
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, authHeaders };
}

describe('POST /api/embed/profile/change-password', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('v1 token: forwards the embedded MP access token', async () => {
    const { authHeaders } = stubMpFetch();
    const token = await createWidgetToken({
      sub: 'guid-1',
      wid: 'profile',
      origin: ORIGIN,
      ver: 1,
      mpAccessToken: 'legacy-mp-token',
    });
    const res = await POST(post(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(authHeaders).toEqual(['Bearer legacy-mp-token']);
  });

  it('v2 token: resolves the MP access token from the server-side session', async () => {
    const { authHeaders } = stubMpFetch();
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'guid-2', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'session-mp-token',
    });
    const token = await createWidgetToken({ sub: 'guid-2', wid: 'user-menu', origin: ORIGIN, ver: 2, sid });
    const res = await POST(post(token));
    expect(res.status).toBe(200);
    expect(authHeaders).toEqual(['Bearer session-mp-token']);
  });

  it('v2 token with an expired, non-refreshable MP token → 401 "Session expired"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { fetchMock } = stubMpFetch();
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'guid-3', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'short-lived',
      mpExpiresIn: 30,
    });
    const token = await createWidgetToken({ sub: 'guid-3', wid: 'user-menu', origin: ORIGIN, ver: 2, sid });
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));

    const res = await POST(post(token));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Session expired. Please sign in again.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('public token → 401 Authentication required', async () => {
    stubMpFetch();
    const token = await createWidgetToken({ sub: 'public', wid: 'profile', origin: ORIGIN, ver: 2 });
    const res = await POST(post(token));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
  });
});
