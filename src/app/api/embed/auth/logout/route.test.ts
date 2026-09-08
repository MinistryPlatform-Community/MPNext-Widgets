/**
 * What the widget logout actually hands MinistryPlatform (TODO 29).
 *
 * MP only completes an end-session whose `post_logout_redirect_uri` is
 * registered on its OAuth client. An embed SDK's host pages never can be, so
 * these tests pin two things and will fail if either regresses:
 *
 *   1. no caller-supplied URL ever reaches `post_logout_redirect_uri`, and
 *   2. the visitor still gets back to their own page, via this route's sealed
 *      bounce rather than via MP.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET, OPTIONS } from './route';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { createEmbedSession, getEmbedSession } from '@/lib/embed/embed-session';
import { LOGOUT_RETURN_COOKIE, openLogoutReturn } from '@/lib/embed/logout-return';

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));
vi.mock('@/lib/providers/ministry-platform', () => ({ MPHelper: vi.fn() }));

const ORIGIN = 'https://allowed.example.com';
const ENDSESSION = 'https://test-mp.example.com/oauth/connect/endsession';
const REGISTERED = 'https://widgets.example.com/signin';

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/auth/logout', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(ticket?: string): NextRequest {
  const url = new URL('http://localhost:3000/api/embed/auth/logout');
  if (ticket !== undefined) url.searchParams.set('t', ticket);
  return new NextRequest(url, { method: 'GET' });
}

/** The `t` ticket out of the URL the POST told the SDK to navigate to. */
function ticketFrom(endSessionUrl: string): string {
  return new URL(endSessionUrl).searchParams.get('t') ?? '';
}

describe('POST /api/embed/auth/logout', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('deletes the session and returns a bounce URL on this host, not MP', async () => {
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'g', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'mp-access',
      mpIdToken: 'the-id-token',
    });

    const res = await POST(post({ sid, postLogoutRedirectUri: `${ORIGIN}/bye` }));
    expect(res.status).toBe(200);
    const { endSessionUrl } = await res.json();
    const url = new URL(endSessionUrl);

    expect(url.origin + url.pathname).toBe('http://localhost:3000/api/embed/auth/logout');
    // The host page is carried in an opaque ticket, never on the wire to MP.
    expect(endSessionUrl).not.toContain(ORIGIN);
    expect(await openLogoutReturn(url.searchParams.get('t'))).toEqual({
      returnTo: `${ORIGIN}/bye`,
      idToken: 'the-id-token',
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    expect(await getEmbedSession(sid, ORIGIN)).toBeNull();
  });

  it('goes straight to MP with the registered URI when no return target is asked for', async () => {
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'g', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'mp-access',
      mpIdToken: 'the-id-token',
    });

    const endSession = new URL((await (await POST(post({ sid }))).json()).endSessionUrl);
    expect(endSession.origin + endSession.pathname).toBe(ENDSESSION);
    expect(endSession.searchParams.get('id_token_hint')).toBe('the-id-token');
    expect(endSession.searchParams.get('post_logout_redirect_uri')).toBe(REGISTERED);
  });

  it('refuses a return target that is not on the requesting origin', async () => {
    const res = await POST(
      post({ sid: 'whatever', postLogoutRedirectUri: 'https://evil.example.net/' }),
    );
    const url = new URL((await res.json()).endSessionUrl);
    // Falls back to MP directly; the attacker's URL appears nowhere.
    expect(url.origin + url.pathname).toBe(ENDSESSION);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(REGISTERED);
    expect(url.toString()).not.toContain('evil.example.net');
  });

  it('is idempotent: unknown or missing sid still yields 200 with an end-session URL', async () => {
    const a = await POST(post({ sid: 'unknown' }));
    expect(a.status).toBe(200);
    expect((await a.json()).endSessionUrl.startsWith(ENDSESSION)).toBe(true);

    const b = await POST(post({}));
    expect(b.status).toBe(200);
    const url = new URL((await b.json()).endSessionUrl);
    expect(url.searchParams.has('id_token_hint')).toBe(false);
  });

  it('400 on invalid JSON, 403 on disallowed origin', async () => {
    expect((await POST(post('{bad'))).status).toBe(400);
    expect((await POST(post({ sid: 'x' }, { Origin: 'https://evil.example.net' }))).status).toBe(403);
  });

  it('answers OPTIONS preflight', async () => {
    const res = await OPTIONS(
      new NextRequest('http://localhost:3000/api/embed/auth/logout', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(204);
  });
});

describe('GET /api/embed/auth/logout (the bounce)', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('remembers the host page in a Lax cookie and forwards to MP with the registered URI', async () => {
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'g', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'mp-access',
      mpIdToken: 'the-id-token',
    });
    const posted = await POST(post({ sid, postLogoutRedirectUri: `${ORIGIN}/members` }));

    const res = await GET(get(ticketFrom((await posted.json()).endSessionUrl)));

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(ENDSESSION);
    expect(location.searchParams.get('id_token_hint')).toBe('the-id-token');
    expect(location.searchParams.get('post_logout_redirect_uri')).toBe(REGISTERED);

    const cookie = res.cookies.get(LOGOUT_RETURN_COOKIE);
    expect(cookie?.value).toBe(`${ORIGIN}/members`);
    expect(cookie?.httpOnly).toBe(true);
    // Lax, not None: the cookie is first-party to this host and only has to
    // survive MP's top-level GET navigation back.
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('still ends the MP session when the ticket is missing, junk, or tampered with', async () => {
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'g', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'mp-access',
      mpIdToken: 'the-id-token',
    });
    const good = ticketFrom(
      (await (await POST(post({ sid, postLogoutRedirectUri: `${ORIGIN}/x` }))).json()).endSessionUrl,
    );

    for (const ticket of [undefined, '', 'nonsense', `${good}tampered`]) {
      const res = await GET(get(ticket));
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.origin + location.pathname).toBe(ENDSESSION);
      expect(location.searchParams.get('post_logout_redirect_uri')).toBe(REGISTERED);
      expect(res.cookies.get(LOGOUT_RETURN_COOKIE)).toBeUndefined();
    }
  });
});
