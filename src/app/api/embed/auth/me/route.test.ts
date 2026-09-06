import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, OPTIONS } from './route';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { createEmbedSession, deleteEmbedSession } from '@/lib/embed/embed-session';
import { createWidgetToken } from '@/lib/embed/jwt';

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com', 'https://other.example.org'],
}));

const ORIGIN = 'https://allowed.example.com';

function get(token?: string, origin = ORIGIN): NextRequest {
  const headers: Record<string, string> = { Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost:3000/api/embed/auth/me', { headers });
}

describe('GET /api/embed/auth/me', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('public token → 401 { authenticated: false }', async () => {
    const token = await createWidgetToken({ sub: 'public', wid: 'user-menu', origin: ORIGIN, ver: 2 });
    const res = await GET(get(token));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('legacy v1 token (no sid) → 200 { authenticated: false }', async () => {
    const token = await createWidgetToken({
      sub: 'guid-1',
      wid: 'user-menu',
      origin: ORIGIN,
      ver: 1,
      mpAccessToken: 'mp-token',
    });
    const res = await GET(get(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it('v2 token with a live session → 200 { authenticated: true, user }', async () => {
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'guid-2', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', imageGuid: 'img' },
      mpAccessToken: 'mp-access',
    });
    const token = await createWidgetToken({ sub: 'guid-2', wid: 'profile', origin: ORIGIN, ver: 2, sid });
    const res = await GET(get(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: true,
      user: { userGuid: 'guid-2', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', imageGuid: 'img' },
    });
  });

  it('v2 token whose session was deleted → 401 invalid_session', async () => {
    const { sid } = await createEmbedSession({
      origin: ORIGIN,
      user: { userGuid: 'guid-3', firstName: 'A', lastName: 'B', email: 'a@b.c' },
      mpAccessToken: 'mp-access',
    });
    const token = await createWidgetToken({ sub: 'guid-3', wid: 'profile', origin: ORIGIN, ver: 2, sid });
    await deleteEmbedSession(sid);
    const res = await GET(get(token));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authenticated: false, error: 'invalid_session' });
  });

  it('missing or invalid bearer token → 401 { authenticated: false, error }', async () => {
    const none = await GET(get());
    expect(none.status).toBe(401);
    expect((await none.json()).authenticated).toBe(false);

    const bad = await GET(get('not-a-jwt'));
    expect(bad.status).toBe(401);
    expect((await bad.json()).authenticated).toBe(false);
  });

  it('token replayed from another allowed origin → 401 (origin binding)', async () => {
    const token = await createWidgetToken({ sub: 'guid-4', wid: 'profile', origin: ORIGIN, ver: 2, sid: 'x' });
    const res = await GET(get(token, 'https://other.example.org'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/origin mismatch/i);
  });

  it('answers OPTIONS preflight', async () => {
    const res = await OPTIONS(
      new NextRequest('http://localhost:3000/api/embed/auth/me', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(204);
  });
});
