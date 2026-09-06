import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { verifyStateToken } from '@/lib/embed/jwt';

/**
 * GET /api/embed/auth/login — validates origin/return_to, sets the signed state
 * cookie and redirects to the MP authorize endpoint.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));
vi.mock('@/lib/providers/ministry-platform', () => ({ MPHelper: vi.fn() }));

const ORIGIN = 'https://allowed.example.com';

function login(params: Record<string, string>, base = 'http://localhost:3000'): NextRequest {
  const url = new URL(`${base}/api/embed/auth/login`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe('GET /api/embed/auth/login', () => {
  afterEach(() => {
    vi.stubEnv('EMBED_PUBLIC_URL', '');
    vi.stubEnv('EMBED_OAUTH_PKCE', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  it('400 when origin is missing or not allowed', async () => {
    expect((await GET(login({ return_to: `${ORIGIN}/x` }))).status).toBe(400);
    expect(
      (await GET(login({ origin: 'https://evil.example.net', return_to: 'https://evil.example.net/x' }))).status,
    ).toBe(400);
    expect((await GET(login({ origin: 'not a url', return_to: `${ORIGIN}/x` }))).status).toBe(400);
  });

  it('400 when return_to is missing, relative, or on another origin', async () => {
    expect((await GET(login({ origin: ORIGIN }))).status).toBe(400);
    expect((await GET(login({ origin: ORIGIN, return_to: '/relative' }))).status).toBe(400);
    expect((await GET(login({ origin: ORIGIN, return_to: 'https://evil.example.net/page' }))).status).toBe(400);
    expect((await GET(login({ origin: ORIGIN, return_to: 'javascript:alert(1)' }))).status).toBe(400);
    // Subdomain of the origin is a different origin.
    expect((await GET(login({ origin: ORIGIN, return_to: 'https://sub.allowed.example.com/' }))).status).toBe(400);
  });

  it('302 to the MP authorize URL with state cookie set (http localhost → not Secure)', async () => {
    const res = await GET(login({ origin: ORIGIN, return_to: `${ORIGIN}/members#tab=1`, wid: 'user-menu' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://test-mp.example.com/oauth/connect/authorize');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/embed/auth/callback');
    expect(location.searchParams.get('realm')).toBe('realm');
    expect(location.searchParams.get('scope')).toContain('openid');
    expect(location.searchParams.get('scope')).toContain('offline_access');
    expect(location.searchParams.get('code_challenge')).toBeNull();
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();

    const cookie = res.cookies.get('nw_oauth_state');
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe('lax');
    expect(cookie!.path).toBe('/api/embed/auth');
    expect(cookie!.maxAge).toBe(600);
    expect(cookie!.secure).toBeFalsy();

    // The cookie is a signed state token carrying exactly what the callback needs.
    const payload = await verifyStateToken<Record<string, unknown>>(cookie!.value);
    expect(payload).toMatchObject({
      state,
      origin: ORIGIN,
      return_to: `${ORIGIN}/members#tab=1`,
      wid: 'user-menu',
    });
    expect(payload.nonce).toBe(location.searchParams.get('nonce'));
    expect(payload.codeVerifier).toBeUndefined();
    // Cookie must not be readable as a widget bearer token (different typ) — covered in jwt tests.
  });

  it('uses EMBED_PUBLIC_URL for redirect_uri and marks the cookie Secure on https', async () => {
    vi.stubEnv('EMBED_PUBLIC_URL', 'https://widgets.example.church');
    const res = await GET(login({ origin: ORIGIN, return_to: `${ORIGIN}/` }));
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('redirect_uri')).toBe('https://widgets.example.church/api/embed/auth/callback');
    expect(res.cookies.get('nw_oauth_state')!.secure).toBe(true);
  });

  it('defaults wid to user-menu and uses a fresh state per request', async () => {
    const a = await GET(login({ origin: ORIGIN, return_to: `${ORIGIN}/` }));
    const b = await GET(login({ origin: ORIGIN, return_to: `${ORIGIN}/` }));
    const stateA = new URL(a.headers.get('location')!).searchParams.get('state');
    const stateB = new URL(b.headers.get('location')!).searchParams.get('state');
    expect(stateA).not.toBe(stateB);
    const payload = await verifyStateToken<{ wid: string }>(a.cookies.get('nw_oauth_state')!.value);
    expect(payload.wid).toBe('user-menu');
  });

  it('adds PKCE when EMBED_OAUTH_PKCE=true and stores the verifier in the state', async () => {
    vi.stubEnv('EMBED_OAUTH_PKCE', 'true');
    const res = await GET(login({ origin: ORIGIN, return_to: `${ORIGIN}/` }));
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    const payload = await verifyStateToken<{ codeVerifier?: string }>(res.cookies.get('nw_oauth_state')!.value);
    expect(payload.codeVerifier).toBeTruthy();
  });
});
