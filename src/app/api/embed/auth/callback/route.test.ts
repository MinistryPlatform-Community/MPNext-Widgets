import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { GET as loginGET } from '../login/route';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { __resetUserinfoCacheForTests } from '@/lib/embed/mp-oauth';
import { getEmbedSession, redeemHandoffCode } from '@/lib/embed/embed-session';
import { open } from '@/lib/embed/crypto';

/**
 * GET /api/embed/auth/callback — state verification, code exchange, session +
 * handoff creation, fragment redirect back to the embedding page.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const { getTableRecordsMock } = vi.hoisted(() => ({ getTableRecordsMock: vi.fn() }));
vi.mock("@/lib/providers/ministry-platform", () => ({
  // A class: Vitest rejects arrow-function mock implementations invoked with `new`.
  MPHelper: class {
    getTableRecords = getTableRecordsMock;
  },
}));

const ORIGIN = 'https://allowed.example.com';
const RETURN_TO = `${ORIGIN}/members`;
const TOKEN_URL = 'https://test-mp.example.com/oauth/connect/token';
const USERINFO_URL = 'https://test-mp.example.com/oauth/connect/userinfo';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FetchOptions {
  tokenStatus?: number;
  userinfoStatus?: number;
}

function stubMpFetch(opts: FetchOptions = {}) {
  const calls: { url: string; body?: string }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url === TOKEN_URL) {
      if (opts.tokenStatus && opts.tokenStatus !== 200) return jsonResponse({ error: 'invalid_grant' }, opts.tokenStatus);
      return jsonResponse({
        access_token: 'mp-access-token',
        refresh_token: 'mp-refresh-token',
        id_token: 'mp-id-token',
        expires_in: 1200,
        token_type: 'Bearer',
      });
    }
    if (url === USERINFO_URL) {
      if (opts.userinfoStatus && opts.userinfoStatus !== 200) return jsonResponse({}, opts.userinfoStatus);
      return jsonResponse({ sub: 'guid-cb', given_name: 'Ada', family_name: 'Lovelace', email: 'ada@example.com' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

/** Run the login route to obtain a real state cookie + state value. */
async function startLogin(wid = 'user-menu', returnTo = RETURN_TO) {
  const url = new URL('http://localhost:3000/api/embed/auth/login');
  url.searchParams.set('origin', ORIGIN);
  url.searchParams.set('return_to', returnTo);
  url.searchParams.set('wid', wid);
  const res = await loginGET(new NextRequest(url));
  const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
  const cookie = res.cookies.get('nw_oauth_state')!.value;
  return { state, cookie };
}

function callback(params: Record<string, string>, cookie?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/embed/auth/callback');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, {
    headers: cookie ? { Cookie: `nw_oauth_state=${cookie}` } : {},
  });
}

function expectCookieCleared(res: Response & { cookies: { get(name: string): { value: string; maxAge?: number } | undefined } }) {
  const cleared = res.cookies.get('nw_oauth_state');
  expect(cleared).toBeDefined();
  expect(cleared!.value).toBe('');
  expect(cleared!.maxAge).toBe(0);
}

describe('GET /api/embed/auth/callback', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    __resetUserinfoCacheForTests();
    getTableRecordsMock.mockReset();
    getTableRecordsMock.mockResolvedValue([{ Image_GUID: 'photo-guid' }]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('happy path: creates a session, redirects to return_to with #nw_auth=<code>, clears the cookie', async () => {
    const { calls } = stubMpFetch();
    const { state, cookie } = await startLogin('profile');

    const res = await GET(callback({ code: 'auth-code-1', state }, cookie));
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expectCookieCleared(res);

    const location = res.headers.get('location')!;
    expect(location.startsWith(`${RETURN_TO}#nw_auth=`)).toBe(true);
    const handoff = decodeURIComponent(location.split('#nw_auth=')[1]);

    // Token exchange used the registered redirect_uri and the code.
    const tokenCall = calls.find((c) => c.url === TOKEN_URL)!;
    const form = new URLSearchParams(tokenCall.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code-1');
    expect(form.get('redirect_uri')).toBe('http://localhost:3000/api/embed/auth/callback');
    expect(form.get('client_id')).toBe('test-client-id');

    // Handoff is bound to origin + wid and resolves to a real session.
    const redeemed = await redeemHandoffCode(handoff, ORIGIN);
    expect(redeemed?.wid).toBe('profile');
    const record = await getEmbedSession(redeemed!.sid, ORIGIN);
    expect(record?.user).toEqual({
      userGuid: 'guid-cb',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      imageGuid: 'photo-guid',
    });
    expect(record!.mpExpiresAt - record!.createdAt).toBe(1200);
    expect(await open(record!.mpAccessTokenEnc)).toBe('mp-access-token');
    expect(await open(record!.mpRefreshTokenEnc!)).toBe('mp-refresh-token');
    expect(await open(record!.mpIdTokenEnc!)).toBe('mp-id-token');

    // Image lookup mirrors src/lib/auth.ts mapProfileToUser.
    expect(getTableRecordsMock).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'dp_Users', filter: "User_GUID = 'guid-cb'", top: 1 }),
    );
  });

  it('preserves an existing fragment on return_to (appends with &)', async () => {
    stubMpFetch();
    const { state, cookie } = await startLogin('user-menu', `${ORIGIN}/page#nw-tab=profile`);
    const res = await GET(callback({ code: 'c', state }, cookie));
    expect(res.headers.get('location')).toMatch(new RegExp(`^${ORIGIN}/page#nw-tab=profile&nw_auth=.+`));
  });

  it('does not fail login when the Image_GUID lookup throws', async () => {
    stubMpFetch();
    getTableRecordsMock.mockRejectedValue(new Error('MP down'));
    const { state, cookie } = await startLogin();
    const res = await GET(callback({ code: 'c', state }, cookie));
    expect(res.status).toBe(302);
    const handoff = decodeURIComponent(res.headers.get('location')!.split('#nw_auth=')[1]);
    const redeemed = await redeemHandoffCode(handoff, ORIGIN);
    const record = await getEmbedSession(redeemed!.sid, ORIGIN);
    expect(record?.user.imageGuid).toBeNull();
  });

  it('state mismatch → redirect with #nw_auth_error=state_mismatch and no MP calls', async () => {
    const { fetchMock } = stubMpFetch();
    const { cookie } = await startLogin();
    const res = await GET(callback({ code: 'c', state: 'forged-state' }, cookie));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${RETURN_TO}#nw_auth_error=state_mismatch`);
    expect(fetchMock).not.toHaveBeenCalled();
    expectCookieCleared(res);
  });

  it('missing state cookie → 400 text (return_to unknown)', async () => {
    stubMpFetch();
    const res = await GET(callback({ code: 'c', state: 'x' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('location')).toBeNull();
  });

  it('tampered state cookie → 400 text', async () => {
    stubMpFetch();
    const { state, cookie } = await startLogin();
    const res = await GET(callback({ code: 'c', state }, cookie.slice(0, -4) + 'AAAA'));
    expect(res.status).toBe(400);
  });

  it('provider error / missing code → exchange_failed', async () => {
    stubMpFetch();
    const { state, cookie } = await startLogin();
    const res = await GET(callback({ state, error: 'access_denied' }, cookie));
    expect(res.headers.get('location')).toBe(`${RETURN_TO}#nw_auth_error=exchange_failed`);
  });

  it('token endpoint failure → exchange_failed', async () => {
    stubMpFetch({ tokenStatus: 400 });
    const { state, cookie } = await startLogin();
    const res = await GET(callback({ code: 'bad', state }, cookie));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${RETURN_TO}#nw_auth_error=exchange_failed`);
  });

  it('userinfo failure → userinfo_failed', async () => {
    stubMpFetch({ userinfoStatus: 401 });
    const { state, cookie } = await startLogin();
    const res = await GET(callback({ code: 'c', state }, cookie));
    expect(res.headers.get('location')).toBe(`${RETURN_TO}#nw_auth_error=userinfo_failed`);
  });

  it('a state cookie cannot be replayed after use (single login per cookie)', async () => {
    stubMpFetch();
    const { state, cookie } = await startLogin();
    const first = await GET(callback({ code: 'c', state }, cookie));
    expect(first.status).toBe(302);
    // The browser has dropped the cookie (Max-Age=0); a replay without it is rejected.
    const replay = await GET(callback({ code: 'c', state }));
    expect(replay.status).toBe(400);
  });
});
