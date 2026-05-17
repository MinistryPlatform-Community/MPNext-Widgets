import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resolveRequestOrigin,
  isOriginAllowed,
  requireWidgetAuth,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
  getCorsHeaders,
} from './auth';
import { createWidgetToken } from './jwt';

/**
 * Auth Tests
 *
 * Tests the embed widget auth middleware + CORS helpers:
 * - requireWidgetAuth: token extraction, widget validation, origin allowlist
 * - resolveRequestOrigin: Origin header with Referer fallback
 * - isOriginAllowed: exact + wildcard subdomain matching
 * - buildOptionsResponse / buildFallbackCorsHeaders / getCorsHeaders: CORS shapes
 *
 * We mock the './config' module so the allowedOrigins list is deterministic
 * regardless of host env vars at test-run time.
 */

vi.mock('./config', () => ({
  allowedOrigins: [
    'https://allowed.example.com',
    'https://other.example.org',
    '*.wild.example.com',
  ],
}));

const TEST_ORIGIN = 'https://allowed.example.com';

function buildAuthedRequest({
  token,
  origin = TEST_ORIGIN,
  authHeader,
}: {
  token?: string;
  origin?: string | null;
  authHeader?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers['Authorization'] = authHeader;
  } else if (token !== undefined) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (origin) headers['Origin'] = origin;
  return new NextRequest('http://localhost/api/embed/session', { headers });
}

describe('resolveRequestOrigin', () => {
  it('returns the Origin header when present', () => {
    const req = new NextRequest('http://localhost/api/embed/session', {
      headers: { Origin: 'https://example.com' },
    });
    expect(resolveRequestOrigin(req)).toBe('https://example.com');
  });

  it('falls back to the Referer origin when Origin is missing', () => {
    const req = new NextRequest('http://localhost/api/embed/session', {
      headers: { Referer: 'https://example.com/some/path?q=1' },
    });
    expect(resolveRequestOrigin(req)).toBe('https://example.com');
  });

  it('prefers Origin over Referer when both present', () => {
    const req = new NextRequest('http://localhost/api/embed/session', {
      headers: {
        Origin: 'https://from-origin.example.com',
        Referer: 'https://from-referer.example.com/page',
      },
    });
    expect(resolveRequestOrigin(req)).toBe('https://from-origin.example.com');
  });

  it('returns "" when Referer is malformed', () => {
    const req = new NextRequest('http://localhost/api/embed/session', {
      headers: { Referer: 'not a url' },
    });
    expect(resolveRequestOrigin(req)).toBe('');
  });

  it('returns "" when neither header is present', () => {
    const req = new NextRequest('http://localhost/api/embed/session');
    expect(resolveRequestOrigin(req)).toBe('');
  });
});

describe('isOriginAllowed', () => {
  const origins = [
    'https://allowed.example.com',
    'https://other.example.org',
    '*.wild.example.com',
  ];

  it('returns false for empty origin', () => {
    expect(isOriginAllowed('', origins)).toBe(false);
  });

  it('returns true on exact match', () => {
    expect(isOriginAllowed('https://allowed.example.com', origins)).toBe(true);
    expect(isOriginAllowed('https://other.example.org', origins)).toBe(true);
  });

  it('returns false for an origin not in the list', () => {
    expect(isOriginAllowed('https://evil.example.com', origins)).toBe(false);
  });

  it('matches wildcard *.wild.example.com against subdomains', () => {
    expect(isOriginAllowed('https://sub.wild.example.com', origins)).toBe(true);
    expect(isOriginAllowed('https://a.b.wild.example.com', origins)).toBe(true);
  });

  it('does not match a wildcard against an unrelated domain', () => {
    expect(isOriginAllowed('https://wild.example.org', origins)).toBe(false);
  });

  it('returns false against an empty allowlist', () => {
    expect(isOriginAllowed('https://allowed.example.com', [])).toBe(false);
  });
});

describe('requireWidgetAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Re-establish the default test env stubs set in src/test-setup.ts
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'EMBED_JWT_SECRET',
      'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256',
    );
  });

  it('throws when Authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/embed/session', {
      headers: { Origin: TEST_ORIGIN },
    });
    await expect(requireWidgetAuth(req, { widget: 'user-menu' })).rejects.toThrow(
      /Missing Authorization header/,
    );
  });

  it('throws when Authorization header is not Bearer scheme', async () => {
    const req = buildAuthedRequest({ authHeader: 'Basic abc123' });
    await expect(requireWidgetAuth(req, { widget: 'user-menu' })).rejects.toThrow(
      /Invalid Authorization header format/,
    );
  });

  it('throws when Bearer token is missing/empty', async () => {
    const req = buildAuthedRequest({ authHeader: 'Bearer ' });
    // 'Bearer ' splits to ['Bearer', ''] → format check fails first
    await expect(requireWidgetAuth(req, { widget: 'user-menu' })).rejects.toThrow();
  });

  it('throws when token fails signature verification', async () => {
    const req = buildAuthedRequest({ token: 'not.a.valid-jwt' });
    await expect(requireWidgetAuth(req, { widget: 'user-menu' })).rejects.toThrow(
      /Token verification failed/,
    );
  });

  it('returns claims for a valid token with matching widget + allowed origin', async () => {
    const token = await createWidgetToken({
      sub: 'user-1',
      wid: 'user-menu',
      mpAccessToken: 'mp-token',
      origin: TEST_ORIGIN,
    });
    const req = buildAuthedRequest({ token });

    const claims = await requireWidgetAuth(req, { widget: 'user-menu' });
    expect(claims.sub).toBe('user-1');
    expect(claims.wid).toBe('user-menu');
    expect(claims.mpAccessToken).toBe('mp-token');
  });

  it('throws when token widget does not match expected widget', async () => {
    const token = await createWidgetToken({
      sub: 'user-1',
      wid: 'add-to-calendar',
      mpAccessToken: 'mp-token',
      origin: TEST_ORIGIN,
    });
    const req = buildAuthedRequest({ token });

    await expect(requireWidgetAuth(req, { widget: 'user-menu' })).rejects.toThrow(
      /Invalid widget/,
    );
  });

  it('accepts any widget in an allowed-widget array', async () => {
    const token = await createWidgetToken({
      sub: 'user-1',
      wid: 'full-calendar',
      mpAccessToken: 'mp-token',
      origin: TEST_ORIGIN,
    });
    const req = buildAuthedRequest({ token });

    const claims = await requireWidgetAuth(req, {
      widget: ['user-menu', 'full-calendar'],
    });
    expect(claims.wid).toBe('full-calendar');
  });

  it('throws in production when origin is not in allowlist', async () => {
    const token = await createWidgetToken({
      sub: 'user-1',
      wid: 'user-menu',
      mpAccessToken: 'mp-token',
      origin: 'https://evil.example.com',
    });
    const req = buildAuthedRequest({
      token,
      origin: 'https://evil.example.com',
    });

    await expect(requireWidgetAuth(req, { widget: 'user-menu' })).rejects.toThrow(
      /not allowed/,
    );
  });

  it('only warns (does not throw) in development when origin is not allowed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const token = await createWidgetToken({
      sub: 'user-1',
      wid: 'user-menu',
      mpAccessToken: 'mp-token',
      origin: 'https://evil.example.com',
    });
    const req = buildAuthedRequest({
      token,
      origin: 'https://evil.example.com',
    });

    const claims = await requireWidgetAuth(req, { widget: 'user-menu' });
    expect(claims.sub).toBe('user-1');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEV MODE'),
    );

    warnSpy.mockRestore();
  });

  it('accepts a wildcard-subdomain origin', async () => {
    const token = await createWidgetToken({
      sub: 'user-1',
      wid: 'user-menu',
      mpAccessToken: 'mp-token',
      origin: 'https://child.wild.example.com',
    });
    const req = buildAuthedRequest({
      token,
      origin: 'https://child.wild.example.com',
    });

    const claims = await requireWidgetAuth(req, { widget: 'user-menu' });
    expect(claims.sub).toBe('user-1');
  });
});

describe('buildOptionsResponse', () => {
  it('returns 204 with full CORS headers when origin is present', () => {
    const req = new NextRequest('http://localhost/api/embed/session', {
      headers: { Origin: 'https://example.com' },
    });
    const res = buildOptionsResponse(req);

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PUT, DELETE, OPTIONS',
    );
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization, Content-Type, Idempotency-Key',
    );
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com',
    );
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('omits Allow-Origin and Vary when no origin can be resolved', () => {
    const req = new NextRequest('http://localhost/api/embed/session');
    const res = buildOptionsResponse(req);

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Vary')).toBeNull();
    // Static headers still present
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, PUT, DELETE, OPTIONS',
    );
  });
});

describe('buildFallbackCorsHeaders', () => {
  it('returns an empty object when origin is empty', () => {
    expect(buildFallbackCorsHeaders('')).toEqual({});
  });

  it('returns CORS headers for a valid origin', () => {
    expect(buildFallbackCorsHeaders('https://example.com')).toEqual({
      'Access-Control-Allow-Origin': 'https://example.com',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Idempotency-Key',
    });
  });
});

describe('getCorsHeaders', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv(
      'EMBED_JWT_SECRET',
      'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256',
    );
  });

  it('returns {} for a disallowed origin in production', () => {
    expect(getCorsHeaders('https://evil.example.com')).toEqual({});
  });

  it('returns full CORS headers for an allowed origin in production', () => {
    const headers = getCorsHeaders('https://allowed.example.com') as Record<
      string,
      string
    >;

    expect(headers['Access-Control-Allow-Origin']).toBe(
      'https://allowed.example.com',
    );
    expect(headers['Access-Control-Allow-Methods']).toBe(
      'GET, POST, OPTIONS',
    );
    expect(headers['Access-Control-Allow-Headers']).toBe(
      'Authorization, Content-Type, Idempotency-Key',
    );
    expect(headers['Access-Control-Max-Age']).toBe('86400');
    expect(headers['Access-Control-Allow-Credentials']).toBe('false');
    expect(headers['Vary']).toBe('Origin');
  });

  it('returns full CORS headers in development even for a disallowed origin', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const headers = getCorsHeaders('https://evil.example.com') as Record<
      string,
      string
    >;

    expect(headers['Access-Control-Allow-Origin']).toBe(
      'https://evil.example.com',
    );
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
  });
});
