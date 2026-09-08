import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, OPTIONS } from './route';

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));
vi.mock('@/lib/providers/ministry-platform', () => ({ MPHelper: vi.fn() }));

const ORIGIN = 'https://allowed.example.com';

function get(origin: string | null = ORIGIN): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/auth/config', {
    headers: origin ? { Origin: origin } : {},
  });
}

describe('GET /api/embed/auth/config', () => {
  afterEach(() => {
    vi.stubEnv('EMBED_AUTH_MODE', '');
    vi.stubEnv('EMBED_PUBLIC_URL', '');
    vi.stubEnv('BETTER_AUTH_URL', '');
  });

  it('returns the mode for the origin and absolute endpoint URLs derived from the request', async () => {
    vi.stubEnv('EMBED_AUTH_MODE', 'dual');
    vi.stubEnv('BETTER_AUTH_URL', '');
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: 'dual',
      loginUrl: 'http://localhost:3000/api/embed/auth/login',
      logoutUrl: 'http://localhost:3000/api/embed/auth/logout',
      meUrl: 'http://localhost:3000/api/embed/auth/me',
    });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('prefers EMBED_PUBLIC_URL for the advertised endpoints', async () => {
    vi.stubEnv('EMBED_PUBLIC_URL', 'https://widgets.example.church/');
    const body = await (await GET(get())).json();
    expect(body.loginUrl).toBe('https://widgets.example.church/api/embed/auth/login');
    expect(body.mode).toBe('legacy');
  });

  /**
   * TODO 29. `legacy` builds MP's end-session URL in the browser and cannot
   * discover the widget host's registered post-logout URI any other way. MP
   * refuses to complete a logout whose redirect URI is not registered on its
   * OAuth client, so guessing is not an option.
   */
  it('advertises the registered post-logout redirect URI when one is configured', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com');
    const body = await (await GET(get())).json();
    expect(body.postLogoutRedirectUri).toBe('https://widgets.example.com/signin');
  });

  it('omits it entirely when this deployment has none', async () => {
    vi.stubEnv('BETTER_AUTH_URL', '');
    const body = await (await GET(get())).json();
    expect('postLogoutRedirectUri' in body).toBe(false);
  });

  it('rejects a disallowed origin with 403', async () => {
    const res = await GET(get('https://evil.example.net'));
    expect(res.status).toBe(403);
  });

  it('answers OPTIONS preflight', async () => {
    const res = await OPTIONS(
      new NextRequest('http://localhost:3000/api/embed/auth/config', {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN },
      }),
    );
    expect(res.status).toBe(204);
  });
});
