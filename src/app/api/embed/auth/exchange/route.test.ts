import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, OPTIONS } from './route';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { createEmbedSession, createHandoffCode } from '@/lib/embed/embed-session';
import { verifyWidgetToken } from '@/lib/embed/jwt';

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com', 'https://other.example.org'],
}));
vi.mock('@/lib/providers/ministry-platform', () => ({ MPHelper: vi.fn() }));

const ORIGIN = 'https://allowed.example.com';

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/auth/exchange', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function seed(origin = ORIGIN, wid = 'user-menu') {
  const { sid } = await createEmbedSession({
    origin,
    user: { userGuid: 'guid-x', firstName: 'A', lastName: 'B', email: 'a@b.c' },
    mpAccessToken: 'mp-access',
  });
  const code = await createHandoffCode(sid, origin, wid);
  return { sid, code };
}

describe('POST /api/embed/auth/exchange', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.stubEnv('EMBED_AUTH_MODE', 'hardened');
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.stubEnv('EMBED_AUTH_MODE', '');
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('redeems a handoff code for { sid, token, expiresIn, mode }', async () => {
    const { sid, code } = await seed();
    const res = await POST(post({ code, wid: 'user-menu' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sid, expiresIn: 300, mode: 'hardened' });
    const claims = await verifyWidgetToken(body.token);
    expect(claims).toMatchObject({ sub: 'guid-x', wid: 'user-menu', origin: ORIGIN, ver: 2, sid });
    expect(claims.mpAccessToken).toBeUndefined();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('is single use', async () => {
    const { code } = await seed();
    expect((await POST(post({ code, wid: 'user-menu' }))).status).toBe(200);
    const second = await POST(post({ code, wid: 'user-menu' }));
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: 'invalid_code' });
  });

  it('rejects a code redeemed from a different (allowed) origin — and burns it', async () => {
    const { code } = await seed();
    const wrong = await POST(post({ code, wid: 'user-menu' }, { Origin: 'https://other.example.org' }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'invalid_code' });
    const right = await POST(post({ code, wid: 'user-menu' }));
    expect(right.status).toBe(400);
  });

  it('rejects unknown / empty codes and bad JSON', async () => {
    expect((await POST(post({ code: 'nope', wid: 'user-menu' }))).status).toBe(400);
    expect((await POST(post({ wid: 'user-menu' }))).status).toBe(400);
    expect((await POST(post('{bad'))).status).toBe(400);
  });

  it('falls back to the wid recorded at login when the body omits it', async () => {
    const { code } = await seed(ORIGIN, 'profile');
    const body = await (await POST(post({ code }))).json();
    expect((await verifyWidgetToken(body.token)).wid).toBe('profile');
  });

  it('403 for a disallowed origin', async () => {
    const { code } = await seed();
    expect((await POST(post({ code }, { Origin: 'https://evil.example.net' }))).status).toBe(403);
  });

  it('429 once the per-IP limit is exceeded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '1');
    const ip = { 'x-real-ip': '203.0.113.9' };
    await POST(post({ code: 'a' }, ip));
    const res = await POST(post({ code: 'b' }, ip));
    expect(res.status).toBe(429);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('answers OPTIONS preflight', async () => {
    const res = await OPTIONS(
      new NextRequest('http://localhost:3000/api/embed/auth/exchange', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(204);
  });
});
