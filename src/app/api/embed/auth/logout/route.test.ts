import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, OPTIONS } from './route';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { createEmbedSession, getEmbedSession } from '@/lib/embed/embed-session';

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));
vi.mock('@/lib/providers/ministry-platform', () => ({ MPHelper: vi.fn() }));

const ORIGIN = 'https://allowed.example.com';
const ENDSESSION = 'https://test-mp.example.com/oauth/connect/endsession';

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/auth/logout', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/embed/auth/logout', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('deletes the session and returns an end-session URL with id_token_hint and same-origin redirect', async () => {
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
    expect(url.origin + url.pathname).toBe(ENDSESSION);
    expect(url.searchParams.get('id_token_hint')).toBe('the-id-token');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${ORIGIN}/bye`);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    expect(await getEmbedSession(sid, ORIGIN)).toBeNull();
  });

  it('drops a postLogoutRedirectUri that is not on the requesting origin', async () => {
    const res = await POST(post({ sid: 'whatever', postLogoutRedirectUri: 'https://evil.example.net/' }));
    const url = new URL((await res.json()).endSessionUrl);
    expect(url.searchParams.has('post_logout_redirect_uri')).toBe(false);
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
