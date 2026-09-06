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
  });

  it('returns the mode for the origin and absolute endpoint URLs derived from the request', async () => {
    vi.stubEnv('EMBED_AUTH_MODE', 'dual');
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
